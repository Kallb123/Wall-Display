"""MQTT topic names and payload formats the agent publishes.

contracts/mqtt.json is the source of truth. tests/test_contract.py holds everything here to it, so a topic or
payload cannot drift away from what the app and Home Assistant expect.
"""

import math
from decimal import ROUND_HALF_UP, Decimal

from .button import DOUBLE, LONG, SINGLE

# Every topic sits under this, so one broker can serve several displays.
BASE = "wallcal/{display_id}"

AVAILABILITY = "pi/availability"
CPU_TEMPERATURE = "pi/cpu_temperature"
UPTIME = "pi/uptime"
# The request to turn the panel on or off (the agent subscribes to it) and what the panel is actually doing.
SCREEN_SET = "pi/screen/set"
SCREEN_STATE = "pi/screen/state"
# A press of the physical button, already told apart as single, double or long.
BUTTON = "pi/button"
# Whether the mmWave sensor sees someone: a state, so it is retained and a late subscriber learns it at once.
PRESENCE = "pi/presence"
# The ambient light in lux: a measurement, so it is not retained.
ILLUMINANCE = "pi/illuminance"

# What the button publishes, written out here as the contract has them. button.py's detector produces these.
BUTTON_GESTURES = (SINGLE, DOUBLE, LONG)

# What presence publishes, as the contract has them. Upper case, because that is what Home Assistant's binary sensor
# expects by default.
PRESENCE_ON = "ON"
PRESENCE_OFF = "OFF"

ONLINE = "online"
OFFLINE = "offline"

# Each topic the agent publishes, and whether it is retained. Availability is retained so a late subscriber learns
# the state at once (and so the last will can replace it). The diagnostics are not: a stale reading is worse than none.
# The panel state is retained because it only changes when someone asks, so it can be a long time between messages.
# A button press is an event, not a state: replayed to a subscriber that connects later it would act twice. Presence
# is the other way round: a state, true until it changes, so the retained value is how the app learns it at connect.
# A light reading is a measurement, like the diagnostics: replayed to a subscriber that connects later it would be
# a stale one, which is worse than none, so it is not retained. The agent publishes it again every few seconds anyway.
PUBLISHED: dict[str, bool] = {
    AVAILABILITY: True,
    CPU_TEMPERATURE: False,
    UPTIME: False,
    SCREEN_STATE: True,
    BUTTON: False,
    PRESENCE: True,
    ILLUMINANCE: False,
}

# Each topic the agent listens to. The contract's `to_pi` topics are exactly these.
SUBSCRIBED: tuple[str, ...] = (SCREEN_SET,)


def topic_for(display_id: str, name: str) -> str:
    """The full topic for `name` (such as `pi/uptime`) on one display."""
    return f"{BASE.format(display_id=display_id)}/{name}"


def cpu_temperature_payload(celsius: float) -> str:
    """Degrees Celsius to one decimal place, as the contract wants ("48.3").

    Rounds halves away from zero, which is what people expect. Decimal avoids binary floating point's surprises,
    and a value that rounds to zero is always "0.0", never "-0.0", which the contract's pattern does not allow.
    """
    if not math.isfinite(celsius):
        raise ValueError(f"cannot format a temperature of {celsius}")
    rounded = Decimal(repr(celsius)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    if rounded.is_zero():
        return "0.0"
    return format(rounded, "f")


def uptime_payload(seconds: float) -> str:
    """Whole seconds since boot. Fractions are dropped, and a clock that steps backwards gives 0, never a minus."""
    return str(max(0, math.floor(seconds)))


def parse_screen_payload(text: str) -> bool | None:
    """True for "on", False for "off", and None for anything else. Exact: "ON" and " on" are not valid."""
    if text == "on":
        return True
    if text == "off":
        return False
    return None


def screen_payload(on: bool) -> str:
    """The payload for a panel that is on or off."""
    return "on" if on else "off"


def button_payload(gesture: str) -> str:
    """The payload for a press: "single", "double" or "long", exactly. Anything else is a bug and raises."""
    if gesture not in BUTTON_GESTURES:
        raise ValueError(f"not a button gesture: {gesture!r}")
    return gesture


def presence_payload(present: bool) -> str:
    """The payload for someone there or nobody: "ON" or "OFF"."""
    return PRESENCE_ON if present else PRESENCE_OFF


def illuminance_payload(lux: float) -> str:
    """Lux to at most two decimal places, with no trailing zeros, as the contract wants ("0", "0.25", "12.5", "430").

    Rounds halves away from zero, as the temperature does. A reading below zero, or one that is not a number, is a bug
    in whatever read the sensor, so it raises and nothing is published. A value that rounds to zero is always "0",
    never "-0", and the text is never in exponent form, which the contract's pattern does not allow.
    """
    if not math.isfinite(lux) or lux < 0:
        raise ValueError(f"cannot format an illuminance of {lux}")
    rounded = Decimal(repr(lux)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if rounded.is_zero():
        return "0"
    # Always written with two decimals, so there is a point to stop at: "12.50" is "12.5" and "100.00" is "100".
    return format(rounded, "f").rstrip("0").rstrip(".")
