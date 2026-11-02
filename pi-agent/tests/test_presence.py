"""The presence filter, played with explicit times. No clock, no threads: every call says what time it is."""

import pytest

from wallcal_agent.presence import PresenceFilter

# Times are in seconds, in binary-friendly numbers where the test cares about an exact boundary.
HOLD = 0.5


def filt(hold: float = HOLD) -> PresenceFilter:
    return PresenceFilter(hold=hold)


def play(f: PresenceFilter, *steps: tuple[str, float]) -> list[tuple[float, bool]]:
    """Runs ("on", t), ("off", t) and ("tick", t) in order. Returns each change a tick handed out, with its time."""
    out: list[tuple[float, bool]] = []
    for what, at in steps:
        if what == "tick":
            changed = f.tick(at)
            if changed is not None:
                out.append((at, changed))
        else:
            f.update(what == "on", at)
    return out


# Before anything has been seen


def test_nothing_is_known_to_begin_with() -> None:
    f = filt()

    assert f.state is None
    assert f.next_deadline() is None
    assert f.tick(100.0) is None


# The first reading


def test_the_first_reading_counts_once_it_has_held() -> None:
    f = filt()

    out = play(f, ("on", 10.0), ("tick", 10.25), ("tick", 10.4375), ("tick", 10.5), ("tick", 20.0))

    assert out == [(10.5, True)]
    assert f.state is True


def test_a_first_reading_of_nobody_counts_too() -> None:
    f = filt()

    assert play(f, ("off", 0.0), ("tick", 0.25), ("tick", 0.5)) == [(0.5, False)]
    assert f.state is False


def test_the_state_stays_unknown_until_the_first_reading_has_held() -> None:
    f = filt()

    play(f, ("on", 0.0), ("tick", 0.25))

    assert f.state is None


def test_a_first_reading_that_flips_before_it_has_held_never_counts_but_the_one_that_follows_does() -> None:
    f = filt()

    out = play(f, ("on", 0.0), ("off", 0.25), ("tick", 0.5), ("tick", 0.75))

    assert out == [(0.75, False)]


# The hold time


def test_the_hold_runs_from_when_the_reading_first_changed() -> None:
    f = filt()

    # Repeats of the same reading, as a serial sensor gives them, do not move the start.
    out = play(f, ("on", 0.0), ("on", 0.125), ("on", 0.25), ("on", 0.375), ("tick", 0.4375), ("tick", 0.5))

    assert out == [(0.5, True)]


def test_a_change_counts_exactly_at_the_hold_and_not_a_moment_before() -> None:
    f = filt()
    play(f, ("on", 0.0), ("tick", 1.0))

    assert play(f, ("off", 2.0), ("tick", 2.4990234375)) == []
    assert play(f, ("tick", 2.5)) == [(2.5, False)]


def test_each_change_is_reported_once() -> None:
    f = filt()

    first = play(f, ("on", 0.0), ("tick", 1.0), ("tick", 2.0), ("tick", 3.0))
    second = play(f, ("off", 4.0), ("tick", 5.0), ("tick", 6.0))

    assert first == [(1.0, True)]
    assert second == [(5.0, False)]


def test_a_reading_that_agrees_with_the_confirmed_state_changes_nothing() -> None:
    f = filt()
    play(f, ("on", 0.0), ("tick", 1.0))

    out = play(f, ("on", 2.0), ("on", 3.0), ("tick", 4.0), ("tick", 10.0))

    assert out == []
    assert f.next_deadline() is None


# Flicker


def test_a_blip_of_nobody_shorter_than_the_hold_is_dropped() -> None:
    f = filt()
    play(f, ("on", 0.0), ("tick", 1.0))

    out = play(f, ("off", 2.0), ("on", 2.25), ("tick", 2.5), ("tick", 3.0), ("tick", 100.0))

    assert out == []
    assert f.state is True


def test_a_blip_of_someone_shorter_than_the_hold_is_dropped() -> None:
    f = filt()
    play(f, ("off", 0.0), ("tick", 1.0))

    out = play(f, ("on", 2.0), ("off", 2.25), ("tick", 3.0), ("tick", 100.0))

    assert out == []
    assert f.state is False


def test_a_flicker_does_not_delay_what_comes_after_it() -> None:
    f = filt()
    play(f, ("on", 0.0), ("tick", 1.0))

    # A blip at 2.0 to 2.25, then a real leaving at 3.0: counted from 3.0, not from the blip.
    out = play(f, ("off", 2.0), ("on", 2.25), ("off", 3.0), ("tick", 3.25), ("tick", 3.5))

    assert out == [(3.5, False)]


def test_a_stream_of_flickers_never_changes_anything() -> None:
    f = filt()
    play(f, ("on", 0.0), ("tick", 1.0))

    out: list[tuple[float, bool]] = []
    for i in range(40):
        out += play(f, ("off", 2.0 + i * 0.25), ("tick", 2.0 + i * 0.25 + 0.125), ("on", 2.0 + i * 0.25 + 0.125))
    out += play(f, ("tick", 100.0))

    assert out == []


# A late tick


def test_a_reading_that_held_long_enough_before_the_next_one_arrived_still_counts() -> None:
    f = filt()

    # Nobody ticked for ten seconds. The "on" was long since confirmed when the "off" came, so it is not a flicker.
    out = play(f, ("on", 0.0), ("off", 10.0), ("tick", 10.25), ("tick", 10.5))

    assert out == [(10.25, True), (10.5, False)]


def test_a_late_tick_reports_the_state_it_finds_not_each_step_on_the_way() -> None:
    f = filt()
    play(f, ("on", 0.0), ("tick", 1.0))

    # Off and back on, each held long enough, with no tick in between: nothing changed overall.
    out = play(f, ("off", 2.0), ("on", 4.0), ("tick", 10.0))

    assert out == []
    assert f.state is True


def test_a_late_tick_after_a_real_change_reports_it() -> None:
    f = filt()
    play(f, ("on", 0.0), ("tick", 1.0))

    out = play(f, ("off", 2.0), ("tick", 100.0))

    assert out == [(100.0, False)]


# Zero hold


def test_with_no_hold_a_reading_counts_at_once() -> None:
    f = filt(hold=0.0)

    assert play(f, ("on", 5.0)) == []
    assert f.state is True
    assert play(f, ("tick", 5.0)) == [(5.0, True)]
    play(f, ("off", 6.0))
    assert play(f, ("tick", 6.0)) == [(6.0, False)]


def test_with_no_hold_nothing_is_ever_a_flicker() -> None:
    f = filt(hold=0.0)

    out = play(f, ("on", 0.0), ("off", 0.0), ("on", 0.0), ("tick", 0.0))

    assert out == [(0.0, True)]


# The deadline


def test_the_deadline_is_when_the_waiting_reading_will_have_held() -> None:
    f = filt()

    play(f, ("on", 10.0))
    assert f.next_deadline() == 10.5

    play(f, ("tick", 10.5))
    assert f.next_deadline() is None


def test_the_deadline_follows_a_new_waiting_reading_and_goes_when_it_flickers_back() -> None:
    f = filt()
    play(f, ("on", 0.0), ("tick", 1.0))

    play(f, ("off", 2.0))
    assert f.next_deadline() == 2.5
    play(f, ("on", 2.125))
    assert f.next_deadline() is None


def test_a_change_confirmed_while_a_reading_arrived_is_still_handed_out_by_a_worker_that_wakes_for_it() -> None:
    f = filt()
    play(f, ("on", 0.0))

    # The "off" arrives after the "on" had held: the "on" is confirmed in passing and waits to be handed out.
    play(f, ("off", 10.0))
    deadline = f.next_deadline()

    assert deadline is not None
    # The "on" is due at 0.5, a time already gone, so a worker wakes at once and is handed it.
    assert deadline == 0.5
    assert f.tick(10.0) is True
    # Handed out, so what is left is the "off" still being held.
    assert f.next_deadline() == 10.5


def test_the_deadline_is_always_one_tick_acts_on() -> None:
    # A worker that wakes at the deadline must find something to do, or it would spin. Checked on awkward numbers.
    for hold in (0.1, 0.3, 0.7):
        f = filt(hold=hold)
        f.update(True, 0.1)
        deadline = f.next_deadline()
        assert deadline is not None
        assert f.tick(deadline) is True


@pytest.mark.parametrize("hold", [0.0, 0.5, 10.0])
def test_state_is_the_confirmed_answer_whatever_the_hold(hold: float) -> None:
    f = filt(hold=hold)

    f.update(True, 0.0)
    f.tick(hold)

    assert f.state is True
