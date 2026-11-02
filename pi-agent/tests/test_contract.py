"""The agent against contracts/mqtt.json, the file the app's tests check too.

The topics must match, and so must the payloads: whatever the contract calls valid, the agent's formatters
produce, and every message the agent publishes is one the contract describes.
"""

import json
import re
from typing import Any

import pytest
from jsonschema import Draft202012Validator

from wallcal_agent import topics
from wallcal_agent.discovery import discovery_messages

from .conftest import AgentRig

# Contract topics the agent does not handle yet, with the pull request that will. Listed so that a new pi/ topic in
# the contract fails these tests until someone decides what the agent does with it.
FROM_PI_LATER = {
    "pi/button": "3.3",
    "pi/presence": "3.4",
    "pi/illuminance": "3.5",
    "pi/screen/state": "3.2",
}
TO_PI_LATER = {"pi/screen/set": "3.2"}

TEMPERATURES = [-20.04, -0.04, 0, 0.05, 48.25, 48.35, 99.99, 105, -5.5, 0.0, 12.0, 1234.56]
UPTIMES = [0, 0.9, 59.99, 60, 86400.5, 10**9]


def topics_where(contract: dict[str, Any], direction: str) -> set[str]:
    return {name for name, topic in contract["topics"].items() if topic["direction"] == direction}


def accepts(contract: dict[str, Any], name: str, payload: str) -> bool:
    """Whether the contract calls `payload` valid for the topic `name`."""
    spec = contract["topics"][name]["payload"]
    if spec["encoding"] == "any":
        return True
    if spec.get("empty") == "clear" and payload.strip() == "":
        return True
    value: Any = payload
    if spec["encoding"] == "json":
        try:
            value = json.loads(payload)
        except ValueError:
            return False
    return Draft202012Validator(spec["schema"]).is_valid(value)


def name_of(topic: str, display_id: str = "hallway") -> str:
    """`wallcal/hallway/pi/uptime` to `pi/uptime`."""
    prefix = f"wallcal/{display_id}/"
    assert topic.startswith(prefix), topic
    return topic.removeprefix(prefix)


def test_the_contract_says_what_it_is(contract: dict[str, Any]) -> None:
    assert contract["version"] == 1
    assert contract["base"] == topics.BASE
    assert re.search(r"Vitest.*pytest", contract["$comment"])


def test_every_schema_is_itself_valid(contract: dict[str, Any]) -> None:
    for topic in contract["topics"].values():
        if "schema" in topic["payload"]:
            Draft202012Validator.check_schema(topic["payload"]["schema"])


def test_every_example_passes_its_schema_and_no_invalid_example_does(contract: dict[str, Any]) -> None:
    for name, topic in contract["topics"].items():
        for payload in topic["examples"]:
            assert accepts(contract, name, payload), f"{name}: example {payload!r}"
        for payload in topic["invalid_examples"]:
            assert not accepts(contract, name, payload), f"{name}: invalid example {payload!r}"


def test_the_new_diagnostics_topics_are_described(contract: dict[str, Any]) -> None:
    for name in (topics.CPU_TEMPERATURE, topics.UPTIME):
        topic = contract["topics"][name]
        assert topic["direction"] == "from_pi"
        assert topic["retained"] is False
        assert topic["payload"]["encoding"] == "text"
        assert len(topic["examples"]) >= 2
        assert len(topic["invalid_examples"]) >= 4


def test_the_agent_publishes_topics_that_are_from_pi_with_the_same_retain_flag(contract: dict[str, Any]) -> None:
    for name, retained in topics.PUBLISHED.items():
        assert name in contract["topics"], name
        assert contract["topics"][name]["direction"] == "from_pi", name
        assert contract["topics"][name]["retained"] is retained, name


def test_every_pi_topic_is_handled_or_listed_for_a_later_pull_request(contract: dict[str, Any]) -> None:
    from_pi = topics_where(contract, "from_pi")
    to_pi = topics_where(contract, "to_pi")

    assert from_pi == set(topics.PUBLISHED) | set(FROM_PI_LATER)
    assert not set(topics.PUBLISHED) & set(FROM_PI_LATER)
    assert to_pi == set(TO_PI_LATER)


def test_the_pi_topics_are_the_ones_under_pi(contract: dict[str, Any]) -> None:
    assert topics_where(contract, "from_pi") | topics_where(contract, "to_pi") == {
        name for name in contract["topics"] if name.startswith("pi/")
    }


@pytest.mark.parametrize("celsius", TEMPERATURES)
def test_temperature_payloads_pass_the_schema(contract: dict[str, Any], celsius: float) -> None:
    payload = topics.cpu_temperature_payload(celsius)

    assert accepts(contract, topics.CPU_TEMPERATURE, payload), payload


@pytest.mark.parametrize("seconds", UPTIMES)
def test_uptime_payloads_pass_the_schema(contract: dict[str, Any], seconds: float) -> None:
    payload = topics.uptime_payload(seconds)

    assert accepts(contract, topics.UPTIME, payload), payload


def test_online_and_offline_pass_the_availability_schema(contract: dict[str, Any]) -> None:
    assert accepts(contract, topics.AVAILABILITY, topics.ONLINE)
    assert accepts(contract, topics.AVAILABILITY, topics.OFFLINE)


def test_discovery_topics_are_contract_topics_for_this_display(contract: dict[str, Any]) -> None:
    for message in discovery_messages("homeassistant", "hallway", "0.0.0", 60):
        config = json.loads(message.payload)
        for key in ("state_topic", "availability_topic"):
            name = name_of(config[key])
            assert name in contract["topics"], f"{key} {config[key]}"
            assert contract["topics"][name]["direction"] == "from_pi"
        assert config["payload_available"] == topics.ONLINE
        assert config["payload_not_available"] == topics.OFFLINE
        assert accepts(contract, name_of(config["availability_topic"]), config["payload_available"])
        assert accepts(contract, name_of(config["availability_topic"]), config["payload_not_available"])


def test_a_run_of_the_agent_only_publishes_what_the_contract_describes(contract: dict[str, Any], rig: AgentRig) -> None:
    rig.client.broker_accepts()
    for celsius in TEMPERATURES:
        rig.system.temperature = celsius
        rig.system.uptime = celsius + 100
        rig.agent.publish_diagnostics()
    rig.client.connection_drops()
    rig.client.broker_accepts()
    rig.client.message_arrives("homeassistant/status", "online")
    rig.agent.stop()

    under_wallcal = [p for p in rig.client.publishes if p.topic.startswith("wallcal/")]
    assert {name_of(p.topic) for p in under_wallcal} == set(topics.PUBLISHED)
    for published in under_wallcal:
        name = name_of(published.topic)
        assert published.payload is not None
        assert accepts(contract, name, published.payload), f"{name}: {published.payload!r}"
        assert published.retain is contract["topics"][name]["retained"], name
        assert published.qos == 1

    # Everything else is Home Assistant's discovery, retained, under its own prefix.
    discovery = [p for p in rig.client.publishes if not p.topic.startswith("wallcal/")]
    assert discovery
    assert all(p.topic.startswith("homeassistant/sensor/wallcal_pi_hallway/") and p.retain for p in discovery)


def test_the_last_will_is_the_contracts_offline(contract: dict[str, Any], rig: AgentRig) -> None:
    will = rig.client.will

    assert will is not None
    assert name_of(will.topic) == topics.AVAILABILITY
    assert will.payload == topics.OFFLINE
    assert accepts(contract, topics.AVAILABILITY, will.payload)
    assert will.retain is contract["topics"][topics.AVAILABILITY]["retained"]
    assert will.qos == 1
