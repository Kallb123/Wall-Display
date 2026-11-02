import copy
import textwrap
from pathlib import Path
from typing import Any

import pytest
import yaml

from wallcal_agent.config import CecConfig, Config, ConfigError, OutputConfig, ScreenConfig, load_config, parse_config

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
            "sensors": {"button": True, "light": True},
            "screen": {
                "backend": "output",
                "cec": {"device": 15},
                "output": {"tool": "wlr-randr", "name": "DP-2", "wayland_display": "/run/user/1001/wayland-1"},
                "command_timeout_seconds": 60,
                "poll_seconds": 5,
            },
        }
    )

    assert config.mqtt.port == 8883
    assert config.mqtt.tls is True
    assert config.mqtt.client_id == "my_pi-1"
    assert config.mqtt.discovery is False
    assert config.mqtt.discovery_prefix == "ha/custom"
    assert config.diagnostics_interval_seconds == 5
    assert config.enabled_sensors() == ["button", "light"]
    assert config.screen == ScreenConfig(
        backend="output",
        cec=CecConfig(device=15),
        output=OutputConfig(tool="wlr-randr", name="DP-2", wayland_display="/run/user/1001/wayland-1"),
        command_timeout_seconds=60,
        poll_seconds=5,
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

    assert parse_config(trimmed).mqtt.port == parse_config(example).mqtt.port
    assert parse_config(trimmed).mqtt.client_id == parse_config(example).mqtt.client_id
    assert parse_config(trimmed).diagnostics_interval_seconds == parse_config(example).diagnostics_interval_seconds
    assert parse_config(trimmed).screen == parse_config(example).screen


def test_the_examples_screen_block_sets_every_screen_key_to_its_default() -> None:
    screen = yaml.safe_load(EXAMPLE_PATH.read_text())["screen"]

    assert set(screen) == {"backend", "cec", "output", "command_timeout_seconds", "poll_seconds"}
    assert parse_config({**minimal(), "screen": screen}).screen == ScreenConfig()


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
