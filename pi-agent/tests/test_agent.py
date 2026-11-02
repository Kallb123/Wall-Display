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
from wallcal_agent.config import Config, ScreenConfig
from wallcal_agent.discovery import discovery_messages
from wallcal_agent.hardware import Hardware
from wallcal_agent.hardware.fake import FakeScreen, FakeSystemInfo

from .conftest import PASSWORD, AgentRig, FakeMqttClient, Published

AVAILABILITY = "wallcal/hallway/pi/availability"
CPU = "wallcal/hallway/pi/cpu_temperature"
UPTIME = "wallcal/hallway/pi/uptime"
SCREEN_SET = "wallcal/hallway/pi/screen/set"
SCREEN_STATE = "wallcal/hallway/pi/screen/state"


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
    expected = discovery_messages("homeassistant", "hallway", __version__, 60)
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

    expected = discovery_messages("homeassistant", "hallway", __version__, 60)
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


def test_topics_published_are_the_ones_declared(rig: AgentRig) -> None:
    rig.client.broker_accepts()
    rig.agent.run_screen_work()

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
