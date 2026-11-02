"""Shared test helpers: the MQTT contract, a fake MQTT client and a ready-made config."""

import json
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

import pytest
from paho.mqtt.client import MQTTMessage
from paho.mqtt.packettypes import PacketTypes
from paho.mqtt.reasoncodes import ReasonCode

from wallcal_agent.agent import Agent
from wallcal_agent.config import Config, MqttConfig, SensorsConfig
from wallcal_agent.hardware import Hardware
from wallcal_agent.hardware.fake import FakeButton, FakePresence, FakeScreen, FakeSystemInfo

CONTRACT_PATH = Path(__file__).resolve().parents[2] / "contracts" / "mqtt.json"

SUCCESS = ReasonCode(PacketTypes.CONNACK, "Success")
NOT_AUTHORISED = ReasonCode(PacketTypes.CONNACK, "Not authorized")
NORMAL_DISCONNECT = ReasonCode(PacketTypes.DISCONNECT, "Normal disconnection")

PASSWORD = "s3cret-hunter2"


@pytest.fixture(scope="session")
def contract() -> dict[str, Any]:
    """contracts/mqtt.json, the wire contract both the app and the agent are tested against."""
    with CONTRACT_PATH.open(encoding="utf-8") as file:
        return json.load(file)


@dataclass(frozen=True)
class Published:
    topic: str
    payload: str | None
    qos: int
    retain: bool


class FakeMessageInfo:
    """What paho's publish returns: something to wait on."""

    def __init__(self) -> None:
        self.waited_with: float | None = None

    def wait_for_publish(self, timeout: float | None = None) -> None:
        self.waited_with = timeout


@dataclass
class FakeMqttClient:
    """Records what the agent asks of paho, and lets a test play the broker by calling the callbacks."""

    client_id: str = ""
    on_connect: Any = None
    on_connect_fail: Any = None
    on_disconnect: Any = None
    on_message: Any = None
    will: Published | None = None
    credentials: tuple[str, str | None] | None = None
    tls: bool = False
    reconnect_delays: tuple[int, int] | None = None
    connect_args: tuple[str, int, int] | None = None
    loop_running: bool = False
    disconnected: bool = False
    publishes: list[Published] = field(default_factory=list)
    infos: list[FakeMessageInfo] = field(default_factory=list)
    subscriptions: list[tuple[str, int]] = field(default_factory=list)
    # Calls in order, for tests about sequence (the will before connecting, offline before disconnecting).
    calls: list[str] = field(default_factory=list)

    def will_set(self, topic: str, payload: str | None = None, qos: int = 0, retain: bool = False) -> None:
        self.calls.append("will_set")
        self.will = Published(topic, payload, qos, retain)

    def username_pw_set(self, username: str, password: str | None = None) -> None:
        self.credentials = (username, password)

    def tls_set(self) -> None:
        self.tls = True

    def reconnect_delay_set(self, min_delay: int = 1, max_delay: int = 120) -> None:
        self.reconnect_delays = (min_delay, max_delay)

    def connect_async(self, host: str, port: int = 1883, keepalive: int = 60) -> None:
        self.calls.append("connect_async")
        self.connect_args = (host, port, keepalive)

    def loop_start(self) -> None:
        self.loop_running = True

    def loop_stop(self) -> None:
        self.calls.append("loop_stop")
        self.loop_running = False

    def publish(self, topic: str, payload: str | None = None, qos: int = 0, retain: bool = False) -> FakeMessageInfo:
        self.calls.append(f"publish {topic}")
        self.publishes.append(Published(topic, payload, qos, retain))
        info = FakeMessageInfo()
        self.infos.append(info)
        return info

    def subscribe(self, topic: str, qos: int = 0) -> None:
        self.subscriptions.append((topic, qos))

    def disconnect(self) -> None:
        self.calls.append("disconnect")
        self.disconnected = True

    # The broker's side: each calls the agent's callback with the arguments paho 2 gives.

    def broker_accepts(self) -> None:
        self.on_connect(self, None, None, SUCCESS, None)

    def broker_refuses(self) -> None:
        self.on_connect(self, None, None, NOT_AUTHORISED, None)

    def broker_unreachable(self) -> None:
        self.on_connect_fail(self, None)

    def connection_drops(self) -> None:
        self.on_disconnect(self, None, None, NORMAL_DISCONNECT, None)

    def message_arrives(self, topic: str, payload: str) -> None:
        message = MQTTMessage(topic=topic.encode())
        message.payload = payload.encode()
        self.on_message(self, None, message)

    def clear(self) -> None:
        self.publishes.clear()


@pytest.fixture
def config() -> Config:
    return Config(
        display_id="hallway",
        mqtt=MqttConfig(host="broker.test", client_id="wallcal-pi-hallway", username="wallcal", password=PASSWORD),
        diagnostics_interval_seconds=60,
    )


@pytest.fixture
def system() -> FakeSystemInfo:
    return FakeSystemInfo(cpu_temperature=48.25, uptime=3600.0)


@pytest.fixture
def screen() -> FakeScreen:
    return FakeScreen(power=True)


class FakeClock:
    """A clock the test moves by hand, for the button's and presence's timings (the agent's `clock` argument)."""

    def __init__(self, now: float = 1000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> float:
        self.now += seconds
        return self.now


@dataclass
class AgentRig:
    agent: Agent
    client: FakeMqttClient
    system: FakeSystemInfo
    screen: FakeScreen
    clock: FakeClock
    # None unless the config has `sensors.button` on, as with the real hardware.
    button: FakeButton | None
    # None unless the config has `sensors.presence` on.
    presence: FakePresence | None


@pytest.fixture
def make_agent(system: FakeSystemInfo, screen: FakeScreen) -> Callable[[Config], AgentRig]:
    """Builds an Agent wired to a FakeMqttClient and the fake hardware.

    The agent has no worker threads: a test makes the screen work happen by calling `run_screen_work()` (or
    `poll_screen()`), the button's by pressing `rig.button`, moving `rig.clock` and calling `run_button_work()`, and
    presence by calling `rig.presence.set(...)`, moving `rig.clock` and calling `run_presence_work()`, so what runs
    and when is under the test's control.
    """

    def build(config: Config) -> AgentRig:
        client = FakeMqttClient()

        def factory(client_id: str) -> FakeMqttClient:
            client.client_id = client_id
            return client

        clock = FakeClock()
        button = FakeButton() if config.sensors.button else None
        presence = FakePresence() if config.sensors.presence else None
        agent = Agent(
            config,
            Hardware(system=system, screen=screen, button=button, presence=presence),
            client_factory=factory,
            clock=clock,
            screen_worker=False,
            button_worker=False,
            presence_worker=False,
        )
        return AgentRig(
            agent=agent, client=client, system=system, screen=screen, clock=clock, button=button, presence=presence
        )

    return build


@pytest.fixture
def rig(config: Config, make_agent: Callable[[Config], AgentRig]) -> AgentRig:
    """A started agent that has not connected yet."""
    built = make_agent(config)
    built.agent.start()
    return built


@pytest.fixture
def button_config(config: Config) -> Config:
    """The same config with `sensors.button` on, so the agent is given a button."""
    return replace(config, sensors=SensorsConfig(button=True))


@pytest.fixture
def button_rig(button_config: Config, make_agent: Callable[[Config], AgentRig]) -> AgentRig:
    """A started agent with a button, not connected yet."""
    built = make_agent(button_config)
    built.agent.start()
    return built


@pytest.fixture
def presence_config(config: Config) -> Config:
    """The same config with `sensors.presence` on, so the agent is given a presence sensor."""
    return replace(config, sensors=SensorsConfig(presence=True))


@pytest.fixture
def presence_rig(presence_config: Config, make_agent: Callable[[Config], AgentRig]) -> AgentRig:
    """A started agent with a presence sensor, not connected yet."""
    built = make_agent(presence_config)
    built.agent.start()
    return built
