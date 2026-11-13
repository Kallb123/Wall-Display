import argparse
import math
import queue
from collections.abc import Callable

import pytest

from hw_probe import button
from hw_probe.agent_code import AgentCodeMissing
from hw_probe.button import PressWatcher, analyse, suggest
from hw_probe.report import Status

from .fakes import FakeClock

T0 = 1000.0


class FakeButton:
    """Stands in for the agent's GpioButton: `start` keeps the callback, so a test can press the button."""

    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.callback: Callable[[bool], None] | None = None
        self.started = 0
        self.closed = 0

    def start(self, on_change: Callable[[bool], None]) -> None:
        self.started += 1
        if self.error is not None:
            raise self.error
        self.callback = on_change

    def close(self) -> None:
        self.closed += 1

    def press(self, pressed: bool) -> None:
        assert self.callback is not None
        self.callback(pressed)


class Script:
    """Plays timed events in place of waiting on the queue, so a test moves the fake clock and nothing sleeps.

    `at(time, action)` schedules an action. When the loop asks to wait `timeout` seconds, the clock jumps to the next
    event if that is sooner (and runs it), otherwise to the end of the wait.
    """

    def __init__(self, clock: FakeClock) -> None:
        self.clock = clock
        self.events: list[tuple[float, Callable[[], None]]] = []

    def at(self, when: float, action: Callable[[], None]) -> None:
        self.events.append((when, action))
        self.events.sort(key=lambda event: event[0])

    def tap(self, pressed_button: FakeButton, down: float, up: float) -> None:
        self.at(down, lambda: pressed_button.press(True))
        self.at(up, lambda: pressed_button.press(False))

    def __call__(self, edges: "queue.Queue[tuple[float, bool]]", timeout: float) -> tuple[float, bool] | None:
        if edges.empty():
            horizon = self.clock.now + timeout
            if self.events and self.events[0][0] <= horizon:
                self.clock.now = max(self.clock.now, self.events[0][0])
                self.events.pop(0)[1]()
            elif timeout > 0:
                # Always move on, even by the smallest step, so a deadline a hair away cannot hold the loop up.
                self.clock.now = max(horizon, math.nextafter(self.clock.now, math.inf))
        try:
            return edges.get_nowait()
        except queue.Empty:
            return None


@pytest.fixture
def fake_button() -> FakeButton:
    return FakeButton()


@pytest.fixture
def script(clock: FakeClock) -> Script:
    return Script(clock)


@pytest.fixture
def wired(monkeypatch, fake_button: FakeButton, script: Script) -> FakeButton:
    """The probe's hardware and waiting replaced by the fakes."""
    monkeypatch.setattr(button, "open_button", lambda pin: fake_button)
    monkeypatch.setattr(button, "wait_for_edge", script)
    return fake_button


def parse(*argv: str) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    button.add_arguments(parser)
    return parser.parse_args(list(argv))


def checks(section) -> dict[str, tuple[Status, str]]:
    return {check.name: (check.status, check.detail) for check in section.checks}


def table(section, title: str) -> list[list[str]]:
    return next(item.rows for item in section.tables if item.title == title)


def edges(*pairs: tuple[float, bool]) -> list[tuple[float, bool]]:
    return list(pairs)


# The defaults


def test_the_defaults_are_the_agents():
    pytest.importorskip("yaml")
    from wallcal_agent.config import ButtonConfig

    agent = ButtonConfig()
    args = parse()

    assert (args.pin, args.bounce_ms, args.double_ms, args.long_ms) == (
        agent.pin,
        agent.bounce_ms,
        agent.double_press_ms,
        agent.long_press_ms,
    )


@pytest.mark.parametrize(
    "argv",
    [("--pin", "28"), ("--bounce-ms", "201"), ("--double-ms", "99"), ("--long-ms", "299"), ("--long-ms", "soon")],
)
def test_values_the_agent_would_refuse_are_refused(argv):
    with pytest.raises(SystemExit):
        parse(*argv)


# Reading edges


def test_a_clean_press_is_one_press():
    result = analyse(edges((1.0, True), (1.12, False)))

    assert [round(p.length, 3) for p in result.presses] == [0.12]
    assert result.short_lengths == pytest.approx((0.12,))
    assert result.bounces == ()
    assert result.hold_lengths == ()


def test_bounce_on_the_way_down_and_up_does_not_split_a_press():
    result = analyse(
        edges((1.0, True), (1.002, False), (1.004, True), (1.2, False), (1.203, True), (1.206, False)),
    )

    assert len(result.presses) == 1
    assert result.presses[0].start == pytest.approx(1.004)
    # The release is dated from the last real change: the flicker after it went back and was dropped.
    assert result.presses[0].end == pytest.approx(1.206)
    assert result.bounces == pytest.approx((0.002, 0.003))


def test_a_flicker_from_rest_is_bounce_and_not_a_press():
    result = analyse(edges((1.0, True), (1.01, False)))

    assert result.presses == ()
    assert result.bounces == pytest.approx((0.01,))


def test_repeated_levels_are_ignored():
    result = analyse(edges((1.0, True), (1.05, True), (1.3, False), (1.4, False)))

    assert [round(p.length, 2) for p in result.presses] == [0.3]


def test_a_press_still_down_has_no_length_yet():
    assert analyse(edges((1.0, True))).presses == ()


def test_holds_are_told_from_short_presses_and_gaps_are_measured_after_short_ones():
    result = analyse(
        edges(
            (1.0, True),
            (1.1, False),  # short, 0.1 s
            (1.3, True),
            (1.42, False),  # short, 0.12 s, 0.2 s after the first
            (3.0, True),
            (4.0, False),  # a hold, 1.0 s, after a gap too long to be a double
            (4.2, True),
            (4.3, False),  # follows a hold, so no gap is measured
        )
    )

    assert result.short_lengths == pytest.approx((0.1, 0.12, 0.1))
    assert result.hold_lengths == pytest.approx((1.0,))
    assert result.gaps == pytest.approx((0.2,))


# Suggestions


def presses(*lengths_and_gaps: float) -> list[tuple[float, bool]]:
    """Edges for presses of the given lengths, each started the given time after the last was let go."""
    out, now = [], 10.0
    for index in range(0, len(lengths_and_gaps), 2):
        now += lengths_and_gaps[index]
        out.append((now, True))
        now += lengths_and_gaps[index + 1]
        out.append((now, False))
    return out


def test_nothing_is_suggested_from_nothing():
    suggestions = suggest(analyse([]))

    assert (suggestions.bounce_ms, suggestions.double_press_ms, suggestions.long_press_ms) == (None, None, None)
    assert suggestions.why["bounce_ms"] == "not enough presses"
    assert suggestions.why["double_press_ms"] == "no double presses recorded"
    assert suggestions.why["long_press_ms"] == "not enough presses"


def test_a_clean_button_gets_the_smallest_debounce():
    suggestions = suggest(analyse(presses(1, 0.1, 1, 0.1, 1, 0.1)))

    assert suggestions.bounce_ms == 10


def test_debounce_is_twice_the_longest_flicker_rounded_up_to_ten():
    recorded = edges((1.0, True), (1.013, False), (1.014, True))  # a 13 ms flicker, then a press
    recorded += [(1.5, False), (3.0, True), (3.1, False), (5.0, True), (5.1, False)]

    assert suggest(analyse(recorded)).bounce_ms == 30  # 26 ms rounded up


def test_debounce_stays_within_what_the_agent_accepts():
    recorded = edges((1.0, True), (1.04, False), (1.041, True), (1.5, False), (3.0, True), (3.1, False))
    recorded += [(5.0, True), (5.1, False)]

    assert suggest(analyse(recorded)).bounce_ms == 80  # 2 x 40 ms; never beyond 200


def test_the_double_press_window_is_one_and_a_half_times_the_longest_gap():
    recorded = presses(1, 0.1, 0.2, 0.1, 1, 0.1, 0.28, 0.1)

    assert suggest(analyse(recorded)).double_press_ms == 450  # 1.5 x 280 ms = 420, up to the next 50


def test_the_double_press_window_is_kept_inside_the_agents_range():
    recorded = presses(1, 0.1, 0.06, 0.1)

    assert suggest(analyse(recorded)).double_press_ms == 100


def test_the_long_press_time_sits_between_short_presses_and_holds():
    recorded = presses(1, 0.2, 2, 0.3, 2, 1.4, 2, 1.8)

    suggestion = suggest(analyse(recorded)).long_press_ms

    # Twice the longest short press is 600 ms, the shortest hold is 1400 ms; the middle is 1000.
    assert suggestion == 1000


def test_no_long_press_is_suggested_when_short_presses_are_as_long_as_holds():
    suggestions = suggest(analyse(presses(1, 0.4, 2, 0.4, 2, 0.7)))

    assert suggestions.long_press_ms is None
    assert suggestions.why["long_press_ms"] == "short presses are nearly as long as the holds"


def test_a_long_press_needs_both_short_presses_and_a_hold():
    only_short = suggest(analyse(presses(1, 0.1, 1, 0.1, 1, 0.1)))
    only_holds = suggest(analyse(presses(1, 1.2, 1, 1.3)))

    assert only_short.why["long_press_ms"] == "need short presses and a hold"
    assert only_holds.why["long_press_ms"] == "not enough presses"


# Following the button


def test_the_press_watcher_reports_a_press_once_it_is_let_go_and_steady():
    watcher = PressWatcher(0.03)

    assert watcher.edge(True, 1.0) == []
    assert watcher.next_deadline() == pytest.approx(1.03)
    assert watcher.settle(1.05) == []
    assert watcher.edge(False, 1.2) == []
    assert watcher.settle(1.24) == [pytest.approx(0.2)]
    assert watcher.next_deadline() is None


def test_the_press_watcher_ignores_a_flicker_shorter_than_the_debounce():
    watcher = PressWatcher(0.03)

    watcher.edge(True, 1.0)
    watcher.edge(False, 1.01)

    assert watcher.settle(2.0) == []
    assert not watcher.pressed


def test_the_press_watcher_with_no_debounce_decides_at_once():
    watcher = PressWatcher(0)

    assert watcher.edge(True, 1.0) == []
    assert watcher.edge(False, 1.1) == [pytest.approx(0.1)]


# The probe


def test_a_missing_agent_is_a_failed_check(ctx, monkeypatch):
    def missing() -> None:
        raise AgentCodeMissing("use a clone")

    monkeypatch.setattr(button, "ensure_agent_code", missing)

    section = button.run(parse(), ctx)

    assert checks(section) == {"Pi agent code": (Status.FAIL, "use a clone")}


def test_a_button_that_cannot_be_opened_fails_with_the_reason_and_a_hint(ctx, wired):
    from wallcal_agent.hardware import ButtonError

    wired.error = ButtonError("No module named 'gpiozero'")

    section = button.run(parse(), ctx)

    assert checks(section) == {"Button GPIO": (Status.FAIL, "No module named 'gpiozero'")}
    assert any("sudo apt install python3-gpiozero python3-lgpio" in note for note in section.notes)
    assert any("gpio group" in note and "GPIO17" in note for note in section.notes)
    assert section.failed
    assert wired.closed == 1


def test_without_anyone_at_the_button_the_guided_steps_are_skipped(ctx, wired, prompter):
    prompter.interactive = False

    section = button.run(parse("--seconds", "1"), ctx)

    found = checks(section)
    assert found["Button GPIO"] == (Status.PASS, "GPIO17, pull-up, press reads low")
    for name in ("Single press", "Double press", "Long press"):
        assert found[name] == (Status.SKIP, "needs someone at the button")
    assert found["Presses seen"][0] is Status.INFO
    assert not section.failed
    assert wired.closed == 1


def test_a_free_watch_records_presses_and_gestures_and_suggests_timings(ctx, wired, script, out, prompter):
    prompter.interactive = False
    # A single, a double and a long press, with a little bounce on the first press.
    script.at(T0 + 1.000, lambda: wired.press(True))
    script.at(T0 + 1.002, lambda: wired.press(False))
    script.at(T0 + 1.004, lambda: wired.press(True))
    script.at(T0 + 1.120, lambda: wired.press(False))
    script.tap(wired, T0 + 3.0, T0 + 3.1)
    script.tap(wired, T0 + 3.3, T0 + 3.4)
    script.tap(wired, T0 + 6.0, T0 + 7.5)

    section = button.run(parse("--seconds", "10"), ctx)

    found = checks(section)
    assert found["Free watch"] == (Status.INFO, "4 presses; 1 single, 1 double, 1 long")
    assert found["Presses seen"] == (Status.PASS, "4 presses, 10 edges")
    log = out.getvalue()
    assert "down 116 ms" in log
    assert "-> single" in log and "-> double" in log and "-> long" in log
    assert table(section, "Presses") == [
        ["Short presses", "3", "100 ms", "100 ms", "116 ms"],
        ["Holds", "1", "1500 ms", "1500 ms", "1500 ms"],
        ["Gaps between presses", "1", "200 ms", "200 ms", "200 ms"],
        ["Bounces", "1", "2 ms", "2 ms", "2 ms"],
    ]
    assert table(section, "Timings") == [
        ["bounce_ms", "30 ms", "10 ms"],
        ["double_press_ms", "400 ms", "300 ms"],
        ["long_press_ms", "1000 ms", "850 ms"],
    ]
    assert any(
        "button: {pin: 17, bounce_ms: 10, double_press_ms: 300, long_press_ms: 850}" in note
        and "/etc/wallcal-agent/config.yaml" in note
        for note in section.notes
    )


def test_the_gestures_follow_the_settings_that_are_given(ctx, wired, script, prompter):
    prompter.interactive = False
    script.tap(wired, T0 + 1.0, T0 + 1.1)
    script.tap(wired, T0 + 1.7, T0 + 1.8)  # 600 ms after the first was let go

    wide = button.run(parse("--seconds", "5", "--double-ms", "800"), ctx)

    assert checks(wide)["Free watch"][1] == "2 presses; 0 single, 1 double, 0 long"


def test_not_enough_presses_is_said_and_nothing_is_invented(ctx, wired, script, prompter):
    prompter.interactive = False
    script.tap(wired, T0 + 1.0, T0 + 1.1)

    section = button.run(parse("--seconds", "3"), ctx)

    assert table(section, "Timings") == [
        ["bounce_ms", "30 ms", "not enough presses"],
        ["double_press_ms", "400 ms", "no double presses recorded"],
        ["long_press_ms", "1000 ms", "need short presses and a hold"],
    ]
    assert any(note.startswith("Not enough presses to suggest timings") for note in section.notes)
    assert not any("button: {" in note for note in section.notes)


def test_the_guided_steps_pass_when_the_right_gesture_comes(ctx, wired, script):
    script.tap(wired, T0 + 1.0, T0 + 1.11)
    script.tap(wired, T0 + 4.0, T0 + 4.09)
    script.tap(wired, T0 + 4.25, T0 + 4.36)
    script.tap(wired, T0 + 8.0, T0 + 9.3)

    section = button.run(parse("--seconds", "0"), ctx)

    found = checks(section)
    assert found["Single press"] == (Status.PASS, "single: pressed for 110 ms")
    assert found["Double press"] == (Status.PASS, "double: presses of 90 ms, 110 ms, with gaps of 160 ms")
    assert found["Long press"] == (Status.PASS, "long: pressed for 1300 ms")
    assert "Free watch" not in found
    assert not section.failed


def test_a_double_press_that_came_too_slowly_fails_with_the_gap(ctx, wired, script):
    script.tap(wired, T0 + 1.0, T0 + 1.1)
    script.tap(wired, T0 + 4.0, T0 + 4.1)
    script.tap(wired, T0 + 4.6, T0 + 4.7)  # 500 ms after letting go: outside the 400 ms window

    section = button.run(parse("--seconds", "0", "--step-timeout", "5"), ctx)

    status, detail = checks(section)["Double press"]
    assert status is Status.FAIL
    assert detail == "got single then single, expected double: presses of 100 ms, 100 ms, with gaps of 500 ms"
    assert section.failed


def test_a_step_with_no_press_is_skipped_after_the_timeout(ctx, wired, clock):
    section = button.run(parse("--seconds", "0", "--step-timeout", "2"), ctx)

    found = checks(section)
    for name in ("Single press", "Double press", "Long press"):
        assert found[name] == (Status.SKIP, "no gesture within 2 s")
    # Nothing was pressed at all, and someone was there to press: that is a failure worth reporting.
    assert found["Presses seen"][0] is Status.FAIL
    assert clock.now == pytest.approx(T0 + 6)


def test_enter_ends_the_free_watch(ctx, wired, script, clock):
    ctx.prompter._enter_polls.extend([False, False, True])

    section = button.run(parse("--seconds", "60", "--step-timeout", "0.1"), ctx)

    assert checks(section)["Free watch"][0] is Status.INFO
    assert clock.now < T0 + 5  # nowhere near the 60 s
    assert ctx.prompter.poll_timeouts and set(ctx.prompter.poll_timeouts) == {0}


def test_the_button_is_released_when_the_probe_is_interrupted(ctx, wired, monkeypatch):
    def interrupted(edges, timeout):
        raise KeyboardInterrupt

    monkeypatch.setattr(button, "wait_for_edge", interrupted)

    with pytest.raises(KeyboardInterrupt):
        button.run(parse("--seconds", "5"), ctx)

    assert wired.closed == 1


def test_the_real_wait_returns_what_is_queued_and_none_when_nothing_comes():
    waiting: queue.Queue[tuple[float, bool]] = queue.Queue()

    assert button.wait_for_edge(waiting, 0) is None
    assert button.wait_for_edge(waiting, -1) is None
    waiting.put((1.0, True))
    assert button.wait_for_edge(waiting, 0.5) == (1.0, True)


def test_the_probe_reads_the_real_gpio_button_through_gpiozeros_mock_pins(ctx, monkeypatch, script, clock):
    """Everything from a pin level change to a gesture, using the agent's own GpioButton on a mock pin."""
    from gpiozero.pins.mock import MockFactory
    from wallcal_agent.hardware.gpio import GpioButton

    factory = MockFactory()
    real = GpioButton(17, pin_factory=factory)
    monkeypatch.setattr(button, "open_button", lambda pin: real)
    monkeypatch.setattr(button, "wait_for_edge", script)
    pin = factory.pin(17)
    ctx.prompter.interactive = False
    # The button pulls the pin to ground, so a press reads low.
    script.at(T0 + 1.0, pin.drive_low)
    script.at(T0 + 1.1, pin.drive_high)
    script.at(T0 + 3.0, pin.drive_low)
    script.at(T0 + 4.5, pin.drive_high)

    section = button.run(parse("--seconds", "6"), ctx)

    found = checks(section)
    assert found["Button GPIO"][0] is Status.PASS
    assert found["Free watch"] == (Status.INFO, "2 presses; 1 single, 0 double, 1 long")
    assert found["Presses seen"] == (Status.PASS, "2 presses, 4 edges")
    assert real._device is None  # closed again
