import json
from typing import Any

import pytest

from wallcal_agent import __version__
from wallcal_agent.discovery import BIRTH_ONLINE, DiscoveryMessage, birth_topic, discovery_messages

BUTTON_TOPIC = "homeassistant/event/wallcal_pi_hallway/button/config"
PRESENCE_TOPIC = "homeassistant/binary_sensor/wallcal_pi_hallway/presence/config"
DIAGNOSTIC_TOPICS = [
    "homeassistant/sensor/wallcal_pi_hallway/cpu_temperature/config",
    "homeassistant/sensor/wallcal_pi_hallway/uptime/config",
    "homeassistant/binary_sensor/wallcal_pi_hallway/panel_power/config",
]


def messages(**overrides: Any) -> list[DiscoveryMessage]:
    arguments: dict[str, Any] = {
        "prefix": "homeassistant",
        "display_id": "hallway",
        "version": "1.2.3",
        "diagnostics_interval": 60,
        "button": True,
        "presence": True,
    }
    arguments.update(overrides)
    return discovery_messages(**arguments)


def configs(**overrides: Any) -> dict[str, dict[str, Any]]:
    """The configs for a display, keyed by topic, with the payloads parsed. A removed entity (an empty payload) is
    left out: see `test_without_a_button_...` and `test_without_presence_...` for those."""
    return {m.topic: json.loads(m.payload) for m in messages(**overrides) if m.payload != ""}


def test_topics_and_order() -> None:
    assert list(configs()) == [*DIAGNOSTIC_TOPICS, BUTTON_TOPIC, PRESENCE_TOPIC]


def test_the_prefix_and_display_id_are_used() -> None:
    topics = list(configs(prefix="ha/custom", display_id="living-room"))

    assert topics[0] == "ha/custom/sensor/wallcal_pi_living-room/cpu_temperature/config"


def test_cpu_temperature_config() -> None:
    config = configs()["homeassistant/sensor/wallcal_pi_hallway/cpu_temperature/config"]

    assert config["name"] == "CPU temperature"
    assert config["unique_id"] == "wallcal_pi_hallway_cpu_temperature"
    assert config["state_topic"] == "wallcal/hallway/pi/cpu_temperature"
    assert config["device_class"] == "temperature"
    assert config["unit_of_measurement"] == "°C"
    assert config["state_class"] == "measurement"
    assert config["suggested_display_precision"] == 1


def test_uptime_config() -> None:
    config = configs()["homeassistant/sensor/wallcal_pi_hallway/uptime/config"]

    assert config["name"] == "Uptime"
    assert config["unique_id"] == "wallcal_pi_hallway_uptime"
    assert config["state_topic"] == "wallcal/hallway/pi/uptime"
    assert config["device_class"] == "duration"
    assert config["unit_of_measurement"] == "s"
    assert config["icon"] == "mdi:timer-outline"


def test_panel_power_config() -> None:
    config = configs()["homeassistant/binary_sensor/wallcal_pi_hallway/panel_power/config"]

    assert config["name"] == "Panel power"
    assert config["unique_id"] == "wallcal_pi_hallway_panel_power"
    assert config["state_topic"] == "wallcal/hallway/pi/screen/state"
    assert config["device_class"] == "power"
    assert config["payload_on"] == "on"
    assert config["payload_off"] == "off"
    # Retained state that may not change for days, so it must not expire.
    assert "expire_after" not in config


def test_button_config() -> None:
    config = configs()[BUTTON_TOPIC]

    assert config["name"] == "Button"
    assert config["unique_id"] == "wallcal_pi_hallway_button"
    assert config["state_topic"] == "wallcal/hallway/pi/button"
    assert config["event_types"] == ["single", "double", "long"]
    assert config["device_class"] == "button"
    assert config["icon"] == "mdi:gesture-tap-button"
    # Home Assistant wants JSON with an event_type, and the contract's payload is the bare word.
    assert config["value_template"] == "{{ {'event_type': value} | tojson }}"
    # An event is not a reading that goes stale, and the button is something to put on a dashboard.
    assert "expire_after" not in config
    assert "entity_category" not in config


def test_the_button_event_types_are_the_contracts_gestures(contract: dict[str, Any]) -> None:
    assert configs()[BUTTON_TOPIC]["event_types"] == contract["topics"]["pi/button"]["payload"]["schema"]["enum"]


def test_presence_config() -> None:
    config = configs()[PRESENCE_TOPIC]

    assert config["name"] == "Presence"
    assert config["unique_id"] == "wallcal_pi_hallway_presence"
    assert config["state_topic"] == "wallcal/hallway/pi/presence"
    assert config["device_class"] == "occupancy"
    assert config["payload_on"] == "ON"
    assert config["payload_off"] == "OFF"
    # Retained state that stays the same for days in an empty room, so it must not expire. It is something to put on
    # a dashboard or use in an automation, so it is not diagnostic.
    assert "expire_after" not in config
    assert "entity_category" not in config


def test_the_presence_payloads_are_the_contracts(contract: dict[str, Any]) -> None:
    config = configs()[PRESENCE_TOPIC]

    assert [config["payload_on"], config["payload_off"]] == contract["topics"]["pi/presence"]["payload"]["schema"][
        "enum"
    ]


def test_without_a_button_the_entity_is_removed_with_an_empty_retained_message() -> None:
    sent = messages(button=False)

    assert [m.topic for m in sent] == [*DIAGNOSTIC_TOPICS, BUTTON_TOPIC, PRESENCE_TOPIC]
    assert sent[3].payload == ""
    # Everything else is exactly what it is with a button.
    assert sent[:3] == messages()[:3]
    assert sent[4:] == messages()[4:]


def test_without_presence_the_entity_is_removed_with_an_empty_retained_message() -> None:
    sent = messages(presence=False)

    assert [m.topic for m in sent] == [*DIAGNOSTIC_TOPICS, BUTTON_TOPIC, PRESENCE_TOPIC]
    assert sent[-1].payload == ""
    assert sent[:-1] == messages()[:-1]


def test_without_either_both_are_removed_and_the_diagnostics_stay() -> None:
    sent = messages(button=False, presence=False)

    assert [m.payload for m in sent[3:]] == ["", ""]
    assert sent[:3] == messages()[:3]


def test_the_entities_are_removed_from_the_right_place_for_the_prefix_and_display() -> None:
    sent = messages(prefix="ha/custom", display_id="den", button=False, presence=False)

    assert sent[-2:] == [
        DiscoveryMessage("ha/custom/event/wallcal_pi_den/button/config", ""),
        DiscoveryMessage("ha/custom/binary_sensor/wallcal_pi_den/presence/config", ""),
    ]


@pytest.mark.parametrize("topic", [*DIAGNOSTIC_TOPICS, BUTTON_TOPIC, PRESENCE_TOPIC])
def test_what_every_config_shares(topic: str) -> None:
    config = configs()[topic]

    assert config["availability_topic"] == "wallcal/hallway/pi/availability"
    assert config["payload_available"] == "online"
    assert config["payload_not_available"] == "offline"
    assert config["qos"] == 1
    assert config["device"] == {
        "identifiers": ["wallcal_pi_hallway"],
        "name": "Wall Calendar Pi",
        "manufacturer": "Wall Display",
        "model": "Pi agent",
        "sw_version": "1.2.3",
    }
    assert config["origin"] == {
        "name": "Wall Calendar Pi agent",
        "sw_version": "1.2.3",
        "url": "https://github.com/kallb123/wall-display",
    }


@pytest.mark.parametrize(("interval", "expiry"), [(5, 15), (60, 180), (300, 900)])
def test_sensor_values_expire_after_three_intervals(interval: int, expiry: int) -> None:
    for topic, config in configs(diagnostics_interval=interval).items():
        if "/sensor/" in topic:
            assert config["expire_after"] == expiry


def test_unique_ids_differ_between_entities_and_displays() -> None:
    ids = [c["unique_id"] for c in configs().values()] + [
        c["unique_id"] for c in configs(display_id="kitchen").values()
    ]

    assert len(set(ids)) == len(ids)


def test_all_entities_share_one_device_per_display() -> None:
    devices = {json.dumps(c["device"]) for c in configs().values()}

    assert len(devices) == 1


@pytest.mark.parametrize("topic", DIAGNOSTIC_TOPICS)
def test_the_first_three_are_diagnostic(topic: str) -> None:
    assert configs()[topic]["entity_category"] == "diagnostic"


def test_the_degree_sign_is_sent_as_it_is() -> None:
    message = discovery_messages("homeassistant", "hallway", __version__, 60, button=True, presence=True)[0]

    assert "°C" in message.payload


def test_birth_topic() -> None:
    assert birth_topic("homeassistant") == "homeassistant/status"
    assert birth_topic("ha/custom") == "ha/custom/status"
    assert BIRTH_ONLINE == "online"
