"""The agent's MQTT side: stays connected, says whether the Pi is online, publishes discovery and diagnostics.

Availability follows the usual pattern. The last will (retained "offline") is set before connecting, so the
broker announces it if the Pi vanishes. On every connect the agent publishes retained "online", and on a clean
stop it publishes "offline" itself, because a clean disconnect does not trigger the will.

paho-mqtt runs its own network thread (`loop_start`), reconnects by itself, and calls back on that thread. The
main thread only waits in `run`, so a broker that is missing or down never stops the agent: nothing here throws
or blocks on it.
"""

import logging
import threading
import time
from collections.abc import Callable
from typing import Any, Protocol

import paho.mqtt.client as mqtt
from paho.mqtt.client import CallbackAPIVersion, ConnectFlags, DisconnectFlags, MQTTMessage
from paho.mqtt.properties import Properties
from paho.mqtt.reasoncodes import ReasonCode

from . import __version__, discovery, topics
from .config import Config
from .hardware import Hardware

logger = logging.getLogger(__name__)

KEEPALIVE_SECONDS = 30
# How long a clean stop waits for "offline" to reach the broker before giving up.
OFFLINE_PUBLISH_TIMEOUT = 2.0


class MqttClient(Protocol):
    """The part of paho's Client the agent uses, so tests can pass a fake."""

    on_connect: Any
    on_connect_fail: Any
    on_disconnect: Any
    on_message: Any

    def will_set(self, topic: str, payload: str | None = None, qos: int = 0, retain: bool = False) -> Any: ...
    def username_pw_set(self, username: str, password: str | None = None) -> Any: ...
    def tls_set(self) -> Any: ...
    def reconnect_delay_set(self, min_delay: int = 1, max_delay: int = 120) -> Any: ...
    def connect_async(self, host: str, port: int = 1883, keepalive: int = 60) -> Any: ...
    def loop_start(self) -> Any: ...
    def loop_stop(self) -> Any: ...
    def publish(self, topic: str, payload: str | None = None, qos: int = 0, retain: bool = False) -> Any: ...
    def subscribe(self, topic: str, qos: int = 0) -> Any: ...
    def disconnect(self) -> Any: ...


ClientFactory = Callable[[str], MqttClient]


def default_client_factory(client_id: str) -> MqttClient:
    """A real paho client. A persistent session isn't wanted: everything is republished on connect."""
    return mqtt.Client(callback_api_version=CallbackAPIVersion.VERSION2, client_id=client_id, clean_session=True)


class Agent:
    """Owns the MQTT connection for one display's Pi."""

    def __init__(
        self,
        config: Config,
        hardware: Hardware,
        client_factory: ClientFactory = default_client_factory,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._config = config
        self._hardware = hardware
        self._client_factory = client_factory
        self._clock = clock
        self._client: MqttClient | None = None
        self._connected = threading.Event()
        # Whether the current outage has been logged yet, so a broker that stays down doesn't fill the journal.
        self._failure_logged = False
        self._stopped = False

    def _topic(self, name: str) -> str:
        return topics.topic_for(self._config.display_id, name)

    def start(self) -> None:
        """Sets up the last will and starts connecting in the background. Returns at once, connected or not."""
        mqtt_config = self._config.mqtt
        client = self._client_factory(mqtt_config.client_id)
        client.on_connect = self._on_connect
        client.on_connect_fail = self._on_connect_fail
        client.on_disconnect = self._on_disconnect
        client.on_message = self._on_message

        # The will must be set before connecting: the broker only takes it as part of the CONNECT packet.
        client.will_set(self._topic(topics.AVAILABILITY), topics.OFFLINE, qos=1, retain=True)
        if mqtt_config.username is not None:
            client.username_pw_set(mqtt_config.username, mqtt_config.password)
        if mqtt_config.tls:
            client.tls_set()
        client.reconnect_delay_set(min_delay=1, max_delay=60)

        logger.info(
            "Connecting to MQTT broker %s:%d as %s%s",
            mqtt_config.host,
            mqtt_config.port,
            mqtt_config.client_id,
            " (TLS)" if mqtt_config.tls else "",
        )
        client.connect_async(mqtt_config.host, mqtt_config.port, keepalive=KEEPALIVE_SECONDS)
        client.loop_start()
        self._client = client

    def run(self, stop: threading.Event) -> None:
        """Publishes the diagnostics every interval until `stop` is set."""
        interval = self._config.diagnostics_interval_seconds
        due = self._clock() + interval
        while not stop.wait(max(0.0, due - self._clock())):
            # Counting from the due time keeps the rhythm steady; if the Pi was suspended, don't fire a burst.
            due = max(due + interval, self._clock())
            if self._connected.is_set():
                self.publish_diagnostics()

    def stop(self) -> None:
        """Says the Pi is offline, then disconnects. Safe to call more than once."""
        client = self._client
        if client is None or self._stopped:
            return
        self._stopped = True
        if self._connected.is_set():
            # A clean disconnect doesn't send the will, so the offline state is published by hand.
            try:
                info = client.publish(self._topic(topics.AVAILABILITY), topics.OFFLINE, qos=1, retain=True)
                info.wait_for_publish(timeout=OFFLINE_PUBLISH_TIMEOUT)
            except (RuntimeError, ValueError) as error:
                logger.debug("Could not confirm the offline message was sent: %s", error)
        client.disconnect()
        client.loop_stop()
        self._connected.clear()
        logger.info("Disconnected from MQTT broker")

    def publish_diagnostics(self) -> None:
        """Publishes the CPU temperature (if it can be read) and uptime."""
        client = self._client
        if client is None:
            return
        system = self._hardware.system
        try:
            celsius = system.cpu_temperature()
            uptime = system.uptime_seconds()
        except (OSError, ValueError) as error:
            logger.warning("Could not read the Pi's diagnostics: %s", error)
            return
        # A missing temperature is left unpublished rather than sent as a made-up value.
        if celsius is not None:
            client.publish(
                self._topic(topics.CPU_TEMPERATURE), topics.cpu_temperature_payload(celsius), qos=1, retain=False
            )
        client.publish(self._topic(topics.UPTIME), topics.uptime_payload(uptime), qos=1, retain=False)

    def publish_discovery(self) -> None:
        """Publishes every Home Assistant discovery config, retained."""
        client = self._client
        if client is None:
            return
        messages = discovery.discovery_messages(
            self._config.mqtt.discovery_prefix,
            self._config.display_id,
            __version__,
            self._config.diagnostics_interval_seconds,
        )
        for message in messages:
            client.publish(message.topic, message.payload, qos=1, retain=True)

    def _on_connect(
        self,
        client: MqttClient,
        userdata: Any,
        flags: ConnectFlags,
        reason_code: ReasonCode,
        properties: Properties | None,
    ) -> None:
        if reason_code.is_failure:
            self._note_failure(f"MQTT broker refused the connection: {reason_code}")
            return

        self._failure_logged = False
        self._connected.set()
        logger.info("Connected to MQTT broker %s", self._config.mqtt.host)
        client.publish(self._topic(topics.AVAILABILITY), topics.ONLINE, qos=1, retain=True)
        if self._config.mqtt.discovery:
            self.publish_discovery()
            # Home Assistant says when it restarts, and then wants the configs again.
            client.subscribe(discovery.birth_topic(self._config.mqtt.discovery_prefix), qos=1)
        self.publish_diagnostics()

    def _on_connect_fail(self, client: MqttClient, userdata: Any) -> None:
        """paho couldn't reach the broker at all (nothing listening, no route). It keeps retrying."""
        self._note_failure(f"Could not reach MQTT broker {self._config.mqtt.host}:{self._config.mqtt.port}")

    def _on_disconnect(
        self,
        client: MqttClient,
        userdata: Any,
        flags: DisconnectFlags,
        reason_code: ReasonCode,
        properties: Properties | None,
    ) -> None:
        # Only the first report of an outage: a broker that stays away is reported by _note_failure from then on.
        if self._connected.is_set():
            self._connected.clear()
            if not self._stopped:
                logger.info("Lost the MQTT connection (%s). Reconnecting in the background.", reason_code)
            self._failure_logged = True

    def _on_message(self, client: MqttClient, userdata: Any, message: MQTTMessage) -> None:
        if message.topic != discovery.birth_topic(self._config.mqtt.discovery_prefix):
            return
        if message.payload.decode("utf-8", errors="replace") == discovery.BIRTH_ONLINE:
            logger.info("Home Assistant has started; publishing discovery again")
            self.publish_discovery()

    def _note_failure(self, text: str) -> None:
        """Warns about the first failure of an outage, then stays quiet at debug level, as the app does."""
        if self._failure_logged:
            logger.debug("%s", text)
        else:
            self._failure_logged = True
            logger.warning("%s. Will keep retrying.", text)
