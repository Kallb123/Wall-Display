"""The gesture detector, played with explicit times. No clock, no threads: every call says what time it is."""

import pytest

from wallcal_agent.button import DOUBLE, LONG, SINGLE, GestureDetector

# Times are in seconds. These are the config's defaults (30, 400 and 1000 ms), in binary-friendly numbers where the
# test cares about an exact boundary.
BOUNCE = 0.03125
DOUBLE_PRESS = 0.5
LONG_PRESS = 1.0


def detector(
    bounce: float = BOUNCE, double_press: float = DOUBLE_PRESS, long_press: float = LONG_PRESS
) -> GestureDetector:
    return GestureDetector(bounce=bounce, double_press=double_press, long_press=long_press)


def play(d: GestureDetector, *steps: tuple[str, float]) -> list[tuple[float, str]]:
    """Runs ("down", t), ("up", t) and ("tick", t) in order. Returns what each tick handed out, with its time."""
    out: list[tuple[float, str]] = []
    for what, at in steps:
        if what == "tick":
            out.extend((at, gesture) for gesture in d.tick(at))
        else:
            d.edge(what == "down", at)
    return out


def gestures(d: GestureDetector, *steps: tuple[str, float]) -> list[str]:
    return [gesture for _, gesture in play(d, *steps)]


# One press


def test_a_short_press_is_a_single_once_the_double_press_window_has_passed() -> None:
    d = detector()

    out = play(d, ("down", 0.0), ("up", 0.25), ("tick", 0.5), ("tick", 0.74), ("tick", 0.75), ("tick", 5.0))

    assert out == [(0.75, SINGLE)]


def test_nothing_is_reported_until_the_press_is_over() -> None:
    d = detector()

    assert gestures(d, ("down", 0.0), ("tick", 0.0), ("tick", 0.5), ("tick", 0.99)) == []


def test_a_single_is_reported_exactly_once() -> None:
    d = detector()

    first = gestures(d, ("down", 0.0), ("up", 0.125), ("tick", 10.0))
    again = gestures(d, ("tick", 11.0), ("tick", 12.0))

    assert first == [SINGLE]
    assert again == []


def test_a_press_is_a_press_even_if_nobody_ticks_until_much_later() -> None:
    d = detector()

    assert gestures(d, ("down", 0.0), ("up", 0.25), ("tick", 100.0)) == [SINGLE]


# Long presses


def test_a_long_press_is_reported_while_the_button_is_still_held() -> None:
    d = detector()

    out = play(d, ("down", 0.0), ("tick", 0.5), ("tick", 0.99), ("tick", 1.0), ("tick", 3.0))

    assert out == [(1.0, LONG)]


def test_letting_go_after_a_long_press_adds_nothing() -> None:
    d = detector()

    out = play(d, ("down", 0.0), ("tick", 1.0), ("up", 2.0), ("tick", 2.5), ("tick", 10.0))

    assert out == [(1.0, LONG)]


def test_a_press_let_go_just_before_the_long_press_time_is_a_single() -> None:
    d = detector()

    assert gestures(d, ("down", 0.0), ("up", 0.96875), ("tick", 5.0)) == [SINGLE]


def test_a_release_at_exactly_the_long_press_time_is_a_long_press() -> None:
    d = detector()

    assert gestures(d, ("down", 0.0), ("up", 1.0), ("tick", 5.0)) == [LONG]


def test_a_release_after_the_long_press_time_is_a_long_press_even_if_nothing_ticked_in_between() -> None:
    # The worker was late, or the release was reported in the same breath as the deadline: the hold was long enough.
    d = detector()

    assert gestures(d, ("down", 0.0), ("up", 1.5), ("tick", 1.6), ("tick", 5.0)) == [LONG]


def test_a_release_confirmed_after_the_long_press_time_but_which_really_came_before_it_is_a_single() -> None:
    # Up at 0.9875, confirmed at 1.01875: the clock has passed 1.0, but the button was let go before it.
    d = detector(bounce=0.03125)

    out = play(d, ("down", 0.0), ("tick", 0.5), ("up", 0.96875), ("tick", 1.0), ("tick", 1.5))

    assert out == [(1.5, SINGLE)]


def test_the_long_press_waits_while_a_release_is_being_confirmed() -> None:
    d = detector()
    play(d, ("down", 0.0), ("tick", 0.5), ("up", 0.96875))

    # 1.0 is past the long press time, but a change is still unconfirmed (it settles at 1.0), so it is not decided.
    assert d.tick(0.99) == []
    assert d.next_deadline() == pytest.approx(0.96875 + BOUNCE)


# Double presses


def test_a_second_press_inside_the_window_is_a_double_at_once() -> None:
    d = detector()

    out = play(d, ("down", 0.0), ("up", 0.125), ("down", 0.375), ("tick", 0.40625), ("tick", 0.5), ("up", 0.5625))

    assert out == [(0.40625, DOUBLE)]
    # And that is all there is: no single follows.
    assert gestures(d, ("tick", 0.625), ("tick", 5.0)) == []


def test_a_second_press_at_exactly_the_window_is_still_a_double() -> None:
    d = detector()

    # Let go at 0.125, so the window runs to 0.625.
    assert gestures(d, ("down", 0.0), ("up", 0.125), ("down", 0.625), ("tick", 0.75)) == [DOUBLE]


def test_a_second_press_just_after_the_window_is_a_new_press_and_the_first_is_a_single() -> None:
    d = detector()

    out = play(d, ("down", 0.0), ("up", 0.125), ("down", 0.65625), ("tick", 0.6875), ("up", 0.75), ("tick", 2.0))

    assert [gesture for _, gesture in out] == [SINGLE, SINGLE]


def test_the_double_is_reported_as_one_gesture_even_if_the_second_press_is_held_long() -> None:
    d = detector()

    out = play(
        d, ("down", 0.0), ("up", 0.125), ("down", 0.25), ("tick", 0.28125), ("tick", 2.0), ("up", 3.0), ("tick", 9.0)
    )

    assert out == [(0.28125, DOUBLE)]


def test_a_triple_press_is_a_double_and_then_a_single() -> None:
    d = detector()

    out = play(
        d,
        ("down", 0.0),
        ("up", 0.125),
        ("down", 0.25),
        ("tick", 0.28125),
        ("up", 0.375),
        ("down", 0.5),  # inside the window of the second release, but that release belonged to the double
        ("tick", 0.53125),
        ("up", 0.625),
        ("tick", 0.75),
        ("tick", 1.125),
    )

    assert [gesture for _, gesture in out] == [DOUBLE, SINGLE]


def test_a_long_press_then_a_quick_press_is_a_long_and_then_a_single() -> None:
    d = detector()

    out = play(
        d, ("down", 0.0), ("tick", 1.0), ("up", 1.25), ("down", 1.375), ("up", 1.5), ("tick", 1.625), ("tick", 2.0)
    )

    assert out == [(1.0, LONG), (2.0, SINGLE)]


def test_a_single_then_a_press_long_after_is_two_singles() -> None:
    d = detector()

    out = play(d, ("down", 0.0), ("up", 0.125), ("tick", 1.0), ("down", 5.0), ("up", 5.125), ("tick", 6.0))

    assert [gesture for _, gesture in out] == [SINGLE, SINGLE]


def test_a_double_followed_by_a_long_hold_of_a_fresh_press_is_a_double_and_then_a_long() -> None:
    d = detector()

    out = play(
        d,
        ("down", 0.0),
        ("up", 0.125),
        ("down", 0.25),
        ("tick", 0.28125),
        ("up", 0.375),
        ("tick", 2.0),  # well past the window of the double's release, which was never pending
        ("down", 3.0),
        ("tick", 4.0),
    )

    assert out == [(0.28125, DOUBLE), (4.0, LONG)]


# Debounce


def test_a_press_is_only_real_once_it_has_stayed_down_for_the_bounce_time() -> None:
    d = detector()
    d.edge(True, 0.0)

    assert d.tick(0.015625) == []
    assert d.next_deadline() == BOUNCE
    # Once it is confirmed, the long press counts from the real edge at 0.0.
    d.tick(BOUNCE)
    assert d.next_deadline() == LONG_PRESS


def test_a_press_is_dated_from_when_it_began_not_when_it_was_confirmed() -> None:
    d = detector()
    d.edge(True, 0.0)
    d.tick(0.5)

    # The long press is due one second after the real edge.
    assert d.next_deadline() == LONG_PRESS


def test_a_blip_that_flips_back_before_the_bounce_time_is_noise() -> None:
    d = detector()

    out = play(d, ("down", 0.0), ("up", 0.015625), ("tick", 0.0625), ("tick", 5.0))

    assert out == []
    assert d.next_deadline() is None


def test_a_dirty_press_is_one_press() -> None:
    d = detector()

    out = play(
        d,
        ("down", 0.0),
        ("up", 0.00390625),
        ("down", 0.0078125),
        ("up", 0.01171875),
        ("down", 0.015625),  # settles at 0.046875, dated 0.015625
        ("tick", 0.0625),
        ("up", 0.25),
        ("up", 0.25390625),  # a repeat of the same level
        ("down", 0.2578125),  # contact bounce on the way up
        ("up", 0.26171875),
        ("tick", 0.3125),
        ("tick", 5.0),
    )

    assert out == [(5.0, SINGLE)]


def test_noise_on_a_released_button_never_becomes_a_press() -> None:
    d = detector()

    for index in range(20):
        d.edge(index % 2 == 0, index * 0.00390625)
    d.edge(False, 0.1)

    assert d.tick(1.0) == []
    assert d.next_deadline() is None


def test_noise_while_held_does_not_break_the_press_up() -> None:
    d = detector()
    play(d, ("down", 0.0), ("tick", 0.0625))

    d.edge(False, 0.5)
    d.edge(True, 0.5078125)  # the contact chattered and came back down within the bounce time

    assert d.tick(0.75) == []
    # Still the same press, so its long press is still due one second after it began.
    assert d.tick(1.0) == [LONG]


def test_a_confirmed_press_is_not_mistaken_for_noise_by_the_edge_that_ends_it() -> None:
    d = detector()
    d.edge(True, 0.0)

    # Nobody ticked, but by now the press has been down for far longer than the bounce time.
    d.edge(False, 0.5)

    # The press was real, so letting go of it is a short press.
    assert gestures(d, ("tick", 5.0)) == [SINGLE]


def test_a_second_press_with_a_real_edge_inside_the_window_is_a_double_even_if_confirming_it_runs_past_the_window() -> (
    None
):
    d = detector(bounce=0.125)

    # Let go at 0.0 (window to 0.5). Pressed again at 0.5, confirmed at 0.625, which is past the window.
    out = play(d, ("down", -0.25), ("tick", -0.125), ("up", 0.0), ("tick", 0.0625), ("down", 0.5))
    assert out == []
    # The single is deferred while the second press is being confirmed...
    assert d.tick(0.5625) == []
    assert d.next_deadline() == pytest.approx(0.625)
    # ...and when it is confirmed it counts from its real edge.
    assert d.tick(0.625) == [DOUBLE]


def test_a_second_press_that_really_began_after_the_window_is_not_a_double() -> None:
    d = detector(bounce=0.125)

    out = play(d, ("down", -0.25), ("tick", -0.125), ("up", 0.0), ("tick", 0.0625), ("down", 0.5625), ("tick", 0.75))

    assert out == [(0.75, SINGLE)]


def test_a_single_is_not_reported_while_a_second_press_is_being_confirmed() -> None:
    d = detector(bounce=0.125)
    play(d, ("down", -0.25), ("tick", -0.125), ("up", 0.0), ("tick", 0.125), ("down", 0.375))

    # The window ends at 0.5, but the press at 0.375 is unconfirmed until 0.5. At 0.5 it is confirmed as a double.
    assert d.tick(0.4375) == []
    assert d.tick(0.5) == [DOUBLE]


def test_no_bounce_time_applies_every_edge_straight_away() -> None:
    d = detector(bounce=0.0)

    d.edge(True, 0.0)
    assert d.next_deadline() == LONG_PRESS
    d.edge(False, 0.125)

    assert d.next_deadline() == 0.125 + DOUBLE_PRESS
    assert d.tick(0.625) == [SINGLE]


def test_no_bounce_time_a_double() -> None:
    d = detector(bounce=0.0)

    assert gestures(d, ("down", 0.0), ("up", 0.0625), ("down", 0.125), ("up", 0.1875), ("tick", 0.1875)) == [DOUBLE]


def test_no_bounce_time_and_a_blip_is_two_edges() -> None:
    d = detector(bounce=0.0)

    out = play(d, ("down", 0.0), ("up", 0.0001), ("tick", 0.0002), ("tick", 1.0))

    assert out == [(1.0, SINGLE)]


# Odd input


def test_a_release_with_nothing_pressed_does_nothing() -> None:
    d = detector()

    assert gestures(d, ("up", 0.0), ("tick", 0.5), ("up", 1.0), ("tick", 5.0)) == []
    assert d.next_deadline() is None


def test_a_button_held_at_start_up_does_nothing_until_it_is_pressed_again() -> None:
    d = detector()

    # The input is already down, so the first thing heard is it coming up: there was no press to end.
    assert gestures(d, ("up", 3.0), ("tick", 10.0)) == []
    assert gestures(d, ("down", 11.0), ("up", 11.125), ("tick", 12.0)) == [SINGLE]


def test_repeated_edges_at_the_same_level_change_nothing() -> None:
    d = detector()

    out = play(
        d,
        ("down", 0.0),
        ("down", 0.125),
        ("down", 0.25),  # still the same press, not three
        ("up", 0.375),
        ("up", 0.5),
        ("up", 0.625),
        ("tick", 5.0),
    )

    assert out == [(5.0, SINGLE)]


def test_a_repeat_does_not_restart_the_bounce_time() -> None:
    d = detector()
    d.edge(True, 0.0)
    d.edge(True, 0.015625)

    assert d.next_deadline() == BOUNCE


def test_ticking_with_nothing_going_on_is_harmless() -> None:
    d = detector()

    assert d.tick(0.0) == []
    assert d.tick(100.0) == []
    assert d.next_deadline() is None


# next_deadline


def test_next_deadline_follows_the_state() -> None:
    d = detector()
    assert d.next_deadline() is None

    d.edge(True, 10.0)  # unconfirmed: the bounce time is what is due
    assert d.next_deadline() == 10.0 + BOUNCE

    d.tick(10.5)  # confirmed and held: the long press is next
    assert d.next_deadline() == 10.0 + LONG_PRESS

    d.edge(False, 10.25)
    d.tick(10.5)  # let go: the single is next
    assert d.next_deadline() == 10.25 + DOUBLE_PRESS

    d.tick(11.0)  # reported: idle again
    assert d.next_deadline() is None


def test_next_deadline_is_only_the_bounce_time_while_a_change_is_unconfirmed() -> None:
    d = detector()
    play(d, ("down", 0.0), ("tick", 0.0625), ("up", 0.5))

    # The long press is due at 1.0 and the release's bounce at 0.53125: only the earlier one matters now.
    assert d.next_deadline() == 0.5 + BOUNCE


def test_next_deadline_is_never_later_than_a_gesture_that_edge_has_already_decided() -> None:
    d = detector(bounce=0.0)
    d.edge(True, 0.0)
    d.edge(False, 0.125)
    d.edge(True, 0.25)  # a double, decided inside edge

    deadline = d.next_deadline()

    assert deadline is not None and deadline <= 0.25
    assert d.tick(0.25) == [DOUBLE]


def test_a_worker_that_wakes_at_each_deadline_always_finds_something_to_do() -> None:
    """Floating point must not leave a deadline that is due but not acted on: the worker would spin on it."""
    d = GestureDetector(bounce=0.03, double_press=0.4, long_press=1.0)
    d.edge(True, 0.1)

    # Wake at each deadline, as the agent's worker does. The press is confirmed, then the long press comes due.
    woken: list[list[str]] = []
    for _ in range(2):
        deadline = d.next_deadline()
        assert deadline is not None
        woken.append(d.tick(deadline))
    assert woken == [[], [LONG]]

    d.edge(False, 1.3)
    d.edge(True, 1.4)
    d.edge(False, 1.5)
    while (deadline := d.next_deadline()) is not None:
        woken.append(d.tick(deadline))
        assert len(woken) < 10
    assert [gesture for batch in woken for gesture in batch] == [LONG, SINGLE]
