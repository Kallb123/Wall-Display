import json
import logging
import threading
import time
from collections.abc import Callable
from dataclasses import replace

import pytest
from paho.mqtt.client import MQTTMessage
from paho.mqtt.enums import CallbackAPIVersion

from wallcal_agent import __version__, topics
from wallcal_agent.agent import Agent, default_client_factory
from wallcal_agent.config import ButtonConfig, Config, PresenceConfig, ScreenConfig, SensorsConfig, UartConfig
from wallcal_agent.discovery import discovery_messages
from wallcal_agent.hardware import Hardware
from wallcal_agent.hardware.fake import FakeButton, FakePresence, FakeScreen, FakeSystemInfo

from .conftest import PASSWORD, AgentRig, FakeMessageInfo, FakeMqttClient, Published

AVAILABILITY = "wallcal/hallway/pi/availability"
CPU = "wallcal/hallway/pi/cpu_temperature"
UPTIME = "wallcal/hallway/pi/uptime"
SCREEN_SET = "wallcal/hallway/pi/screen/set"
SCREEN_STATE = "wallcal/hallway/pi/screen/state"
BUTTON = "wallcal/hallway/pi/button"
BUTTON_DISCOVERY = "homeassistant/event/wallcal_pi_hallway/button/config"
PRESENCE = "wallcal/hallway/pi/presence"
PRESENCE_DISCOVERY = "homeassistant/binary_sensor/wallcal_pi_hallway/presence/config"


def by_topic(client: FakeMqttClient) -> dict[str, Published]:
    return {p.topic: p for p in client.publishes}


def test_start_sets_up_the_client_and_connects_in_the_background(rig: AgentRig) -> None:
    client = rig.client

    assert client.client_id == "wallcal-pi-hallway"
    assert client.will == Published(AVAILABILITY, "offline", 1, True)
    assert client.credentials == ("wallcal", PASSWORD)
    assert client.tls is False
    assert client.reconnect_delays == (1, 60)
    assert client.connect_args == ("broker.test", 1883, 30)
    assert client.loop_running is True
    # The broker only accepts a will as part of the connect, so it has to come first.
    assert client.calls.index("will_set") < client.calls.index("connect_async")
    # Nothing is published until the broker has accepted the connection.
    assert client.publishes == []


def test_start_without_login_or_tls_options(make_agent: Callable[[Config], AgentRig], config: Config) -> None:
    plain = make_agent(replace(config, mqtt=replace(config.mqtt, username=None, password=None)))
    plain.agent.start()

    assert plain.client.credentials is None


def test_start_with_tls(make_agent: Callable[[Config], AgentRig], config: Config) -> None:
    secure = make_agent(replace(config, mqtt=replace(config.mqtt, tls=True, port=8883)))
    secure.agent.start()

    assert secure.client.tls is True
    assert secure.client.connect_args == ("broker.test", 8883, 30)


def test_connecting_says_online_and_publishes_discovery_and_diagnostics(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    published = by_topic(rig.client)

    assert published[AVAILABILITY] == Published(AVAILABILITY, "online", 1, True)
    expected = discovery_messages("homeassistant", "hallway", __version__, 60, button=False, presence=False)
    for message in expected:
        assert published[message.topic] == Published(message.topic, message.payload, 1, True)
    assert published[CPU] == Published(CPU, "48.3", 1, False)
    assert published[UPTIME] == Published(UPTIME, "3600", 1, False)
    assert rig.client.subscriptions == [("homeassistant/status", 1), (SCREEN_SET, 1)]


def test_availability_is_published_before_the_rest(rig: AgentRig) -> None:
    rig.client.broker_accepts()

    assert rig.client.publishes[0].topic == AVAILABILITY


def test_discovery_off_publishes_no_configs_and_does_not_subscribe(
    make_agent: Callable[[Config], AgentRig], config: Config
) -> None:
    quiet = make_agent(replace(config, mqtt=replace(config.mqtt, discovery=False)))
    quiet.agent.start()
    quiet.client.broker_accepts()

    assert sorted(p.topic for p in quiet.client.publishes) == sorted([AVAILABILITY, CPU, UPTIME])
    assert quiet.client.subscriptions == [(SCREEN_SET, 1)]


def test_a_custom_discovery_prefix_is_used(make_agent: Callable[[Config], AgentRig], config: Config) -> None:
    custom = make_agent(replace(config, mqtt=replace(config.mqtt, discovery_prefix="ha/custom")))
    custom.agent.start()
    custom.client.broker_accepts()

    assert "ha/custom/sensor/wallcal_pi_hallway/uptime/config" in by_topic(custom.client)
    assert custom.client.subscriptions == [("ha/custom/status", 1), (SCREEN_SET, 1)]


def test_the_discovery_config_uses_the_diagnostics_interval(
    make_agent: Callable[[Config], AgentRig], config: Config
) -> None:
    slow = make_agent(replace(config, diagnostics_interval_seconds=300))
    slow.agent.start()
    slow.client.broker_accepts()

    payload = by_topic(slow.client)["homeassistant/sensor/wallcal_pi_hallway/uptime/config"].payload
    assert payload is not None
    assert json.loads(payload)["expire_after"] == 900


def test_home_assistant_birth_republishes_discovery(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    rig.client.clear()

    rig.client.message_arrives("homeassistant/status", "online")

    expected = discovery_messages("homeassistant", "hallway", __version__, 60, button=False, presence=False)
    assert rig.client.publishes == [Published(m.topic, m.payload, 1, True) for m in expected]


@pytest.mark.parametrize(
    ("topic", "payload"),
    [
        ("homeassistant/status", "offline"),
        ("homeassistant/status", "Online"),
        ("homeassistant/status", ""),
        ("homeassistant/other", "online"),
        ("wallcal/hallway/pi/uptime", "on"),
        ("wallcal/other/pi/screen/set", "off"),
    ],
)
def test_other_messages_are_ignored(rig: AgentRig, topic: str, payload: str) -> None:
    rig.client.broker_accepts()
    rig.client.clear()

    rig.client.message_arrives(topic, payload)

    assert rig.client.publishes == []


def test_a_message_that_is_not_text_does_not_break_the_agent(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    rig.client.clear()
    bad = MQTTMessage(topic=b"homeassistant/status")
    bad.payload = b"\xff\xfe"

    rig.client.on_message(rig.client, None, bad)

    assert rig.client.publishes == []


def test_reconnecting_publishes_everything_again(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    first = list(rig.client.publishes)
    rig.client.connection_drops()
    rig.client.clear()

    rig.client.broker_accepts()

    assert rig.client.publishes == first


def test_diagnostics_skip_the_temperature_when_it_cannot_be_read(rig: AgentRig) -> None:
    rig.system.temperature = None
    rig.client.broker_accepts()
    published = by_topic(rig.client)

    assert CPU not in published
    assert published[UPTIME].payload == "3600"


def test_diagnostics_follow_the_hardware(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    rig.client.clear()
    rig.system.temperature = -3.04
    rig.system.uptime = 7200.9

    rig.agent.publish_diagnostics()

    assert rig.client.publishes == [Published(CPU, "-3.0", 1, False), Published(UPTIME, "7200", 1, False)]


def test_unreadable_uptime_is_logged_and_nothing_is_published(
    rig: AgentRig, config: Config, caplog: pytest.LogCaptureFixture
) -> None:
    class Broken(FakeSystemInfo):
        def uptime_seconds(self) -> float:
            raise OSError("no /proc")

    agent = Agent(config, Hardware(system=Broken(), screen=rig.screen), client_factory=lambda _: rig.client)
    agent.start()
    rig.client.clear()

    with caplog.at_level(logging.WARNING, logger="wallcal_agent.agent"):
        agent.publish_diagnostics()

    assert rig.client.publishes == []
    assert "Could not read" in caplog.text


def test_diagnostics_before_start_do_nothing(make_agent: Callable[[Config], AgentRig], config: Config) -> None:
    idle = make_agent(config)

    idle.agent.publish_diagnostics()
    idle.agent.publish_discovery()

    assert idle.client.publishes == []


class ScriptedStop(threading.Event):
    """A stop event whose waits return at once, recording how long the agent asked to wait."""

    def __init__(self, ticks: int, on_wait: Callable[[], None] | None = None) -> None:
        super().__init__()
        self.waits: list[float] = []
        self._ticks = ticks
        self._on_wait = on_wait

    def wait(self, timeout: float | None = None) -> bool:
        self.waits.append(timeout or 0.0)
        if self._on_wait is not None:
            self._on_wait()
        if len(self.waits) > self._ticks:
            self.set()
        return self.is_set()


def test_run_publishes_diagnostics_each_interval_while_connected(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    rig.client.clear()

    stop = ScriptedStop(ticks=3)
    rig.agent.run(stop)

    assert [p.topic for p in rig.client.publishes] == [CPU, UPTIME] * 3
    assert 0 < stop.waits[0] <= 60


def test_run_publishes_nothing_while_disconnected(rig: AgentRig) -> None:
    stop = ScriptedStop(ticks=2)

    rig.agent.run(stop)

    assert rig.client.publishes == []


def test_run_keeps_a_steady_rhythm_with_the_clock(make_agent: Callable[[Config], AgentRig], config: Config) -> None:
    now = [1000.0]
    rig = make_agent(config)
    agent = Agent(
        config,
        Hardware(system=rig.system, screen=rig.screen),
        client_factory=lambda _: rig.client,
        clock=lambda: now[0],
        screen_worker=False,
    )

    def pass_time() -> None:
        now[0] += 62.0  # a publish that ran 2 seconds late

    stop = ScriptedStop(ticks=2, on_wait=pass_time)
    agent.run(stop)

    # The first wait is the whole interval. That tick ran 2 s late (the clock is at 1062), but the next is still
    # due at 1120, so the agent waits 58 s, not another 60.
    assert stop.waits[:2] == [60.0, 58.0]


def test_stop_publishes_offline_waits_for_it_and_disconnects(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    rig.client.clear()
    rig.client.calls.clear()

    rig.agent.stop()

    assert rig.client.publishes == [Published(AVAILABILITY, "offline", 1, True)]
    assert rig.client.infos[-1].waited_with == 2.0
    assert rig.client.calls == [f"publish {AVAILABILITY}", "disconnect", "loop_stop"]
    assert rig.client.loop_running is False


def test_stop_while_disconnected_just_shuts_down(rig: AgentRig) -> None:
    rig.agent.stop()

    assert rig.client.publishes == []
    assert rig.client.disconnected is True
    assert rig.client.loop_running is False


def test_stop_twice_is_harmless(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    rig.agent.stop()
    count = len(rig.client.publishes)

    rig.agent.stop()

    assert len(rig.client.publishes) == count


def test_stop_before_start_is_harmless(make_agent: Callable[[Config], AgentRig], config: Config) -> None:
    make_agent(config).agent.stop()


def test_stop_survives_a_publish_that_cannot_be_confirmed(rig: AgentRig) -> None:
    rig.client.broker_accepts()

    def failing_publish(*args: object, **kwargs: object) -> None:
        raise RuntimeError("Message publish failed: The client is not currently connected.")

    rig.client.publish = failing_publish  # type: ignore[method-assign]
    rig.agent.stop()

    assert rig.client.disconnected is True


def test_a_refused_connection_warns_once_then_goes_quiet(rig: AgentRig, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.DEBUG, logger="wallcal_agent.agent"):
        rig.client.broker_refuses()
        rig.client.broker_refuses()
        rig.client.broker_unreachable()

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "Not authorized" in warnings[0].getMessage()
    assert len([r for r in caplog.records if r.levelno == logging.DEBUG]) == 2
    assert rig.client.publishes == []


def test_the_warning_comes_back_after_a_successful_connection(rig: AgentRig, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO, logger="wallcal_agent.agent"):
        rig.client.broker_unreachable()
        rig.client.broker_accepts()
        rig.client.connection_drops()
        rig.client.broker_unreachable()  # same outage as the drop, so quiet
        rig.client.broker_accepts()
        rig.client.connection_drops()

    assert len([r for r in caplog.records if r.levelno == logging.WARNING]) == 1
    assert len([r for r in caplog.records if "Lost the MQTT connection" in r.getMessage()]) == 2


def test_a_dropped_connection_is_logged_once(rig: AgentRig, caplog: pytest.LogCaptureFixture) -> None:
    rig.client.broker_accepts()

    with caplog.at_level(logging.INFO, logger="wallcal_agent.agent"):
        rig.client.connection_drops()
        rig.client.connection_drops()

    assert len([r for r in caplog.records if "Lost the MQTT connection" in r.getMessage()]) == 1


def test_the_password_never_reaches_the_log_or_a_publish(
    rig: AgentRig, config: Config, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.DEBUG):
        rig.client.broker_refuses()
        rig.client.broker_unreachable()
        rig.client.broker_accepts()
        rig.client.connection_drops()
        rig.client.message_arrives("homeassistant/status", "online")
        rig.agent.stop()

    assert PASSWORD not in caplog.text
    assert PASSWORD not in repr(config)
    assert all(PASSWORD not in (p.payload or "") for p in rig.client.publishes)
    assert "broker.test" in caplog.text


def test_starting_logs_the_broker_and_client_id_but_not_the_password(
    make_agent: Callable[[Config], AgentRig], config: Config, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.DEBUG):
        make_agent(config).agent.start()

    assert "broker.test:1883" in caplog.text
    assert "wallcal-pi-hallway" in caplog.text
    assert PASSWORD not in caplog.text


def test_default_client_factory_makes_a_paho_2_client() -> None:
    client = default_client_factory("wallcal-pi-test")

    assert client._callback_api_version == CallbackAPIVersion.VERSION2  # type: ignore[attr-defined]
    assert client._client_id == b"wallcal-pi-test"  # type: ignore[attr-defined]


def test_topics_published_are_the_ones_declared(config: Config, make_agent: Callable[[Config], AgentRig]) -> None:
    rig = make_agent(replace(config, sensors=SensorsConfig(button=True, presence=True)))
    rig.agent.start()
    rig.client.broker_accepts()
    rig.agent.run_screen_work()
    tap(rig)
    after(rig, 1.0)
    assert rig.presence is not None
    rig.presence.set(True)
    rig.clock.advance(1.0)
    rig.agent.run_presence_work()

    names = {p.topic.removeprefix("wallcal/hallway/") for p in rig.client.publishes if p.topic.startswith("wallcal/")}
    assert names == set(topics.PUBLISHED)


# The panel. The rig has no worker thread, so `run_screen_work()` is the worker's turn and the test decides when.


def ask(rig: AgentRig, payload: str) -> None:
    rig.client.message_arrives(SCREEN_SET, payload)


def state_publishes(client: FakeMqttClient) -> list[Published]:
    return [p for p in client.publishes if p.topic == SCREEN_STATE]


def test_every_connect_subscribes_to_screen_requests_at_qos_1(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    assert (SCREEN_SET, 1) in rig.client.subscriptions

    rig.client.subscriptions.clear()
    rig.client.connection_drops()
    rig.client.broker_accepts()
    assert (SCREEN_SET, 1) in rig.client.subscriptions


def test_a_request_is_only_noted_on_pahos_thread_and_applied_by_the_worker(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    rig.client.clear()

    ask(rig, "off")

    # Nothing has touched the panel, or even read it: that is the worker's job, not the message handler's.
    assert rig.screen.set_calls == []
    assert rig.screen.read_count == 0
    assert rig.client.publishes == []

    rig.agent.run_screen_work()

    assert rig.screen.set_calls == [False]
    assert state_publishes(rig.client) == [Published(SCREEN_STATE, "off", 1, True)]


def test_a_retained_request_that_arrives_right_after_connecting_is_applied(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    ask(rig, "off")
    rig.client.clear()

    rig.agent.run_screen_work()

    assert rig.screen.set_calls == [False]
    # The connect's own announcement is folded into applying the request, so the state is published once.
    assert state_publishes(rig.client) == [Published(SCREEN_STATE, "off", 1, True)]


def test_nothing_touches_the_panel_until_a_request_arrives(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    rig.agent.run_screen_work()
    rig.agent.poll_screen()

    assert rig.screen.set_calls == []


def test_connecting_publishes_the_current_panel_state_when_it_can_be_read(rig: AgentRig) -> None:
    rig.screen.power = False
    rig.client.broker_accepts()

    assert state_publishes(rig.client) == []  # not on the connect callback's thread

    rig.agent.run_screen_work()

    assert state_publishes(rig.client) == [Published(SCREEN_STATE, "off", 1, True)]


def test_connecting_publishes_nothing_when_the_state_is_unknown(rig: AgentRig) -> None:
    rig.screen.power = None
    rig.client.broker_accepts()

    rig.agent.run_screen_work()

    assert state_publishes(rig.client) == []
    assert rig.screen.set_calls == []


def test_reconnecting_publishes_the_state_again_even_if_it_has_not_changed(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    rig.agent.run_screen_work()
    rig.client.connection_drops()
    rig.client.clear()

    rig.client.broker_accepts()
    rig.agent.run_screen_work()

    assert state_publishes(rig.client) == [Published(SCREEN_STATE, "on", 1, True)]


def test_work_is_done_once(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    ask(rig, "off")
    rig.agent.run_screen_work()
    rig.client.clear()

    rig.agent.run_screen_work()

    assert rig.screen.set_calls == [False]
    assert rig.client.publishes == []


def test_an_empty_request_is_a_cleared_retained_message_and_is_ignored_quietly(
    rig: AgentRig, caplog: pytest.LogCaptureFixture
) -> None:
    rig.client.broker_accepts()
    rig.agent.run_screen_work()
    rig.client.clear()

    with caplog.at_level(logging.DEBUG, logger="wallcal_agent.agent"):
        ask(rig, "")
        rig.agent.run_screen_work()

    assert rig.screen.set_calls == []
    assert rig.client.publishes == []
    assert caplog.records == []


@pytest.mark.parametrize("payload", ["ON", "Off", "true", "1", "toggle", " on", "on\n", "{}", "   "])
def test_a_bad_request_gets_one_warning_naming_the_topic_and_is_ignored(
    rig: AgentRig, caplog: pytest.LogCaptureFixture, payload: str
) -> None:
    rig.client.broker_accepts()
    rig.agent.run_screen_work()
    rig.client.clear()

    with caplog.at_level(logging.DEBUG, logger="wallcal_agent.agent"):
        ask(rig, payload)
        rig.agent.run_screen_work()

    assert [r.levelno for r in caplog.records] == [logging.WARNING]
    assert SCREEN_SET in caplog.text
    assert repr(payload) in caplog.text
    assert rig.screen.set_calls == []
    assert rig.client.publishes == []


def test_a_bad_request_does_not_cancel_one_that_is_waiting(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    rig.agent.run_screen_work()

    ask(rig, "off")
    ask(rig, "nonsense")
    rig.agent.run_screen_work()

    assert rig.screen.set_calls == [False]


def test_a_long_bad_payload_is_cut_short_in_the_log(rig: AgentRig, caplog: pytest.LogCaptureFixture) -> None:
    rig.client.broker_accepts()

    with caplog.at_level(logging.WARNING, logger="wallcal_agent.agent"):
        ask(rig, "x" * 5000)

    assert len(caplog.text) < 400
    assert "..." in caplog.text


def test_a_screen_request_that_is_not_text_is_a_bad_request_not_a_crash(
    rig: AgentRig, caplog: pytest.LogCaptureFixture
) -> None:
    rig.client.broker_accepts()
    bad = MQTTMessage(topic=SCREEN_SET.encode())
    bad.payload = b"\xff\xfe"

    with caplog.at_level(logging.WARNING, logger="wallcal_agent.agent"):
        rig.client.on_message(rig.client, None, bad)
    rig.agent.run_screen_work()

    assert "Ignoring" in caplog.text
    assert rig.screen.set_calls == []


def test_requests_that_pile_up_apply_only_the_newest(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    rig.agent.run_screen_work()
    rig.client.clear()

    for payload in ("off", "on", "off"):
        ask(rig, payload)
    rig.agent.run_screen_work()

    assert rig.screen.set_calls == [False]
    assert [p.payload for p in state_publishes(rig.client)] == ["off"]


def test_requests_that_arrive_while_one_is_applied_collapse_to_the_newest_which_runs_after_it(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    rig.agent.run_screen_work()
    rig.client.clear()

    def more_arrive(on: bool) -> None:
        rig.screen.on_set = None
        for payload in ("off", "on", "off"):
            ask(rig, payload)

    rig.screen.on_set = more_arrive
    ask(rig, "on")
    rig.agent.run_screen_work()

    # The first request ran, then only the newest of the three that arrived during it. Never the middle one.
    assert rig.screen.set_calls == [True, False]
    assert [p.payload for p in state_publishes(rig.client)] == ["on", "off"]


def test_a_request_to_the_state_it_is_already_in_is_still_applied(rig: AgentRig) -> None:
    # A panel the agent thinks is on may have been switched off by hand, so the request is always carried out.
    rig.client.broker_accepts()
    ask(rig, "on")

    rig.agent.run_screen_work()

    assert rig.screen.set_calls == [True]


def test_the_state_published_is_what_the_panel_reports_not_what_was_asked(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    rig.agent.run_screen_work()
    rig.client.clear()
    rig.screen.applies_requests = False  # a panel that ignores the command

    ask(rig, "off")
    rig.agent.run_screen_work()

    assert [p.payload for p in state_publishes(rig.client)] == ["on"]


@pytest.mark.parametrize("on", [True, False])
def test_when_the_panel_cannot_be_read_the_requested_state_is_published(rig: AgentRig, on: bool) -> None:
    rig.screen.power = None
    rig.screen.applies_requests = False
    rig.client.broker_accepts()
    rig.agent.run_screen_work()
    rig.client.clear()

    ask(rig, "on" if on else "off")
    rig.agent.run_screen_work()

    assert state_publishes(rig.client) == [Published(SCREEN_STATE, "on" if on else "off", 1, True)]


def test_when_reading_fails_but_the_command_worked_the_requested_state_is_published(
    rig: AgentRig, caplog: pytest.LogCaptureFixture
) -> None:
    rig.client.broker_accepts()
    rig.agent.run_screen_work()
    rig.client.clear()
    rig.screen.read_error = "cec-client did not finish within 10 seconds"

    with caplog.at_level(logging.WARNING, logger="wallcal_agent.agent"):
        ask(rig, "off")
        rig.agent.run_screen_work()

    assert [p.payload for p in state_publishes(rig.client)] == ["off"]
    assert [r.levelno for r in caplog.records] == [logging.WARNING]
    assert "Could not read the panel's power state: cec-client did not finish" in caplog.text


def test_a_failed_command_is_a_warning_without_a_traceback_and_the_real_state_is_published(
    rig: AgentRig, caplog: pytest.LogCaptureFixture
) -> None:
    rig.client.broker_accepts()
    rig.agent.run_screen_work()
    rig.client.clear()
    rig.screen.set_error = "cec-client exited with status 1: no adapter found"

    with caplog.at_level(logging.DEBUG, logger="wallcal_agent.agent"):
        ask(rig, "off")
        rig.agent.run_screen_work()

    assert [r.levelno for r in caplog.records if r.levelno >= logging.WARNING] == [logging.WARNING]
    warning = next(r for r in caplog.records if r.levelno == logging.WARNING)
    assert warning.exc_info is None
    assert warning.getMessage() == "Could not turn the panel off: cec-client exited with status 1: no adapter found"
    # The panel didn't change, and reading says so; that is what Home Assistant is told.
    assert [p.payload for p in state_publishes(rig.client)] == ["on"]


def test_nothing_is_published_when_both_the_command_and_the_read_fail(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    rig.agent.run_screen_work()
    rig.client.clear()
    rig.screen.set_error = "boom"
    rig.screen.read_error = "boom"

    ask(rig, "off")
    rig.agent.run_screen_work()

    assert state_publishes(rig.client) == []


def test_a_failed_command_with_an_unknown_state_publishes_nothing(rig: AgentRig) -> None:
    rig.screen.power = None
    rig.client.broker_accepts()
    rig.agent.run_screen_work()
    rig.client.clear()
    rig.screen.set_error = "boom"

    ask(rig, "off")
    rig.agent.run_screen_work()

    assert state_publishes(rig.client) == []


def test_the_worker_carries_on_after_a_failure(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    rig.screen.set_error = "boom"
    ask(rig, "off")
    rig.agent.run_screen_work()
    rig.screen.set_error = None
    rig.client.clear()

    ask(rig, "off")
    rig.agent.run_screen_work()

    assert [p.payload for p in state_publishes(rig.client)] == ["off"]


def test_the_same_failure_over_and_over_warns_once_then_logs_at_debug(
    rig: AgentRig, caplog: pytest.LogCaptureFixture
) -> None:
    rig.client.broker_accepts()
    rig.agent.run_screen_work()
    rig.screen.set_error = "wlopm is not installed"

    with caplog.at_level(logging.DEBUG, logger="wallcal_agent.agent"):
        for _ in range(3):
            ask(rig, "off")
            rig.agent.run_screen_work()

    failures = [r for r in caplog.records if "Could not turn the panel off" in r.getMessage()]
    assert [r.levelno for r in failures] == [logging.WARNING, logging.DEBUG, logging.DEBUG]


def test_a_different_failure_or_one_after_a_success_warns_again(
    rig: AgentRig, caplog: pytest.LogCaptureFixture
) -> None:
    rig.client.broker_accepts()
    rig.agent.run_screen_work()

    with caplog.at_level(logging.DEBUG, logger="wallcal_agent.agent"):
        rig.screen.set_error = "first problem"
        ask(rig, "off")
        rig.agent.run_screen_work()
        rig.screen.set_error = "second problem"
        ask(rig, "off")
        rig.agent.run_screen_work()
        rig.screen.set_error = None
        ask(rig, "off")
        rig.agent.run_screen_work()
        rig.screen.set_error = "second problem"
        ask(rig, "off")
        rig.agent.run_screen_work()

    failures = [r for r in caplog.records if "Could not turn the panel off" in r.getMessage()]
    assert [r.levelno for r in failures] == [logging.WARNING] * 3


def test_a_poll_publishes_only_when_the_state_differs_from_what_was_last_published(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    rig.agent.run_screen_work()  # publishes "on"
    rig.client.clear()

    rig.agent.poll_screen()
    assert rig.client.publishes == []

    rig.screen.power = False  # someone used the monitor's remote
    rig.agent.poll_screen()
    assert state_publishes(rig.client) == [Published(SCREEN_STATE, "off", 1, True)]

    rig.client.clear()
    rig.agent.poll_screen()
    assert rig.client.publishes == []

    rig.screen.power = True
    rig.agent.poll_screen()
    assert [p.payload for p in state_publishes(rig.client)] == ["on"]
    assert rig.screen.set_calls == []


def test_a_poll_compares_with_what_a_request_published(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    ask(rig, "off")
    rig.agent.run_screen_work()
    rig.client.clear()

    rig.agent.poll_screen()

    assert rig.client.publishes == []


def test_a_poll_publishes_the_first_time_after_each_connect(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    rig.agent.run_screen_work()
    rig.client.connection_drops()
    rig.client.broker_accepts()
    rig.client.clear()

    rig.agent.poll_screen()

    assert [p.payload for p in state_publishes(rig.client)] == ["on"]


def test_a_poll_does_nothing_while_disconnected(rig: AgentRig) -> None:
    rig.agent.poll_screen()
    rig.client.broker_accepts()
    rig.client.connection_drops()
    rig.screen.read_count = 0

    rig.agent.poll_screen()

    assert rig.screen.read_count == 0
    assert rig.client.publishes[-1].topic != SCREEN_STATE


def test_a_poll_that_cannot_read_publishes_nothing_and_warns_once(
    rig: AgentRig, caplog: pytest.LogCaptureFixture
) -> None:
    rig.client.broker_accepts()
    rig.agent.run_screen_work()
    rig.client.clear()
    rig.screen.read_error = "cec-client is not installed"

    with caplog.at_level(logging.DEBUG, logger="wallcal_agent.agent"):
        for _ in range(3):
            rig.agent.poll_screen()

    assert rig.client.publishes == []
    assert [r.levelno for r in caplog.records] == [logging.WARNING, logging.DEBUG, logging.DEBUG]


def test_a_poll_that_reads_unknown_publishes_nothing(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    rig.agent.run_screen_work()
    rig.client.clear()
    rig.screen.power = None

    rig.agent.poll_screen()

    assert rig.client.publishes == []


def test_the_state_is_not_published_while_disconnected(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    ask(rig, "off")
    rig.client.connection_drops()
    rig.client.clear()

    rig.agent.run_screen_work()

    assert rig.screen.set_calls == [False]
    assert rig.client.publishes == []


def test_the_state_comes_after_availability_on_connect(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    rig.agent.run_screen_work()

    topics_in_order = [p.topic for p in rig.client.publishes]
    assert topics_in_order.index(AVAILABILITY) < topics_in_order.index(SCREEN_STATE)


def test_stopping_drops_work_that_has_not_started_and_leaves_the_panel_as_it_is(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    ask(rig, "off")

    rig.agent.stop()
    rig.client.clear()
    rig.agent.run_screen_work()

    assert rig.screen.set_calls == []
    assert rig.screen.power is True
    assert rig.client.publishes == []


def test_a_clean_stop_does_not_switch_the_panel(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    rig.agent.run_screen_work()

    rig.agent.stop()

    assert rig.screen.set_calls == []
    assert rig.screen.power is True


def test_the_offline_message_is_still_the_last_thing_published_on_stop(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    ask(rig, "off")

    rig.agent.stop()

    assert rig.client.publishes[-1] == Published(AVAILABILITY, "offline", 1, True)


# With the real worker thread. The logic is covered above without threads; these check the threading itself.


class Threaded:
    """An agent with its own screen worker, and a client that plays the broker from the test's thread."""

    def __init__(self, config: Config, screen: FakeScreen) -> None:
        self.client = FakeMqttClient()
        self.screen = screen
        self.agent = Agent(
            config,
            Hardware(system=FakeSystemInfo(), screen=screen),
            client_factory=lambda _: self.client,
        )
        self.agent.start()

    def states(self) -> list[str]:
        return [p.payload or "" for p in state_publishes(self.client)]


def wait_until(condition: Callable[[], bool], timeout: float = 5.0) -> bool:
    """Waits for something another thread is doing, without a fixed sleep: it returns as soon as it holds."""
    deadline = time.monotonic() + timeout
    pause = threading.Event()
    while not condition():
        if time.monotonic() > deadline:
            return False
        pause.wait(0.002)
    return True


def test_the_worker_thread_applies_requests_and_publishes_the_state(config: Config) -> None:
    screen = FakeScreen(power=True)
    threads: list[str] = []
    screen.on_set = lambda on: threads.append(threading.current_thread().name)
    rig = Threaded(config, screen)
    try:
        rig.client.broker_accepts()
        assert wait_until(lambda: rig.states() == ["on"])

        rig.client.message_arrives(SCREEN_SET, "off")
        assert wait_until(lambda: rig.states() == ["on", "off"])
    finally:
        rig.agent.stop()

    assert screen.set_calls == [False]
    # Never on the thread that called the message handler (paho's, here the test's).
    assert threads == ["wallcal-screen"]
    assert threading.current_thread().name not in threads


def test_a_slow_command_does_not_hold_up_the_message_handler_and_a_burst_collapses(config: Config) -> None:
    screen = FakeScreen(power=True)
    started = threading.Event()
    gate = threading.Event()

    def slow(on: bool) -> None:
        started.set()
        gate.wait(5)

    screen.on_set = slow
    rig = Threaded(config, screen)
    try:
        rig.client.broker_accepts()
        assert wait_until(lambda: rig.states() == ["on"])

        rig.client.message_arrives(SCREEN_SET, "off")
        assert started.wait(5)
        # The first command is stuck, yet more messages are taken at once.
        screen.on_set = None
        for payload in ("on", "off", "on"):
            rig.client.message_arrives(SCREEN_SET, payload)
        gate.set()

        assert wait_until(lambda: rig.states() == ["on", "off", "on"])
    finally:
        gate.set()
        rig.agent.stop()

    assert screen.set_calls == [False, True]


def test_the_worker_polls_on_its_own(config: Config) -> None:
    polled = threading.Event()

    class Watching(FakeScreen):
        def read_power(self) -> bool | None:
            result = super().read_power()
            if self.read_count > 1:
                polled.set()
            return result

    ticks = iter(range(0, 10**9, 10))  # every look at the clock is 10 s later, so a poll is always due
    screen = Watching(power=True)
    client = FakeMqttClient()
    agent = Agent(
        replace(config, screen=ScreenConfig(poll_seconds=5)),
        Hardware(system=FakeSystemInfo(), screen=screen),
        client_factory=lambda _: client,
        clock=lambda: float(next(ticks)),
    )
    agent.start()
    try:
        client.broker_accepts()
        assert polled.wait(5)
    finally:
        agent.stop()


def test_without_polling_the_worker_waits_for_requests(config: Config) -> None:
    screen = FakeScreen(power=True)
    rig = Threaded(replace(config, screen=ScreenConfig(poll_seconds=0)), screen)
    try:
        rig.client.broker_accepts()
        assert wait_until(lambda: rig.states() == ["on"])
        reads = screen.read_count

        rig.client.message_arrives(SCREEN_SET, "off")
        assert wait_until(lambda: rig.states() == ["on", "off"])
    finally:
        rig.agent.stop()

    assert reads == 1
    assert screen.read_count == 2


def test_stop_ends_the_worker_thread(config: Config) -> None:
    rig = Threaded(config, FakeScreen(power=True))
    rig.client.broker_accepts()
    assert wait_until(lambda: rig.states() == ["on"])
    thread = rig.agent._screen_thread
    assert thread is not None and thread.is_alive()

    rig.agent.stop()

    assert not thread.is_alive()


def test_stop_does_not_wait_longer_than_one_command_may_take(config: Config, caplog: pytest.LogCaptureFixture) -> None:
    screen = FakeScreen(power=True)
    started = threading.Event()
    gate = threading.Event()

    def stuck(on: bool) -> None:
        started.set()
        gate.wait(10)

    screen.on_set = stuck
    rig = Threaded(replace(config, screen=ScreenConfig(command_timeout_seconds=1)), screen)
    try:
        rig.client.broker_accepts()
        rig.client.message_arrives(SCREEN_SET, "off")
        assert started.wait(5)

        before = time.monotonic()
        with caplog.at_level(logging.WARNING, logger="wallcal_agent.agent"):
            rig.agent.stop()
        elapsed = time.monotonic() - before
    finally:
        gate.set()

    assert elapsed < 4
    assert rig.client.disconnected is True
    assert "still running" in caplog.text
    # The command that was stuck finishes later without publishing anything: the agent is already stopped.
    thread = rig.agent._screen_thread
    assert thread is not None
    thread.join(5)
    assert not thread.is_alive()
    assert rig.client.publishes[-1] == Published(AVAILABILITY, "offline", 1, True)


# The button. Like the panel, the rig has no worker thread: a test presses the fake button, moves the clock and calls
# `run_button_work()` when the worker would have woken. The timings are the config's defaults: 30 ms to bounce,
# 400 ms for a double, 1 s for a long press.


def button_publishes(client: FakeMqttClient) -> list[Published]:
    return [p for p in client.publishes if p.topic == BUTTON]


def fake_button(rig: AgentRig) -> FakeButton:
    assert rig.button is not None
    return rig.button


def connected(rig: AgentRig) -> AgentRig:
    rig.client.broker_accepts()
    rig.client.clear()
    return rig


def after(rig: AgentRig, seconds: float) -> list[str]:
    """Lets time pass, lets the worker have its turn, and returns every gesture published so far."""
    rig.clock.advance(seconds)
    rig.agent.run_button_work()
    return [p.payload or "" for p in button_publishes(rig.client)]


def tap(rig: AgentRig, held: float = 0.0625) -> None:
    fake_button(rig).press()
    rig.clock.advance(held)
    fake_button(rig).release()


def test_start_opens_the_button(button_rig: AgentRig) -> None:
    assert fake_button(button_rig).started is True
    assert fake_button(button_rig).closed is False


def test_start_logs_the_pin_the_button_is_on(
    button_config: Config, make_agent: Callable[[Config], AgentRig], caplog: pytest.LogCaptureFixture
) -> None:
    rig = make_agent(replace(button_config, button=ButtonConfig(pin=22)))

    with caplog.at_level(logging.INFO, logger="wallcal_agent.agent"):
        rig.agent.start()

    assert "Watching the button on GPIO22" in caplog.text


def test_without_a_button_nothing_is_started_and_the_button_work_does_nothing(rig: AgentRig) -> None:
    assert rig.button is None
    rig.client.broker_accepts()
    rig.client.clear()

    rig.agent.run_button_work()
    rig.agent.run_button_work(now=1e9)

    assert rig.client.publishes == []
    assert rig.agent._button_thread is None


def test_a_single_press_is_published_once_the_double_press_window_has_passed(button_rig: AgentRig) -> None:
    connected(button_rig)
    tap(button_rig)

    assert after(button_rig, 0.0625) == []
    assert after(button_rig, 0.25) == []
    assert after(button_rig, 0.25) == ["single"]
    assert after(button_rig, 5.0) == ["single"]


def test_a_gesture_is_published_at_qos_1_and_not_retained(button_rig: AgentRig) -> None:
    connected(button_rig)
    tap(button_rig)
    after(button_rig, 1.0)

    assert button_publishes(button_rig.client) == [Published(BUTTON, "single", 1, False)]


def test_a_double_press_is_published_as_soon_as_the_second_press_is_confirmed(button_rig: AgentRig) -> None:
    connected(button_rig)
    tap(button_rig)
    button_rig.clock.advance(0.125)
    fake_button(button_rig).press()

    assert after(button_rig, 0.0) == []  # not confirmed yet: it might be a bounce
    assert after(button_rig, 0.0625) == ["double"]

    fake_button(button_rig).release()
    assert after(button_rig, 5.0) == ["double"]


def test_a_long_press_is_published_while_the_button_is_still_held(button_rig: AgentRig) -> None:
    connected(button_rig)
    fake_button(button_rig).press()

    assert after(button_rig, 0.5) == []
    assert after(button_rig, 0.5) == ["long"]

    fake_button(button_rig).release()
    assert after(button_rig, 5.0) == ["long"]


def test_the_edge_callback_only_notes_the_edge_and_publishes_nothing(button_rig: AgentRig) -> None:
    connected(button_rig)

    tap(button_rig)
    button_rig.clock.advance(10.0)

    # Time has passed and nobody ran the worker: all that happened is that the edges were noted.
    assert button_publishes(button_rig.client) == []
    assert button_rig.client.publishes == []


def test_the_times_come_from_the_config_in_milliseconds(
    button_config: Config, make_agent: Callable[[Config], AgentRig]
) -> None:
    rig = make_agent(replace(button_config, button=ButtonConfig(bounce_ms=0, double_press_ms=2000, long_press_ms=300)))
    rig.agent.start()
    connected(rig)

    fake_button(rig).press()
    assert after(rig, 0.25) == []
    assert after(rig, 0.0625) == ["long"]
    fake_button(rig).release()
    tap(rig)
    # A 2 s double press window: nothing yet after 1.5 s.
    assert after(rig, 1.5) == ["long"]
    assert after(rig, 0.5) == ["long", "single"]


def test_a_blip_shorter_than_the_bounce_time_is_not_a_press(button_rig: AgentRig) -> None:
    connected(button_rig)

    fake_button(button_rig).press()
    button_rig.clock.advance(0.0078125)
    fake_button(button_rig).release()

    assert after(button_rig, 10.0) == []


def test_a_press_while_the_broker_is_away_is_dropped_and_not_sent_later(
    button_rig: AgentRig, caplog: pytest.LogCaptureFixture
) -> None:
    button_rig.client.broker_accepts()
    button_rig.client.connection_drops()
    button_rig.client.clear()
    tap(button_rig)

    with caplog.at_level(logging.DEBUG, logger="wallcal_agent.agent"):
        assert after(button_rig, 1.0) == []
    button_rig.client.broker_accepts()
    button_rig.agent.run_button_work()

    assert button_publishes(button_rig.client) == []
    assert "Dropped the single press" in caplog.text


def test_a_press_before_the_first_connection_is_dropped_too(button_rig: AgentRig) -> None:
    tap(button_rig)
    after(button_rig, 1.0)
    button_rig.client.broker_accepts()
    button_rig.agent.run_button_work()

    assert button_publishes(button_rig.client) == []


def test_the_button_works_again_after_a_reconnect(button_rig: AgentRig) -> None:
    connected(button_rig)
    button_rig.client.connection_drops()
    tap(button_rig)
    after(button_rig, 1.0)
    button_rig.client.broker_accepts()
    button_rig.client.clear()

    tap(button_rig)

    assert after(button_rig, 1.0) == ["single"]


def test_every_gesture_is_logged_at_info(button_rig: AgentRig, caplog: pytest.LogCaptureFixture) -> None:
    connected(button_rig)

    with caplog.at_level(logging.INFO, logger="wallcal_agent.agent"):
        tap(button_rig)
        after(button_rig, 0.125)
        fake_button(button_rig).press()
        after(button_rig, 1.0)
        fake_button(button_rig).release()
        after(button_rig, 1.0)

    messages = [r.getMessage() for r in caplog.records if r.levelno == logging.INFO]
    # The tap and the press 0.125 s later make a double; the second one is held, so it adds nothing.
    assert messages == ["Button: double press"]


def test_a_dropped_press_is_still_logged_at_info(button_rig: AgentRig, caplog: pytest.LogCaptureFixture) -> None:
    tap(button_rig)

    with caplog.at_level(logging.INFO, logger="wallcal_agent.agent"):
        after(button_rig, 1.0)

    assert "Button: single press" in caplog.text


def test_a_publish_that_fails_is_logged_quietly_and_the_button_carries_on(
    button_rig: AgentRig, caplog: pytest.LogCaptureFixture
) -> None:
    connected(button_rig)
    failures = iter([RuntimeError("not connected")])

    def publish(topic: str, payload: str | None = None, qos: int = 0, retain: bool = False) -> None:
        error = next(failures, None)
        if error is not None:
            raise error

    original = button_rig.client.publish
    button_rig.client.publish = publish  # type: ignore[method-assign]
    tap(button_rig)
    with caplog.at_level(logging.DEBUG, logger="wallcal_agent.agent"):
        after(button_rig, 1.0)
    button_rig.client.publish = original  # type: ignore[method-assign]
    tap(button_rig)

    assert "Could not publish the single press" in caplog.text
    assert after(button_rig, 1.0) == ["single"]


def test_a_button_that_cannot_be_opened_is_one_warning_and_the_agent_carries_on(
    button_config: Config, make_agent: Callable[[Config], AgentRig], caplog: pytest.LogCaptureFixture
) -> None:
    rig = make_agent(button_config)
    fake_button(rig).start_error = "pin GPIO17 is already in use"

    with caplog.at_level(logging.INFO, logger="wallcal_agent.agent"):
        rig.agent.start()
        rig.client.broker_accepts()
        rig.agent.run_button_work()
        rig.agent.stop()

    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert warnings == ["Could not open the button on GPIO17: pin GPIO17 is already in use; carrying on without it"]
    assert "Watching the button" not in caplog.text
    # Everything else works: it connected, said it was online and said it was offline again.
    assert rig.client.publishes[0].topic == AVAILABILITY
    assert rig.client.publishes[-1] == Published(AVAILABILITY, "offline", 1, True)
    assert rig.client.disconnected is True


def test_a_button_that_could_not_be_opened_is_not_closed_and_gets_no_thread(
    button_config: Config, caplog: pytest.LogCaptureFixture
) -> None:
    button = FakeButton()
    button.start_error = "no access"
    client = FakeMqttClient()
    agent = Agent(
        button_config,
        Hardware(system=FakeSystemInfo(), screen=FakeScreen(power=True), button=button),
        client_factory=lambda _: client,
        screen_worker=False,
    )

    agent.start()
    try:
        assert agent._button_thread is None
    finally:
        agent.stop()

    assert button.closed is False


def test_stop_closes_the_button_before_it_disconnects(button_config: Config, system: FakeSystemInfo) -> None:
    client = FakeMqttClient()

    class Recording(FakeButton):
        def close(self) -> None:
            client.calls.append("button closed")
            super().close()

    button = Recording()
    agent = Agent(
        button_config,
        Hardware(system=system, screen=FakeScreen(power=True), button=button),
        client_factory=lambda _: client,
        screen_worker=False,
    )
    agent.start()
    client.broker_accepts()
    client.calls.clear()

    agent.stop()

    assert client.calls.index("button closed") < client.calls.index(f"publish {AVAILABILITY}")
    assert client.calls.index("button closed") < client.calls.index("disconnect")
    assert button.closed is True


def test_presses_after_stop_are_ignored(button_rig: AgentRig) -> None:
    connected(button_rig)
    button = fake_button(button_rig)
    button_rig.agent.stop()
    button_rig.client.clear()

    # A late callback from the GPIO library's thread, as if the input had not quite been closed yet.
    button_rig.agent._on_button_change(True)
    button_rig.clock.advance(5.0)
    button_rig.agent.run_button_work()

    assert button.closed is True
    assert button_publishes(button_rig.client) == []


def test_stopping_drops_a_gesture_that_has_not_been_published(button_rig: AgentRig) -> None:
    connected(button_rig)
    tap(button_rig)
    button_rig.clock.advance(5.0)

    button_rig.agent.stop()
    button_rig.agent.run_button_work()

    assert button_publishes(button_rig.client) == []


def test_discovery_has_the_button_entity_when_the_button_is_on(button_rig: AgentRig) -> None:
    button_rig.client.broker_accepts()

    published = by_topic(button_rig.client)[BUTTON_DISCOVERY]

    assert published.retain is True
    assert published.payload is not None
    config = json.loads(published.payload)
    assert config["state_topic"] == BUTTON
    assert config["event_types"] == ["single", "double", "long"]


def test_discovery_removes_the_button_entity_when_the_button_is_off(rig: AgentRig) -> None:
    rig.client.broker_accepts()

    assert by_topic(rig.client)[BUTTON_DISCOVERY] == Published(BUTTON_DISCOVERY, "", 1, True)


def test_discovery_after_home_assistant_restarts_follows_the_button_setting(button_rig: AgentRig) -> None:
    button_rig.client.broker_accepts()
    button_rig.client.clear()

    button_rig.client.message_arrives("homeassistant/status", "online")

    expected = discovery_messages("homeassistant", "hallway", __version__, 60, button=True, presence=False)
    assert button_rig.client.publishes == [Published(m.topic, m.payload, 1, True) for m in expected]


# With the real worker thread. The logic is covered above without threads; these check the threading itself. They use
# the real clock, so the times are the shortest the config allows (no bounce, 100 ms and 300 ms) to keep them quick.

QUICK = ButtonConfig(bounce_ms=0, double_press_ms=100, long_press_ms=300)


class ThreadedButton:
    """An agent with its own button worker, and a client that notes which thread published each gesture."""

    def __init__(self, config: Config, button: ButtonConfig = QUICK) -> None:
        self.threads: list[str] = []
        outer = self

        class Client(FakeMqttClient):
            def publish(
                self, topic: str, payload: str | None = None, qos: int = 0, retain: bool = False
            ) -> FakeMessageInfo:
                if topic == BUTTON:
                    outer.threads.append(threading.current_thread().name)
                return super().publish(topic, payload, qos, retain)

        self.client = Client()
        self.button = FakeButton()
        self.agent = Agent(
            replace(config, sensors=SensorsConfig(button=True), button=button),
            Hardware(system=FakeSystemInfo(), screen=FakeScreen(power=True), button=self.button),
            client_factory=lambda _: self.client,
            screen_worker=False,
        )
        self.agent.start()

    def gestures(self) -> list[str]:
        return [p.payload or "" for p in list(button_publishes(self.client))]


def test_the_worker_thread_publishes_a_single_after_the_window(config: Config) -> None:
    rig = ThreadedButton(config)
    try:
        rig.client.broker_accepts()
        rig.button.press()
        rig.button.release()

        assert wait_until(lambda: rig.gestures() == ["single"])
    finally:
        rig.agent.stop()

    # Never on the thread that pressed the button (the GPIO library's, here the test's).
    assert rig.threads == ["wallcal-button"]


def test_the_worker_thread_publishes_a_double_straight_away(config: Config) -> None:
    rig = ThreadedButton(config, ButtonConfig(bounce_ms=0, double_press_ms=2000, long_press_ms=10000))
    try:
        rig.client.broker_accepts()
        for _ in range(2):
            rig.button.press()
            rig.button.release()

        # Far sooner than the 2 s window: a double does not wait for it.
        assert wait_until(lambda: rig.gestures() == ["double"], timeout=1.5)
    finally:
        rig.agent.stop()


def test_the_worker_thread_publishes_a_long_press_while_the_button_is_held(config: Config) -> None:
    rig = ThreadedButton(config)
    try:
        rig.client.broker_accepts()
        rig.button.press()

        assert wait_until(lambda: rig.gestures() == ["long"])
        rig.button.release()
    finally:
        rig.agent.stop()

    assert rig.gestures() == ["long"]


def test_the_worker_thread_waits_for_the_bounce_time_then_publishes(config: Config) -> None:
    rig = ThreadedButton(config, ButtonConfig(bounce_ms=200, double_press_ms=100, long_press_ms=300))
    try:
        rig.client.broker_accepts()
        rig.button.press()
        rig.button.release()  # a blip within the bounce time: nothing ever happens
        rig.button.press()
        rig.button.release()
        rig.button.press()

        assert wait_until(lambda: rig.gestures() == ["long"], timeout=2)
    finally:
        rig.agent.stop()


def test_the_worker_thread_is_a_daemon_and_stop_ends_it(config: Config) -> None:
    rig = ThreadedButton(config)
    thread = rig.agent._button_thread
    assert thread is not None and thread.is_alive() and thread.daemon
    assert thread.name == "wallcal-button"

    rig.agent.stop()

    assert not thread.is_alive()
    assert rig.button.closed is True


def test_stop_does_not_wait_for_a_long_deadline(config: Config) -> None:
    rig = ThreadedButton(config, ButtonConfig(bounce_ms=0, double_press_ms=2000, long_press_ms=10000))
    rig.client.broker_accepts()
    rig.button.press()
    time.sleep(0.05)
    thread = rig.agent._button_thread
    assert thread is not None

    before = time.monotonic()
    rig.agent.stop()

    assert time.monotonic() - before < 1.5
    assert not thread.is_alive()


# Presence. As with the button, the rig has no worker thread: a test sets the fake sensor, moves the clock and calls
# `run_presence_work()` when the worker would have woken. The hold time is the config's default, 500 ms.


def presence_publishes(client: FakeMqttClient) -> list[Published]:
    return [p for p in client.publishes if p.topic == PRESENCE]


def fake_presence(rig: AgentRig) -> FakePresence:
    assert rig.presence is not None
    return rig.presence


def presence_after(rig: AgentRig, seconds: float) -> list[str]:
    """Lets time pass, lets the worker have its turn, and returns every presence payload published so far."""
    rig.clock.advance(seconds)
    rig.agent.run_presence_work()
    return [p.payload or "" for p in presence_publishes(rig.client)]


def test_start_opens_the_presence_sensor(presence_rig: AgentRig) -> None:
    assert fake_presence(presence_rig).started is True
    assert fake_presence(presence_rig).closed is False


def test_start_logs_where_the_sensor_is(
    presence_config: Config, make_agent: Callable[[Config], AgentRig], caplog: pytest.LogCaptureFixture
) -> None:
    on_gpio = make_agent(replace(presence_config, presence=PresenceConfig(pin=22)))
    on_uart = make_agent(
        replace(presence_config, presence=PresenceConfig(source="uart", uart=UartConfig(device="/dev/ttyAMA0")))
    )

    with caplog.at_level(logging.INFO, logger="wallcal_agent.agent"):
        on_gpio.agent.start()
        on_uart.agent.start()

    messages = [r.getMessage() for r in caplog.records if r.name == "wallcal_agent.agent"]
    assert "Watching presence on GPIO22" in messages
    assert "Watching presence on /dev/ttyAMA0 (UART)" in messages


def test_without_a_presence_sensor_nothing_is_started_and_the_presence_work_does_nothing(rig: AgentRig) -> None:
    assert rig.presence is None
    rig.client.broker_accepts()
    rig.client.clear()

    rig.agent.run_presence_work()
    rig.agent.run_presence_work(now=1e9)

    assert rig.client.publishes == []
    assert rig.agent._presence_thread is None


def test_someone_arriving_is_published_once_it_has_held_and_is_retained_at_qos_1(presence_rig: AgentRig) -> None:
    connected(presence_rig)
    fake_presence(presence_rig).set(True)

    assert presence_after(presence_rig, 0.25) == []
    assert presence_after(presence_rig, 0.25) == ["ON"]
    assert presence_after(presence_rig, 5.0) == ["ON"]
    assert presence_publishes(presence_rig.client) == [Published(PRESENCE, "ON", 1, True)]


def test_the_hold_is_counted_from_when_the_reading_first_changed_not_from_each_repeat(presence_rig: AgentRig) -> None:
    connected(presence_rig)

    # A serial sensor repeats the reading many times a second. The repeats do not start the hold again.
    for _ in range(4):
        fake_presence(presence_rig).set(True)
        presence_rig.clock.advance(0.125)

    assert presence_after(presence_rig, 0.0) == ["ON"]


def test_someone_leaving_is_published_as_off(presence_rig: AgentRig) -> None:
    connected(presence_rig)
    fake_presence(presence_rig).set(True)
    presence_after(presence_rig, 1.0)

    fake_presence(presence_rig).set(False)

    assert presence_after(presence_rig, 0.25) == ["ON"]
    assert presence_after(presence_rig, 0.25) == ["ON", "OFF"]


def test_the_first_reading_counts_even_when_nobody_is_there(presence_rig: AgentRig) -> None:
    connected(presence_rig)

    fake_presence(presence_rig).set(False)

    assert presence_after(presence_rig, 1.0) == ["OFF"]


def test_a_flicker_shorter_than_the_hold_is_not_published(presence_rig: AgentRig) -> None:
    connected(presence_rig)
    fake_presence(presence_rig).set(True)
    presence_after(presence_rig, 1.0)

    fake_presence(presence_rig).set(False)
    presence_rig.clock.advance(0.25)
    fake_presence(presence_rig).set(True)

    assert presence_after(presence_rig, 10.0) == ["ON"]


def test_the_reading_callback_only_notes_the_reading_and_publishes_nothing(presence_rig: AgentRig) -> None:
    connected(presence_rig)

    fake_presence(presence_rig).set(True)
    presence_rig.clock.advance(10.0)

    # Time has passed and nobody ran the worker: all that happened is that the reading was noted.
    assert presence_rig.client.publishes == []


def test_the_worker_is_only_woken_when_a_reading_changes_what_it_waits_for(presence_rig: AgentRig) -> None:
    wakes = []
    presence_rig.agent._presence_cond.notify_all = lambda: wakes.append(1)  # type: ignore[method-assign]

    for _ in range(10):
        fake_presence(presence_rig).set(True)
        presence_rig.clock.advance(0.0625)

    # Once, for the first reading that started the hold. The nine repeats change nothing it is waiting for.
    assert wakes == [1]


def test_the_hold_comes_from_the_config_in_milliseconds(
    presence_config: Config, make_agent: Callable[[Config], AgentRig]
) -> None:
    quick = make_agent(replace(presence_config, presence=PresenceConfig(hold_ms=0)))
    slow = make_agent(replace(presence_config, presence=PresenceConfig(hold_ms=3000)))
    for rig in (quick, slow):
        rig.agent.start()
        connected(rig)
        fake_presence(rig).set(True)

    assert presence_after(quick, 0.0) == ["ON"]
    assert presence_after(slow, 2.5) == []
    assert presence_after(slow, 0.5) == ["ON"]


def test_a_change_while_the_broker_is_away_is_remembered_and_published_when_it_is_back(
    presence_rig: AgentRig,
) -> None:
    presence_rig.client.broker_accepts()
    presence_rig.client.connection_drops()
    presence_rig.client.clear()
    fake_presence(presence_rig).set(True)

    assert presence_after(presence_rig, 1.0) == []

    presence_rig.client.broker_accepts()

    assert presence_publishes(presence_rig.client) == [Published(PRESENCE, "ON", 1, True)]


def test_only_the_latest_state_is_published_when_the_broker_comes_back(presence_rig: AgentRig) -> None:
    presence_rig.client.broker_accepts()
    presence_rig.client.connection_drops()
    presence_rig.client.clear()
    fake_presence(presence_rig).set(True)
    presence_after(presence_rig, 1.0)
    fake_presence(presence_rig).set(False)
    presence_after(presence_rig, 1.0)

    presence_rig.client.broker_accepts()

    assert [p.payload for p in presence_publishes(presence_rig.client)] == ["OFF"]


def test_every_connect_publishes_the_current_state_again(presence_rig: AgentRig) -> None:
    connected(presence_rig)
    fake_presence(presence_rig).set(True)
    presence_after(presence_rig, 1.0)
    presence_rig.client.clear()

    presence_rig.client.connection_drops()
    presence_rig.client.broker_accepts()

    assert presence_publishes(presence_rig.client) == [Published(PRESENCE, "ON", 1, True)]


def test_connecting_before_any_reading_has_held_publishes_nothing(presence_rig: AgentRig) -> None:
    presence_rig.client.broker_accepts()
    fake_presence(presence_rig).set(True)
    presence_after(presence_rig, 0.25)
    presence_rig.client.connection_drops()
    presence_rig.client.broker_accepts()

    assert presence_publishes(presence_rig.client) == []


def test_presence_comes_after_availability_on_connect(presence_rig: AgentRig) -> None:
    fake_presence(presence_rig).set(True)
    presence_after(presence_rig, 1.0)

    presence_rig.client.broker_accepts()

    topics_in_order = [p.topic for p in presence_rig.client.publishes]
    assert topics_in_order[0] == AVAILABILITY
    assert topics_in_order.index(PRESENCE) > topics_in_order.index(UPTIME)


def test_every_change_is_logged_at_info_even_while_the_broker_is_away(
    presence_rig: AgentRig, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger="wallcal_agent.agent"):
        fake_presence(presence_rig).set(True)
        presence_after(presence_rig, 1.0)
        fake_presence(presence_rig).set(False)
        presence_after(presence_rig, 1.0)

    messages = [r.getMessage() for r in caplog.records if r.getMessage().startswith("Presence")]
    assert messages == ["Presence: someone is there", "Presence: nobody"]


def test_a_publish_that_fails_is_logged_quietly_and_the_next_connect_publishes_the_state(
    presence_rig: AgentRig, caplog: pytest.LogCaptureFixture
) -> None:
    connected(presence_rig)
    original = presence_rig.client.publish

    def refuse(topic: str, payload: str | None = None, qos: int = 0, retain: bool = False) -> None:
        raise RuntimeError("not connected")

    presence_rig.client.publish = refuse  # type: ignore[method-assign]
    fake_presence(presence_rig).set(True)
    with caplog.at_level(logging.DEBUG, logger="wallcal_agent.agent"):
        presence_after(presence_rig, 1.0)
    presence_rig.client.publish = original  # type: ignore[method-assign]
    presence_rig.client.connection_drops()
    presence_rig.client.broker_accepts()

    assert "Could not publish presence" in caplog.text
    assert [p.payload for p in presence_publishes(presence_rig.client)] == ["ON"]


def test_a_sensor_that_cannot_be_opened_is_one_warning_and_the_agent_carries_on(
    presence_config: Config, make_agent: Callable[[Config], AgentRig], caplog: pytest.LogCaptureFixture
) -> None:
    rig = make_agent(presence_config)
    fake_presence(rig).start_error = "pin GPIO27 is already in use"

    with caplog.at_level(logging.INFO, logger="wallcal_agent.agent"):
        rig.agent.start()
        rig.client.broker_accepts()
        rig.agent.run_presence_work()
        rig.agent.stop()

    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert warnings == [
        "Could not open the presence sensor on GPIO27: pin GPIO27 is already in use; carrying on without it"
    ]
    assert "Watching presence" not in caplog.text
    assert rig.client.publishes[0].topic == AVAILABILITY
    assert rig.client.publishes[-1] == Published(AVAILABILITY, "offline", 1, True)
    assert presence_publishes(rig.client) == []
    # The Home Assistant entity still follows the config.
    assert by_topic(rig.client)[PRESENCE_DISCOVERY].payload != ""


def test_a_uart_that_cannot_be_opened_names_the_device(
    presence_config: Config, make_agent: Callable[[Config], AgentRig], caplog: pytest.LogCaptureFixture
) -> None:
    rig = make_agent(replace(presence_config, presence=PresenceConfig(source="uart")))
    fake_presence(rig).start_error = "could not open port /dev/serial0: permission denied"

    with caplog.at_level(logging.WARNING, logger="wallcal_agent.agent"):
        rig.agent.start()

    assert (
        "Could not open the presence sensor on /dev/serial0 (UART): could not open port /dev/serial0: "
        "permission denied; carrying on without it"
    ) in caplog.text


def test_a_sensor_that_could_not_be_opened_is_not_closed_and_gets_no_thread(
    presence_config: Config, system: FakeSystemInfo
) -> None:
    sensor = FakePresence()
    sensor.start_error = "no access"
    agent = Agent(
        presence_config,
        Hardware(system=system, screen=FakeScreen(power=True), presence=sensor),
        client_factory=lambda _: FakeMqttClient(),
        screen_worker=False,
    )

    agent.start()
    try:
        assert agent._presence_thread is None
    finally:
        agent.stop()

    assert sensor.closed is False


def test_stop_closes_the_sensor_before_it_disconnects(presence_config: Config, system: FakeSystemInfo) -> None:
    client = FakeMqttClient()

    class Recording(FakePresence):
        def close(self) -> None:
            client.calls.append("presence closed")
            super().close()

    sensor = Recording()
    agent = Agent(
        presence_config,
        Hardware(system=system, screen=FakeScreen(power=True), presence=sensor),
        client_factory=lambda _: client,
        screen_worker=False,
    )
    agent.start()
    client.broker_accepts()
    client.calls.clear()

    agent.stop()

    assert client.calls.index("presence closed") < client.calls.index(f"publish {AVAILABILITY}")
    assert client.calls.index("presence closed") < client.calls.index("disconnect")
    assert sensor.closed is True


def test_a_clean_stop_leaves_the_retained_presence_alone(presence_rig: AgentRig) -> None:
    connected(presence_rig)
    fake_presence(presence_rig).set(True)
    presence_after(presence_rig, 1.0)
    presence_rig.client.clear()

    presence_rig.agent.stop()

    # Only the availability goes: clearing or flipping the state would tell the app something that is not known.
    assert [p.topic for p in presence_rig.client.publishes] == [AVAILABILITY]


def test_readings_after_stop_are_ignored(presence_rig: AgentRig) -> None:
    connected(presence_rig)
    sensor = fake_presence(presence_rig)
    presence_rig.agent.stop()
    presence_rig.client.clear()

    # A late callback from the sensor's thread, as if it had not quite been closed yet.
    presence_rig.agent._on_presence_reading(True)
    presence_rig.clock.advance(5.0)
    presence_rig.agent.run_presence_work()

    assert sensor.closed is True
    assert presence_publishes(presence_rig.client) == []


def test_stopping_drops_a_change_that_has_not_been_published(presence_rig: AgentRig) -> None:
    connected(presence_rig)
    fake_presence(presence_rig).set(True)
    presence_rig.clock.advance(5.0)

    presence_rig.agent.stop()
    presence_rig.agent.run_presence_work()

    assert presence_publishes(presence_rig.client) == []


def test_discovery_has_the_presence_entity_when_the_sensor_is_on(presence_rig: AgentRig) -> None:
    presence_rig.client.broker_accepts()

    published = by_topic(presence_rig.client)[PRESENCE_DISCOVERY]

    assert published.retain is True
    assert published.payload is not None
    config = json.loads(published.payload)
    assert config["state_topic"] == PRESENCE
    assert config["device_class"] == "occupancy"


def test_discovery_removes_the_presence_entity_when_the_sensor_is_off(rig: AgentRig) -> None:
    rig.client.broker_accepts()

    assert by_topic(rig.client)[PRESENCE_DISCOVERY] == Published(PRESENCE_DISCOVERY, "", 1, True)


def test_discovery_after_home_assistant_restarts_follows_the_presence_setting(presence_rig: AgentRig) -> None:
    presence_rig.client.broker_accepts()
    presence_rig.client.clear()

    presence_rig.client.message_arrives("homeassistant/status", "online")

    expected = discovery_messages("homeassistant", "hallway", __version__, 60, button=False, presence=True)
    assert presence_rig.client.publishes == [Published(m.topic, m.payload, 1, True) for m in expected]


# With the real worker thread. The logic is covered above without threads; these check the threading itself. They use
# the real clock, so the holds are short.


class ThreadedPresence:
    """An agent with its own presence worker, and a client that notes which thread published each state."""

    def __init__(self, config: Config, hold_ms: int = 50) -> None:
        self.threads: list[str] = []
        outer = self

        class Client(FakeMqttClient):
            def publish(
                self, topic: str, payload: str | None = None, qos: int = 0, retain: bool = False
            ) -> FakeMessageInfo:
                if topic == PRESENCE:
                    outer.threads.append(threading.current_thread().name)
                return super().publish(topic, payload, qos, retain)

        self.client = Client()
        self.sensor = FakePresence()
        self.agent = Agent(
            replace(config, sensors=SensorsConfig(presence=True), presence=PresenceConfig(hold_ms=hold_ms)),
            Hardware(system=FakeSystemInfo(), screen=FakeScreen(power=True), presence=self.sensor),
            client_factory=lambda _: self.client,
            screen_worker=False,
        )
        self.agent.start()

    def states(self) -> list[str]:
        return [p.payload or "" for p in list(presence_publishes(self.client))]


def test_the_worker_thread_publishes_a_state_after_the_hold(config: Config) -> None:
    rig = ThreadedPresence(config)
    try:
        rig.client.broker_accepts()
        rig.sensor.set(True)

        assert wait_until(lambda: rig.states() == ["ON"])
        rig.sensor.set(False)
        assert wait_until(lambda: rig.states() == ["ON", "OFF"])
    finally:
        rig.agent.stop()

    # Never on the thread that set the reading (the sensor's own, here the test's).
    assert rig.threads == ["wallcal-presence", "wallcal-presence"]


def test_the_worker_thread_drops_a_flicker(config: Config) -> None:
    rig = ThreadedPresence(config, hold_ms=300)
    try:
        rig.client.broker_accepts()
        rig.sensor.set(True)
        assert wait_until(lambda: rig.states() == ["ON"], timeout=3)
        rig.sensor.set(False)
        rig.sensor.set(True)
        time.sleep(0.5)
    finally:
        rig.agent.stop()

    assert rig.states() == ["ON"]


def test_the_presence_worker_thread_is_a_daemon_and_stop_ends_it(config: Config) -> None:
    rig = ThreadedPresence(config)
    thread = rig.agent._presence_thread
    assert thread is not None and thread.is_alive() and thread.daemon
    assert thread.name == "wallcal-presence"

    rig.agent.stop()

    assert not thread.is_alive()
    assert rig.sensor.closed is True


def test_stop_does_not_wait_for_a_long_presence_hold(config: Config) -> None:
    rig = ThreadedPresence(config, hold_ms=10000)
    rig.client.broker_accepts()
    rig.sensor.set(True)
    time.sleep(0.05)
    thread = rig.agent._presence_thread
    assert thread is not None

    before = time.monotonic()
    rig.agent.stop()

    assert time.monotonic() - before < 1.5
    assert not thread.is_alive()
