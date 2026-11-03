"""The offline fallback policy, played with explicit times. No clock, no threads: every call says what time it is."""

import pytest

from wallcal_agent.fallback import HAND_BACK, SCREEN_OFF, SCREEN_ON, TAKE_OVER, FallbackPolicy

# Times are in seconds, in binary-friendly numbers where the test cares about an exact boundary.
TIMEOUT = 300.0
OFF_AFTER = 600.0


def policy(now: float = 0.0) -> FallbackPolicy:
    return FallbackPolicy(timeout=TIMEOUT, off_after=OFF_AFTER, now=now)


def play(p: FallbackPolicy, *steps: tuple[str, float]) -> list[tuple[float, str]]:
    """Runs ("up"|"down"|"present"|"absent"|"unknown"|"on"|"tick", t) in order. Returns what each tick handed out."""
    out: list[tuple[float, str]] = []
    for what, at in steps:
        if what == "tick":
            out += [(at, action) for action in p.tick(at)]
        elif what == "up":
            p.app(True, at)
        elif what == "down":
            p.app(False, at)
        elif what == "present":
            p.presence(True, at)
        elif what == "absent":
            p.presence(False, at)
        elif what == "unknown":
            p.presence(None, at)
        else:
            assert what == "on"
            p.screen_turned_on(at)
    return out


def in_charge(now: float = 0.0) -> FallbackPolicy:
    """A policy that took over at TIMEOUT and has been told so, with presence not known."""
    p = policy(now)
    assert play(p, ("tick", now + TIMEOUT)) == [(now + TIMEOUT, TAKE_OVER)]
    return p


# Taking over


def test_nothing_happens_before_the_timeout() -> None:
    p = policy()

    assert play(p, ("tick", 0.0), ("tick", 100.0), ("tick", 299.9375)) == []
    assert not p.in_charge


def test_it_takes_over_exactly_at_the_timeout() -> None:
    p = policy()

    assert play(p, ("tick", 299.9375), ("tick", 300.0)) == [(300.0, TAKE_OVER)]
    assert p.in_charge


def test_it_takes_over_once() -> None:
    p = policy()

    assert play(p, ("tick", 300.0), ("tick", 301.0), ("tick", 5000.0)) == [(300.0, TAKE_OVER)]
    assert p.in_charge


def test_the_app_counts_as_down_from_the_start() -> None:
    p = policy(now=1000.0)

    assert play(p, ("tick", 1299.0), ("tick", 1300.0)) == [(1300.0, TAKE_OVER)]


def test_a_down_that_repeats_stays_dated_from_when_it_first_happened() -> None:
    p = policy()

    out = play(p, ("down", 100.0), ("down", 250.0), ("tick", 299.0), ("tick", 300.0))

    assert out == [(300.0, TAKE_OVER)]


def test_the_app_coming_up_before_the_timeout_starts_the_timer_afresh() -> None:
    p = policy()

    out = play(p, ("up", 200.0), ("tick", 300.0), ("tick", 1000.0))
    assert out == []
    assert p.next_deadline() is None

    out = play(p, ("down", 400.0), ("tick", 699.0), ("tick", 700.0))
    assert out == [(700.0, TAKE_OVER)]


def test_a_flapping_app_never_takes_so_long_a_stretch_as_the_timeout() -> None:
    p = policy()

    out = play(p, ("up", 100.0), ("down", 200.0), ("up", 400.0), ("down", 500.0), ("tick", 799.0))
    assert out == []
    assert play(p, ("tick", 800.0)) == [(800.0, TAKE_OVER)]


def test_the_app_coming_up_at_the_moment_of_the_timeout_is_too_late_to_cancel_but_nobody_is_told() -> None:
    p = policy()

    out = play(p, ("up", 300.0), ("tick", 300.0), ("tick", 400.0))

    # The take-over fell due at 300 and the hand-back is at 300: the tick never handed out the take-over, so no more.
    assert out == []
    assert not p.in_charge


# Handing back


def test_the_app_coming_up_while_in_charge_hands_back() -> None:
    p = in_charge()

    p.app(True, 400.0)

    assert not p.in_charge
    assert p.tick(400.0) == [HAND_BACK]
    assert p.tick(401.0) == []


def test_a_take_over_nobody_was_told_about_is_cancelled_silently() -> None:
    p = policy()

    # The timeout passed at 300 but nothing ticked before the app came back at 400.
    play(p, ("up", 400.0))

    assert not p.in_charge
    assert p.tick(400.0) == []
    assert p.next_deadline() is None


def test_handing_back_drops_a_screen_action_that_was_waiting() -> None:
    p = in_charge()

    out = play(p, ("present", 400.0), ("up", 410.0), ("tick", 410.0))

    assert out == [(410.0, HAND_BACK)]


def test_handing_back_cancels_the_wait_for_an_empty_room() -> None:
    p = policy()
    play(p, ("absent", 0.0), ("tick", 300.0), ("up", 400.0))

    assert play(p, ("tick", 400.0), ("tick", 5000.0)) == [(400.0, HAND_BACK)]
    assert p.next_deadline() is None


def test_after_a_hand_back_the_whole_thing_can_happen_again() -> None:
    p = in_charge()
    play(p, ("up", 400.0), ("tick", 400.0), ("down", 500.0))

    assert play(p, ("tick", 799.0), ("tick", 800.0)) == [(800.0, TAKE_OVER)]
    assert p.in_charge


def test_a_hand_back_goes_out_alone_and_a_later_take_over_waits_for_the_next_tick() -> None:
    p = in_charge()

    # Back at 400 and gone again at 500, and nobody ticked until 1000.
    play(p, ("up", 400.0), ("down", 500.0))

    assert p.tick(1000.0) == [HAND_BACK]
    assert p.next_deadline() == 800.0
    assert p.tick(1000.0) == [TAKE_OVER]


# Presence turns the screen on


def test_presence_does_nothing_while_the_app_is_in_charge_of_itself() -> None:
    p = policy()

    out = play(p, ("present", 100.0), ("tick", 200.0))

    assert out == []
    assert p.next_deadline() == 300.0


def test_presence_that_is_already_there_at_the_take_over_leaves_the_screen_alone() -> None:
    p = policy()

    assert play(p, ("present", 100.0), ("tick", 300.0), ("tick", 400.0)) == [(300.0, TAKE_OVER)]
    assert p.next_deadline() is None


def test_presence_arriving_while_in_charge_turns_the_screen_on_at_once() -> None:
    p = in_charge()

    p.presence(True, 400.0)

    assert p.next_deadline() == 400.0
    assert p.tick(400.0) == [SCREEN_ON]


def test_presence_arriving_after_nobody_turns_the_screen_on() -> None:
    p = in_charge()

    out = play(p, ("absent", 350.0), ("present", 400.0), ("tick", 400.0))

    assert out == [(400.0, SCREEN_ON)]


def test_presence_that_repeats_does_nothing() -> None:
    p = in_charge()

    out = play(p, ("present", 400.0), ("tick", 400.0), ("present", 500.0), ("tick", 500.0), ("tick", 900.0))

    assert out == [(400.0, SCREEN_ON)]


def test_each_arrival_turns_the_screen_on() -> None:
    p = in_charge()

    out = play(p, ("present", 400.0), ("tick", 400.0), ("absent", 410.0), ("present", 420.0), ("tick", 420.0))

    assert out == [(400.0, SCREEN_ON), (420.0, SCREEN_ON)]


def test_presence_arriving_after_the_timeout_but_before_any_tick_still_counts_as_in_charge() -> None:
    p = policy()

    out = play(p, ("present", 400.0), ("tick", 400.0))

    assert out == [(400.0, TAKE_OVER), (400.0, SCREEN_ON)]


# Presence turns the screen off


def test_nobody_for_the_wait_turns_the_screen_off_counted_from_when_presence_went() -> None:
    p = in_charge()
    play(p, ("absent", 1000.0))

    assert p.next_deadline() == 1600.0
    assert play(p, ("tick", 1599.9375), ("tick", 1600.0)) == [(1600.0, SCREEN_OFF)]


def test_nobody_since_before_the_take_over_counts_from_the_take_over() -> None:
    p = policy()
    play(p, ("absent", 0.0))

    assert play(p, ("tick", 300.0)) == [(300.0, TAKE_OVER)]
    assert p.next_deadline() == 900.0
    assert play(p, ("tick", 899.9375), ("tick", 900.0)) == [(900.0, SCREEN_OFF)]


def test_the_wait_counts_from_the_take_over_and_not_from_the_tick_that_noticed_it() -> None:
    p = policy()
    play(p, ("absent", 0.0))

    # The worker ran late, at 1000. The take-over fell due at 300 and the screen off at 900.
    assert p.tick(1000.0) == [TAKE_OVER, SCREEN_OFF]


def test_a_late_tick_gives_the_same_answer_as_one_on_time() -> None:
    late = policy()
    play(late, ("absent", -5.0))
    on_time = policy()
    play(on_time, ("absent", -5.0))

    assert late.tick(5000.0) == [TAKE_OVER, SCREEN_OFF]
    assert play(on_time, ("tick", 300.0), ("tick", 900.0), ("tick", 5000.0)) == [
        (300.0, TAKE_OVER),
        (900.0, SCREEN_OFF),
    ]


def test_the_screen_goes_off_once_while_nobody_stays() -> None:
    p = in_charge()
    play(p, ("absent", 400.0))

    out = play(p, ("tick", 1000.0), ("absent", 1100.0), ("tick", 1200.0), ("tick", 9000.0))

    assert out == [(1000.0, SCREEN_OFF)]
    assert p.next_deadline() is None


def test_someone_arriving_cancels_the_wait_and_leaving_again_starts_a_new_one() -> None:
    p = in_charge()

    out = play(p, ("absent", 400.0), ("present", 500.0), ("tick", 500.0), ("absent", 600.0), ("tick", 1199.0))
    assert out == [(500.0, SCREEN_ON)]

    assert play(p, ("tick", 1200.0)) == [(1200.0, SCREEN_OFF)]


def test_presence_that_is_not_known_cancels_the_wait_and_leaves_the_screen_alone() -> None:
    p = in_charge()

    out = play(p, ("absent", 400.0), ("unknown", 500.0), ("tick", 5000.0))

    assert out == []
    assert p.next_deadline() is None


def test_nobody_after_not_knowing_waits_afresh() -> None:
    p = in_charge()
    play(p, ("absent", 400.0), ("unknown", 500.0), ("absent", 6000.0))

    assert p.next_deadline() == 6600.0


def test_a_screen_off_that_fell_due_before_someone_arrived_is_not_returned_with_the_screen_on() -> None:
    p = policy()
    play(p, ("absent", 0.0))

    # Off fell due at 900 and nobody ticked. The one who came at 950 is what the screen should show.
    out = play(p, ("present", 950.0), ("tick", 950.0))

    assert out == [(950.0, TAKE_OVER), (950.0, SCREEN_ON)]


def test_a_screen_on_that_waits_is_replaced_by_a_screen_off_that_falls_due_after_it() -> None:
    p = in_charge()

    out = play(p, ("present", 400.0), ("absent", 410.0), ("tick", 2000.0))

    assert out == [(2000.0, SCREEN_OFF)]


# Someone turns the screen on


def test_the_screen_being_turned_on_with_nobody_there_restarts_the_wait() -> None:
    p = in_charge()
    play(p, ("absent", 400.0), ("on", 800.0))

    assert p.next_deadline() == 1400.0
    assert play(p, ("tick", 1399.0), ("tick", 1400.0)) == [(1400.0, SCREEN_OFF)]


def test_the_screen_being_turned_on_after_it_went_off_allows_another_screen_off() -> None:
    p = in_charge()
    out = play(p, ("absent", 400.0), ("tick", 1000.0), ("on", 1100.0))
    assert out == [(1000.0, SCREEN_OFF)]

    assert p.next_deadline() == 1700.0
    assert play(p, ("tick", 1700.0)) == [(1700.0, SCREEN_OFF)]


def test_a_screen_off_that_fell_due_before_the_screen_was_turned_on_is_dropped() -> None:
    p = policy()
    play(p, ("absent", 0.0))

    # Off fell due at 900 with nobody ticking. The screen was turned on at 950, so it stays on for another wait.
    out = play(p, ("on", 950.0), ("tick", 950.0))

    assert out == [(950.0, TAKE_OVER)]
    assert p.next_deadline() == 1550.0


def test_the_screen_being_turned_on_does_nothing_when_not_in_charge() -> None:
    p = policy()
    play(p, ("absent", 0.0), ("on", 100.0))

    assert play(p, ("tick", 300.0)) == [(300.0, TAKE_OVER)]
    assert p.next_deadline() == 900.0


@pytest.mark.parametrize("state", ["present", "unknown"])
def test_the_screen_being_turned_on_does_nothing_unless_nobody_is_there(state: str) -> None:
    p = in_charge()
    play(p, (state, 400.0), ("tick", 400.0), ("on", 500.0))

    assert play(p, ("tick", 5000.0)) == []
    assert p.next_deadline() is None


# The deadline


def test_there_is_nothing_to_wait_for_while_the_app_is_up() -> None:
    p = policy()
    play(p, ("up", 10.0))

    assert p.next_deadline() is None


def test_the_deadline_while_the_app_is_down_is_the_take_over() -> None:
    p = policy()
    assert p.next_deadline() == 300.0

    play(p, ("up", 100.0), ("down", 150.0))
    assert p.next_deadline() == 450.0


def test_a_take_over_that_waits_to_be_handed_out_is_due_at_the_time_it_fell_due() -> None:
    p = policy()

    play(p, ("present", 1000.0))

    assert p.next_deadline() == 300.0
    assert p.tick(1000.0) == [TAKE_OVER, SCREEN_ON]


def test_in_charge_with_nobody_waiting_there_is_nothing_to_wait_for() -> None:
    p = in_charge()
    assert p.next_deadline() is None

    play(p, ("present", 400.0), ("tick", 400.0))
    assert p.next_deadline() is None

    play(p, ("unknown", 500.0))
    assert p.next_deadline() is None


def test_a_hand_back_that_waits_is_due_at_the_time_it_fell_due() -> None:
    p = in_charge()

    play(p, ("up", 400.0))

    assert p.next_deadline() == 400.0
    p.tick(1000.0)
    assert p.next_deadline() is None


def test_there_is_nothing_to_wait_for_once_the_screen_is_off() -> None:
    p = in_charge()
    play(p, ("absent", 400.0), ("tick", 1000.0))

    assert p.next_deadline() is None


def test_the_deadline_is_always_one_tick_acts_on() -> None:
    # A worker that wakes at the deadline must find something to do, or it would spin. Checked on awkward numbers.
    for timeout, off_after in ((0.1, 0.3), (0.3, 0.7), (7.0, 0.1)):
        p = FallbackPolicy(timeout=timeout, off_after=off_after, now=0.1)
        p.presence(False, 0.1)
        for expected in (TAKE_OVER, SCREEN_OFF):
            deadline = p.next_deadline()
            assert deadline is not None
            assert p.tick(deadline) == [expected]
        assert p.next_deadline() is None


# Handed out once


def test_every_action_is_handed_out_once() -> None:
    p = policy()
    play(p, ("absent", 0.0), ("tick", 300.0))

    out = play(p, ("tick", 900.0), ("present", 1000.0), ("tick", 1000.0), ("up", 1100.0), ("tick", 1100.0))
    out += play(p, ("tick", 1100.0), ("tick", 9000.0))

    assert out == [(900.0, SCREEN_OFF), (1000.0, SCREEN_ON), (1100.0, HAND_BACK)]
