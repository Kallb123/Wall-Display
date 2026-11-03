"""The agent's config file: what it may contain, and what is wrong when it doesn't fit.

The rules mirror the app's config (calendar-app/server/config/schema.ts), so one id or prefix works in both.
Anything unknown is an error, which catches typos such as `dicovery`. Every error names the key it is about,
and no error ever repeats the password.
"""

import re
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

DEFAULT_CONFIG_PATH = Path("/etc/wallcal-agent/config.yaml")

_DISPLAY_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")
_CLIENT_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
# One or more `/`-separated levels. No `+` or `#` (topic wildcards) and no leading or trailing slash.
_DISCOVERY_PREFIX = re.compile(r"^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$")

# An output name such as HDMI-A-1, DP-2 or eDP-1. It ends up as an argument to wlopm or wlr-randr, so it must be
# one plain word that can't be mistaken for an option (no leading hyphen) and has no spaces.
_OUTPUT_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$")

MIN_DIAGNOSTICS_INTERVAL = 5

SCREEN_BACKENDS = ("black", "cec", "output")
OUTPUT_TOOLS = ("wlopm", "wlr-randr")
MIN_SCREEN_POLL_SECONDS = 5

PRESENCE_SOURCES = ("gpio", "uart")
# The speeds the LD2410 can be set to. 256000 is how it leaves the factory.
UART_BAUDS = (9600, 19200, 38400, 57600, 115200, 230400, 256000, 460800)

LIGHT_CHIPS = ("veml7700", "bh1750")
# The I2C addresses each chip can answer on. The VEML7700 has just the one. The BH1750 has two, picked by its ADDR pin
# (low is 0x23, high is 0x5c).
LIGHT_ADDRESSES = {"veml7700": (0x10,), "bh1750": (0x23, 0x5C)}


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
    """Which sensors are wired to this Pi. Their settings are in `ButtonConfig`, `PresenceConfig` and `LightConfig`."""

    button: bool = False
    presence: bool = False
    light: bool = False


@dataclass(frozen=True)
class CecConfig:
    """The `cec` back end: which device on the HDMI CEC bus to switch."""

    # CEC logical address, 0 to 15. 0 is the TV, which is what a wall panel is.
    device: int = 0


@dataclass(frozen=True)
class OutputConfig:
    """The `output` back end: switching an output off in the kiosk's Wayland compositor."""

    tool: str = "wlopm"
    name: str = "HDMI-A-1"
    # The kiosk's Wayland socket. The service has no desktop session of its own, so it is told where to connect.
    wayland_display: str = "/run/user/1000/wayland-0"


@dataclass(frozen=True)
class ScreenConfig:
    """How the agent turns the panel on and off, and how often it checks the panel's real state."""

    backend: str = "black"
    cec: CecConfig = field(default_factory=CecConfig)
    output: OutputConfig = field(default_factory=OutputConfig)
    command_timeout_seconds: int = 10
    # 0 means never poll: the state is only published after a request, and when the agent connects.
    poll_seconds: int = 60


@dataclass(frozen=True)
class ButtonConfig:
    """The push button: where it is wired, and how long each part of a press may take. Times are milliseconds."""

    # BCM number, not the pin's place on the header. The button goes between this GPIO and ground.
    pin: int = 17
    # An edge only counts once the input has stayed that way this long, so contact bounce is not read as presses.
    bounce_ms: int = 30
    # The longest gap from letting go to pressing again that still makes a double press.
    double_press_ms: int = 400
    # Held this long, it is a long press, reported while the button is still down.
    long_press_ms: int = 1000


@dataclass(frozen=True)
class UartConfig:
    """The `uart` presence source: which serial port the LD2410 is on, and how fast."""

    # The Pi's own UART, whichever of its two it is on this model. Needs the serial port switched on in raspi-config.
    device: str = "/dev/serial0"
    baud: int = 256000


@dataclass(frozen=True)
class PresenceConfig:
    """The mmWave presence sensor: how the agent reads it, and how long a change must last to count."""

    # gpio reads the LD2410's OUT pin as a plain input. uart reads its data frames, which tell more but need the
    # serial port.
    source: str = "gpio"
    # BCM number, not the pin's place on the header. Used by the gpio source. GPIO27 is physical pin 13.
    pin: int = 27
    # A change only counts once it has held this long, so a person walking past the edge of the beam, or the
    # sensor flickering, doesn't make the screen flap. Milliseconds.
    hold_ms: int = 500
    uart: UartConfig = field(default_factory=UartConfig)


@dataclass(frozen=True)
class LightConfig:
    """The ambient light sensor: which chip and where it is, how often it is read, and what counts as a change."""

    # veml7700 or bh1750. Both are small breakout boards on the Pi's I2C pins.
    chip: str = "veml7700"
    # The I2C bus number: /dev/i2c-<bus>. Bus 1 is the one on the header's pins 3 and 5.
    bus: int = 1
    # Left out of the config, this is the chip's own address (`parse_config` fills it in). A `LightConfig` made by
    # hand for another chip must say so.
    address: int = 0x10
    # How often the sensor is read. Most readings are not published: see `change_percent` and `report_seconds`.
    sample_ms: int = 1000
    # A reading is published when it differs from the last one published by at least this share of it...
    change_percent: int = 10
    # ...and by at least this many lux, so flicker in a dark room isn't a change.
    change_lux: float = 0.5
    # The longest a reading goes unpublished, so Home Assistant can tell a steady room from a dead sensor.
    report_seconds: int = 30


@dataclass(frozen=True)
class FallbackConfig:
    """What the agent does on its own when the app is away: take over the screen with local presence rules."""

    # Needs sensors.presence: without a presence sensor there is nothing to go on, so it stays off.
    enabled: bool = True
    # How long the app must be offline (or the broker unreachable) before the agent takes over. Minutes.
    timeout_minutes: int = 5
    # With nobody there this long (counted from the take-over at the earliest), the agent turns the screen off. Minutes.
    off_after_minutes: int = 10


@dataclass(frozen=True)
class Config:
    display_id: str
    mqtt: MqttConfig
    diagnostics_interval_seconds: int = 60
    sensors: SensorsConfig = field(default_factory=SensorsConfig)
    screen: ScreenConfig = field(default_factory=ScreenConfig)
    button: ButtonConfig = field(default_factory=ButtonConfig)
    presence: PresenceConfig = field(default_factory=PresenceConfig)
    light: LightConfig = field(default_factory=LightConfig)
    fallback: FallbackConfig = field(default_factory=FallbackConfig)

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


def _parse_cec(data: Any) -> CecConfig:
    if data is None:
        return CecConfig()
    section = _mapping(data, "screen.cec")
    _check_keys(section, "screen.cec", ("device",))
    device = _whole_number(section, "device", "screen.cec.device", 0, "must be a CEC logical address, 0 to 15")
    if not 0 <= device <= 15:
        raise ConfigError("screen.cec.device: must be a CEC logical address, 0 to 15")
    return CecConfig(device=device)


def _parse_output(data: Any) -> OutputConfig:
    if data is None:
        return OutputConfig()
    section = _mapping(data, "screen.output")
    _check_keys(section, "screen.output", ("tool", "name", "wayland_display"))

    tool = _text(section, "tool", "screen.output.tool")
    if tool is None:
        tool = "wlopm"
    if tool not in OUTPUT_TOOLS:
        raise ConfigError(f"screen.output.tool: must be one of {', '.join(OUTPUT_TOOLS)}")

    name = _text(section, "name", "screen.output.name")
    if name is None:
        name = "HDMI-A-1"
    if not _OUTPUT_NAME.match(name):
        raise ConfigError(
            "screen.output.name: must be one output name such as HDMI-A-1 "
            "(letters, digits and - _ . :, no spaces, not starting with a hyphen)"
        )

    wayland_display = _text(section, "wayland_display", "screen.output.wayland_display")
    if wayland_display is None:
        wayland_display = "/run/user/1000/wayland-0"
    path = PurePosixPath(wayland_display)
    if not path.is_absolute() or wayland_display.endswith("/") or "\0" in wayland_display:
        raise ConfigError(
            "screen.output.wayland_display: must be the absolute path of the Wayland socket, "
            "such as /run/user/1000/wayland-0"
        )
    return OutputConfig(tool=tool, name=name, wayland_display=wayland_display)


def _parse_screen(data: Any) -> ScreenConfig:
    if data is None:
        return ScreenConfig()
    section = _mapping(data, "screen")
    _check_keys(section, "screen", ("backend", "cec", "output", "command_timeout_seconds", "poll_seconds"))

    backend = _text(section, "backend", "screen.backend")
    if backend is None:
        backend = "black"
    if backend not in SCREEN_BACKENDS:
        raise ConfigError(f"screen.backend: must be one of {', '.join(SCREEN_BACKENDS)}")

    timeout = _whole_number(
        section,
        "command_timeout_seconds",
        "screen.command_timeout_seconds",
        10,
        "must be a whole number of seconds, 1 to 60",
    )
    if not 1 <= timeout <= 60:
        raise ConfigError("screen.command_timeout_seconds: must be a whole number of seconds, 1 to 60")

    poll = _whole_number(
        section,
        "poll_seconds",
        "screen.poll_seconds",
        60,
        f"must be a whole number of seconds, at least {MIN_SCREEN_POLL_SECONDS} (or 0 to never check)",
    )
    if poll != 0 and poll < MIN_SCREEN_POLL_SECONDS:
        raise ConfigError(f"screen.poll_seconds: must be at least {MIN_SCREEN_POLL_SECONDS} (or 0 to never check)")

    # Both sub-blocks are checked whichever back end is chosen, so a mistake is found now and not on the day
    # someone switches back end.
    return ScreenConfig(
        backend=backend,
        cec=_parse_cec(section.get("cec")),
        output=_parse_output(section.get("output")),
        command_timeout_seconds=timeout,
        poll_seconds=poll,
    )


def _milliseconds(data: dict[Any, Any], key: str, default: int, low: int, high: int) -> int:
    """A `button.<key>` setting in milliseconds, which must be a whole number from `low` to `high`."""
    path = f"button.{key}"
    message = f"must be a whole number of milliseconds, {low} to {high}"
    value = _whole_number(data, key, path, default, message)
    if not low <= value <= high:
        raise ConfigError(f"{path}: {message}")
    return value


def _parse_button(data: Any) -> ButtonConfig:
    if data is None:
        return ButtonConfig()
    section = _mapping(data, "button")
    _check_keys(section, "button", ("pin", "bounce_ms", "double_press_ms", "long_press_ms"))

    pin = _whole_number(section, "pin", "button.pin", 17, "must be a BCM GPIO number, 0 to 27")
    if not 0 <= pin <= 27:
        raise ConfigError("button.pin: must be a BCM GPIO number, 0 to 27")

    return ButtonConfig(
        pin=pin,
        bounce_ms=_milliseconds(section, "bounce_ms", 30, 0, 200),
        double_press_ms=_milliseconds(section, "double_press_ms", 400, 100, 2000),
        long_press_ms=_milliseconds(section, "long_press_ms", 1000, 300, 10000),
    )


def _parse_uart(data: Any) -> UartConfig:
    if data is None:
        return UartConfig()
    section = _mapping(data, "presence.uart")
    _check_keys(section, "presence.uart", ("device", "baud"))

    device = _text(section, "device", "presence.uart.device")
    if device is None:
        device = "/dev/serial0"
    # The path is opened as it stands, so it must be one plain absolute path to a device.
    if not PurePosixPath(device).is_absolute() or device.endswith("/") or "\0" in device:
        raise ConfigError("presence.uart.device: must be the absolute path of the serial port, such as /dev/serial0")

    baud_message = f"must be one of {', '.join(str(baud) for baud in UART_BAUDS)}"
    baud = _whole_number(section, "baud", "presence.uart.baud", 256000, baud_message)
    if baud not in UART_BAUDS:
        raise ConfigError(f"presence.uart.baud: {baud_message}")
    return UartConfig(device=device, baud=baud)


def _parse_presence(data: Any) -> PresenceConfig:
    if data is None:
        return PresenceConfig()
    section = _mapping(data, "presence")
    _check_keys(section, "presence", ("source", "pin", "hold_ms", "uart"))

    source = _text(section, "source", "presence.source")
    if source is None:
        source = "gpio"
    if source not in PRESENCE_SOURCES:
        raise ConfigError(f"presence.source: must be one of {', '.join(PRESENCE_SOURCES)}")

    pin = _whole_number(section, "pin", "presence.pin", 27, "must be a BCM GPIO number, 0 to 27")
    if not 0 <= pin <= 27:
        raise ConfigError("presence.pin: must be a BCM GPIO number, 0 to 27")

    hold_message = "must be a whole number of milliseconds, 0 to 10000"
    hold = _whole_number(section, "hold_ms", "presence.hold_ms", 500, hold_message)
    if not 0 <= hold <= 10000:
        raise ConfigError(f"presence.hold_ms: {hold_message}")

    # The uart block is checked whichever source is chosen, like the settings of a screen back end that isn't.
    return PresenceConfig(source=source, pin=pin, hold_ms=hold, uart=_parse_uart(section.get("uart")))


def _number(data: dict[Any, Any], key: str, path: str, default: float, message: str) -> float:
    """A setting that may be a whole or a fractional number. A YAML `0.5` is a float and `1` is an int."""
    if key not in data or data[key] is None:
        return default
    value = data[key]
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ConfigError(f"{path}: {message}")
    return value


def _parse_light(data: Any) -> LightConfig:
    if data is None:
        return LightConfig()
    section = _mapping(data, "light")
    _check_keys(
        section, "light", ("chip", "bus", "address", "sample_ms", "change_percent", "change_lux", "report_seconds")
    )

    chip = _text(section, "chip", "light.chip")
    if chip is None:
        chip = "veml7700"
    if chip not in LIGHT_CHIPS:
        raise ConfigError(f"light.chip: must be one of {', '.join(LIGHT_CHIPS)}")

    bus_message = "must be an I2C bus number, 0 to 31"
    bus = _whole_number(section, "bus", "light.bus", 1, bus_message)
    if not 0 <= bus <= 31:
        raise ConfigError(f"light.bus: {bus_message}")

    # Checked against the chip chosen above. YAML reads `0x23` as a number, so it is written the way the chip's
    # datasheet does.
    allowed = LIGHT_ADDRESSES[chip]
    address_message = f"must be {' or '.join(f'0x{address:02x}' for address in allowed)} for the {chip}"
    address = _whole_number(section, "address", "light.address", allowed[0], address_message)
    if address not in allowed:
        raise ConfigError(f"light.address: {address_message}")

    sample_message = "must be a whole number of milliseconds, 200 to 60000"
    sample = _whole_number(section, "sample_ms", "light.sample_ms", 1000, sample_message)
    if not 200 <= sample <= 60000:
        raise ConfigError(f"light.sample_ms: {sample_message}")

    percent_message = "must be a whole number of percent, 1 to 100"
    percent = _whole_number(section, "change_percent", "light.change_percent", 10, percent_message)
    if not 1 <= percent <= 100:
        raise ConfigError(f"light.change_percent: {percent_message}")

    lux_message = "must be a number of lux, 0 to 1000"
    lux = _number(section, "change_lux", "light.change_lux", 0.5, lux_message)
    # Written so that NaN, which is neither above nor below anything, is refused too.
    if not 0 <= lux <= 1000:
        raise ConfigError(f"light.change_lux: {lux_message}")

    report_message = "must be a whole number of seconds, 5 to 3600"
    report = _whole_number(section, "report_seconds", "light.report_seconds", 30, report_message)
    if not 5 <= report <= 3600:
        raise ConfigError(f"light.report_seconds: {report_message}")

    return LightConfig(
        chip=chip,
        bus=bus,
        address=address,
        sample_ms=sample,
        change_percent=percent,
        change_lux=float(lux),
        report_seconds=report,
    )


def _parse_fallback(data: Any) -> FallbackConfig:
    if data is None:
        return FallbackConfig()
    section = _mapping(data, "fallback")
    _check_keys(section, "fallback", ("enabled", "timeout_minutes", "off_after_minutes"))

    minutes_message = "must be a whole number of minutes, 1 to 1440"
    timeout = _whole_number(section, "timeout_minutes", "fallback.timeout_minutes", 5, minutes_message)
    if not 1 <= timeout <= 1440:
        raise ConfigError(f"fallback.timeout_minutes: {minutes_message}")
    off_after = _whole_number(section, "off_after_minutes", "fallback.off_after_minutes", 10, minutes_message)
    if not 1 <= off_after <= 1440:
        raise ConfigError(f"fallback.off_after_minutes: {minutes_message}")

    return FallbackConfig(
        enabled=_flag(section, "enabled", "fallback.enabled", True),
        timeout_minutes=timeout,
        off_after_minutes=off_after,
    )


def parse_config(data: Any) -> Config:
    """Checks a config that has already been read from YAML. Raises ConfigError naming the first problem."""
    top = _mapping(data, "config") if data is not None else {}
    _check_keys(
        top,
        "",
        (
            "display_id",
            "mqtt",
            "diagnostics_interval_seconds",
            "sensors",
            "screen",
            "button",
            "presence",
            "light",
            "fallback",
        ),
    )

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

    sensors = _parse_sensors(top.get("sensors"))
    # Checked whether or not the sensor is on, like the settings of a screen back end that isn't chosen.
    button = _parse_button(top.get("button"))
    presence = _parse_presence(top.get("presence"))
    light = _parse_light(top.get("light"))
    fallback = _parse_fallback(top.get("fallback"))
    # One wire can't be two inputs. Only when both sensors are on: with either off nothing opens the pin.
    if sensors.button and sensors.presence and presence.source == "gpio" and presence.pin == button.pin:
        raise ConfigError(f"presence.pin: GPIO{presence.pin} is already the button's pin (button.pin)")

    return Config(
        display_id=display_id,
        mqtt=_parse_mqtt(top["mqtt"], display_id),
        diagnostics_interval_seconds=interval,
        sensors=sensors,
        screen=_parse_screen(top.get("screen")),
        button=button,
        presence=presence,
        light=light,
        fallback=fallback,
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
