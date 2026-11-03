import copy
import textwrap
from pathlib import Path
from typing import Any

import pytest
import yaml

from wallcal_agent.config import (
    ButtonConfig,
    CecConfig,
    Config,
    ConfigError,
    FallbackConfig,
    LightConfig,
    OutputConfig,
    PresenceConfig,
    ScreenConfig,
    UartConfig,
    load_config,
    parse_config,
)

EXAMPLE_PATH = Path(__file__).resolve().parents[1] / "config.example.yaml"


def minimal() -> dict[str, Any]:
    return {"display_id": "hallway", "mqtt": {"host": "broker.test"}}


def with_change(path: list[str], value: Any) -> dict[str, Any]:
    """The minimal config with one value set, or removed when `value` is the string "<missing>"."""
    data = minimal()
    node = data
    for key in path[:-1]:
        node = node.setdefault(key, {})
    if value == "<missing>":
        node.pop(path[-1], None)
    else:
        node[path[-1]] = value
    return data


def test_minimal_config_gets_the_defaults() -> None:
    config = parse_config(minimal())

    assert config.display_id == "hallway"
    assert config.mqtt.host == "broker.test"
    assert config.mqtt.port == 1883
    assert config.mqtt.username is None
    assert config.mqtt.password is None
    assert config.mqtt.tls is False
    assert config.mqtt.client_id == "wallcal-pi-hallway"
    assert config.mqtt.discovery is True
    assert config.mqtt.discovery_prefix == "homeassistant"
    assert config.diagnostics_interval_seconds == 60
    assert config.enabled_sensors() == []
    assert config.screen == ScreenConfig(
        backend="black",
        cec=CecConfig(device=0),
        output=OutputConfig(tool="wlopm", name="HDMI-A-1", wayland_display="/run/user/1000/wayland-0"),
        command_timeout_seconds=10,
        poll_seconds=60,
    )
    assert config.button == ButtonConfig(pin=17, bounce_ms=30, double_press_ms=400, long_press_ms=1000)
    assert config.presence == PresenceConfig(
        source="gpio", pin=27, hold_ms=500, uart=UartConfig(device="/dev/serial0", baud=256000)
    )
    assert config.light == LightConfig(
        chip="veml7700", bus=1, address=0x10, sample_ms=1000, change_percent=10, change_lux=0.5, report_seconds=30
    )
    assert config.fallback == FallbackConfig(enabled=True, timeout_minutes=5, off_after_minutes=10)


def test_full_config() -> None:
    config = parse_config(
        {
            "display_id": "living-room",
            "mqtt": {
                "host": "10.0.0.5",
                "port": 8883,
                "username": "pi",
                "password": "pw",
                "tls": True,
                "client_id": "my_pi-1",
                "discovery": False,
                "discovery_prefix": "ha/custom",
            },
            "diagnostics_interval_seconds": 5,
            "sensors": {"button": True, "presence": True, "light": True},
            "screen": {
                "backend": "output",
                "cec": {"device": 15},
                "output": {"tool": "wlr-randr", "name": "DP-2", "wayland_display": "/run/user/1001/wayland-1"},
                "command_timeout_seconds": 60,
                "poll_seconds": 5,
            },
            "button": {"pin": 26, "bounce_ms": 0, "double_press_ms": 2000, "long_press_ms": 10000},
            "presence": {
                "source": "uart",
                "pin": 5,
                "hold_ms": 10000,
                "uart": {"device": "/dev/ttyUSB0", "baud": 115200},
            },
            "light": {
                "chip": "bh1750",
                "bus": 3,
                "address": 0x5C,
                "sample_ms": 200,
                "change_percent": 100,
                "change_lux": 1000,
                "report_seconds": 3600,
            },
        }
    )

    assert config.mqtt.port == 8883
    assert config.mqtt.tls is True
    assert config.mqtt.client_id == "my_pi-1"
    assert config.mqtt.discovery is False
    assert config.mqtt.discovery_prefix == "ha/custom"
    assert config.diagnostics_interval_seconds == 5
    assert config.enabled_sensors() == ["button", "presence", "light"]
    assert config.screen == ScreenConfig(
        backend="output",
        cec=CecConfig(device=15),
        output=OutputConfig(tool="wlr-randr", name="DP-2", wayland_display="/run/user/1001/wayland-1"),
        command_timeout_seconds=60,
        poll_seconds=5,
    )
    assert config.button == ButtonConfig(pin=26, bounce_ms=0, double_press_ms=2000, long_press_ms=10000)
    assert config.presence == PresenceConfig(
        source="uart", pin=5, hold_ms=10000, uart=UartConfig(device="/dev/ttyUSB0", baud=115200)
    )
    assert config.light == LightConfig(
        chip="bh1750", bus=3, address=0x5C, sample_ms=200, change_percent=100, change_lux=1000.0, report_seconds=3600
    )


def test_the_example_file_is_valid_as_it_stands() -> None:
    config = load_config(EXAMPLE_PATH)

    assert config.display_id == "hallway"
    assert config.mqtt.host == "homeserver.local"
    assert config.mqtt.username == "wallcal"
    assert config.mqtt.client_id == "wallcal-pi-hallway"
    assert config.enabled_sensors() == []
    assert config.screen.backend == "black"


def test_the_example_file_sets_every_key_to_its_default() -> None:
    # The example documents the defaults, so leaving a value out must mean the same as the example says.
    example = yaml.safe_load(EXAMPLE_PATH.read_text())
    trimmed = copy.deepcopy(example)
    for key in ("port", "tls", "client_id", "discovery", "discovery_prefix"):
        del trimmed["mqtt"][key]
    del trimmed["diagnostics_interval_seconds"]
    del trimmed["sensors"]
    del trimmed["screen"]
    del trimmed["button"]
    del trimmed["presence"]
    del trimmed["light"]
    del trimmed["fallback"]

    assert parse_config(trimmed).mqtt.port == parse_config(example).mqtt.port
    assert parse_config(trimmed).mqtt.client_id == parse_config(example).mqtt.client_id
    assert parse_config(trimmed).diagnostics_interval_seconds == parse_config(example).diagnostics_interval_seconds
    assert parse_config(trimmed).screen == parse_config(example).screen
    assert parse_config(trimmed).button == parse_config(example).button
    assert parse_config(trimmed).presence == parse_config(example).presence
    assert parse_config(trimmed).light == parse_config(example).light
    assert parse_config(trimmed).fallback == parse_config(example).fallback


def test_the_examples_screen_block_sets_every_screen_key_to_its_default() -> None:
    screen = yaml.safe_load(EXAMPLE_PATH.read_text())["screen"]

    assert set(screen) == {"backend", "cec", "output", "command_timeout_seconds", "poll_seconds"}
    assert parse_config({**minimal(), "screen": screen}).screen == ScreenConfig()


def test_the_examples_button_block_sets_every_button_key_to_its_default() -> None:
    button = yaml.safe_load(EXAMPLE_PATH.read_text())["button"]

    assert set(button) == {"pin", "bounce_ms", "double_press_ms", "long_press_ms"}
    assert parse_config({**minimal(), "button": button}).button == ButtonConfig()


def test_the_button_block_is_optional_and_may_be_left_empty() -> None:
    assert parse_config({**minimal(), "button": None}).button == ButtonConfig()
    assert parse_config({**minimal(), "button": {}}).button == ButtonConfig()


def test_each_button_setting_may_be_given_alone() -> None:
    assert parse_config(with_change(["button", "pin"], 4)).button == ButtonConfig(pin=4)
    assert parse_config(with_change(["button", "bounce_ms"], 50)).button == ButtonConfig(bounce_ms=50)
    assert parse_config(with_change(["button", "double_press_ms"], 250)).button == ButtonConfig(double_press_ms=250)
    assert parse_config(with_change(["button", "long_press_ms"], 1500)).button == ButtonConfig(long_press_ms=1500)


def test_the_button_settings_are_checked_even_when_the_button_is_off() -> None:
    data = with_change(["button", "pin"], 99)
    data["sensors"] = {"button": False}

    with pytest.raises(ConfigError, match=r"button\.pin"):
        parse_config(data)


@pytest.mark.parametrize(
    ("key", "low", "high"), [("bounce_ms", 0, 200), ("double_press_ms", 100, 2000), ("long_press_ms", 300, 10000)]
)
def test_button_times_accept_both_ends_of_their_range(key: str, low: int, high: int) -> None:
    assert getattr(parse_config(with_change(["button", key], low)).button, key) == low
    assert getattr(parse_config(with_change(["button", key], high)).button, key) == high


@pytest.mark.parametrize("pin", [0, 27])
def test_button_pin_accepts_both_ends_of_its_range(pin: int) -> None:
    assert parse_config(with_change(["button", "pin"], pin)).button.pin == pin


def test_the_examples_light_block_sets_every_light_key_to_its_default() -> None:
    light = yaml.safe_load(EXAMPLE_PATH.read_text())["light"]

    assert set(light) == {"chip", "bus", "address", "sample_ms", "change_percent", "change_lux", "report_seconds"}
    assert parse_config({**minimal(), "light": light}).light == LightConfig()


def test_the_examples_fallback_block_sets_every_fallback_key_to_its_default() -> None:
    fallback = yaml.safe_load(EXAMPLE_PATH.read_text())["fallback"]

    assert set(fallback) == {"enabled", "timeout_minutes", "off_after_minutes"}
    assert parse_config({**minimal(), "fallback": fallback}).fallback == FallbackConfig()


def test_the_fallback_block_is_optional_and_may_be_left_empty() -> None:
    assert parse_config({**minimal(), "fallback": None}).fallback == FallbackConfig()
    assert parse_config({**minimal(), "fallback": {}}).fallback == FallbackConfig()


def test_each_fallback_setting_may_be_given_alone() -> None:
    assert parse_config(with_change(["fallback", "enabled"], False)).fallback == FallbackConfig(enabled=False)
    assert parse_config(with_change(["fallback", "timeout_minutes"], 30)).fallback == FallbackConfig(timeout_minutes=30)
    assert parse_config(with_change(["fallback", "off_after_minutes"], 1)).fallback == FallbackConfig(
        off_after_minutes=1
    )


@pytest.mark.parametrize("key", ["timeout_minutes", "off_after_minutes"])
@pytest.mark.parametrize("minutes", [1, 1440])
def test_fallback_times_accept_both_ends_of_their_range(key: str, minutes: int) -> None:
    assert getattr(parse_config(with_change(["fallback", key], minutes)).fallback, key) == minutes


def test_the_fallback_settings_are_checked_even_when_presence_is_off() -> None:
    data = with_change(["fallback", "timeout_minutes"], 0)
    assert data.get("sensors") is None

    with pytest.raises(ConfigError, match=r"fallback.timeout_minutes"):
        parse_config(data)


def test_the_light_block_is_optional_and_may_be_left_empty() -> None:
    assert parse_config({**minimal(), "light": None}).light == LightConfig()
    assert parse_config({**minimal(), "light": {}}).light == LightConfig()


def test_each_light_setting_may_be_given_alone() -> None:
    assert parse_config(with_change(["light", "chip"], "bh1750")).light == LightConfig(chip="bh1750", address=0x23)
    assert parse_config(with_change(["light", "bus"], 0)).light == LightConfig(bus=0)
    assert parse_config(with_change(["light", "address"], 0x10)).light == LightConfig(address=0x10)
    assert parse_config(with_change(["light", "sample_ms"], 5000)).light == LightConfig(sample_ms=5000)
    assert parse_config(with_change(["light", "change_percent"], 25)).light == LightConfig(change_percent=25)
    assert parse_config(with_change(["light", "change_lux"], 2.5)).light == LightConfig(change_lux=2.5)
    assert parse_config(with_change(["light", "report_seconds"], 60)).light == LightConfig(report_seconds=60)


def test_the_light_settings_are_checked_even_when_the_sensor_is_off() -> None:
    data = with_change(["light", "sample_ms"], 10)
    data["sensors"] = {"light": False}

    with pytest.raises(ConfigError, match=r"light\.sample_ms"):
        parse_config(data)


@pytest.mark.parametrize(
    ("chip", "address"),
    [("veml7700", 0x10), ("bh1750", 0x23)],
)
def test_the_address_is_the_chips_own_when_left_out(chip: str, address: int) -> None:
    assert parse_config(with_change(["light", "chip"], chip)).light.address == address


@pytest.mark.parametrize(("chip", "address"), [("veml7700", 0x10), ("bh1750", 0x23), ("bh1750", 0x5C)])
def test_the_addresses_each_chip_answers_on_are_accepted(chip: str, address: int) -> None:
    data = with_change(["light", "chip"], chip)
    data["light"]["address"] = address

    assert parse_config(data).light.address == address


@pytest.mark.parametrize("address", [0x23, 0x5C, 0x11, 0])
def test_the_veml7700_has_only_the_one_address(address: int) -> None:
    data = with_change(["light", "chip"], "veml7700")
    data["light"]["address"] = address

    with pytest.raises(ConfigError, match=r"light\.address: must be 0x10 for the veml7700"):
        parse_config(data)


@pytest.mark.parametrize("address", [0x10, 0x22, 0x5D, 35.0, "0x23", True])
def test_the_bh1750_has_two_addresses(address: Any) -> None:
    data = with_change(["light", "chip"], "bh1750")
    data["light"]["address"] = address

    with pytest.raises(ConfigError, match=r"light\.address: must be 0x23 or 0x5c for the bh1750"):
        parse_config(data)


def test_a_hex_address_in_the_file_is_read_as_the_number_it_is(tmp_path: Path) -> None:
    path = write(
        tmp_path,
        """
        display_id: hallway
        mqtt:
          host: broker.test
        light:
          chip: bh1750
          address: 0x5C
          change_lux: 1
        """,
    )

    light = load_config(path).light

    assert (light.address, light.change_lux) == (0x5C, 1.0)
    assert isinstance(light.change_lux, float)


@pytest.mark.parametrize(
    ("key", "low", "high"),
    [
        ("bus", 0, 31),
        ("sample_ms", 200, 60000),
        ("change_percent", 1, 100),
        ("change_lux", 0, 1000),
        ("report_seconds", 5, 3600),
    ],
)
def test_light_settings_accept_both_ends_of_their_range(key: str, low: int, high: int) -> None:
    assert getattr(parse_config(with_change(["light", key], low)).light, key) == low
    assert getattr(parse_config(with_change(["light", key], high)).light, key) == high


@pytest.mark.parametrize("value", [0, 0.25, 0.5, 1, 999.5, 1000, 1000.0])
def test_change_lux_may_be_whole_or_fractional(value: float) -> None:
    assert parse_config(with_change(["light", "change_lux"], value)).light.change_lux == value


def test_the_examples_presence_block_sets_every_presence_key_to_its_default() -> None:
    presence = yaml.safe_load(EXAMPLE_PATH.read_text())["presence"]

    assert set(presence) == {"source", "pin", "hold_ms", "uart"}
    assert set(presence["uart"]) == {"device", "baud"}
    assert parse_config({**minimal(), "presence": presence}).presence == PresenceConfig()


def test_the_presence_block_is_optional_and_may_be_left_empty() -> None:
    assert parse_config({**minimal(), "presence": None}).presence == PresenceConfig()
    assert parse_config({**minimal(), "presence": {}}).presence == PresenceConfig()
    assert parse_config({**minimal(), "presence": {"uart": None}}).presence == PresenceConfig()
    assert parse_config({**minimal(), "presence": {"uart": {}}}).presence == PresenceConfig()


def test_each_presence_setting_may_be_given_alone() -> None:
    assert parse_config(with_change(["presence", "source"], "uart")).presence == PresenceConfig(source="uart")
    assert parse_config(with_change(["presence", "pin"], 4)).presence == PresenceConfig(pin=4)
    assert parse_config(with_change(["presence", "hold_ms"], 1500)).presence == PresenceConfig(hold_ms=1500)
    assert parse_config(with_change(["presence", "uart", "device"], "/dev/ttyAMA0")).presence == PresenceConfig(
        uart=UartConfig(device="/dev/ttyAMA0")
    )
    assert parse_config(with_change(["presence", "uart", "baud"], 9600)).presence == PresenceConfig(
        uart=UartConfig(baud=9600)
    )


def test_the_presence_settings_are_checked_even_when_the_sensor_is_off() -> None:
    data = with_change(["presence", "pin"], 99)
    data["sensors"] = {"presence": False}

    with pytest.raises(ConfigError, match=r"presence\.pin"):
        parse_config(data)


def test_the_uart_settings_are_checked_even_when_the_source_is_gpio() -> None:
    data = with_change(["presence", "uart", "baud"], 1234)
    data["presence"]["source"] = "gpio"

    with pytest.raises(ConfigError, match=r"presence\.uart\.baud"):
        parse_config(data)


@pytest.mark.parametrize("pin", [0, 27])
def test_presence_pin_accepts_both_ends_of_its_range(pin: int) -> None:
    assert parse_config(with_change(["presence", "pin"], pin)).presence.pin == pin


@pytest.mark.parametrize("hold_ms", [0, 10000])
def test_presence_hold_accepts_both_ends_of_its_range(hold_ms: int) -> None:
    assert parse_config(with_change(["presence", "hold_ms"], hold_ms)).presence.hold_ms == hold_ms


@pytest.mark.parametrize("baud", [9600, 19200, 38400, 57600, 115200, 230400, 256000, 460800])
def test_every_baud_the_sensor_supports_is_accepted(baud: int) -> None:
    assert parse_config(with_change(["presence", "uart", "baud"], baud)).presence.uart.baud == baud


def _both_sensors(**presence: Any) -> dict[str, Any]:
    data = minimal()
    data["sensors"] = {"button": True, "presence": True}
    data["presence"] = presence
    return data


def test_the_button_and_a_gpio_presence_sensor_may_not_share_a_pin() -> None:
    data = _both_sensors(pin=17)

    with pytest.raises(ConfigError) as error:
        parse_config(data)

    assert str(error.value).startswith("presence.pin: ")
    assert "GPIO17" in str(error.value)
    assert "button.pin" in str(error.value)


def test_the_shared_pin_is_checked_against_a_changed_button_pin_too() -> None:
    data = _both_sensors(pin=22)
    data["button"] = {"pin": 22}

    with pytest.raises(ConfigError, match=r"presence\.pin"):
        parse_config(data)


def test_a_shared_pin_is_fine_when_either_sensor_is_off_or_presence_is_not_on_gpio() -> None:
    both = _both_sensors(pin=17)
    no_button = {**both, "sensors": {"presence": True}}
    no_presence = {**both, "sensors": {"button": True}}
    neither = {**both, "sensors": {}}
    uart = _both_sensors(pin=17, source="uart")

    for data in (no_button, no_presence, neither, uart):
        assert parse_config(data).presence.pin == 17


def test_different_pins_are_fine_with_both_sensors_on() -> None:
    config = parse_config(_both_sensors(pin=22))

    assert (config.button.pin, config.presence.pin) == (17, 22)


def test_the_default_presence_pin_does_not_clash_with_the_default_button_pin() -> None:
    data = minimal()
    data["sensors"] = {"button": True, "presence": True}

    config = parse_config(data)

    assert (config.button.pin, config.presence.pin) == (17, 27)


@pytest.mark.parametrize("backend", ["black", "cec", "output"])
def test_each_screen_backend_is_accepted(backend: str) -> None:
    assert parse_config(with_change(["screen", "backend"], backend)).screen.backend == backend


@pytest.mark.parametrize("value", [0, 5, 6, 3600])
def test_screen_poll_seconds_accepts_zero_for_never_or_five_and_up(value: int) -> None:
    assert parse_config(with_change(["screen", "poll_seconds"], value)).screen.poll_seconds == value


@pytest.mark.parametrize("name", ["HDMI-A-1", "DP-1", "eDP-1", "HDMI-A-2", "Virtual-1", "NOOP-1", "out_put.2", "A:1"])
def test_screen_output_names_that_are_accepted(name: str) -> None:
    assert parse_config(with_change(["screen", "output", "name"], name)).screen.output.name == name


def test_a_screen_section_may_be_left_empty() -> None:
    data = minimal()
    data["screen"] = None

    assert parse_config(data).screen == ScreenConfig()


def test_screen_sub_blocks_may_be_left_empty() -> None:
    data = with_change(["screen"], {"backend": "cec", "cec": None, "output": None})

    assert parse_config(data).screen == ScreenConfig(backend="cec")


def test_a_back_end_that_is_not_selected_is_still_checked() -> None:
    # Backend black, but the output name is wrong: found now, not on the day someone switches to it.
    data = with_change(["screen"], {"backend": "black", "output": {"name": "bad name"}})

    with pytest.raises(ConfigError, match=r"screen.output.name"):
        parse_config(data)

    data = with_change(["screen"], {"backend": "output", "cec": {"device": 16}})

    with pytest.raises(ConfigError, match=r"screen.cec.device"):
        parse_config(data)


def test_sensors_may_be_left_empty() -> None:
    data = minimal()
    data["sensors"] = None

    assert parse_config(data).enabled_sensors() == []


@pytest.mark.parametrize(
    ("data", "message"),
    [
        (None, "display_id: is required"),
        ([], "config: must be a mapping"),
        ("hallway", "config: must be a mapping"),
        ({"mqtt": {"host": "h"}}, "display_id: is required"),
        (with_change(["display_id"], 7), "display_id: must be text"),
        (with_change(["display_id"], "Hall"), "display_id: must be lowercase"),
        (with_change(["display_id"], "-hall"), "display_id: must be lowercase"),
        (with_change(["display_id"], "hall way"), "display_id: must be lowercase"),
        (with_change(["display_id"], ""), "display_id: must be lowercase"),
        ({"display_id": "hallway"}, "mqtt: is required"),
        ({"display_id": "hallway", "mqtt": None}, "mqtt: is required"),
        ({"display_id": "hallway", "mqtt": "broker"}, "mqtt: must be a mapping"),
        (with_change(["mqtt", "host"], "<missing>"), "mqtt.host: is required"),
        (with_change(["mqtt", "host"], "  "), "mqtt.host: is required"),
        (with_change(["mqtt", "host"], "mqtt://broker"), "mqtt.host: must be just a host name"),
        (with_change(["mqtt", "host"], "bro ker"), "mqtt.host: must be just a host name"),
        (with_change(["mqtt", "host"], 5), "mqtt.host: must be text"),
        (with_change(["mqtt", "port"], 0), "mqtt.port: must be 1 to 65535"),
        (with_change(["mqtt", "port"], 65536), "mqtt.port: must be 1 to 65535"),
        (with_change(["mqtt", "port"], "1883"), "mqtt.port: must be 1 to 65535"),
        (with_change(["mqtt", "port"], 1883.5), "mqtt.port: must be 1 to 65535"),
        (with_change(["mqtt", "port"], True), "mqtt.port: must be 1 to 65535"),
        (with_change(["mqtt", "username"], ""), "mqtt.username: must not be empty"),
        (with_change(["mqtt", "password"], "pw"), "mqtt.password: needs a username"),
        (with_change(["mqtt", "client_id"], "has space"), "mqtt.client_id: must be 1 to 64"),
        (with_change(["mqtt", "client_id"], "x" * 65), "mqtt.client_id: must be 1 to 64"),
        (with_change(["mqtt", "client_id"], ""), "mqtt.client_id: must be 1 to 64"),
        (with_change(["mqtt", "tls"], "yes"), "mqtt.tls: must be true or false"),
        (with_change(["mqtt", "discovery"], 1), "mqtt.discovery: must be true or false"),
        (with_change(["mqtt", "discovery_prefix"], "ha/"), "mqtt.discovery_prefix: must be one or more"),
        (with_change(["mqtt", "discovery_prefix"], "/ha"), "mqtt.discovery_prefix: must be one or more"),
        (with_change(["mqtt", "discovery_prefix"], "ha/#"), "mqtt.discovery_prefix: must be one or more"),
        (with_change(["mqtt", "discovery_prefix"], "ha/+/x"), "mqtt.discovery_prefix: must be one or more"),
        (with_change(["mqtt", "discovery_prefix"], ""), "mqtt.discovery_prefix: must be one or more"),
        (with_change(["diagnostics_interval_seconds"], 4), "diagnostics_interval_seconds: must be at least 5"),
        (with_change(["diagnostics_interval_seconds"], "60"), "diagnostics_interval_seconds: must be a whole number"),
        (with_change(["diagnostics_interval_seconds"], 2.5), "diagnostics_interval_seconds: must be a whole number"),
        (with_change(["sensors"], ["button"]), "sensors: must be a mapping"),
        (with_change(["sensors", "button"], "on"), "sensors.button: must be true or false"),
        (with_change(["screen"], ["cec"]), "screen: must be a mapping"),
        (with_change(["screen", "backend"], "hdmi"), "screen.backend: must be one of black, cec, output"),
        (with_change(["screen", "backend"], "CEC"), "screen.backend: must be one of black, cec, output"),
        (with_change(["screen", "backend"], ""), "screen.backend: must be one of black, cec, output"),
        (with_change(["screen", "backend"], 1), "screen.backend: must be text"),
        (with_change(["screen", "cec"], "0"), "screen.cec: must be a mapping"),
        (with_change(["screen", "cec", "device"], -1), "screen.cec.device: must be a CEC logical address, 0 to 15"),
        (with_change(["screen", "cec", "device"], 16), "screen.cec.device: must be a CEC logical address, 0 to 15"),
        (with_change(["screen", "cec", "device"], "0"), "screen.cec.device: must be a CEC logical address, 0 to 15"),
        (with_change(["screen", "cec", "device"], 1.5), "screen.cec.device: must be a CEC logical address, 0 to 15"),
        (with_change(["screen", "cec", "device"], True), "screen.cec.device: must be a CEC logical address, 0 to 15"),
        (with_change(["screen", "output"], ["HDMI-A-1"]), "screen.output: must be a mapping"),
        (with_change(["screen", "output", "tool"], "xrandr"), "screen.output.tool: must be one of wlopm, wlr-randr"),
        (with_change(["screen", "output", "tool"], 3), "screen.output.tool: must be text"),
        (with_change(["screen", "output", "name"], ""), "screen.output.name: must be one output name"),
        (with_change(["screen", "output", "name"], "HDMI A 1"), "screen.output.name: must be one output name"),
        (with_change(["screen", "output", "name"], "HDMI-A-1 "), "screen.output.name: must be one output name"),
        (with_change(["screen", "output", "name"], "-HDMI"), "screen.output.name: must be one output name"),
        (with_change(["screen", "output", "name"], "a;b"), "screen.output.name: must be one output name"),
        (with_change(["screen", "output", "name"], "a\nb"), "screen.output.name: must be one output name"),
        (with_change(["screen", "output", "name"], 1), "screen.output.name: must be text"),
        (
            with_change(["screen", "output", "wayland_display"], "wayland-0"),
            "screen.output.wayland_display: must be the absolute path",
        ),
        (
            with_change(["screen", "output", "wayland_display"], ""),
            "screen.output.wayland_display: must be the absolute path",
        ),
        (
            with_change(["screen", "output", "wayland_display"], "/"),
            "screen.output.wayland_display: must be the absolute path",
        ),
        (
            with_change(["screen", "output", "wayland_display"], "/run/user/1000/"),
            "screen.output.wayland_display: must be the absolute path",
        ),
        (with_change(["screen", "output", "wayland_display"], 0), "screen.output.wayland_display: must be text"),
        (
            with_change(["screen", "command_timeout_seconds"], 0),
            "screen.command_timeout_seconds: must be a whole number of seconds, 1 to 60",
        ),
        (
            with_change(["screen", "command_timeout_seconds"], 61),
            "screen.command_timeout_seconds: must be a whole number of seconds, 1 to 60",
        ),
        (
            with_change(["screen", "command_timeout_seconds"], "10"),
            "screen.command_timeout_seconds: must be a whole number of seconds",
        ),
        (
            with_change(["screen", "command_timeout_seconds"], 2.5),
            "screen.command_timeout_seconds: must be a whole number of seconds",
        ),
        (with_change(["screen", "poll_seconds"], 1), "screen.poll_seconds: must be at least 5 (or 0 to never check)"),
        (with_change(["screen", "poll_seconds"], 4), "screen.poll_seconds: must be at least 5 (or 0 to never check)"),
        (with_change(["screen", "poll_seconds"], -1), "screen.poll_seconds: must be at least 5 (or 0 to never check)"),
        (with_change(["screen", "poll_seconds"], "60"), "screen.poll_seconds: must be a whole number of seconds"),
        (with_change(["screen", "poll_seconds"], 7.5), "screen.poll_seconds: must be a whole number of seconds"),
        (with_change(["screen", "poll_seconds"], False), "screen.poll_seconds: must be a whole number of seconds"),
        (with_change(["button"], ["pin"]), "button: must be a mapping"),
        (with_change(["presence"], ["gpio"]), "presence: must be a mapping"),
        (with_change(["presence", "source"], "i2c"), "presence.source: must be one of gpio, uart"),
        (with_change(["presence", "source"], "GPIO"), "presence.source: must be one of gpio, uart"),
        (with_change(["presence", "source"], ""), "presence.source: must be one of gpio, uart"),
        (with_change(["presence", "source"], 1), "presence.source: must be text"),
        (with_change(["presence", "pin"], -1), "presence.pin: must be a BCM GPIO number, 0 to 27"),
        (with_change(["presence", "pin"], 28), "presence.pin: must be a BCM GPIO number, 0 to 27"),
        (with_change(["presence", "pin"], "27"), "presence.pin: must be a BCM GPIO number, 0 to 27"),
        (with_change(["presence", "pin"], 27.5), "presence.pin: must be a BCM GPIO number, 0 to 27"),
        (with_change(["presence", "pin"], True), "presence.pin: must be a BCM GPIO number, 0 to 27"),
        (
            with_change(["presence", "hold_ms"], -1),
            "presence.hold_ms: must be a whole number of milliseconds, 0 to 10000",
        ),
        (
            with_change(["presence", "hold_ms"], 10001),
            "presence.hold_ms: must be a whole number of milliseconds, 0 to 10000",
        ),
        (
            with_change(["presence", "hold_ms"], "500"),
            "presence.hold_ms: must be a whole number of milliseconds, 0 to 10000",
        ),
        (
            with_change(["presence", "hold_ms"], 0.5),
            "presence.hold_ms: must be a whole number of milliseconds, 0 to 10000",
        ),
        (
            with_change(["presence", "hold_ms"], False),
            "presence.hold_ms: must be a whole number of milliseconds, 0 to 10000",
        ),
        (with_change(["presence", "uart"], "/dev/serial0"), "presence.uart: must be a mapping"),
        (
            with_change(["fallback", "timeout_minutes"], 0),
            "fallback.timeout_minutes: must be a whole number of minutes, 1 to 1440",
        ),
        (
            with_change(["fallback", "timeout_minutes"], 1441),
            "fallback.timeout_minutes: must be a whole number of minutes, 1 to 1440",
        ),
        (
            with_change(["fallback", "timeout_minutes"], -1),
            "fallback.timeout_minutes: must be a whole number of minutes, 1 to 1440",
        ),
        (
            with_change(["fallback", "timeout_minutes"], "5"),
            "fallback.timeout_minutes: must be a whole number of minutes, 1 to 1440",
        ),
        (
            with_change(["fallback", "timeout_minutes"], 5.5),
            "fallback.timeout_minutes: must be a whole number of minutes, 1 to 1440",
        ),
        (
            with_change(["fallback", "timeout_minutes"], 5.0),
            "fallback.timeout_minutes: must be a whole number of minutes, 1 to 1440",
        ),
        (
            with_change(["fallback", "timeout_minutes"], True),
            "fallback.timeout_minutes: must be a whole number of minutes, 1 to 1440",
        ),
        (
            with_change(["fallback", "off_after_minutes"], 0),
            "fallback.off_after_minutes: must be a whole number of minutes, 1 to 1440",
        ),
        (
            with_change(["fallback", "off_after_minutes"], 1441),
            "fallback.off_after_minutes: must be a whole number of minutes, 1 to 1440",
        ),
        (
            with_change(["fallback", "off_after_minutes"], -1),
            "fallback.off_after_minutes: must be a whole number of minutes, 1 to 1440",
        ),
        (
            with_change(["fallback", "off_after_minutes"], "5"),
            "fallback.off_after_minutes: must be a whole number of minutes, 1 to 1440",
        ),
        (
            with_change(["fallback", "off_after_minutes"], 5.5),
            "fallback.off_after_minutes: must be a whole number of minutes, 1 to 1440",
        ),
        (
            with_change(["fallback", "off_after_minutes"], 5.0),
            "fallback.off_after_minutes: must be a whole number of minutes, 1 to 1440",
        ),
        (
            with_change(["fallback", "off_after_minutes"], True),
            "fallback.off_after_minutes: must be a whole number of minutes, 1 to 1440",
        ),
        (with_change(["fallback", "enabled"], "yes"), "fallback.enabled: must be true or false"),
        (with_change(["fallback", "enabled"], 1), "fallback.enabled: must be true or false"),
        (with_change(["fallback"], ["enabled"]), "fallback: must be a mapping"),
        (with_change(["light"], ["veml7700"]), "light: must be a mapping"),
        (with_change(["light", "chip"], "tsl2561"), "light.chip: must be one of veml7700, bh1750"),
        (with_change(["light", "chip"], "VEML7700"), "light.chip: must be one of veml7700, bh1750"),
        (with_change(["light", "chip"], ""), "light.chip: must be one of veml7700, bh1750"),
        (with_change(["light", "chip"], 7700), "light.chip: must be text"),
        (with_change(["light", "bus"], -1), "light.bus: must be an I2C bus number, 0 to 31"),
        (with_change(["light", "bus"], 32), "light.bus: must be an I2C bus number, 0 to 31"),
        (with_change(["light", "bus"], "1"), "light.bus: must be an I2C bus number, 0 to 31"),
        (with_change(["light", "bus"], 1.5), "light.bus: must be an I2C bus number, 0 to 31"),
        (with_change(["light", "bus"], True), "light.bus: must be an I2C bus number, 0 to 31"),
        (with_change(["light", "address"], 16.0), "light.address: must be 0x10 for the veml7700"),
        (with_change(["light", "address"], "0x10"), "light.address: must be 0x10 for the veml7700"),
        (with_change(["light", "address"], True), "light.address: must be 0x10 for the veml7700"),
        (
            with_change(["light", "sample_ms"], 199),
            "light.sample_ms: must be a whole number of milliseconds, 200 to 60000",
        ),
        (
            with_change(["light", "sample_ms"], 60001),
            "light.sample_ms: must be a whole number of milliseconds, 200 to 60000",
        ),
        (
            with_change(["light", "sample_ms"], "1000"),
            "light.sample_ms: must be a whole number of milliseconds, 200 to 60000",
        ),
        (
            with_change(["light", "sample_ms"], 500.5),
            "light.sample_ms: must be a whole number of milliseconds, 200 to 60000",
        ),
        (
            with_change(["light", "change_percent"], 0),
            "light.change_percent: must be a whole number of percent, 1 to 100",
        ),
        (
            with_change(["light", "change_percent"], 101),
            "light.change_percent: must be a whole number of percent, 1 to 100",
        ),
        (
            with_change(["light", "change_percent"], 12.5),
            "light.change_percent: must be a whole number of percent, 1 to 100",
        ),
        (
            with_change(["light", "change_percent"], False),
            "light.change_percent: must be a whole number of percent, 1 to 100",
        ),
        (with_change(["light", "change_lux"], -0.1), "light.change_lux: must be a number of lux, 0 to 1000"),
        (with_change(["light", "change_lux"], 1000.5), "light.change_lux: must be a number of lux, 0 to 1000"),
        (with_change(["light", "change_lux"], "0.5"), "light.change_lux: must be a number of lux, 0 to 1000"),
        (with_change(["light", "change_lux"], True), "light.change_lux: must be a number of lux, 0 to 1000"),
        (with_change(["light", "change_lux"], float("nan")), "light.change_lux: must be a number of lux, 0 to 1000"),
        (with_change(["light", "change_lux"], float("inf")), "light.change_lux: must be a number of lux, 0 to 1000"),
        (
            with_change(["light", "report_seconds"], 4),
            "light.report_seconds: must be a whole number of seconds, 5 to 3600",
        ),
        (
            with_change(["light", "report_seconds"], 3601),
            "light.report_seconds: must be a whole number of seconds, 5 to 3600",
        ),
        (
            with_change(["light", "report_seconds"], 30.0),
            "light.report_seconds: must be a whole number of seconds, 5 to 3600",
        ),
        (
            with_change(["presence", "uart", "device"], "serial0"),
            "presence.uart.device: must be the absolute path of the serial port",
        ),
        (
            with_change(["presence", "uart", "device"], ""),
            "presence.uart.device: must be the absolute path of the serial port",
        ),
        (
            with_change(["presence", "uart", "device"], "/dev/"),
            "presence.uart.device: must be the absolute path of the serial port",
        ),
        (
            with_change(["presence", "uart", "device"], "/dev/tty\0"),
            "presence.uart.device: must be the absolute path of the serial port",
        ),
        (with_change(["presence", "uart", "device"], 1), "presence.uart.device: must be text"),
        (
            with_change(["presence", "uart", "baud"], 1234),
            "presence.uart.baud: must be one of 9600, 19200, 38400, 57600, 115200, 230400, 256000, 460800",
        ),
        (
            with_change(["presence", "uart", "baud"], "256000"),
            "presence.uart.baud: must be one of 9600, 19200, 38400, 57600, 115200, 230400, 256000, 460800",
        ),
        (
            with_change(["presence", "uart", "baud"], 115200.0),
            "presence.uart.baud: must be one of 9600, 19200, 38400, 57600, 115200, 230400, 256000, 460800",
        ),
        (
            with_change(["presence", "uart", "baud"], True),
            "presence.uart.baud: must be one of 9600, 19200, 38400, 57600, 115200, 230400, 256000, 460800",
        ),
        (with_change(["button", "pin"], -1), "button.pin: must be a BCM GPIO number, 0 to 27"),
        (with_change(["button", "pin"], 28), "button.pin: must be a BCM GPIO number, 0 to 27"),
        (with_change(["button", "pin"], "17"), "button.pin: must be a BCM GPIO number, 0 to 27"),
        (with_change(["button", "pin"], 17.5), "button.pin: must be a BCM GPIO number, 0 to 27"),
        (with_change(["button", "pin"], True), "button.pin: must be a BCM GPIO number, 0 to 27"),
        (
            with_change(["button", "bounce_ms"], -1),
            "button.bounce_ms: must be a whole number of milliseconds, 0 to 200",
        ),
        (
            with_change(["button", "bounce_ms"], 201),
            "button.bounce_ms: must be a whole number of milliseconds, 0 to 200",
        ),
        (
            with_change(["button", "bounce_ms"], "30"),
            "button.bounce_ms: must be a whole number of milliseconds, 0 to 200",
        ),
        (
            with_change(["button", "bounce_ms"], 0.5),
            "button.bounce_ms: must be a whole number of milliseconds, 0 to 200",
        ),
        (
            with_change(["button", "double_press_ms"], 99),
            "button.double_press_ms: must be a whole number of milliseconds, 100 to 2000",
        ),
        (
            with_change(["button", "double_press_ms"], 2001),
            "button.double_press_ms: must be a whole number of milliseconds, 100 to 2000",
        ),
        (
            with_change(["button", "double_press_ms"], False),
            "button.double_press_ms: must be a whole number of milliseconds, 100 to 2000",
        ),
        (
            with_change(["button", "long_press_ms"], 299),
            "button.long_press_ms: must be a whole number of milliseconds, 300 to 10000",
        ),
        (
            with_change(["button", "long_press_ms"], 10001),
            "button.long_press_ms: must be a whole number of milliseconds, 300 to 10000",
        ),
        (
            with_change(["button", "long_press_ms"], "1s"),
            "button.long_press_ms: must be a whole number of milliseconds, 300 to 10000",
        ),
    ],
)
def test_bad_config_names_the_key(data: Any, message: str) -> None:
    with pytest.raises(ConfigError) as error:
        parse_config(data)

    assert message in str(error.value)


@pytest.mark.parametrize(
    ("data", "message"),
    [
        ({**minimal(), "dicovery": True}, "dicovery: unknown key"),
        (with_change(["mqtt", "prot"], 1883), "mqtt.prot: unknown key"),
        (with_change(["sensors", "lidar"], True), "sensors.lidar: unknown key"),
        (with_change(["screen", "backen"], "cec"), "screen.backen: unknown key"),
        (with_change(["screen", "cec", "address"], 0), "screen.cec.address: unknown key"),
        (with_change(["screen", "output", "display"], "x"), "screen.output.display: unknown key"),
        (with_change(["button", "gpio"], 17), "button.gpio: unknown key"),
        (with_change(["presence", "gpio"], 27), "presence.gpio: unknown key"),
        (with_change(["presence", "uart", "port"], "/dev/serial0"), "presence.uart.port: unknown key"),
        (with_change(["light", "pin"], 2), "light.pin: unknown key"),
        (with_change(["fallback", "timeout"], 5), "fallback.timeout: unknown key"),
    ],
)
def test_unknown_keys_are_errors(data: Any, message: str) -> None:
    with pytest.raises(ConfigError) as error:
        parse_config(data)

    assert message in str(error.value)
    assert "allowed here:" in str(error.value)


def test_the_password_is_not_in_repr_or_str() -> None:
    config = parse_config(with_change(["mqtt"], {"host": "h", "username": "u", "password": "hunter2-secret"}))

    for text in (repr(config), repr(config.mqtt), str(config), str(config.mqtt)):
        assert "hunter2-secret" not in text
    assert config.mqtt.password == "hunter2-secret"


def test_config_is_frozen() -> None:
    config = parse_config(minimal())

    with pytest.raises(AttributeError):
        config.display_id = "other"  # type: ignore[misc]


def write(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "config.yaml"
    path.write_text(textwrap.dedent(text))
    return path


def test_load_config_reads_a_file(tmp_path: Path) -> None:
    path = write(
        tmp_path,
        """
        display_id: kitchen
        mqtt:
          host: broker.test
          username: pi
          password: "12345"
        """,
    )

    config = load_config(path)

    assert isinstance(config, Config)
    assert config.display_id == "kitchen"
    assert config.mqtt.password == "12345"
    assert load_config(str(path)) == config


def test_load_config_missing_file(tmp_path: Path) -> None:
    with pytest.raises(ConfigError, match="file not found"):
        load_config(tmp_path / "nope.yaml")


def test_load_config_unreadable_file(tmp_path: Path) -> None:
    # A directory is "unreadable" for any user, including root, unlike a chmod 000 file.
    with pytest.raises(ConfigError, match="could not be read"):
        load_config(tmp_path)


def test_load_config_empty_file(tmp_path: Path) -> None:
    with pytest.raises(ConfigError, match="display_id: is required"):
        load_config(write(tmp_path, ""))


def test_load_config_numeric_password_must_be_quoted(tmp_path: Path) -> None:
    path = write(tmp_path, "display_id: a\nmqtt:\n  host: h\n  username: u\n  password: 12345\n")

    with pytest.raises(ConfigError, match=r"mqtt.password: must be text") as error:
        load_config(path)

    assert "12345" not in str(error.value)


def test_load_config_bad_yaml_gives_the_line_but_not_the_text(tmp_path: Path) -> None:
    path = write(tmp_path, "display_id: a\nmqtt:\n  host: h\n  password: [hunter2-secret\n")

    with pytest.raises(ConfigError, match=r"is not valid YAML \(line \d+, column \d+\)") as error:
        load_config(path)

    assert "hunter2-secret" not in str(error.value)
