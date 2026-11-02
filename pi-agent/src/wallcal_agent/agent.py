"""The agent's MQTT side: stays connected, says whether the Pi is online, publishes discovery and diagnostics, and
turns the panel on and off when asked.

Availability follows the usual pattern. The last will (retained "offline") is set before connecting, so the
broker announces it if the Pi vanishes. On every connect the agent publishes retained "online", and on a clean
stop it publishes "offline" itself, because a clean disconnect does not trigger the will.

paho-mqtt runs its own network thread (`loop_start`), reconnects by itself, and calls back on that thread. The
main thread only waits in `run`, so a broker that is missing or down never stops the agent: nothing here throws
or blocks on it.

Switching the panel runs commands that can take seconds, and a message handler must not wait on them: paho's
thread would stop answering the broker's pings. So the handler only notes what was asked for, and one worker
thread does the work (see `run_screen_work`). The worker also re-checks the panel now and then, because the panel
can be changed behind the agent's back (the monitor's own remote, say).
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
from .hardware import Hardware, ScreenError

logger = logging.getLogger(__name__)

KEEPALIVE_SECONDS = 30
# How long a clean stop waits for "offline" to reach the broker before giving up.
OFFLINE_PUBLISH_TIMEOUT = 2.0
# How much of a bad payload is quoted in the log. It came from the network, so it isn't trusted to be short.
MAX_LOGGED_PAYLOAD = 32


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
        screen_worker: bool = True,
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

        # The panel. `_screen_cond` guards everything in this block, and wakes the worker thread when there is
        # something for it to do. The worker is what runs the screen commands; tests turn it off (`screen_worker`)
        # and call `run_screen_work` and `poll_screen` themselves, so they need no threads or sleeps.
        self._use_screen_worker = screen_worker
        self._screen_thread: threading.Thread | None = None
        self._screen_cond = threading.Condition()
        self._screen_stop = False
        # The newest request that hasn't been applied yet. A later request replaces an earlier one.
        self._screen_wanted: bool | None = None
        # Set on each connect: the current panel state should be published.
        self._screen_announce = False
        # What was last published on this connection, so a poll only publishes a change.
        self._screen_published: bool | None = None
        # The last failure message for each kind of screen call, so a repeat is logged at debug, not warning.
        self._screen_failures: dict[str, str] = {}

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
        logger.info("Panel power back end: %s", self._config.screen.backend)
        client.connect_async(mqtt_config.host, mqtt_config.port, keepalive=KEEPALIVE_SECONDS)
        client.loop_start()
        self._client = client
        if self._use_screen_worker:
            self._screen_thread = threading.Thread(target=self._screen_loop, name="wallcal-screen", daemon=True)
            self._screen_thread.start()

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
        # Before disconnecting, so the worker can't publish into a closed connection. It never leaves the panel
        # half-set: a command already running finishes (or times out), and nothing new is started.
        self._stop_screen_worker()
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
        # Retained, so the last request arrives straight away: an agent that starts late still obeys it.
        client.subscribe(self._topic(topics.SCREEN_SET), qos=1)
        self.publish_diagnostics()
        self._announce_on_connect()

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
        text = message.payload.decode("utf-8", errors="replace")
        if message.topic == self._topic(topics.SCREEN_SET):
            self._on_screen_request(message.topic, text)
        elif (
            message.topic == discovery.birth_topic(self._config.mqtt.discovery_prefix)
            and text == discovery.BIRTH_ONLINE
        ):
            logger.info("Home Assistant has started; publishing discovery again")
            self.publish_discovery()

    def _on_screen_request(self, topic: str, text: str) -> None:
        """Runs on paho's thread, so it only passes the request on."""
        if text == "":
            # Someone cleared the retained request. There is nothing to do, and nothing wrong.
            return
        wanted = topics.parse_screen_payload(text)
        if wanted is None:
            shown = text if len(text) <= MAX_LOGGED_PAYLOAD else text[:MAX_LOGGED_PAYLOAD] + "..."
            logger.warning('Ignoring %s: expected "on" or "off", got %r', topic, shown)
            return
        with self._screen_cond:
            self._screen_wanted = wanted
            self._screen_cond.notify_all()

    def _announce_on_connect(self) -> None:
        """Asks the worker to publish the panel's state, and forgets what was published on the last connection."""
        with self._screen_cond:
            self._screen_published = None
            self._screen_announce = True
            self._screen_cond.notify_all()

    def run_screen_work(self) -> None:
        """Does what the screen needs: applies the newest request, or publishes the state after a connect.

        The worker thread calls this. If a request comes in while one is being applied, the newer one replaces any
        in between and is applied once the current one is done, so on, off, on in a burst ends with the panel on
        and the middle off is skipped. Without the worker (`screen_worker=False`) tests call it themselves.
        """
        while True:
            with self._screen_cond:
                if self._screen_stop:
                    return
                wanted, self._screen_wanted = self._screen_wanted, None
                announce, self._screen_announce = self._screen_announce, False
            if wanted is not None:
                # Applying publishes the state too, which is all an announcement would do.
                self._apply_screen(wanted)
            elif announce:
                self._publish_read_screen_state(only_changes=False)
            else:
                return

    def poll_screen(self) -> None:
        """Reads the panel again, and publishes its state if it is not what was last published on this connection."""
        if self._connected.is_set():
            self._publish_read_screen_state(only_changes=True)

    def _apply_screen(self, on: bool) -> None:
        word = "on" if on else "off"
        logger.info("Turning the panel %s", word)
        succeeded = False
        try:
            self._hardware.screen.set_power(on)
            succeeded = True
            self._screen_failures.pop("set", None)
        except ScreenError as error:
            self._note_screen_failure("set", f"Could not turn the panel {word}: {error}")
        if self._screen_stopping():
            return
        state = self._read_screen()
        if state is None and succeeded:
            # Some panels can't be asked. The command worked, so the request is the best answer there is.
            state = on
        if state is not None:
            self._publish_screen_state(state)

    def _publish_read_screen_state(self, only_changes: bool) -> None:
        state = self._read_screen()
        if state is None:
            return
        if only_changes and state == self._screen_published:
            return
        self._publish_screen_state(state)

    def _read_screen(self) -> bool | None:
        """The panel's state, or None if it can't be told or the check failed."""
        try:
            state = self._hardware.screen.read_power()
        except ScreenError as error:
            self._note_screen_failure("read", f"Could not read the panel's power state: {error}")
            return None
        self._screen_failures.pop("read", None)
        return state

    def _publish_screen_state(self, on: bool) -> None:
        client = self._client
        if client is None or self._screen_stopping() or not self._connected.is_set():
            return
        try:
            client.publish(self._topic(topics.SCREEN_STATE), topics.screen_payload(on), qos=1, retain=True)
        except (RuntimeError, ValueError) as error:
            logger.debug("Could not publish the panel state: %s", error)
            return
        with self._screen_cond:
            self._screen_published = on

    def _note_screen_failure(self, kind: str, text: str) -> None:
        """Warns about a failure, but only the first of a run of identical ones: a panel that stays unreachable
        would otherwise fill the journal every poll. No traceback: the message says what is wrong."""
        if self._screen_failures.get(kind) == text:
            logger.debug("%s", text)
        else:
            self._screen_failures[kind] = text
            logger.warning("%s", text)

    def _screen_stopping(self) -> bool:
        with self._screen_cond:
            return self._screen_stop

    def _screen_loop(self) -> None:
        """The worker thread: sleeps until there is work or a poll is due, and stops when asked."""
        poll = self._config.screen.poll_seconds
        next_poll = self._clock() + poll
        while True:
            with self._screen_cond:
                while not self._screen_stop and self._screen_wanted is None and not self._screen_announce:
                    if poll == 0:
                        self._screen_cond.wait()
                        continue
                    remaining = next_poll - self._clock()
                    if remaining <= 0:
                        break
                    self._screen_cond.wait(remaining)
                if self._screen_stop:
                    return
            self.run_screen_work()
            if poll and self._clock() >= next_poll:
                self.poll_screen()
                next_poll = self._clock() + poll

    def _stop_screen_worker(self) -> None:
        """Tells the worker to stop and waits for it, but not past the time one command is allowed to take."""
        with self._screen_cond:
            self._screen_stop = True
            self._screen_cond.notify_all()
        thread = self._screen_thread
        if thread is None:
            return
        thread.join(timeout=self._config.screen.command_timeout_seconds)
        if thread.is_alive():
            logger.warning("A panel command is still running; stopping without waiting for it")

    def _note_failure(self, text: str) -> None:
        """Warns about the first failure of an outage, then stays quiet at debug level, as the app does."""
        if self._failure_logged:
            logger.debug("%s", text)
        else:
            self._failure_logged = True
            logger.warning("%s. Will keep retrying.", text)
