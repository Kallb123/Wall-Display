import json
from typing import Any

import pytest

from wallcal_agent import __version__
from wallcal_agent.discovery import BIRTH_ONLINE, birth_topic, discovery_messages


def configs(**overrides: Any) -> dict[str, dict[str, Any]]:
    """The messages for a display, keyed by topic, with the payloads parsed."""
    arguments: dict[str, Any] = {
        "prefix": "homeassistant",
        "display_id": "hallway",
        "version": "1.2.3",
        "diagnostics_interval": 60,
    }
    arguments.update(overrides)
    return {message.topic: json.loads(message.payload) for message in discovery_messages(**arguments)}


def test_topics_and_order() -> None:
    assert list(configs()) == [
        "homeassistant/sensor/wallcal_pi_hallway/cpu_temperature/config",
        "homeassistant/sensor/wallcal_pi_hallway/uptime/config",
        "homeassistant/binary_sensor/wallcal_pi_hallway/panel_power/config",
    ]


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


@pytest.mark.parametrize("topic", list(configs()))
def test_what_every_config_shares(topic: str) -> None:
    config = configs()[topic]

    assert config["availability_topic"] == "wallcal/hallway/pi/availability"
    assert config["payload_available"] == "online"
    assert config["payload_not_available"] == "offline"
    assert config["entity_category"] == "diagnostic"
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


def test_the_degree_sign_is_sent_as_it_is() -> None:
    message = discovery_messages("homeassistant", "hallway", __version__, 60)[0]

    assert "°C" in message.payload


def test_birth_topic() -> None:
    assert birth_topic("homeassistant") == "homeassistant/status"
    assert birth_topic("ha/custom") == "ha/custom/status"
    assert BIRTH_ONLINE == "online"
