import json
import logging
import threading
from collections.abc import Callable
from dataclasses import replace

import pytest
from paho.mqtt.client import MQTTMessage
from paho.mqtt.enums import CallbackAPIVersion

from wallcal_agent import __version__, topics
from wallcal_agent.agent import Agent, default_client_factory
from wallcal_agent.config import Config
from wallcal_agent.discovery import discovery_messages
from wallcal_agent.hardware import Hardware
from wallcal_agent.hardware.fake import FakeSystemInfo

from .conftest import PASSWORD, AgentRig, FakeMqttClient, Published

AVAILABILITY = "wallcal/hallway/pi/availability"
CPU = "wallcal/hallway/pi/cpu_temperature"
UPTIME = "wallcal/hallway/pi/uptime"


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
    assert rig.client.subscriptions == [("homeassistant/status", 1)]


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
    assert quiet.client.subscriptions == []


def test_a_custom_discovery_prefix_is_used(make_agent: Callable[[Config], AgentRig], config: Config) -> None:
    custom = make_agent(replace(config, mqtt=replace(config.mqtt, discovery_prefix="ha/custom")))
    custom.agent.start()
    custom.client.broker_accepts()

    assert "ha/custom/sensor/wallcal_pi_hallway/uptime/config" in by_topic(custom.client)
    assert custom.client.subscriptions == [("ha/custom/status", 1)]


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
        ("wallcal/hallway/pi/screen/set", "on"),
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

    agent = Agent(config, Hardware(system=Broken()), client_factory=lambda _: rig.client)
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
    agent = Agent(config, Hardware(system=rig.system), client_factory=lambda _: rig.client, clock=lambda: now[0])

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

    names = {p.topic.removeprefix("wallcal/hallway/") for p in rig.client.publishes if p.topic.startswith("wallcal/")}
    assert names == set(topics.PUBLISHED)
