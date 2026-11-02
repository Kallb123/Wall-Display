"""The agent's config file: what it may contain, and what is wrong when it doesn't fit.

The rules mirror the app's config (calendar-app/server/config/schema.ts), so one id or prefix works in both.
Anything unknown is an error, which catches typos such as `dicovery`. Every error names the key it is about,
and no error ever repeats the password.
"""

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

DEFAULT_CONFIG_PATH = Path("/etc/wallcal-agent/config.yaml")

_DISPLAY_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")
_CLIENT_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
# One or more `/`-separated levels. No `+` or `#` (topic wildcards) and no leading or trailing slash.
_DISCOVERY_PREFIX = re.compile(r"^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$")

MIN_DIAGNOSTICS_INTERVAL = 5


class ConfigError(Exception):
    """The config can't be used. The message is for the person who wrote it, so it reads as plain English."""


@dataclass(frozen=True)
class MqttConfig:
    host: str
    client_id: str
    port: int = 1883
    username: str | None = None
    # Left out of repr so it can't reach a log by accident.
    password: str | None = field(default=None, repr=False)
    tls: bool = False
    discovery: bool = True
    discovery_prefix: str = "homeassistant"


@dataclass(frozen=True)
class SensorsConfig:
    """Which sensors are wired to this Pi. They arrive in later pull requests."""

    button: bool = False
    presence: bool = False
    light: bool = False


@dataclass(frozen=True)
class Config:
    display_id: str
    mqtt: MqttConfig
    diagnostics_interval_seconds: int = 60
    sensors: SensorsConfig = field(default_factory=SensorsConfig)

    def enabled_sensors(self) -> list[str]:
        """The names of the sensors switched on, in a fixed order."""
        return [name for name in ("button", "presence", "light") if getattr(self.sensors, name)]


def _check_keys(data: dict[Any, Any], path: str, allowed: tuple[str, ...]) -> None:
    for key in data:
        if key not in allowed:
            where = f"{path}.{key}" if path else str(key)
            raise ConfigError(f"{where}: unknown key (allowed here: {', '.join(allowed)})")


def _mapping(value: Any, path: str) -> dict[Any, Any]:
    if not isinstance(value, dict):
        raise ConfigError(f"{path}: must be a mapping of settings")
    return value


def _text(data: dict[Any, Any], key: str, path: str) -> str | None:
    """A string setting, or None when left out. Numbers are refused: a YAML `password: 1234` is an int."""
    if key not in data or data[key] is None:
        return None
    value = data[key]
    if not isinstance(value, str):
        raise ConfigError(f"{path}: must be text (put it in quotes if it looks like a number)")
    return value


def _flag(data: dict[Any, Any], key: str, path: str, default: bool) -> bool:
    if key not in data or data[key] is None:
        return default
    value = data[key]
    if not isinstance(value, bool):
        raise ConfigError(f"{path}: must be true or false")
    return value


def _whole_number(data: dict[Any, Any], key: str, path: str, default: int, message: str) -> int:
    if key not in data or data[key] is None:
        return default
    value = data[key]
    # bool is a kind of int in Python, so `port: true` would otherwise slip through.
    if isinstance(value, bool) or not isinstance(value, int):
        raise ConfigError(f"{path}: {message}")
    return value


def _parse_mqtt(data: Any, display_id: str) -> MqttConfig:
    section = _mapping(data, "mqtt")
    _check_keys(
        section,
        "mqtt",
        ("host", "port", "username", "password", "tls", "client_id", "discovery", "discovery_prefix"),
    )

    host = _text(section, "host", "mqtt.host")
    if host is None or host.strip() == "":
        raise ConfigError("mqtt.host: is required (the broker's host name or address)")
    if re.search(r"\s", host) or "://" in host:
        raise ConfigError("mqtt.host: must be just a host name or address, such as homeserver.local")

    port = _whole_number(section, "port", "mqtt.port", 1883, "must be 1 to 65535")
    if not 1 <= port <= 65535:
        raise ConfigError("mqtt.port: must be 1 to 65535")

    username = _text(section, "username", "mqtt.username")
    if username is not None and username == "":
        raise ConfigError("mqtt.username: must not be empty (leave it out for no login)")
    password = _text(section, "password", "mqtt.password")
    if password is not None and password == "":
        raise ConfigError("mqtt.password: must not be empty (leave it out for no password)")
    if password is not None and username is None:
        raise ConfigError("mqtt.password: needs a username as well (a password on its own is not sent)")

    client_id = _text(section, "client_id", "mqtt.client_id")
    if client_id is None:
        client_id = f"wallcal-pi-{display_id}"
    if not _CLIENT_ID.match(client_id):
        raise ConfigError("mqtt.client_id: must be 1 to 64 letters, digits, hyphens and underscores")

    prefix = _text(section, "discovery_prefix", "mqtt.discovery_prefix")
    if prefix is None:
        prefix = "homeassistant"
    if not _DISCOVERY_PREFIX.match(prefix):
        raise ConfigError(
            "mqtt.discovery_prefix: must be one or more topic levels of letters, digits, hyphens and underscores, "
            "such as homeassistant (no wildcards, no leading or trailing slash)"
        )

    return MqttConfig(
        host=host.strip(),
        client_id=client_id,
        port=port,
        username=username,
        password=password,
        tls=_flag(section, "tls", "mqtt.tls", False),
        discovery=_flag(section, "discovery", "mqtt.discovery", True),
        discovery_prefix=prefix,
    )


def _parse_sensors(data: Any) -> SensorsConfig:
    if data is None:
        return SensorsConfig()
    section = _mapping(data, "sensors")
    _check_keys(section, "sensors", ("button", "presence", "light"))
    return SensorsConfig(
        button=_flag(section, "button", "sensors.button", False),
        presence=_flag(section, "presence", "sensors.presence", False),
        light=_flag(section, "light", "sensors.light", False),
    )


def parse_config(data: Any) -> Config:
    """Checks a config that has already been read from YAML. Raises ConfigError naming the first problem."""
    top = _mapping(data, "config") if data is not None else {}
    _check_keys(top, "", ("display_id", "mqtt", "diagnostics_interval_seconds", "sensors"))

    display_id = _text(top, "display_id", "display_id")
    if display_id is None:
        raise ConfigError("display_id: is required (the id of this display in the app's config)")
    if not _DISPLAY_ID.match(display_id):
        raise ConfigError("display_id: must be lowercase letters, digits and hyphens, starting with a letter or digit")

    if "mqtt" not in top or top["mqtt"] is None:
        raise ConfigError("mqtt: is required (at least the broker's host)")

    interval = _whole_number(
        top,
        "diagnostics_interval_seconds",
        "diagnostics_interval_seconds",
        60,
        f"must be a whole number of seconds, at least {MIN_DIAGNOSTICS_INTERVAL}",
    )
    if interval < MIN_DIAGNOSTICS_INTERVAL:
        raise ConfigError(f"diagnostics_interval_seconds: must be at least {MIN_DIAGNOSTICS_INTERVAL}")

    return Config(
        display_id=display_id,
        mqtt=_parse_mqtt(top["mqtt"], display_id),
        diagnostics_interval_seconds=interval,
        sensors=_parse_sensors(top.get("sensors")),
    )


def load_config(path: Path | str) -> Config:
    """Reads and checks the config file. Raises ConfigError, whose message leaves out the path and the file's text."""
    try:
        text = Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        raise ConfigError("file not found") from None
    except PermissionError:
        raise ConfigError("not readable (is the service user in the file's group?)") from None
    except (OSError, UnicodeDecodeError) as error:
        raise ConfigError(f"could not be read: {type(error).__name__}") from None

    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as error:
        # Not str(error): its snippet of the file could show the password.
        mark = getattr(error, "problem_mark", None)
        where = f" (line {mark.line + 1}, column {mark.column + 1})" if mark is not None else ""
        problem = getattr(error, "problem", None) or "invalid YAML"
        raise ConfigError(f"is not valid YAML{where}: {problem}") from None

    return parse_config(data)
