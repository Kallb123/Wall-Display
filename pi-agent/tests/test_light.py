"""The light reporter, played with explicit times. No clock, no threads: every call says what time it is."""

import pytest

from wallcal_agent.light import LightReporter

# Numbers that are exact in binary, so a test can sit precisely on a threshold.
PERCENT = 10
LUX = 0.5
INTERVAL = 30.0


def reporter(percent: float = PERCENT, lux: float = LUX, interval: float = INTERVAL) -> LightReporter:
    return LightReporter(change_percent=percent, change_lux=lux, report_interval=interval)


def started(first: float = 100.0, at: float = 1000.0) -> LightReporter:
    """A reporter that has published `first` at time `at`."""
    r = reporter()
    assert r.offer(first, at) is True
    return r


# The first reading


def test_the_first_reading_is_published() -> None:
    assert reporter().offer(100.0, 1000.0) is True


def test_a_first_reading_of_darkness_is_published_too() -> None:
    assert reporter().offer(0.0, 1000.0) is True


def test_the_same_reading_again_is_not_published() -> None:
    r = started()

    assert r.offer(100.0, 1001.0) is False
    assert r.offer(100.0, 1002.0) is False


# A change relative to the last published value


def test_a_change_just_under_the_percentage_is_not_published() -> None:
    r = started(100.0)

    assert r.offer(109.75, 1001.0) is False
    assert r.offer(90.25, 1002.0) is False


def test_a_change_of_exactly_the_percentage_is_published() -> None:
    assert started(100.0).offer(110.0, 1001.0) is True
    assert started(100.0).offer(90.0, 1001.0) is True


def test_a_change_just_over_the_percentage_is_published() -> None:
    assert started(100.0).offer(110.25, 1001.0) is True
    assert started(100.0).offer(89.75, 1001.0) is True


def test_the_percentage_is_of_the_last_published_value_so_a_bright_room_needs_a_bigger_change() -> None:
    assert started(1000.0).offer(1099.0, 1001.0) is False
    assert started(1000.0).offer(1100.0, 1001.0) is True
    assert started(10.0).offer(11.0, 1001.0) is True


def test_the_change_is_measured_from_the_last_reading_published_and_not_the_last_one_seen() -> None:
    r = started(100.0)

    # A slow dimming: each step is small, but together they are a change from what was published.
    assert r.offer(104.0, 1001.0) is False
    assert r.offer(108.0, 1002.0) is False
    assert r.offer(112.0, 1003.0) is True
    # And now that is the one to compare with.
    assert r.offer(115.0, 1004.0) is False


def test_a_reading_that_is_not_published_does_not_move_the_comparison() -> None:
    r = started(100.0)

    assert r.offer(105.0, 1001.0) is False
    # Ten from 100, though only five from the reading before it.
    assert r.offer(110.0, 1002.0) is True


# The floor in lux


def test_in_the_dark_a_change_under_the_lux_floor_is_not_published_however_big_a_share_it_is() -> None:
    r = started(1.0)

    # 40% of one lux, but under half a lux.
    assert r.offer(1.25, 1001.0) is False
    assert r.offer(0.625, 1002.0) is False


def test_a_change_of_exactly_the_lux_floor_is_published() -> None:
    assert started(1.0).offer(1.5, 1001.0) is True
    assert started(1.0).offer(0.5, 1001.0) is True


def test_a_change_just_over_the_lux_floor_is_published() -> None:
    assert started(1.0).offer(1.625, 1001.0) is True


def test_from_darkness_the_lux_floor_is_the_only_threshold() -> None:
    r = started(0.0)

    assert r.offer(0.25, 1001.0) is False
    assert r.offer(0.5, 1002.0) is True


def test_the_floor_and_the_percentage_each_win_where_they_are_larger() -> None:
    # At 4 lux, 10% is 0.4, so the half-lux floor is the threshold.
    assert started(4.0).offer(4.4375, 1001.0) is False
    assert started(4.0).offer(4.5, 1001.0) is True
    # At 40 lux, 10% is 4, which is well past the floor.
    assert started(40.0).offer(43.75, 1001.0) is False
    assert started(40.0).offer(44.0, 1001.0) is True


def test_the_thresholds_come_from_the_arguments() -> None:
    r = LightReporter(change_percent=50, change_lux=10, report_interval=INTERVAL)
    assert r.offer(100.0, 1000.0) is True

    assert r.offer(149.0, 1001.0) is False
    assert r.offer(150.0, 1002.0) is True
    # 50% of 150 is 75, so 10 lux is nothing.
    assert r.offer(160.0, 1003.0) is False


def test_a_zero_floor_and_a_zero_percentage_publish_every_reading_that_differs() -> None:
    r = LightReporter(change_percent=0, change_lux=0, report_interval=INTERVAL)

    assert r.offer(100.0, 1000.0) is True
    assert r.offer(100.0, 1001.0) is True
    assert r.offer(100.5, 1002.0) is True


# The heartbeat


def test_a_steady_reading_is_published_again_at_the_report_interval() -> None:
    r = started(100.0, at=1000.0)

    assert r.offer(100.0, 1029.5) is False
    assert r.offer(100.0, 1030.0) is True


def test_the_heartbeat_is_counted_from_the_last_publish_and_not_from_the_last_reading() -> None:
    r = started(100.0, at=1000.0)

    assert [r.offer(100.0, t) for t in (1010.0, 1020.0, 1029.0)] == [False, False, False]
    assert r.offer(100.0, 1030.0) is True
    # The next one is a full interval after that.
    assert r.offer(100.0, 1059.0) is False
    assert r.offer(100.0, 1060.0) is True


def test_a_change_restarts_the_heartbeat() -> None:
    r = started(100.0, at=1000.0)

    assert r.offer(200.0, 1020.0) is True
    assert r.offer(200.0, 1049.0) is False
    assert r.offer(200.0, 1050.0) is True


def test_a_heartbeat_is_late_by_no_more_than_the_next_reading() -> None:
    r = started(100.0, at=1000.0)

    assert r.offer(100.0, 1100.0) is True


def test_a_reading_in_the_dark_still_gets_its_heartbeat() -> None:
    r = started(0.0, at=1000.0)

    assert r.offer(0.0, 1029.0) is False
    assert r.offer(0.0, 1030.0) is True


def test_the_interval_comes_from_the_argument() -> None:
    r = LightReporter(change_percent=PERCENT, change_lux=LUX, report_interval=5)
    assert r.offer(100.0, 1000.0) is True

    assert r.offer(100.0, 1004.0) is False
    assert r.offer(100.0, 1005.0) is True


# Reset


def test_reset_publishes_the_next_reading_whatever_it_is() -> None:
    r = started(100.0, at=1000.0)
    assert r.offer(100.0, 1001.0) is False

    r.reset()

    assert r.offer(100.0, 1002.0) is True
    # And it is the new baseline.
    assert r.offer(100.0, 1003.0) is False


def test_reset_before_any_reading_is_harmless() -> None:
    r = reporter()

    r.reset()
    r.reset()

    assert r.offer(5.0, 1000.0) is True


def test_reset_restarts_the_heartbeat() -> None:
    r = started(100.0, at=1000.0)

    r.reset()

    assert r.offer(100.0, 1010.0) is True
    assert r.offer(100.0, 1039.0) is False
    assert r.offer(100.0, 1040.0) is True


# A clock that steps backwards


def test_a_clock_that_steps_back_counts_the_heartbeat_from_the_new_time() -> None:
    r = started(100.0, at=1000.0)

    # An hour back. Not published, and not stuck waiting for a time that is an hour ahead.
    assert r.offer(100.0, 400.0) is False
    assert r.offer(100.0, 429.0) is False
    assert r.offer(100.0, 430.0) is True


def test_a_clock_that_steps_back_still_notices_a_change() -> None:
    r = started(100.0, at=1000.0)

    assert r.offer(150.0, 400.0) is True


def test_a_clock_that_steps_back_does_not_publish_a_heartbeat_early() -> None:
    r = started(100.0, at=1000.0)

    assert r.offer(100.0, 999.0) is False
    assert r.offer(100.0, 1028.0) is False
    assert r.offer(100.0, 1029.0) is True


@pytest.mark.parametrize("first", [0.0, 0.25, 1.0, 100.0, 35000.0])
def test_the_first_reading_after_a_reset_is_always_published(first: float) -> None:
    r = started(100.0)
    r.reset()

    assert r.offer(first, 1001.0) is True
