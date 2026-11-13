"""`hw-probe button`: tune the button's single, double and long press timings.

The Pi agent turns a button's raw ups and downs into single, double and long presses with its own gesture detector,
and reads the pin with its own `GpioButton`. This probe runs exactly that code on the real button, so the timings
that work here are the timings that will work in the agent. It watches the pin, asks for each kind of press in turn,
lets you press freely for a while, and then reads the recorded edges to suggest `bounce_ms`, `double_press_ms` and
`long_press_ms` for the agent's config.

The pin's callbacks come from gpiozero's own threads, so they only stamp the time and queue the edge. The loop that
runs the detector is the main thread, and it sleeps until the detector's next deadline or the next edge.
"""

import argparse
import itertools
import math
import queue
import statistics
import warnings
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from .agent_code import AgentCodeMissing, ensure_agent_code, library_hint
from .context import Context
from .report import Section, Status, Table

# The agent's own defaults and the ranges its config accepts. A test checks the defaults against the agent's config.
DEFAULT_PIN = 17
DEFAULT_BOUNCE_MS = 30
DEFAULT_DOUBLE_MS = 400
DEFAULT_LONG_MS = 1000
PIN_RANGE = (0, 27)
BOUNCE_RANGE = (0, 200)
DOUBLE_RANGE = (100, 2000)
LONG_RANGE = (300, 10000)

# How often the loop looks for Enter when no edge or deadline wakes it sooner, in seconds.
POLL_SECONDS = 0.1

# For reading the recorded edges, which are judged on their own and not by the timings in use (they are what is
# being tuned). A level that lasted less than NOISE_LIMIT is contact bounce. A press of at least HOLD_MINIMUM is a
# deliberate hold, and a gap shorter than DOUBLE_GAP_LIMIT between two presses is a double press being tried.
NOISE_LIMIT = 0.05
HOLD_MINIMUM = 0.6
DOUBLE_GAP_LIMIT = 1.0

# How many readings a suggestion needs before it is worth making.
MIN_PRESSES_FOR_BOUNCE = 3
MIN_SHORT_PRESSES = 2

NEEDS_PERSON = "needs someone at the button"
NOT_ENOUGH = "not enough presses"


def _whole_ms(low: int, high: int) -> Callable[[str], int]:
    """An option type for a whole number of milliseconds the agent's config would accept."""

    def parse(text: str) -> int:
        try:
            value = int(text)
        except ValueError:
            raise argparse.ArgumentTypeError(f"{text!r} is not a whole number") from None
        if not low <= value <= high:
            raise argparse.ArgumentTypeError(f"must be {low} to {high}")
        return value

    return parse


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--pin",
        type=_whole_ms(*PIN_RANGE),
        default=DEFAULT_PIN,
        metavar="N",
        help=f"BCM GPIO number the button is wired to (default: {DEFAULT_PIN})",
    )
    parser.add_argument(
        "--bounce-ms",
        type=_whole_ms(*BOUNCE_RANGE),
        default=DEFAULT_BOUNCE_MS,
        metavar="MS",
        help=f"debounce time to run the detector with (default: {DEFAULT_BOUNCE_MS})",
    )
    parser.add_argument(
        "--double-ms",
        type=_whole_ms(*DOUBLE_RANGE),
        default=DEFAULT_DOUBLE_MS,
        metavar="MS",
        help=f"longest gap that still makes a double press (default: {DEFAULT_DOUBLE_MS})",
    )
    parser.add_argument(
        "--long-ms",
        type=_whole_ms(*LONG_RANGE),
        default=DEFAULT_LONG_MS,
        metavar="MS",
        help=f"how long a press is held to be a long press (default: {DEFAULT_LONG_MS})",
    )
    parser.add_argument(
        "--seconds",
        type=float,
        default=60,
        metavar="N",
        help="how long the free watch lasts, in seconds; 0 skips it (default: 60)",
    )
    parser.add_argument(
        "--step-timeout",
        type=float,
        default=15,
        metavar="N",
        help="how long to wait for each guided press, in seconds (default: 15)",
    )


def open_button(pin: int) -> Any:
    """The agent's real button input on `pin`. Nothing is opened until it is started. Tests replace this."""
    from wallcal_agent.hardware.gpio import GpioButton

    return GpioButton(pin)


def wait_for_edge(edges: "queue.Queue[tuple[float, bool]]", timeout: float) -> tuple[float, bool] | None:
    """The next edge, waiting up to `timeout` seconds for one. Tests replace this so no time really passes."""
    try:
        return edges.get(timeout=max(timeout, 0))
    except queue.Empty:
        return None


# Reading the recorded edges


@dataclass(frozen=True)
class Press:
    """One press that was let go again: when it began, and when it ended, in seconds."""

    start: float
    end: float

    @property
    def length(self) -> float:
        return self.end - self.start


@dataclass(frozen=True)
class Analysis:
    """What a run of edges says about the button, all in seconds."""

    presses: tuple[Press, ...] = ()
    bounces: tuple[float, ...] = ()  # how long each flicker lasted
    short_lengths: tuple[float, ...] = ()
    hold_lengths: tuple[float, ...] = ()
    gaps: tuple[float, ...] = ()  # let go to pressed again, for presses that might be half of a double


def analyse(edges: list[tuple[float, bool]], noise_limit: float = NOISE_LIMIT) -> Analysis:
    """Finds the bounce, the presses, and the holds and gaps between them in a list of (time, pressed) edges.

    A level that lasted less than `noise_limit` is thrown away together with the change back, so contact bounce does
    not split one press into several. A press still down at the end is left out: its length is not known yet.
    """
    # Each entry is a change of level and when it happened. The button starts released, from the beginning of time.
    changes: list[tuple[float, bool]] = [(-math.inf, False)]
    bounces: list[float] = []
    for at, pressed in edges:
        if pressed == changes[-1][1]:
            continue
        if at - changes[-1][0] < noise_limit:
            # It went back before it had lasted long enough to be real: that flicker was bounce.
            bounces.append(at - changes[-1][0])
            changes.pop()
            continue
        changes.append((at, pressed))

    presses = tuple(
        Press(down[0], up[0]) for down, up in zip(changes[1::2], changes[2::2], strict=False) if down[1] and not up[1]
    )
    short = tuple(press.length for press in presses if press.length < HOLD_MINIMUM)
    holds = tuple(press.length for press in presses if press.length >= HOLD_MINIMUM)
    gaps = tuple(
        later.start - earlier.end
        for earlier, later in itertools.pairwise(presses)
        if earlier.length < HOLD_MINIMUM and later.start - earlier.end < DOUBLE_GAP_LIMIT
    )
    return Analysis(presses, tuple(bounces), short, holds, gaps)


@dataclass(frozen=True)
class Suggestions:
    """Timings worked out from an analysis, each None when there is not enough to go on (and `why` says so)."""

    bounce_ms: int | None = None
    double_press_ms: int | None = None
    long_press_ms: int | None = None
    why: dict[str, str] = field(default_factory=dict)


def _clamp(value: int, limits: tuple[int, int]) -> int:
    return max(limits[0], min(limits[1], value))


def _round_up(value: float, step: int) -> int:
    return math.ceil(value / step - 1e-9) * step


def _round_to(value: float, step: int) -> int:
    return round(value / step) * step


def suggest(analysis: Analysis) -> Suggestions:
    """Timings for the agent's config that fit what was recorded.

    - Debounce: twice the longest flicker seen, so a flicker is never mistaken for a press, but at least 10 ms.
    - Double press: one and a half times the longest gap between two presses that were meant as a double.
    - Long press: between twice the longest short press and the shortest hold, so ordinary presses never count as long.
    """
    why: dict[str, str] = {}

    bounce: int | None = None
    if len(analysis.presses) >= MIN_PRESSES_FOR_BOUNCE:
        longest = max(analysis.bounces, default=0.0) * 1000
        bounce = _clamp(max(10, _round_up(2 * longest, 10)), BOUNCE_RANGE)
    else:
        why["bounce_ms"] = NOT_ENOUGH

    double: int | None = None
    if analysis.gaps:
        double = _clamp(_round_up(1.5 * max(analysis.gaps) * 1000, 50), DOUBLE_RANGE)
    else:
        why["double_press_ms"] = "no double presses recorded"

    long: int | None = None
    if len(analysis.short_lengths) >= MIN_SHORT_PRESSES and analysis.hold_lengths:
        low = 2 * max(analysis.short_lengths) * 1000
        high = min(analysis.hold_lengths) * 1000
        if low < high:
            middle = (low + high) / 2
            long = _round_to(middle, 50)
            if not low <= long < high:
                long = _round_to(middle, 10)
            long = _clamp(long, LONG_RANGE)
        else:
            why["long_press_ms"] = "short presses are nearly as long as the holds"
    else:
        why["long_press_ms"] = "need short presses and a hold" if analysis.short_lengths else NOT_ENOUGH
    return Suggestions(bounce, double, long, why)


# Following the button live


class PressWatcher:
    """Tells when a press has been confirmed and let go, for the live "down 112 ms" lines.

    It debounces the same way the agent's detector does (a change counts once it has stayed put for `bounce`
    seconds, dated from when it began), but only reports press lengths, which the detector does not expose.
    """

    def __init__(self, bounce: float) -> None:
        self._bounce = bounce
        self._raw = False
        self._since = 0.0
        self._stable = False
        self._start = 0.0

    @property
    def pressed(self) -> bool:
        return self._raw

    def next_deadline(self) -> float | None:
        return self._since + self._bounce if self._raw != self._stable else None

    def edge(self, pressed: bool, at: float) -> list[float]:
        lengths = self.settle(at)
        if pressed != self._raw:
            self._raw = pressed
            self._since = at
            lengths += self.settle(at)
        return lengths

    def settle(self, now: float) -> list[float]:
        """The length of a press that has just been confirmed as let go, as a list of none or one."""
        if self._raw == self._stable or now < self._since + self._bounce:
            return []
        self._stable = self._raw
        if self._raw:
            self._start = self._since
            return []
        return [self._since - self._start]


class Watch:
    """The detector, fed from the button. It records every edge and every gesture, with their times."""

    def __init__(
        self,
        ctx: Context,
        bounce_ms: int,
        double_ms: int,
        long_ms: int,
        wait: Callable[["queue.Queue[tuple[float, bool]]", float], tuple[float, bool] | None] | None = None,
    ) -> None:
        from wallcal_agent.button import GestureDetector

        self.ctx = ctx
        self.detector = GestureDetector(bounce_ms / 1000, double_ms / 1000, long_ms / 1000)
        self.watcher = PressWatcher(bounce_ms / 1000)
        self.double_window = double_ms / 1000
        self.edges: list[tuple[float, bool]] = []
        self.gestures: list[tuple[float, str]] = []
        self._queue: queue.Queue[tuple[float, bool]] = queue.Queue()
        self._wait = wait if wait is not None else wait_for_edge

    def on_change(self, pressed: bool) -> None:
        """The button's callback. It runs on gpiozero's thread, so it only stamps the time and queues the edge."""
        self._queue.put((self.ctx.monotonic(), pressed))

    def step(self, longest: float) -> None:
        """Waits for an edge or the next deadline, for no more than `longest` seconds, and does what is due."""
        now = self.ctx.monotonic()
        deadlines = [
            deadline
            for deadline in (self.detector.next_deadline(), self.watcher.next_deadline())
            if deadline is not None
        ]
        wait = longest if not deadlines else min(longest, max(min(deadlines) - now, 0.0))
        item = self._wait(self._queue, wait)
        if item is not None:
            at, pressed = item
            self.edges.append(item)
            self.detector.edge(pressed, at)
            self._report_presses(self.watcher.edge(pressed, at))
        now = self.ctx.monotonic()
        self._report_presses(self.watcher.settle(now))
        for gesture in self.detector.tick(now):
            self.gestures.append((now, gesture))
            self.ctx.say(f"-> {gesture}")

    def _report_presses(self, lengths: list[float]) -> None:
        for length in lengths:
            self.ctx.say(f"down {length * 1000:.0f} ms")

    def pump(self, end: float, *, until: Callable[[], bool] | None = None, enter: bool = False) -> None:
        """Runs the loop until time `end`, `until` says so, or (with `enter`) Enter is pressed."""
        while self.ctx.monotonic() < end:
            if until is not None and until():
                return
            if enter and self.ctx.prompter.poll_enter(0):
                return
            self.step(min(POLL_SECONDS, end - self.ctx.monotonic()))

    def idle(self) -> bool:
        """Whether the button is let go, nothing is waiting to be decided and it has been quiet for a double window."""
        if self.watcher.pressed or self.detector.next_deadline() is not None or not self._queue.empty():
            return False
        quiet_since = self.edges[-1][0] if self.edges else -math.inf
        return self.ctx.monotonic() - quiet_since >= self.double_window


# The guided steps and the report


def _plural(count: int, one: str, many: str) -> str:
    return f"{count} {one if count == 1 else many}"


def _ms(seconds: float) -> str:
    return f"{round(seconds * 1000)} ms"


def _describe(presses: tuple[Press, ...]) -> str:
    """The presses of a step in words: how long each was held and how far apart they came."""
    if not presses:
        return "no complete press"
    if len(presses) == 1:
        return f"pressed for {_ms(presses[0].length)}"
    lengths = ", ".join(_ms(press.length) for press in presses)
    gaps = ", ".join(_ms(later.start - earlier.end) for earlier, later in itertools.pairwise(presses))
    return f"presses of {lengths}, with gaps of {gaps}"


def _guided_step(section: Section, watch: Watch, name: str, expected: str, ask: str, timeout: float) -> None:
    ctx = watch.ctx
    first_gesture = len(watch.gestures)
    first_edge = len(watch.edges)
    ctx.say(f"{ask} (waiting up to {timeout:g} s)")
    watch.pump(ctx.monotonic() + timeout, until=lambda: len(watch.gestures) > first_gesture)
    if len(watch.gestures) == first_gesture:
        section.add(name, Status.SKIP, f"no gesture within {timeout:g} s")
        return
    # Let the rest of the press happen: a double is decided before the second press is let go, and a long press
    # while the button is still down. Anything extra that follows is part of what was seen.
    watch.pump(ctx.monotonic() + timeout, until=watch.idle)
    came = [gesture for _, gesture in watch.gestures[first_gesture:]]
    how = _describe(analyse(watch.edges[first_edge:]).presses)
    if came == [expected]:
        section.add(name, Status.PASS, f"{expected}: {how}")
    else:
        section.add(name, Status.FAIL, f"got {' then '.join(came)}, expected {expected}: {how}")


def _count_text(values: tuple[float, ...]) -> list[str]:
    if not values:
        return ["0", "-", "-", "-"]
    return [str(len(values)), _ms(min(values)), _ms(statistics.median(values)), _ms(max(values))]


def _gesture_summary(gestures: list[tuple[float, str]]) -> str:
    return ", ".join(f"{sum(1 for _, g in gestures if g == kind)} {kind}" for kind in ("single", "double", "long"))


def _timings_table(args: argparse.Namespace, suggestions: Suggestions) -> list[list[str]]:
    rows = []
    for key, used, value in (
        ("bounce_ms", args.bounce_ms, suggestions.bounce_ms),
        ("double_press_ms", args.double_ms, suggestions.double_press_ms),
        ("long_press_ms", args.long_ms, suggestions.long_press_ms),
    ):
        rows.append([key, f"{used} ms", f"{value} ms" if value is not None else suggestions.why.get(key, NOT_ENOUGH)])
    return rows


def _analysis_notes(section: Section, args: argparse.Namespace, suggestions: Suggestions) -> None:
    if suggestions.bounce_ms is None and suggestions.double_press_ms is None and suggestions.long_press_ms is None:
        section.notes.append(
            "Not enough presses to suggest timings: press singly, double-press and hold a few times each "
            "(run again, or give --seconds more time)."
        )
        return
    # Keep what is in use where nothing could be suggested, so the block can be pasted whole.
    values = {
        "pin": args.pin,
        "bounce_ms": suggestions.bounce_ms if suggestions.bounce_ms is not None else args.bounce_ms,
        "double_press_ms": (suggestions.double_press_ms if suggestions.double_press_ms is not None else args.double_ms),
        "long_press_ms": suggestions.long_press_ms if suggestions.long_press_ms is not None else args.long_ms,
    }
    block = ", ".join(f"{key}: {value}" for key, value in values.items())
    section.notes.append(f"In the Pi agent's /etc/wallcal-agent/config.yaml: button: {{{block}}}")
    section.notes.append(
        "A longer double press window makes every single press wait that much longer to be reported, so keep it as "
        "short as the slowest double press you want to allow."
    )


def run(args: argparse.Namespace, ctx: Context) -> Section:
    section = Section("Button probe")
    try:
        ensure_agent_code()
    except AgentCodeMissing as error:
        section.add("Pi agent code", Status.FAIL, str(error))
        return section
    from wallcal_agent.hardware import ButtonError

    section.fact("Button pin", f"GPIO{args.pin}")
    button = open_button(args.pin)
    try:
        watch = Watch(ctx, args.bounce_ms, args.double_ms, args.long_ms, wait=wait_for_edge)
        try:
            # gpiozero warns about each pin factory it tries before giving up, which only buries the real message.
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                button.start(watch.on_change)
        except ButtonError as error:
            section.add("Button GPIO", Status.FAIL, str(error))
            hint = library_hint(str(error))
            if hint:
                section.notes.append(f"The GPIO libraries come from apt: {hint}")
            section.notes.append(
                f"Check that this is a Raspberry Pi, that the user is in the gpio group, and that nothing else has "
                f"GPIO{args.pin} open: the Pi agent holds the button's pin while it runs (sudo systemctl stop "
                "wallcal-agent)."
            )
            return section
        section.add("Button GPIO", Status.PASS, f"GPIO{args.pin}, pull-up, press reads low")

        guided = (
            ("Single press", "single", "Press the button once."),
            ("Double press", "double", "Double-press it."),
            ("Long press", "long", "Press and hold it."),
        )
        for name, expected, ask in guided:
            if ctx.prompter.interactive:
                _guided_step(section, watch, name, expected, ask, args.step_timeout)
            else:
                section.add(name, Status.SKIP, NEEDS_PERSON)

        if args.seconds > 0:
            free_edges, free_gestures = len(watch.edges), len(watch.gestures)
            stop = "Press Enter to stop" if ctx.prompter.interactive else "No one is at the terminal, so it runs"
            ctx.say(f"Watching the button for {args.seconds:g} s. Press as you like. {stop}.")
            watch.pump(ctx.monotonic() + args.seconds, enter=ctx.prompter.interactive)
            # A press still being decided when the watch ends is given its moment, so its gesture is not lost.
            watch.pump(ctx.monotonic() + max(args.double_ms, args.long_ms) / 1000, until=watch.idle)
            free = analyse(watch.edges[free_edges:])
            section.add(
                "Free watch",
                Status.INFO,
                f"{_plural(len(free.presses), 'press', 'presses')}; {_gesture_summary(watch.gestures[free_gestures:])}",
            )
    finally:
        button.close()

    result = analyse(watch.edges)
    if not watch.edges:
        status = Status.FAIL if ctx.prompter.interactive else Status.INFO
        section.add("Presses seen", status, "none: check the wiring (GPIO and ground) and that this is the right pin")
        return section
    section.add(
        "Presses seen", Status.PASS, f"{_plural(len(result.presses), 'press', 'presses')}, {len(watch.edges)} edges"
    )
    section.tables.append(
        Table("Presses", ["Kind", "Count", "Shortest", "Median", "Longest"], _press_rows(result)),
    )
    suggestions = suggest(result)
    section.tables.append(Table("Timings", ["Setting", "Used", "Suggested"], _timings_table(args, suggestions)))
    _analysis_notes(section, args, suggestions)
    return section


def _press_rows(result: Analysis) -> list[list[str]]:
    return [
        ["Short presses", *_count_text(result.short_lengths)],
        ["Holds", *_count_text(result.hold_lengths)],
        ["Gaps between presses", *_count_text(result.gaps)],
        ["Bounces", *_count_text(result.bounces)],
    ]
