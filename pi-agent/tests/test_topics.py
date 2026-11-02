import pytest

from wallcal_agent import topics


def test_topic_for_puts_the_display_under_the_base() -> None:
    assert topics.topic_for("hallway", topics.UPTIME) == "wallcal/hallway/pi/uptime"
    assert topics.topic_for("living-room", topics.AVAILABILITY) == "wallcal/living-room/pi/availability"


def test_online_and_offline() -> None:
    assert (topics.ONLINE, topics.OFFLINE) == ("online", "offline")


def test_published_retains_availability_and_the_panel_state_only() -> None:
    assert topics.PUBLISHED == {
        "pi/availability": True,
        "pi/cpu_temperature": False,
        "pi/uptime": False,
        "pi/screen/state": True,
    }


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
