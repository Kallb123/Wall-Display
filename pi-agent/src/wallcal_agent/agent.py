"""The agent's MQTT side: stays connected, says whether the Pi is online, publishes discovery and diagnostics,
turns the panel on and off when asked, reports presses of the button, says whether anyone is in front of the mmWave
sensor and reports how bright the room is.

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

The button works the same way. The GPIO library calls back on its own thread for every edge, so the callback only
stamps the time and hands the edge to a gesture detector (button.py). A second worker thread sleeps until the
detector's next deadline, then publishes whatever gestures are due (see `run_button_work`). A press while the broker
is away is dropped, not saved: a "long press" arriving minutes late would do something nobody asked for.

Presence has the same shape, with a third worker thread and a filter (presence.py) that only believes a reading once
it has held for a moment. Where it differs is what happens while the broker is away. Presence is a state, not an
event, so nothing is dropped: the latest confirmed state is remembered and published, retained, when the connection
is back. The retained message is also how the app learns the current state when it starts. A clean stop leaves it
alone, so the last known state stays on the broker (the sensor's availability is the agent's own `online`/`offline`).

The light sensor is read, not watched, so its worker thread (a fourth) simply reads it every `light.sample_ms`. A
reading is a measurement, not a state: a stale one replayed to a late subscriber is worse than none, so it is never
retained and nothing is saved while the broker is away. Most readings are the same room again, so they are published
only when the light has changed meaningfully, or every `light.report_seconds` at the least (see light.py). A connect
starts that afresh, so the new connection hears the light at once.

The offline fallback (fallback.py) is the fifth worker thread. The agent listens to the app's own availability, and
when the app has been away for `fallback.timeout_minutes` it looks after the panel itself: off when nobody has been
there for `fallback.off_after_minutes`, on again when someone comes. The policy only decides; the worker thread sleeps
until its next deadline and hands the result to the screen worker, so the panel is only ever switched in one place.
While the agent is in charge the app's retained screen request is ignored (it is the app's last word from before it went
away, and the broker replays it on every connect); it hands back the moment the app says it is online again.
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
from .button import GestureDetector
from .config import Config
from .fallback import HAND_BACK, SCREEN_OFF, SCREEN_ON, TAKE_OVER, FallbackPolicy
from .hardware import ButtonError, Hardware, LightError, PresenceError, ScreenError
from .light import LightReporter
from .presence import PresenceFilter

logger = logging.getLogger(__name__)

KEEPALIVE_SECONDS = 30
# How long a clean stop waits for "offline" to reach the broker before giving up.
OFFLINE_PUBLISH_TIMEOUT = 2.0
# How long a clean stop waits for the button's thread. It only ever waits for a deadline, so it ends at once.
BUTTON_STOP_TIMEOUT = 2.0
# The same for the presence worker.
PRESENCE_STOP_TIMEOUT = 2.0
# How long a clean stop waits for the light worker. It may be in the middle of a reading, which takes up to about half a
# second when the sensor changes range, and is otherwise waiting for the next one, which it is woken from at once.
LIGHT_STOP_TIMEOUT = 2.0
# The same for the fallback worker, which only ever waits for a deadline.
FALLBACK_STOP_TIMEOUT = 2.0
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
        button_worker: bool = True,
        presence_worker: bool = True,
        light_worker: bool = True,
        fallback_worker: bool = True,
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

        # The button. `_button_cond` guards the detector and the stop flag, and wakes the worker when an edge
        # arrives. Tests turn the worker off (`button_worker`), press the fake button, move their clock, and call
        # `run_button_work` themselves.
        self._use_button_worker = button_worker
        self._button_thread: threading.Thread | None = None
        self._button_cond = threading.Condition()
        self._button_stop = False
        # Only set while the button is open: it stays None when there is no button, or it could not be opened.
        self._detector: GestureDetector | None = None

        # Presence. `_presence_cond` guards the filter, the stop flag and the confirmed state, and wakes the worker
        # when a reading changes its deadline. Tests turn the worker off (`presence_worker`), set the fake sensor,
        # move their clock and call `run_presence_work` themselves.
        self._use_presence_worker = presence_worker
        self._presence_thread: threading.Thread | None = None
        self._presence_cond = threading.Condition()
        self._presence_stop = False
        # Only set while the sensor is open: it stays None when there is none, or it could not be opened.
        self._presence_filter: PresenceFilter | None = None
        # The latest confirmed state, kept for the next connect. None until a reading has held.
        self._presence_state: bool | None = None
        # Taken around reading `_presence_state` and publishing it, so an older state can never be published after
        # a newer one when a connect and a change happen together.
        self._presence_publish_lock = threading.Lock()

        # The light sensor. `_light_cond` guards the reporter and the stop flag, and wakes the worker when it is to
        # stop. Tests turn the worker off (`light_worker`), set the fake sensor, move their clock and call
        # `run_light_work` themselves.
        self._use_light_worker = light_worker
        self._light_thread: threading.Thread | None = None
        self._light_cond = threading.Condition()
        self._light_stop = False
        # Only set when there is a sensor: it stays None when `sensors.light` is off.
        self._light_reporter: LightReporter | None = None
        # The message of the last failed reading, so a repeat is logged at debug, not warning. None while it works.
        # Only the worker touches it.
        self._light_failure: str | None = None

        # The offline fallback. `_fallback_cond` guards the policy, the stop flag and whether the app is up, and wakes
        # the worker when an input changes its deadline. Tests turn the worker off (`fallback_worker`), move their
        # clock and call `run_fallback_work` themselves.
        self._use_fallback_worker = fallback_worker
        self._fallback_thread: threading.Thread | None = None
        self._fallback_cond = threading.Condition()
        self._fallback_stop = False
        # Only set when the fallback is in use: it stays None when it is switched off or there is no presence sensor.
        self._fallback: FallbackPolicy | None = None
        # Whether the app is up: connected, and the last availability heard on this connection was "online".
        self._app_up = False
        # The newest valid pi/screen/set, applied again at the hand-back. An app that never went away (it was the
        # Pi that lost the broker) does not publish it again, and the fallback may have switched the panel since.
        self._latest_request: bool | None = None

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
        # Before connecting: the fallback must be there for the first connect to subscribe to the app's availability,
        # or the agent would take over from an app that is there all along. It needs to know whether presence opened.
        self._start_presence()
        self._start_fallback()
        client.connect_async(mqtt_config.host, mqtt_config.port, keepalive=KEEPALIVE_SECONDS)
        client.loop_start()
        self._client = client
        if self._use_screen_worker:
            self._screen_thread = threading.Thread(target=self._screen_loop, name="wallcal-screen", daemon=True)
            self._screen_thread.start()
        self._start_button()
        self._start_light()

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
        # Before disconnecting, so the workers can't publish into a closed connection. The panel is never left
        # half-set: a command already running finishes (or times out), and nothing new is started.
        self._stop_button()
        self._stop_presence()
        self._stop_light()
        self._stop_fallback()
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
            button=self._config.sensors.button,
            presence=self._config.sensors.presence,
            light=self._config.sensors.light,
            light_report_seconds=self._config.light.report_seconds,
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
        if self._fallback is not None:
            # Nothing has been heard on this connection yet, so the app is down until the retained message arrives.
            # Before the screen request, so the app's availability is known by the time its retained request arrives.
            self._feed_app(False)
            for name in topics.WATCHED:
                client.subscribe(self._topic(name), qos=1)
        # Retained, so the last request arrives straight away: an agent that starts late still obeys it.
        client.subscribe(self._topic(topics.SCREEN_SET), qos=1)
        self.publish_diagnostics()
        self._announce_on_connect()
        self._restart_light_reports()
        # Last, so everything else is there when a subscriber sees the retained state.
        self._publish_presence()

    def _on_connect_fail(self, client: MqttClient, userdata: Any) -> None:
        """paho couldn't reach the broker at all (nothing listening, no route). It keeps retrying."""
        self._note_failure(f"Could not reach MQTT broker {self._config.mqtt.host}:{self._config.mqtt.port}")
        self._feed_app(False)

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
        # Without the broker there is no way to hear the app. Repeats are fine: down stays dated from the first.
        self._feed_app(False)

    def _on_message(self, client: MqttClient, userdata: Any, message: MQTTMessage) -> None:
        text = message.payload.decode("utf-8", errors="replace")
        if message.topic == self._topic(topics.SCREEN_SET):
            self._on_screen_request(message.topic, text, message.retain)
        elif message.topic in {self._topic(name) for name in topics.WATCHED}:
            self._on_app_availability(message.topic, text)
        elif (
            message.topic == discovery.birth_topic(self._config.mqtt.discovery_prefix)
            and text == discovery.BIRTH_ONLINE
        ):
            logger.info("Home Assistant has started; publishing discovery again")
            self.publish_discovery()

    def _on_app_availability(self, topic: str, text: str) -> None:
        """Runs on paho's thread. Only "online" means the app is up: anything else is down, and a bad one is logged."""
        up = topics.parse_availability_payload(text)
        if up is None and text != "":
            shown = text if len(text) <= MAX_LOGGED_PAYLOAD else text[:MAX_LOGGED_PAYLOAD] + "..."
            logger.warning('Ignoring %s: expected "online" or "offline", got %r', topic, shown)
        self._feed_app(bool(up))

    def _on_screen_request(self, topic: str, text: str, retained: bool = False) -> None:
        """Runs on paho's thread, so it only passes the request on."""
        if text == "":
            # Someone cleared the retained request. There is nothing to do, and nothing wrong.
            return
        wanted = topics.parse_screen_payload(text)
        if wanted is None:
            shown = text if len(text) <= MAX_LOGGED_PAYLOAD else text[:MAX_LOGGED_PAYLOAD] + "..."
            logger.warning('Ignoring %s: expected "on" or "off", got %r', topic, shown)
            return
        with self._fallback_cond:
            # Kept for the hand-back, ignored or not: it is the newest word on what the panel should be.
            self._latest_request = wanted
        if retained and self._fallback_in_charge():
            # The app's last word from before it went away. The broker replays it on every reconnect, so obeying it
            # would undo what the fallback has just done. It is applied at the hand-back instead.
            logger.info("Ignoring the retained pi/screen/set while the app is away")
            return
        if wanted and not retained:
            self._feed_screen_turned_on()
        self._request_panel(wanted)

    def _request_panel(self, on: bool) -> None:
        """Notes what the panel should be, for the screen worker to apply. The newest request wins."""
        with self._screen_cond:
            self._screen_wanted = on
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

    def _start_button(self) -> None:
        """Opens the button, if there is one, and starts the thread that watches its deadlines.

        A button that can't be opened (the pin is busy, the service user has no GPIO access) is a warning, not a
        reason to stop: the rest of the agent still works, and exiting would only have systemd restart it every
        five seconds.
        """
        button = self._hardware.button
        if button is None:
            return
        settings = self._config.button
        detector = GestureDetector(
            bounce=settings.bounce_ms / 1000,
            double_press=settings.double_press_ms / 1000,
            long_press=settings.long_press_ms / 1000,
        )
        self._detector = detector
        try:
            button.start(self._on_button_change)
        except ButtonError as error:
            self._detector = None
            logger.warning("Could not open the button on GPIO%d: %s; carrying on without it", settings.pin, error)
            return
        logger.info("Watching the button on GPIO%d", settings.pin)
        if self._use_button_worker:
            self._button_thread = threading.Thread(target=self._button_loop, name="wallcal-button", daemon=True)
            self._button_thread.start()

    def _on_button_change(self, pressed: bool) -> None:
        """Runs on the GPIO library's thread, so it only passes the edge on."""
        with self._button_cond:
            detector = self._detector
            if detector is None or self._button_stop:
                return
            # Stamped under the lock so edges reach the detector in the order they happened.
            detector.edge(pressed, self._clock())
            self._button_cond.notify_all()

    def run_button_work(self, now: float | None = None) -> None:
        """Publishes the gestures that are due by `now` (by default, the clock's time now).

        The worker thread calls this when a deadline arrives or an edge comes in. Without the worker
        (`button_worker=False`) tests call it themselves, with the time they want.
        """
        with self._button_cond:
            detector = self._detector
            if detector is None or self._button_stop:
                return
            gestures = detector.tick(self._clock() if now is None else now)
        for gesture in gestures:
            self._publish_gesture(gesture)

    def _publish_gesture(self, gesture: str) -> None:
        logger.info("Button: %s press", gesture)
        client = self._client
        if client is None or not self._connected.is_set():
            logger.debug("Dropped the %s press: not connected to the broker", gesture)
            return
        try:
            # Not retained: a press is something that happened, not something that is true until it changes.
            client.publish(self._topic(topics.BUTTON), topics.button_payload(gesture), qos=1, retain=False)
        except (RuntimeError, ValueError) as error:
            logger.debug("Could not publish the %s press: %s", gesture, error)

    def _button_loop(self) -> None:
        """The worker thread: sleeps until the detector's next deadline or a new edge, and stops when asked."""
        while True:
            with self._button_cond:
                while not self._button_stop:
                    detector = self._detector
                    deadline = detector.next_deadline() if detector is not None else None
                    if deadline is None:
                        self._button_cond.wait()
                        continue
                    remaining = deadline - self._clock()
                    if remaining <= 0:
                        break
                    self._button_cond.wait(remaining)
                if self._button_stop:
                    return
            self.run_button_work()

    def _stop_button(self) -> None:
        """Stops the worker, then closes the input, so nothing more is heard from it."""
        with self._button_cond:
            self._button_stop = True
            self._button_cond.notify_all()
        thread = self._button_thread
        if thread is not None:
            thread.join(timeout=BUTTON_STOP_TIMEOUT)
        button = self._hardware.button
        if button is not None and self._detector is not None:
            button.close()

    def _start_presence(self) -> None:
        """Opens the presence sensor, if there is one, and starts the thread that watches its deadlines.

        A sensor that can't be opened (the pin is busy, no access to the GPIO or the serial port) is a warning and
        not a reason to stop, for the reason the button's isn't.
        """
        sensor = self._hardware.presence
        if sensor is None:
            return
        settings = self._config.presence
        where = f"GPIO{settings.pin}" if settings.source == "gpio" else f"{settings.uart.device} (UART)"
        self._presence_filter = PresenceFilter(hold=settings.hold_ms / 1000)
        try:
            sensor.start(self._on_presence_reading)
        except PresenceError as error:
            self._presence_filter = None
            logger.warning("Could not open the presence sensor on %s: %s; carrying on without it", where, error)
            return
        logger.info("Watching presence on %s", where)
        if self._use_presence_worker:
            self._presence_thread = threading.Thread(target=self._presence_loop, name="wallcal-presence", daemon=True)
            self._presence_thread.start()

    def _on_presence_reading(self, present: bool) -> None:
        """Runs on the sensor's thread (the GPIO library's, or the serial reader's), so it only passes the reading on.

        The serial reader reports ten times a second, so the worker is only woken when the reading changes what it
        is waiting for."""
        with self._presence_cond:
            presence_filter = self._presence_filter
            if presence_filter is None or self._presence_stop:
                return
            before = presence_filter.next_deadline()
            # Stamped under the lock so readings reach the filter in the order they happened.
            presence_filter.update(present, self._clock())
            if presence_filter.next_deadline() != before:
                self._presence_cond.notify_all()

    def run_presence_work(self, now: float | None = None) -> None:
        """Publishes the presence change that is confirmed by `now` (by default, the clock's time now), if any.

        The worker thread calls this when a deadline arrives or a reading changes one. Without the worker
        (`presence_worker=False`) tests call it themselves, with the time they want.
        """
        with self._presence_cond:
            presence_filter = self._presence_filter
            if presence_filter is None or self._presence_stop:
                return
            changed = presence_filter.tick(self._clock() if now is None else now)
            if changed is None:
                return
            self._presence_state = changed
        logger.info("Presence: %s", "someone is there" if changed else "nobody")
        self._publish_presence()
        # After the presence lock is let go: the agent never holds two of its locks at once.
        self._feed_presence(changed, self._clock() if now is None else now)

    def _publish_presence(self) -> None:
        """Publishes the latest confirmed state, retained, if there is one and the broker is there.

        Called for each change and on every connect. A state that changed while the broker was away is not lost:
        it is the state the next connect publishes.
        """
        client = self._client
        with self._presence_publish_lock:
            with self._presence_cond:
                present = self._presence_state
                stopping = self._presence_stop
            if client is None or present is None or stopping or not self._connected.is_set():
                return
            try:
                client.publish(self._topic(topics.PRESENCE), topics.presence_payload(present), qos=1, retain=True)
            except (RuntimeError, ValueError) as error:
                logger.debug("Could not publish presence: %s", error)

    def _presence_loop(self) -> None:
        """The worker thread: sleeps until the filter's next deadline or a new reading, and stops when asked."""
        while True:
            with self._presence_cond:
                while not self._presence_stop:
                    presence_filter = self._presence_filter
                    deadline = presence_filter.next_deadline() if presence_filter is not None else None
                    if deadline is None:
                        self._presence_cond.wait()
                        continue
                    remaining = deadline - self._clock()
                    if remaining <= 0:
                        break
                    self._presence_cond.wait(remaining)
                if self._presence_stop:
                    return
            self.run_presence_work()

    def _stop_presence(self) -> None:
        """Stops the worker, then closes the sensor, so nothing more is heard from it."""
        with self._presence_cond:
            self._presence_stop = True
            self._presence_cond.notify_all()
        thread = self._presence_thread
        if thread is not None:
            thread.join(timeout=PRESENCE_STOP_TIMEOUT)
        sensor = self._hardware.presence
        if sensor is not None and self._presence_filter is not None:
            sensor.close()

    def _start_light(self) -> None:
        """Starts the thread that reads the light sensor, if there is one.

        Nothing is opened here: the sensor opens the bus on its first reading. If that fails (I2C is off, the chip is
        not there) it is a warning and not a reason to stop, for the reason the button's isn't, and the worker keeps
        trying, so a sensor that is plugged in later is found.
        """
        sensor = self._hardware.light
        if sensor is None:
            return
        settings = self._config.light
        self._light_reporter = LightReporter(
            change_percent=settings.change_percent,
            change_lux=settings.change_lux,
            report_interval=settings.report_seconds,
        )
        logger.info(
            "Reading the light sensor (%s at 0x%02x on /dev/i2c-%d)",
            settings.chip.upper(),
            settings.address,
            settings.bus,
        )
        if self._use_light_worker:
            self._light_thread = threading.Thread(target=self._light_loop, name="wallcal-light", daemon=True)
            self._light_thread.start()

    def run_light_work(self, now: float | None = None) -> None:
        """Reads the sensor once, and publishes the reading if it is worth it at `now` (by default, the clock's time
        now): see light.py.

        The worker thread calls this every `light.sample_ms`. Without the worker (`light_worker=False`) tests call
        it themselves, with the time they want.
        """
        sensor = self._hardware.light
        reporter = self._light_reporter
        if sensor is None or reporter is None or self._light_stopping():
            return
        try:
            # Outside the lock: it can take half a second, and the connect callback must not wait for it.
            lux = sensor.read_lux()
        except LightError as error:
            text = f"Could not read the light sensor: {error}; will keep trying"
            if self._light_failure == text:
                logger.debug("%s", text)
            else:
                self._light_failure = text
                logger.warning("%s", text)
            return
        if self._light_failure is not None:
            self._light_failure = None
            logger.info("The light sensor is reading again")
        with self._light_cond:
            # While the broker is away the reporter isn't asked: nothing is published, so nothing may be marked as
            # published, or the first reading after the connect could be held back as "no change".
            if self._light_stop or not self._connected.is_set():
                return
            due = reporter.offer(lux, self._clock() if now is None else now)
        if due:
            self._publish_illuminance(lux)

    def _publish_illuminance(self, lux: float) -> None:
        client = self._client
        if client is None:
            return
        try:
            # Not retained: a reading is a measurement, and a stale one is worse than none.
            client.publish(self._topic(topics.ILLUMINANCE), topics.illuminance_payload(lux), qos=1, retain=False)
        except (RuntimeError, ValueError) as error:
            logger.debug("Could not publish the light reading: %s", error)

    def _restart_light_reports(self) -> None:
        """Forgets what was published, so the next reading is, now that there is a connection to hear it."""
        with self._light_cond:
            reporter = self._light_reporter
            if reporter is not None:
                reporter.reset()

    def _light_stopping(self) -> bool:
        with self._light_cond:
            return self._light_stop

    def _light_loop(self) -> None:
        """The worker thread: reads the sensor every `sample_ms`, and stops when asked."""
        interval = self._config.light.sample_ms / 1000
        due = self._clock()
        while True:
            with self._light_cond:
                while not self._light_stop:
                    remaining = due - self._clock()
                    if remaining <= 0:
                        break
                    self._light_cond.wait(remaining)
                if self._light_stop:
                    return
            self.run_light_work()
            # Counting from the due time keeps the rhythm steady; if a reading took longer than the interval, or the
            # Pi was suspended, don't fire a burst.
            due = max(due + interval, self._clock())

    def _stop_light(self) -> None:
        """Stops the worker, then closes the sensor, so nothing more is read."""
        with self._light_cond:
            self._light_stop = True
            self._light_cond.notify_all()
        thread = self._light_thread
        if thread is not None:
            thread.join(timeout=LIGHT_STOP_TIMEOUT)
            if thread.is_alive():
                logger.warning("A light sensor reading is still running; stopping without waiting for it")
        sensor = self._hardware.light
        if sensor is not None and self._light_reporter is not None:
            sensor.close()

    def _start_fallback(self) -> None:
        """Starts the fallback, if it is switched on and there is a presence sensor to go on, and says which it is."""
        settings = self._config.fallback
        if not settings.enabled:
            logger.info("Offline fallback: off")
            return
        if self._presence_filter is None:
            logger.info("Offline fallback: off (needs sensors.presence)")
            return
        # The app counts as down from now, so a Pi that boots while the server is away still takes over in time.
        self._fallback = FallbackPolicy(
            timeout=settings.timeout_minutes * 60, off_after=settings.off_after_minutes * 60, now=self._clock()
        )
        logger.info(
            "Offline fallback: on (takes over after %d min without the app; screen off after %d min with nobody there)",
            settings.timeout_minutes,
            settings.off_after_minutes,
        )
        if self._use_fallback_worker:
            self._fallback_thread = threading.Thread(target=self._fallback_loop, name="wallcal-fallback", daemon=True)
            self._fallback_thread.start()

    def _feed_app(self, up: bool) -> None:
        """Tells the policy whether the app is up, and wakes the worker."""
        with self._fallback_cond:
            policy = self._fallback
            if policy is None or self._fallback_stop:
                return
            self._app_up = up
            policy.app(up, self._clock())
            self._fallback_cond.notify_all()

    def _feed_presence(self, present: bool, now: float) -> None:
        with self._fallback_cond:
            policy = self._fallback
            if policy is None or self._fallback_stop:
                return
            policy.presence(present, now)
            self._fallback_cond.notify_all()

    def _feed_screen_turned_on(self) -> None:
        """A live request to turn the panel on: if nobody is there, the wait for an empty room starts again."""
        with self._fallback_cond:
            policy = self._fallback
            if policy is None or self._fallback_stop:
                return
            policy.screen_turned_on(self._clock())
            self._fallback_cond.notify_all()

    def _fallback_in_charge(self) -> bool:
        """Whether the fallback is looking after the panel now. The policy only takes over when a call settles a
        take-over that has fallen due, so it is told what it already knows first."""
        with self._fallback_cond:
            policy = self._fallback
            if policy is None or self._fallback_stop:
                return False
            policy.app(self._app_up, self._clock())
            return policy.in_charge

    def run_fallback_work(self, now: float | None = None) -> None:
        """Carries out what the fallback has decided by `now` (by default, the clock's time now), if anything.

        The worker thread calls this when a deadline arrives or an input changes one. Without the worker
        (`fallback_worker=False`) tests call it themselves, with the time they want. The panel is switched through
        the screen worker, as a request over MQTT is, never from here.
        """
        settings = self._config.fallback
        with self._fallback_cond:
            policy = self._fallback
            if policy is None or self._fallback_stop:
                return
            actions = policy.tick(self._clock() if now is None else now)
            latest = self._latest_request
        for action in actions:
            if action == TAKE_OVER:
                logger.warning(
                    "The app has been away for %d minutes; the agent is looking after the screen until it is back",
                    settings.timeout_minutes,
                )
            elif action == HAND_BACK:
                logger.info("The app is back; handing the screen back to it")
                if latest is not None:
                    # What the app last asked for. If it has just connected it is publishing this again anyway.
                    self._request_panel(latest)
            elif action == SCREEN_ON:
                logger.info("Offline fallback: someone is there, turning the panel on")
                self._request_panel(True)
            elif action == SCREEN_OFF:
                logger.info(
                    "Offline fallback: nobody for %d minutes, turning the panel off", settings.off_after_minutes
                )
                self._request_panel(False)

    def _fallback_loop(self) -> None:
        """The worker thread: sleeps until the policy's next deadline or a new input, and stops when asked."""
        while True:
            with self._fallback_cond:
                while not self._fallback_stop:
                    policy = self._fallback
                    deadline = policy.next_deadline() if policy is not None else None
                    if deadline is None:
                        self._fallback_cond.wait()
                        continue
                    remaining = deadline - self._clock()
                    if remaining <= 0:
                        break
                    self._fallback_cond.wait(remaining)
                if self._fallback_stop:
                    return
            self.run_fallback_work()

    def _stop_fallback(self) -> None:
        """Stops the worker. Before the screen worker, so nothing asks for a panel change that will not be made."""
        with self._fallback_cond:
            self._fallback_stop = True
            self._fallback_cond.notify_all()
        thread = self._fallback_thread
        if thread is not None:
            thread.join(timeout=FALLBACK_STOP_TIMEOUT)

    def _note_failure(self, text: str) -> None:
        """Warns about the first failure of an outage, then stays quiet at debug level, as the app does."""
        if self._failure_logged:
            logger.debug("%s", text)
        else:
            self._failure_logged = True
            logger.warning("%s. Will keep retrying.", text)
