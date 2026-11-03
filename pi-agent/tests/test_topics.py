import pytest

from wallcal_agent import topics


def test_topic_for_puts_the_display_under_the_base() -> None:
    assert topics.topic_for("hallway", topics.UPTIME) == "wallcal/hallway/pi/uptime"
    assert topics.topic_for("living-room", topics.AVAILABILITY) == "wallcal/living-room/pi/availability"


def test_online_and_offline() -> None:
    assert (topics.ONLINE, topics.OFFLINE) == ("online", "offline")


def test_published_retains_availability_the_panel_state_and_presence_only() -> None:
    assert topics.PUBLISHED == {
        "pi/availability": True,
        "pi/cpu_temperature": False,
        "pi/uptime": False,
        "pi/screen/state": True,
        "pi/button": False,
        "pi/presence": True,
        "pi/illuminance": False,
    }


def test_the_button_topic() -> None:
    assert topics.BUTTON == "pi/button"
    assert topics.topic_for("hallway", topics.BUTTON) == "wallcal/hallway/pi/button"


@pytest.mark.parametrize("gesture", ["single", "double", "long"])
def test_button_payloads_are_the_bare_gesture(gesture: str) -> None:
    assert topics.button_payload(gesture) == gesture


@pytest.mark.parametrize("gesture", ["", "Single", "triple", "press", "long ", "SINGLE"])
def test_anything_else_is_not_a_button_gesture(gesture: str) -> None:
    with pytest.raises(ValueError, match="not a button gesture"):
        topics.button_payload(gesture)


def test_the_presence_topic() -> None:
    assert topics.PRESENCE == "pi/presence"
    assert topics.topic_for("hallway", topics.PRESENCE) == "wallcal/hallway/pi/presence"


def test_presence_payloads_are_on_and_off_in_capitals() -> None:
    assert topics.presence_payload(True) == "ON"
    assert topics.presence_payload(False) == "OFF"
    assert (topics.PRESENCE_ON, topics.PRESENCE_OFF) == ("ON", "OFF")


def test_the_illuminance_topic() -> None:
    assert topics.ILLUMINANCE == "pi/illuminance"
    assert topics.topic_for("hallway", topics.ILLUMINANCE) == "wallcal/hallway/pi/illuminance"
    # A reading is a measurement: a stale one replayed to a late subscriber is worse than none.
    assert topics.PUBLISHED[topics.ILLUMINANCE] is False


def test_the_agent_listens_for_screen_requests() -> None:
    assert topics.SUBSCRIBED == ("pi/screen/set",)
    assert topics.topic_for("hallway", topics.SCREEN_SET) == "wallcal/hallway/pi/screen/set"
    assert topics.topic_for("hallway", topics.SCREEN_STATE) == "wallcal/hallway/pi/screen/state"


@pytest.mark.parametrize(("text", "expected"), [("on", True), ("off", False)])
def test_screen_payloads_round_trip(text: str, expected: bool) -> None:
    assert topics.parse_screen_payload(text) is expected
    assert topics.screen_payload(expected) == text


@pytest.mark.parametrize("text", ["", "ON", "Off", " on", "on\n", "true", "1", "toggle", "onn"])
def test_anything_else_is_not_a_screen_payload(text: str) -> None:
    assert topics.parse_screen_payload(text) is None


@pytest.mark.parametrize(
    ("celsius", "expected"),
    [
        (48.3, "48.3"),
        (48.25, "48.3"),
        (48.35, "48.4"),
        (48.0, "48.0"),
        (0, "0.0"),
        (0.04, "0.0"),
        (-0.04, "0.0"),
        (-0.0, "0.0"),
        (-0.05, "-0.1"),
        (-5.5, "-5.5"),
        (-20.04, "-20.0"),
        (99.99, "100.0"),
        (105, "105.0"),
    ],
)
def test_cpu_temperature_has_one_decimal_and_never_minus_zero(celsius: float, expected: str) -> None:
    assert topics.cpu_temperature_payload(celsius) == expected


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_cpu_temperature_refuses_a_value_that_is_not_a_number(bad: float) -> None:
    with pytest.raises(ValueError, match="cannot format"):
        topics.cpu_temperature_payload(bad)


@pytest.mark.parametrize(
    ("seconds", "expected"),
    [(0, "0"), (0.9, "0"), (59.99, "59"), (60, "60"), (86400.5, "86400"), (10**9, "1000000000"), (-3.2, "0")],
)
def test_uptime_is_whole_seconds_and_never_negative(seconds: float, expected: str) -> None:
    assert topics.uptime_payload(seconds) == expected


@pytest.mark.parametrize(
    ("lux", "expected"),
    [
        (0, "0"),
        (0.0, "0"),
        (-0.0, "0"),
        (0.004, "0"),
        (0.005, "0.01"),
        (0.01, "0.01"),
        (0.25, "0.25"),
        (0.255, "0.26"),
        (0.1, "0.1"),
        (0.1 + 0.2, "0.3"),
        (1, "1"),
        (12.5, "12.5"),
        (12.50, "12.5"),
        (12.504, "12.5"),
        (12.505, "12.51"),
        (99.999, "100"),
        (100, "100"),
        (100.0, "100"),
        (430, "430"),
        (430.004, "430"),
        (1000, "1000"),
        (1200.5, "1200.5"),
        (120000, "120000"),
        (65535.5, "65535.5"),
        (1e15, "1000000000000000"),
        (1e-9, "0"),
    ],
)
def test_illuminance_has_at_most_two_decimals_no_trailing_zeros_and_never_minus_zero_or_an_exponent(
    lux: float, expected: str
) -> None:
    assert topics.illuminance_payload(lux) == expected


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf"), -0.01, -1, -1e-9, -430.5])
def test_illuminance_refuses_a_reading_that_is_negative_or_not_a_number(bad: float) -> None:
    with pytest.raises(ValueError, match="cannot format an illuminance"):
        topics.illuminance_payload(bad)
