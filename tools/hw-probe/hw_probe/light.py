"""`hw-probe light`: what does the light sensor read, and which thresholds suit this room?

The sensor is a VEML7700 or a BH1750 on the Pi's I2C bus. The probe reads it with the Pi agent's own sensor classes and
asks the agent's own `LightReporter` which readings it would publish, so what is measured here is what the agent will
do. It reads the sensor at a steady interval (the sensor is read, not watched: there is nothing to wait on but the
clock), keeps every reading, and then says what the room looks like: how steady the sensor is, whether covering it
makes a difference, how bright the evening and the night are, and from those a darkness threshold for the app's auto
brightness. Left running overnight with `--csv`, it also leaves a log to look at the next morning.

The sensor is opened by the agent's classes only while the probe runs, and closed in a `finally`, so Ctrl-C does not
leave the bus open.
"""

import argparse
import contextlib
import math
import os
import statistics
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, TextIO

from .agent_code import AgentCodeMissing, ensure_agent_code, library_hint
from .context import Context
from .report import Section, Status, Table

CHIPS = ("auto", "veml7700", "bh1750")

# The names the agent and the datasheets use, and where each chip answers. "auto" tries them in this order: the
# VEML7700 has the one address, the BH1750 has two (its ADDR pin low or high).
CHIP_NAMES = {"veml7700": "VEML7700", "bh1750": "BH1750"}
CHIP_ADDRESSES = {"veml7700": (0x10,), "bh1750": (0x23, 0x5C)}

# How many readings the steady-light noise check takes, and how many failed readings in a row end the run: a loose
# wire fails the odd reading and the sensor opens afresh each time, but ten in a row means it is not coming back.
NOISE_READINGS = 10
MAX_FAILURES_IN_A_ROW = 10

# A reading this far below the baseline (or below one lux) with the sensor covered shows the sensor sees light at all.
COVERED_FRACTION = 0.5
COVERED_LUX = 1.0

# More than this share of the readings being published means the change settings are passing noise on.
BUSY_PUBLISH_SHARE = 0.5

# The agent will not sample faster than this (config.py), so a faster probe interval could not be used there.
AGENT_MIN_SAMPLE_MS = 200

NEEDS_PERSON = "needs someone at the sensor"

# The guided steps: the name used in the table, and what to ask the person to do. The first two decide "Responds to
# light", the other three are the room's levels for choosing thresholds.
BASELINE = "Room as it is"
COVERED = "Sensor covered"
EVENING = "Evening lights"
DARK = "Room dark (night)"
BRIGHT = "Bright light"
STEPS = (
    (BASELINE, "Leave the room as it usually is, with nothing over the sensor."),
    (COVERED, "Cover the sensor with a finger, so no light reaches it."),
    (EVENING, "Set the lights as they are in the evening."),
    (DARK, "Make the room dark, as it is at night (the sensor may be hard to see: it only needs to be uncovered)."),
    (BRIGHT, "Make the room as bright as it gets: daylight, or the lights full on."),
)


def bus_exists(bus: int) -> bool:
    """Whether `/dev/i2c-<bus>` is there. Tests replace this."""
    return os.path.exists(f"/dev/i2c-{bus}")


def wall_clock() -> datetime:
    """The time written in the CSV. Tests replace this."""
    return datetime.now().astimezone()


def open_sensor(chip: str, bus: int, address: int) -> Any:
    """The agent's sensor class for this chip. The bus is not opened until the first reading. Tests replace this."""
    from wallcal_agent.hardware.light import Bh1750, Veml7700

    return Veml7700(bus, address) if chip == "veml7700" else Bh1750(bus, address)


def _address(text: str) -> int:
    try:
        value = int(text, 0)
    except ValueError:
        raise argparse.ArgumentTypeError(f"{text!r} is not an address (write it like 0x23)") from None
    if not 0x03 <= value <= 0x77:
        raise argparse.ArgumentTypeError("an I2C address is 0x03 to 0x77")
    return value


def _positive(kind: type[int] | type[float], what: str) -> Callable[[str], Any]:
    def parse(text: str) -> Any:
        try:
            value = kind(text)
        except ValueError:
            raise argparse.ArgumentTypeError(f"{text!r} is not a number") from None
        if not value > 0:
            raise argparse.ArgumentTypeError(f"{what} must be more than 0")
        return value

    return parse


def _not_negative(text: str) -> float:
    try:
        value = float(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"{text!r} is not a number") from None
    if value < 0:
        raise argparse.ArgumentTypeError("must not be negative")
    return value


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--chip", choices=CHIPS, default="auto", help="the sensor chip (default: auto, which tries each in turn)"
    )
    parser.add_argument("--bus", type=int, default=1, metavar="N", help="the I2C bus, /dev/i2c-N (default: 1)")
    parser.add_argument(
        "--address",
        type=_address,
        metavar="ADDR",
        help="the chip's I2C address, such as 0x23 (default: the chip's own; auto tries all of them)",
    )
    parser.add_argument(
        "--interval-ms",
        type=_positive(int, "the interval"),
        default=1000,
        metavar="N",
        help="time between readings in milliseconds (default: 1000, the agent's own)",
    )
    parser.add_argument(
        "--seconds",
        type=_positive(float, "the watch"),
        default=60,
        metavar="N",
        help="how long the free watch lasts, unless you press Enter first (default: 60)",
    )
    parser.add_argument(
        "--step-seconds",
        type=_positive(float, "a step"),
        default=5,
        metavar="N",
        help="how long each guided step reads for (default: 5)",
    )
    parser.add_argument(
        "--change-percent",
        type=_positive(float, "the percentage"),
        default=10,
        metavar="N",
        help="the agent's light.change_percent, to count what it would publish (default: 10)",
    )
    parser.add_argument(
        "--change-lux",
        type=_not_negative,
        default=0.5,
        metavar="N",
        help="the agent's light.change_lux (default: 0.5)",
    )
    parser.add_argument(
        "--report-seconds",
        type=_positive(float, "the heartbeat"),
        default=30,
        metavar="N",
        help="the agent's light.report_seconds (default: 30)",
    )
    parser.add_argument(
        "--csv",
        type=Path,
        metavar="PATH",
        help="add every reading to this file as iso_time,seconds,lux (for a long run: --no-prompt --seconds 43200)",
    )


# ---------------------------------------------------------------------------------------------------------------
# Analysis: pure functions over readings, tested with synthetic data.


@dataclass(frozen=True)
class Reading:
    """One lux reading, and when it was taken: seconds since the probe started, from a monotonic clock."""

    seconds: float
    lux: float


@dataclass(frozen=True)
class Stats:
    count: int
    minimum: float
    median: float
    maximum: float

    @property
    def spread(self) -> float:
        return self.maximum - self.minimum


def summarise(readings: list[Reading]) -> Stats | None:
    """Count, smallest, median and largest of the readings, or None when there are none."""
    if not readings:
        return None
    values = [reading.lux for reading in readings]
    return Stats(len(values), min(values), statistics.median(values), max(values))


def published_flags(
    readings: list[Reading], change_percent: float, change_lux: float, report_seconds: float
) -> list[bool]:
    """For each reading, whether the agent's `LightReporter` would publish it, fed the readings in order. The probe
    uses the reporter itself, so the answer follows the agent if its rule ever changes."""
    from wallcal_agent.light import LightReporter

    reporter = LightReporter(change_percent, change_lux, report_seconds)
    return [reporter.offer(reading.lux, reading.seconds) for reading in readings]


def suggest_change_lux(steady_spread: float) -> float:
    """A `change_lux` that is clear of the sensor's own noise: twice the spread seen in steady light, rounded up to a
    tenth of a lux. Smaller than that and the flicker in a dark room counts as a change."""
    return math.ceil(steady_spread * 2 * 10 - 1e-9) / 10


def responds_to_light(baseline: Stats | None, covered: Stats | None) -> bool | None:
    """Whether covering the sensor made a difference: the median fell below half the baseline, or below 1 lx. None
    when one of the two was not measured."""
    if baseline is None or covered is None:
        return None
    return covered.median < baseline.median * COVERED_FRACTION or covered.median < COVERED_LUX


def round_lux(lux: float) -> float:
    """A lux figure rounded to what a person would write in a config: finer when small, coarser when large."""
    if lux < 1:
        return max(round(lux, 1), 0.1)
    if lux < 10:
        return max(round(lux * 2) / 2, 0.5)
    if lux < 100:
        return float(round(lux))
    return float(round(lux / 5) * 5)


def suggest_darkness(dark: Stats | None, evening: Stats | None) -> float | None:
    """A darkness threshold (the app's `night_below_lux`) between the dark room and the evening: their geometric
    mean, because the app reads lux on a log scale, as the eye does. None if either was not measured or the evening
    was not brighter than the night. A pitch-black room reads 0, which has no geometric mean, so it counts as 0.1."""
    if dark is None or evening is None:
        return None
    night = max(dark.median, 0.1)
    if evening.median <= night:
        return None
    middle = math.sqrt(night * evening.median)
    rounded = round_lux(middle)
    # Rounding a narrow gap can land on or past one of the two; the unrounded middle is still between them.
    return rounded if night < rounded < evening.median else round(middle, 2)


def format_lux(lux: float) -> str:
    """Lux with as many decimals as mean something: a dark room is 0.12, a lit room 143.2, daylight 12000."""
    if lux >= 1000:
        return f"{lux:.0f}"
    if lux >= 10:
        return f"{lux:.1f}"
    return f"{lux:.2f}"


# ---------------------------------------------------------------------------------------------------------------
# Reading.


@dataclass
class Collected:
    readings: list[Reading] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)  # each different message, once
    failed: int = 0
    gave_up: bool = False  # too many failures in a row
    stopped: bool = False  # Enter was pressed


class _Recorder:
    """Takes a reading and keeps it: in the CSV with the time of day, and as a `Reading` for the analysis."""

    def __init__(self, ctx: Context, sensor: Any, csv: TextIO | None) -> None:
        self._ctx = ctx
        self._sensor = sensor
        self._csv = csv
        self._began = ctx.monotonic()

    def elapsed(self) -> float:
        return self._ctx.monotonic() - self._began

    def read(self) -> Reading:
        """One reading. Raises LightError if the sensor can't be read."""
        lux = float(self._sensor.read_lux())
        reading = Reading(self.elapsed(), lux)
        if self._csv is not None:
            self._csv.write(f"{wall_clock().isoformat(timespec='seconds')},{reading.seconds:.1f},{lux:.3f}\n")
            self._csv.flush()
        return reading


def _wait(ctx: Context, seconds: float, stoppable: bool) -> bool:
    """Lets `seconds` go by. When stoppable and someone is at the terminal, that is spent listening for Enter (and
    True is returned if it came); otherwise it is a plain sleep, so nothing spins."""
    if stoppable and ctx.prompter.interactive:
        return ctx.prompter.poll_enter(max(seconds, 0))
    if seconds > 0:
        ctx.sleep(seconds)
    return False


def collect(
    ctx: Context,
    recorder: _Recorder,
    *,
    duration: float,
    interval: float,
    stoppable: bool = False,
    on_reading: Callable[[Reading], None] | None = None,
) -> Collected:
    """Reads at `interval` for `duration` seconds: at 0, interval, 2 x interval, and so on while that is before
    the end. Each reading is due at its own time (not an interval after the last one finished), so a slow reading
    doesn't stretch the run. A failed reading is counted and the run goes on; `MAX_FAILURES_IN_A_ROW` in a row end
    it. When `stoppable`, Enter ends it too."""
    from wallcal_agent.hardware import LightError

    result = Collected()
    started = ctx.monotonic()
    in_a_row = 0
    number = 0
    while True:
        try:
            reading = recorder.read()
        except LightError as error:
            result.failed += 1
            in_a_row += 1
            message = str(error)
            if message not in result.errors:
                result.errors.append(message)
                ctx.say(f"Could not read the sensor: {message}")
            if in_a_row >= MAX_FAILURES_IN_A_ROW:
                result.gave_up = True
                return result
        else:
            in_a_row = 0
            result.readings.append(reading)
            if on_reading is not None:
                on_reading(reading)
        number += 1
        due = number * interval
        if due >= duration - 1e-9:
            return result
        if _wait(ctx, started + due - ctx.monotonic(), stoppable):
            result.stopped = True
            return result


class _GaveUp(Exception):
    def __init__(self, errors: list[str]) -> None:
        super().__init__("; ".join(errors))


def _find_sensor(chip: str, bus: int, address: int | None, ctx: Context) -> tuple[str, int, Any, float] | str:
    """The first chip that answers: (chip, address, sensor, first reading). When none does, the reasons, as text."""
    from wallcal_agent.hardware import LightError

    names = list(CHIP_NAMES) if chip == "auto" else [chip]
    candidates = [(name, found) for name in names for found in ((address,) if address else CHIP_ADDRESSES[name])]
    problems: list[str] = []
    for name, where in candidates:
        sensor = open_sensor(name, bus, where)
        try:
            lux = float(sensor.read_lux())
        except LightError as error:
            sensor.close()
            problems.append(f"{CHIP_NAMES[name]} at 0x{where:02x}: {error}")
            continue
        return name, where, sensor, lux
    return "; ".join(problems)


def _open_csv(path: Path) -> TextIO:
    """The CSV, opened for adding to. The header goes in only when the file is new, so a second run continues it."""
    needs_header = not path.exists() or path.stat().st_size == 0
    handle = path.open("a", encoding="utf-8")
    if needs_header:
        handle.write("iso_time,seconds,lux\n")
        handle.flush()
    return handle


# ---------------------------------------------------------------------------------------------------------------
# The probe.


def run(args: argparse.Namespace, ctx: Context) -> Section:
    section = Section("Light probe")
    try:
        ensure_agent_code()
    except AgentCodeMissing as error:
        section.add("Agent code", Status.FAIL, str(error))
        return section

    if not bus_exists(args.bus):
        section.add(
            "I2C bus",
            Status.FAIL,
            f"/dev/i2c-{args.bus} is not there; switch I2C on with sudo raspi-config (Interface Options, I2C) "
            "and reboot, or give the right --bus",
        )
        return section

    found = _find_sensor(args.chip, args.bus, args.address, ctx)
    if isinstance(found, str):
        section.add("Sensor", Status.FAIL, f"no sensor answered on bus {args.bus}: {found}")
        section.notes.append(
            f"Check the wiring (VIN to 3.3 V, GND, SDA to GPIO2, SCL to GPIO3) and run `i2cdetect -y {args.bus}` "
            "(from the i2c-tools package): a VEML7700 shows as 10, a BH1750 as 23 (or 5c)."
        )
        hint = library_hint(found)
        if hint is not None:
            section.notes.append(f"A library is missing: {hint}")
        elif "permission" in found:
            section.notes.append("Add your user to the i2c group (sudo adduser $USER i2c) and log in again.")
        return section
    chip, address, sensor, first = found
    section.add(
        "Sensor",
        Status.PASS,
        f"{CHIP_NAMES[chip]} at 0x{address:02x} on bus {args.bus}, {format_lux(first)} lx",
    )
    section.fact("Chip", CHIP_NAMES[chip])
    section.fact("Address", f"0x{address:02x} on I2C bus {args.bus}")

    csv: TextIO | None = None
    try:
        if args.csv is not None:
            try:
                csv = _open_csv(args.csv)
            except OSError as error:
                section.add("CSV file", Status.FAIL, f"could not open {args.csv}: {error.strerror or error}")
                return section
            ctx.say(f"Adding every reading to {args.csv}.")
        _measure(args, ctx, section, _Recorder(ctx, sensor, csv), chip, address)
    finally:
        with contextlib.suppress(Exception):
            sensor.close()
        if csv is not None:
            csv.close()
    return section


def _measure(
    args: argparse.Namespace, ctx: Context, section: Section, recorder: _Recorder, chip: str, address: int
) -> None:
    interval = args.interval_ms / 1000
    measured: dict[str, Stats | None] = {}
    watch = Collected()
    noise = Collected()
    try:
        noise = _noise(ctx, recorder, section, interval)
        measured = _guided(args, ctx, section, recorder, interval)
        watch = _free_watch(args, ctx, recorder, interval)
        if watch.gave_up:
            raise _GaveUp(watch.errors)
    except _GaveUp as stop:
        section.add("Readings", Status.FAIL, f"the sensor stopped answering: {stop}")
    _analyse(args, section, chip, address, noise, watch, measured)


def _noise(ctx: Context, recorder: _Recorder, section: Section, interval: float) -> Collected:
    ctx.say(f"Reading {NOISE_READINGS} times in steady light.")
    noise = collect(ctx, recorder, duration=NOISE_READINGS * interval, interval=interval)
    if noise.gave_up:
        raise _GaveUp(noise.errors)
    stats = summarise(noise.readings)
    if stats is not None:
        section.add(
            "Noise",
            Status.INFO,
            f"median {format_lux(stats.median)} lx, spread {format_lux(stats.spread)} lx "
            f"({format_lux(stats.minimum)} to {format_lux(stats.maximum)}) over {stats.count} readings",
        )
    return noise


def _guided(
    args: argparse.Namespace, ctx: Context, section: Section, recorder: _Recorder, interval: float
) -> dict[str, Stats | None]:
    if not ctx.prompter.interactive:
        section.add("Responds to light", Status.SKIP, NEEDS_PERSON)
        section.add("Light levels", Status.SKIP, NEEDS_PERSON)
        return {}
    measured: dict[str, Stats | None] = {}
    for name, request in STEPS:
        ctx.prompter.pause(request)
        ctx.say(f"Reading for {args.step_seconds:g} s.")
        taken = collect(ctx, recorder, duration=args.step_seconds, interval=interval)
        if taken.gave_up:
            raise _GaveUp(taken.errors)
        measured[name] = summarise(taken.readings)

    answer = responds_to_light(measured[BASELINE], measured[COVERED])
    if answer is None:
        section.add("Responds to light", Status.FAIL, "no readings came while it was covered or uncovered")
    else:
        baseline, covered = measured[BASELINE], measured[COVERED]
        assert baseline is not None and covered is not None
        detail = f"{format_lux(baseline.median)} lx uncovered, {format_lux(covered.median)} lx covered"
        if answer:
            section.add("Responds to light", Status.PASS, detail)
        else:
            section.add(
                "Responds to light",
                Status.FAIL,
                f"{detail}; covering it should bring it below half, or below {COVERED_LUX:g} lx",
            )
    rows = [
        [name, str(stats.count), format_lux(stats.minimum), format_lux(stats.median), format_lux(stats.maximum)]
        if stats is not None
        else [name, "0", "-", "-", "-"]
        for name, stats in measured.items()
    ]
    section.tables.append(Table("Light levels (lx)", ["Condition", "Readings", "Min", "Median", "Max"], rows))
    return measured


def _free_watch(args: argparse.Namespace, ctx: Context, recorder: _Recorder, interval: float) -> Collected:
    from wallcal_agent.light import LightReporter

    reporter = LightReporter(args.change_percent, args.change_lux, args.report_seconds)
    interactive = ctx.prompter.interactive
    if interactive:
        ctx.say(f"Watching for {args.seconds:g} s. Press Enter to stop. Every reading is shown.")
    else:
        # A long unattended run would print a line a second for nothing; the ones the agent would publish are the
        # ones that say something. The CSV, if asked for, has them all.
        ctx.say(f"Watching for {args.seconds:g} s. Only the readings the agent would publish are shown.")

    def show(reading: Reading) -> None:
        published = reporter.offer(reading.lux, reading.seconds)
        if interactive or published:
            ctx.say(f"{reading.seconds:8.1f} s  {format_lux(reading.lux):>8} lx{'  published' if published else ''}")

    return collect(ctx, recorder, duration=args.seconds, interval=interval, stoppable=True, on_reading=show)


def _analyse(
    args: argparse.Namespace,
    section: Section,
    chip: str,
    address: int,
    noise: Collected,
    watch: Collected,
    measured: dict[str, Stats | None],
) -> None:
    stats = summarise(watch.readings)
    if stats is not None:
        section.add(
            "Watch",
            Status.INFO,
            f"{stats.count} readings, min {format_lux(stats.minimum)}, median {format_lux(stats.median)}, "
            f"max {format_lux(stats.maximum)} lx",
        )
        flags = published_flags(watch.readings, args.change_percent, args.change_lux, args.report_seconds)
        count = sum(flags)
        section.add(
            "Would publish",
            Status.INFO,
            f"{count} of {stats.count} readings with change_percent {args.change_percent:g}, "
            f"change_lux {args.change_lux:g}, report_seconds {args.report_seconds:g}",
        )
        if section.tables:
            section.tables[0].rows.append(
                [
                    "Free watch",
                    str(stats.count),
                    format_lux(stats.minimum),
                    format_lux(stats.median),
                    format_lux(stats.maximum),
                ]
            )
        elif stats.count:
            section.tables.append(
                Table(
                    "Light levels (lx)",
                    ["Condition", "Readings", "Min", "Median", "Max"],
                    [
                        [
                            "Free watch",
                            str(stats.count),
                            *(format_lux(v) for v in (stats.minimum, stats.median, stats.maximum)),
                        ]
                    ],
                )
            )
        if count > BUSY_PUBLISH_SHARE * stats.count and stats.count >= 10:
            section.notes.append(
                f"{count} of {stats.count} readings would be published, which is most of them. Raise change_percent "
                "or change_lux so that only real changes in the light are sent."
            )
    if watch.failed or noise.failed:
        section.add("Read errors", Status.INFO, f"{watch.failed + noise.failed} readings failed and were skipped")

    noise_stats = summarise(noise.readings)
    change_lux = args.change_lux
    if noise_stats is not None and noise_stats.count >= 2:
        wanted = suggest_change_lux(noise_stats.spread)
        if wanted > args.change_lux:
            section.notes.append(
                f"In steady light the readings varied by {format_lux(noise_stats.spread)} lx, more than half of "
                f"change_lux ({args.change_lux:g}). Try change_lux: {wanted:g} so the noise isn't published."
            )
            change_lux = wanted

    threshold = suggest_darkness(measured.get(DARK), measured.get(EVENING))
    dark, evening = measured.get(DARK), measured.get(EVENING)
    if threshold is not None and dark is not None and evening is not None:
        section.add("Darkness threshold", Status.INFO, f"{threshold:g} lx")
        section.notes.append(
            f"The dark room read {format_lux(dark.median)} lx and the evening {format_lux(evening.median)} lx. "
            f"In the app's config.yaml, policies.auto_brightness.night_below_lux: {threshold:g} puts the line between "
            "them. night_above_lux, if you set it, must be above that (left out, it is twice night_below_lux). "
            "The curve in auto_brightness maps lux to brightness and is separate."
        )
    elif dark is not None and evening is not None:
        section.notes.append(
            "The evening was not brighter than the dark room, so no darkness threshold was suggested. Repeat the "
            "steps with a clearer difference between them."
        )

    section.notes.append(
        "Settings for pi-agent's /etc/wallcal-agent/config.yaml: " + _yaml_block(args, chip, address, change_lux)
    )
    if args.interval_ms < AGENT_MIN_SAMPLE_MS:
        section.notes.append(f"The agent does not read faster than every {AGENT_MIN_SAMPLE_MS} ms (sample_ms).")


def _yaml_block(args: argparse.Namespace, chip: str, address: int, change_lux: float) -> str:
    sample = max(args.interval_ms, AGENT_MIN_SAMPLE_MS)
    # One line, because notes are one line each in the report.
    return (
        f"light: {{chip: {chip}, bus: {args.bus}, address: 0x{address:02x}, sample_ms: {sample}, "
        f"change_percent: {args.change_percent:g}, change_lux: {change_lux:g}, "
        f"report_seconds: {args.report_seconds:g}}}"
    )
