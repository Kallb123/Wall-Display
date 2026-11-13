"""`hw-probe mmwave`: watch the mmWave presence sensor, to tune its range and the agent's `presence.hold_ms`.

The LD2410 says "someone is there" on its OUT pin, and, over its serial port, a data frame about ten times a second
with the energy it sees in each distance gate. This probe reads either or both:

- The OUT pin is what the agent uses by default. The probe records every change, so it can say how long the sensor
  takes to notice a person, how long it holds on after they leave, and how often it flickers or drops out while
  someone sits still. That is what `presence.hold_ms` has to cover.
- The serial port (`--uart`) adds the gate energies. Compared with the thresholds the sensor is set to, they show
  which gates pick up noise in an empty room and how far out a person is seen, which is what the maker's HLKRadarTool
  app is used to tune. The probe never changes the sensor's settings, except that it switches the sensor's
  engineering mode on (so the gate energies are sent) and back off in a `finally`.

It reuses the agent's own code: `GpioPresence` for the pin, the LD2410 parser and command frames for the port, and
`PresenceFilter` to replay what the agent would make of the readings. Pin changes arrive on gpiozero's threads and
frames on this probe's reader thread, so both are stamped with the clock at once and put on one queue; the main loop
waits on that queue and looks for Enter between waits.

While the sensor is in configuration mode it stops sending reports, so the setup is quick and the guided steps run
after it has left that mode.

The analysis is in plain functions over the recorded, timestamped readings, so it is tested with made-up ones.
"""

import argparse
import contextlib
import math
import queue
import threading
import warnings
from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from .agent_code import AgentCodeMissing, ensure_agent_code, library_hint
from .context import Context
from .report import Section, Status, Table

if TYPE_CHECKING:
    from wallcal_agent.hardware.ld2410 import Ld2410Ack, Ld2410Parameters, Ld2410Report

# Mirrors of the agent's config defaults (a test checks them), so `--help` needs nothing from the agent.
DEFAULT_PIN = 27
DEFAULT_DEVICE = "/dev/serial0"
DEFAULT_BAUD = 256000
DEFAULT_HOLD_MS = 500
UART_BAUDS = (9600, 19200, 38400, 57600, 115200, 230400, 256000, 460800)
MAX_HOLD_MS = 10000

# How long to wait for the sensor's first frame, and for the reply to each command (it is sent twice at most).
FIRST_FRAME_SECONDS = 3.0
ACK_SECONDS = 1.0
# The reader's read timeout: short, so stopping it does not take long.
READ_TIMEOUT = 0.2
READ_SIZE = 256
# How long the loops wait for an event before looking for Enter and the clock again.
POLL_SECONDS = 0.25
# How long to wait for Enter in the "leave, pressing Enter" step.
ENTER_SECONDS = 60.0
# A dropout is hidden by a hold a little longer than itself.
HOLD_MARGIN = 1.2
HOLD_STEP_MS = 100


@dataclass(frozen=True)
class Event:
    """Something that happened, stamped with the monotonic clock when it did. `kind` is `pin` (value: the level),
    `frame` (a report or a reply to a command) or `lost` (the serial port failed; value: why)."""

    kind: str
    at: float
    value: Any


Transitions = list[tuple[float, bool]]
Interval = tuple[float, float]


@dataclass(frozen=True)
class Verdict:
    ok: bool
    detail: str


@dataclass(frozen=True)
class Flicker:
    """A run of one reading that ended before the agent's hold would have confirmed it."""

    at: float
    seconds: float
    present: bool


@dataclass(frozen=True)
class GateRow:
    gate: int
    moving_threshold: int | None
    still_threshold: int | None
    # Highest energy seen in the empty room, as (moving, still); None when that step was not run.
    empty: tuple[int, int] | None
    walking_max: int | None
    still_max: int | None


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--pin", type=int, default=DEFAULT_PIN, metavar="N", help=f"BCM GPIO of the OUT pin (default: {DEFAULT_PIN})"
    )
    parser.add_argument("--no-pin", action="store_true", help="the OUT pin is not wired: read the serial port only")
    parser.add_argument("--uart", action="store_true", help="also read the serial frames, for the gate energies")
    parser.add_argument(
        "--device", default=DEFAULT_DEVICE, metavar="PATH", help=f"serial port (default: {DEFAULT_DEVICE})"
    )
    parser.add_argument(
        "--baud",
        type=int,
        choices=UART_BAUDS,
        default=DEFAULT_BAUD,
        help=f"serial speed (default: {DEFAULT_BAUD})",
    )
    parser.add_argument(
        "--hold-ms",
        type=int,
        default=DEFAULT_HOLD_MS,
        metavar="N",
        help=f"the agent's presence.hold_ms, to count flickers against (default: {DEFAULT_HOLD_MS})",
    )
    parser.add_argument(
        "--step-seconds", type=float, default=20, metavar="N", help="how long each guided step lasts (default: 20)"
    )
    parser.add_argument(
        "--seconds", type=float, default=120, metavar="N", help="how long the free watch lasts (default: 120)"
    )


# --- Analysis: plain functions over (time, present) changes. Times are seconds on the monotonic clock. ---


def state_at(transitions: Transitions, at: float) -> bool | None:
    """The reading at time `at`, or None if nothing had been read yet."""
    state: bool | None = None
    for when, present in transitions:
        if when > at:
            break
        state = present
    return state


def intervals(transitions: Transitions, start: float, end: float, present: bool) -> list[Interval]:
    """The stretches of start..end where the reading was `present`. Time before the first reading is left out."""
    points: list[tuple[float, bool | None]] = [(start, state_at(transitions, start))]
    points += [(when, value) for when, value in transitions if start < when < end]
    found: list[Interval] = []
    for index, (begin, value) in enumerate(points):
        finish = points[index + 1][0] if index + 1 < len(points) else end
        if value is present and finish > begin:
            found.append((begin, finish))
    return found


def first_high(transitions: Transitions, start: float, end: float) -> float | None:
    """When someone was first seen in start..end: `start` itself if they already were."""
    highs = intervals(transitions, start, end, True)
    return highs[0][0] if highs else None


def check_empty(transitions: Transitions, start: float, end: float) -> Verdict:
    """The room is empty if the sensor read "nobody" for the second half of the step (the first half is for the
    person to get out of view, and for the sensor's own hold to run out)."""
    half = start + (end - start) / 2
    span = end - half
    if state_at(transitions, end) is None:
        return Verdict(False, "the sensor gave no reading")
    highs = intervals(transitions, half, end, True)
    if not highs:
        return Verdict(True, f"read nobody for the last {span:.0f} s")
    seen = sum(finish - begin for begin, finish in highs)
    return Verdict(
        False, f"saw someone for {seen:.1f} s of the last {span:.0f} s, first at {highs[0][0] - start:.1f} s"
    )


def check_walking(transitions: Transitions, start: float, end: float) -> Verdict:
    """Walking is seen if the sensor went to "someone" during the step."""
    seen = first_high(transitions, start, end)
    if seen is None:
        return Verdict(False, f"nothing seen in {end - start:.0f} s")
    if seen == start:
        return Verdict(True, "already seeing someone when the step began (was the room empty?)")
    return Verdict(True, f"seen {seen - start:.1f} s after the step began")


def dropouts(transitions: Transitions, start: float, end: float) -> list[Interval]:
    """The gaps in start..end after the first sighting, where the sensor lost someone who was still there."""
    seen = first_high(transitions, start, end)
    return [] if seen is None else intervals(transitions, seen, end, False)


def check_still(transitions: Transitions, start: float, end: float) -> Verdict:
    """Sitting still is held if the sensor kept saying "someone" after it first did."""
    if first_high(transitions, start, end) is None:
        return Verdict(False, f"never seen in {end - start:.0f} s")
    gaps = dropouts(transitions, start, end)
    if not gaps:
        return Verdict(True, "no dropouts")
    longest = max(finish - begin for begin, finish in gaps)
    return Verdict(False, f"{len(gaps)} dropout{'s' if len(gaps) != 1 else ''}, longest {longest:.1f} s")


def clear_time(transitions: Transitions, enter_at: float, deadline: float) -> float | None:
    """Seconds from `enter_at` until the sensor read "nobody", or None if it never did before `deadline`."""
    state = state_at(transitions, enter_at)
    if state is None:
        return None
    if not state:
        return 0.0
    for when, present in transitions:
        if enter_at < when <= deadline and not present:
            return when - enter_at
    return None


def flickers(transitions: Transitions, hold: float) -> list[Flicker]:
    """The runs of one reading shorter than `hold`, that the agent's presence filter would drop. The first run is left
    out (its start is only when watching began) and so is the last (still going)."""
    found = []
    for index in range(1, len(transitions) - 1):
        when, present = transitions[index]
        length = transitions[index + 1][0] - when
        if length < hold:
            found.append(Flicker(when, length, present))
    return found


def agent_changes(transitions: Transitions, hold: float, end: float) -> Transitions:
    """The changes the agent's own `PresenceFilter` would confirm from these readings, run with the agent's code."""
    from wallcal_agent.presence import PresenceFilter

    presence_filter = PresenceFilter(hold)
    confirmed: Transitions = []

    def settle(until: float) -> None:
        while (deadline := presence_filter.next_deadline()) is not None and deadline <= until:
            answer = presence_filter.tick(deadline)
            if answer is not None:
                confirmed.append((deadline, answer))
            elif presence_filter.next_deadline() == deadline:
                break

    for when, present in transitions:
        settle(when)
        presence_filter.update(present, when)
        answer = presence_filter.tick(when)
        if answer is not None:
            confirmed.append((when, answer))
    settle(end)
    return confirmed


def suggest_hold_ms(longest_dropout: float | None, current_ms: int) -> int | None:
    """A `presence.hold_ms` that would hide the longest dropout, or None when there was none or the current one
    already does. A little longer than the dropout, in whole 100 ms steps, and no more than the agent allows."""
    if longest_dropout is None or longest_dropout * 1000 < current_ms:
        return None
    wanted = math.ceil(longest_dropout * 1000 * HOLD_MARGIN / HOLD_STEP_MS) * HOLD_STEP_MS
    return min(wanted, MAX_HOLD_MS)


def gate_label(gate: int, metres: float | None = None) -> str:
    """The distance a gate covers, such as "0.75-1.50 m"."""
    if metres is None:
        from wallcal_agent.hardware.ld2410 import GATE_METRES

        metres = GATE_METRES
    return f"{gate * metres:.2f}-{(gate + 1) * metres:.2f} m"


def peak_energies(reports: list["Ld2410Report"], moving: bool) -> list[int]:
    """The highest energy each gate reached in these reports, gate 0 first. Reports without gates are ignored."""
    peaks: list[int] = []
    for report in reports:
        gates = report.moving_gates if moving else report.stationary_gates
        for index, energy in enumerate(gates):
            if index >= len(peaks):
                peaks.append(energy)
            elif energy > peaks[index]:
                peaks[index] = energy
    return peaks


def _at(values: list[int], index: int) -> int | None:
    return values[index] if index < len(values) else None


def gate_rows(
    parameters: "Ld2410Parameters | None",
    empty: list["Ld2410Report"] | None,
    walking: list["Ld2410Report"] | None,
    still: list["Ld2410Report"] | None,
) -> list[GateRow]:
    """One row per gate: the thresholds the sensor uses and the highest energy each guided step saw. A step that was
    not run (None), or saw no gate data, has no numbers."""
    empty_moving = peak_energies(empty or [], True)
    empty_still = peak_energies(empty or [], False)
    walking_moving = peak_energies(walking or [], True)
    still_still = peak_energies(still or [], False)
    count = max(
        len(parameters.moving_sensitivity) if parameters else 0,
        len(empty_moving),
        len(empty_still),
        len(walking_moving),
        len(still_still),
    )
    rows = []
    for gate in range(count):
        empty_pair = None
        if empty_moving or empty_still:
            empty_pair = (_at(empty_moving, gate) or 0, _at(empty_still, gate) or 0)
        rows.append(
            GateRow(
                gate=gate,
                moving_threshold=_at(list(parameters.moving_sensitivity), gate) if parameters else None,
                still_threshold=_at(list(parameters.stationary_sensitivity), gate) if parameters else None,
                empty=empty_pair,
                walking_max=_at(walking_moving, gate),
                still_max=_at(still_still, gate),
            )
        )
    return rows


def gate_notes(rows: list[GateRow]) -> list[str]:
    """What the gate table says: gates that picked up an empty room, and how far out the person was seen."""
    notes = []
    noisy = []
    for row in rows:
        if row.empty is None:
            continue
        moving, still = row.empty
        reached = []
        if row.moving_threshold is not None and moving >= row.moving_threshold:
            reached.append(f"moving {moving} against {row.moving_threshold}")
        if row.still_threshold is not None and still >= row.still_threshold:
            reached.append(f"still {still} against {row.still_threshold}")
        if reached:
            noisy.append(f"gate {row.gate} ({gate_label(row.gate)}): {', '.join(reached)}")
    if noisy:
        notes.append(
            "These gates reached their threshold in the empty room, so something there (a fan, a curtain, a "
            "reflection) can make the sensor see someone: " + "; ".join(noisy) + ". Raise that gate's threshold in "
            "HLKRadarTool, or lower the maximum gate if it is farther than anyone needs to be seen."
        )
    elif any(row.empty is not None for row in rows):
        notes.append("No gate reached its threshold in the empty room.")
    farthest = None
    for row in rows:
        moving_seen = row.walking_max is not None and (
            row.moving_threshold is not None and row.walking_max >= row.moving_threshold
        )
        still_seen = row.still_max is not None and (
            row.still_threshold is not None and row.still_max >= row.still_threshold
        )
        if moving_seen or still_seen:
            farthest = row.gate
    if farthest is not None:
        notes.append(
            f"You were seen out to gate {farthest} ({gate_label(farthest)}). Gates beyond that saw nobody, so the "
            "sensor's maximum gate need not go much further than where people will be."
        )
    elif any(row.walking_max is not None or row.still_max is not None for row in rows):
        notes.append(
            "Neither walking nor sitting still reached a gate's threshold, so the thresholds are higher than "
            "this setup gives; lower them for the gates where you were, or move the sensor nearer."
        )
    return notes


def format_report_line(report: "Ld2410Report") -> str:
    """One compact line for the live watch: the state, and where and how strongly each kind of target is seen."""

    def target(distance: int, energy: int) -> str:
        return f"{distance / 100:.2f} m at {energy}" if energy else "-"

    state = "someone" if report.present else "nobody"
    return (
        f"{state:<7}  moving {target(report.moving_distance, report.moving_energy)}"
        f"  still {target(report.stationary_distance, report.stationary_energy)}"
    )


# --- Hardware ---


def open_pin(pin: int) -> Any:
    """The OUT pin, as the agent reads it. Tests replace this."""
    from wallcal_agent.hardware.gpio import GpioPresence

    return GpioPresence(pin)


def open_port(device: str, baud: int, timeout: float) -> Any:
    """The serial port, opened the way the agent opens it. Tests replace this. It needs `read`, `write`, `close`."""
    from wallcal_agent.hardware import ld2410

    return ld2410._default_port(device, baud, timeout)


def wait_event(events: "queue.Queue[Event]", timeout: float) -> Event | None:
    """The next event, waiting up to `timeout` seconds for one. Tests replace this so that nothing really waits."""
    try:
        return events.get(timeout=max(timeout, 0))
    except queue.Empty:
        return None


class Reader:
    """Reads the serial port on a thread and puts every frame on the queue, stamped as it arrives."""

    def __init__(self, port: Any, push: Callable[[Event], None], clock: Callable[[], float]) -> None:
        self._port = port
        self._push = push
        self._clock = clock
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="hw-probe-ld2410", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread.is_alive():
            self._thread.join(timeout=READ_TIMEOUT + 2.0)

    def _run(self) -> None:
        from wallcal_agent.hardware.ld2410 import Ld2410Parser

        parser = Ld2410Parser()
        while not self._stop.is_set():
            try:
                data = self._port.read(READ_SIZE)
            except Exception as error:
                self._push(Event("lost", self._clock(), " ".join(str(error).split()) or type(error).__name__))
                return
            stamp = self._clock()
            for frame in parser.feed_frames(data):
                self._push(Event("frame", stamp, frame))


UART_HINT = (
    "Check that the sensor's TX goes to GPIO15 (pin 10) and its RX to GPIO14 (pin 8), that the serial port is on "
    "but the login console is off (sudo raspi-config, Interface Options, Serial Port), and that your user is in the "
    "dialout group. If the Pi agent is running, stop it first: it uses the same pin and port."
)
PIN_HINT = (
    "Check that your user is in the gpio group, that the pin is the BCM number and not the header position, and "
    "that nothing else holds it. If the Pi agent is running, stop it first."
)


class MmwaveProbe:
    def __init__(
        self,
        args: argparse.Namespace,
        ctx: Context,
        *,
        open_pin: Callable[[int], Any],
        open_port: Callable[[str, int, float], Any],
        get_event: Callable[["queue.Queue[Event]", float], Event | None],
    ) -> None:
        self.args = args
        self.ctx = ctx
        self.section = Section("mmWave probe")
        self._open_pin = open_pin
        self._open_port = open_port
        self._get_event = get_event
        self.events: queue.Queue[Event] = queue.Queue()
        self.use_pin = not args.no_pin
        self.hold = args.hold_ms / 1000
        # What was seen.
        self.transitions: Transitions = []
        self.last_report: Ld2410Report | None = None
        self.reports_seen = 0
        self.engineering_seen = False
        self.acks: list[Ld2410Ack] = []
        self.port_error: str | None = None
        self._capture: list[tuple[float, Ld2410Report]] | None = None
        self._live_from: float | None = None
        # The sensor's side.
        self.parameters: Ld2410Parameters | None = None
        self._port: Any = None
        self._presence: Any = None
        self.still_run = False
        self.empty_from = 0.0
        self._reader: Reader | None = None
        self._config_touched = False
        self.engineering_on = False
        self.step_reports: dict[str, list[tuple[float, Ld2410Report]]] = {}
        self.step_ends: dict[str, float] = {}
        self.dropout_lengths: list[float] = []

    # --- Collecting events ---

    def _on_pin(self, present: bool) -> None:
        # Called on gpiozero's thread: stamp it now and hand it over.
        self.events.put(Event("pin", self.ctx.monotonic(), present))

    def _note(self, at: float, present: bool) -> None:
        if not self.transitions or self.transitions[-1][1] != present:
            self.transitions.append((at, present))
            if self._live_from is not None:
                label = "someone is there" if present else "nobody"
                self.ctx.say(f"{at - self._live_from:7.1f} s  {'OUT' if self.use_pin else 'UART'}: {label}")

    def _record(self, event: Event) -> None:
        if event.kind == "pin":
            self._note(event.at, bool(event.value))
        elif event.kind == "lost":
            self.port_error = str(event.value)
        elif event.kind == "frame":
            frame = event.value
            if hasattr(frame, "status"):
                self.acks.append(frame)
                return
            self.last_report = frame
            self.reports_seen += 1
            if frame.engineering and frame.moving_gates:
                self.engineering_seen = True
            if not self.use_pin:
                self._note(event.at, frame.present)
            if self._capture is not None and frame.moving_gates:
                self._capture.append((event.at, frame))

    def _wait_until(self, done: Callable[[], bool], seconds: float, *, enter_stops: bool = False) -> bool:
        """Takes events for up to `seconds`, until `done()`. Returns whether it was done (or Enter was pressed)."""
        deadline = self.ctx.monotonic() + seconds
        while True:
            if done():
                return True
            remaining = deadline - self.ctx.monotonic()
            if remaining <= 0 or (self.port_error is not None and self._port is not None):
                return False
            event = self._get_event(self.events, min(remaining, POLL_SECONDS))
            if event is not None:
                self._record(event)
            if enter_stops and self.ctx.prompter.poll_enter(0):
                return True

    # --- Opening and closing ---

    def open_pin(self) -> bool:
        from wallcal_agent.hardware import PresenceError

        presence = None
        try:
            presence = self._open_pin(self.args.pin)
            # gpiozero warns about each pin library it tries and can't use before it settles on one (or gives up),
            # which buries the probe's own message. The error that matters is the one it raises.
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                presence.start(self._on_pin)
        except (PresenceError, ImportError) as error:
            text = " ".join(str(error).split()) or type(error).__name__
            self.section.add("OUT pin", Status.FAIL, text)
            hint = library_hint(text)
            self.section.notes.append((f"{hint}. " if hint else "") + PIN_HINT)
            if presence is not None:
                presence.close()
            return False
        self._presence = presence
        self.section.add("OUT pin", Status.PASS, f"GPIO{self.args.pin}, pull-down, reads high while it sees someone")
        return True

    def open_uart(self) -> bool:
        try:
            port = self._open_port(self.args.device, self.args.baud, READ_TIMEOUT)
        except Exception as error:
            text = " ".join(str(error).split()) or type(error).__name__
            self.section.add("UART port", Status.FAIL, text)
            hint = library_hint(text)
            self.section.notes.append((f"{hint}. " if hint else "") + UART_HINT)
            return False
        self._port = port
        self._reader = Reader(port, self.events.put, self.ctx.monotonic)
        self._reader.start()
        self.section.add("UART port", Status.PASS, f"{self.args.device} at {self.args.baud} baud")
        return True

    def close(self) -> None:
        presence = self._presence
        try:
            if self._port is not None and self._config_touched:
                self._leave_config_mode()
        finally:
            if presence is not None:
                presence.close()
            if self._reader is not None:
                self._reader.stop()
            if self._port is not None:
                with contextlib.suppress(Exception):
                    self._port.close()

    # --- Talking to the sensor ---

    def _command(self, command: int, value: bytes = b"", *, retries: int = 1) -> "Ld2410Ack | None":
        """Sends a command and waits for its reply, once more if there is none. None if it never comes."""
        from wallcal_agent.hardware.ld2410 import command_frame

        for _ in range(retries + 1):
            try:
                self._port.write(command_frame(command, value))
            except Exception as error:
                self.port_error = str(error) or type(error).__name__
                return None
            if self._wait_until(lambda: any(ack.command == command for ack in self.acks), ACK_SECONDS):
                ack = next(ack for ack in self.acks if ack.command == command)
                self.acks = [other for other in self.acks if other is not ack]
                return ack
        return None

    def _leave_config_mode(self) -> None:
        """Best effort, and quick: engineering mode off, then out of configuration mode, so the sensor is as it was."""
        from wallcal_agent.hardware import ld2410

        self.port_error = None
        if self._command(ld2410.CMD_ENABLE_CONFIG, b"\x01\x00", retries=0) is None:
            return
        if self.engineering_on:
            self._command(ld2410.CMD_ENGINEERING_OFF, retries=0)
        self._command(ld2410.CMD_END_CONFIG, retries=0)

    def setup_uart(self) -> bool:
        """Waits for frames, then reads the sensor's firmware and settings and switches engineering mode on."""
        from wallcal_agent.hardware import ld2410

        if not self._wait_until(lambda: self.reports_seen > 0, FIRST_FRAME_SECONDS):
            why = f"the port failed: {self.port_error}" if self.port_error else "no frames"
            self.section.add(
                "UART frames", Status.FAIL, f"{why}; check the wiring, the baud rate and the serial console"
            )
            self.section.notes.append(UART_HINT)
            return False
        self.section.add("UART frames", Status.PASS, "frames are arriving")
        self._config_touched = True
        if self._command(ld2410.CMD_ENABLE_CONFIG, b"\x01\x00") is None:
            self.section.add(
                "UART commands",
                Status.FAIL,
                "no reply to the enable-configuration command; carrying on with basic frames",
            )
            return True
        firmware = self._command(ld2410.CMD_READ_FIRMWARE)
        version = ld2410.parse_firmware(firmware) if firmware else None
        if version:
            self.section.fact("Sensor firmware", version)
        reply = self._command(ld2410.CMD_READ_PARAMETERS)
        self.parameters = ld2410.parse_parameters(reply) if reply else None
        if self.parameters is None:
            self.section.add("Sensor settings", Status.FAIL, "could not read them, so no thresholds to compare with")
        else:
            self._add_parameter_facts(self.parameters)
        engineering = self._command(ld2410.CMD_ENGINEERING_ON)
        self.engineering_on = engineering is not None and engineering.ok
        if not self.engineering_on:
            self.section.add(
                "Engineering mode", Status.FAIL, "would not switch on; carrying on with basic frames (no gate energies)"
            )
        if self._command(ld2410.CMD_END_CONFIG) is None:
            self.section.add("UART commands", Status.FAIL, "no reply to the end-configuration command")
        return True

    def _add_parameter_facts(self, parameters: "Ld2410Parameters") -> None:
        far = parameters.max_moving_gate
        still = parameters.max_stationary_gate
        self.section.fact(
            "Sensor range", f"moving to gate {far} ({gate_label(far)}), still to gate {still} ({gate_label(still)})"
        )
        self.section.fact("Sensor no-one time", f"{parameters.no_one_seconds} s")
        self.section.fact("Moving thresholds", " ".join(str(value) for value in parameters.moving_sensitivity))
        self.section.fact("Still thresholds", " ".join(str(value) for value in parameters.stationary_sensitivity))

    # --- The guided steps ---

    def _step(self, name: str, instruction: str, seconds: float) -> tuple[float, float]:
        """Asks for Enter, then watches for `seconds` and returns the window. Reports are kept for the gate table."""
        self.ctx.prompter.pause(instruction)
        start = self.ctx.monotonic()
        self.ctx.say(f"Go: {seconds:g} s")
        self._capture = self.step_reports[name] = []
        self._wait_until(lambda: False, seconds)
        self._capture = None
        self.step_ends[name] = start + seconds
        return start, start + seconds

    def guided(self) -> None:
        step = self.args.step_seconds
        if not self.ctx.prompter.interactive:
            for name in ("Empty room", "Walking", "Still", "Clear time"):
                self.section.add(name, Status.SKIP, "needs someone at the sensor")
            return
        source = "OUT" if self.use_pin else "UART"
        start, end = self._step("empty", "Leave the sensor's view (or the room).", step)
        verdict = check_empty(self.transitions, start, end)
        self.section.add("Empty room", Status.PASS if verdict.ok else Status.FAIL, f"{source}: {verdict.detail}")
        self.empty_from = start + step / 2

        start, end = self._step("walking", "Walk towards the display, from where nobody can see you.", step)
        verdict = check_walking(self.transitions, start, end)
        self.section.add("Walking", Status.PASS if verdict.ok else Status.FAIL, f"{source}: {verdict.detail}")

        start, end = self._step("still", "Sit or stand still where you usually would.", step)
        verdict = check_still(self.transitions, start, end)
        self.section.add("Still", Status.PASS if verdict.ok else Status.FAIL, f"{source}: {verdict.detail}")
        self.dropout_lengths = [finish - begin for begin, finish in dropouts(self.transitions, start, end)]
        self.still_run = True

        self._clear_step(step)

    def _clear_step(self, step: float) -> None:
        self.ctx.say("Leave again, and press Enter as you go.")
        started = self.ctx.monotonic()
        elapsed = self.ctx.prompter.wait_enter("Press Enter as you leave.", ENTER_SECONDS)
        if elapsed is None:
            self.section.add("Clear time", Status.SKIP, "Enter was not pressed")
            return
        enter_at = started + elapsed
        wait = step
        if self.parameters is not None:
            wait = max(step, self.parameters.no_one_seconds + 5)
        deadline = enter_at + wait
        self._wait_until(lambda: False, max(deadline - self.ctx.monotonic(), 0))
        seconds = clear_time(self.transitions, enter_at, deadline)
        if seconds is None:
            self.section.add("Clear time", Status.INFO, f"still seeing someone {wait:.0f} s after Enter")
            return
        detail = f"{seconds:.1f} s from Enter until it read nobody"
        if self.parameters is not None:
            detail += f" (the sensor's no-one time is {self.parameters.no_one_seconds} s)"
        self.section.add("Clear time", Status.INFO, detail)

    # --- The free watch ---

    def watch(self) -> tuple[float, float]:
        seconds = self.args.seconds
        interactive = self.ctx.prompter.interactive
        self.ctx.say(f"Watching for {seconds:g} s." + (" Press Enter to stop." if interactive else ""))
        start = self.ctx.monotonic()
        self._live_from = start
        deadline = start + seconds
        next_line = start + 1
        while True:
            now = self.ctx.monotonic()
            if now >= deadline or (self.port_error is not None and self._port is not None):
                break
            if self.last_report is not None and now >= next_line:
                next_line = now + 1
                self.ctx.say(f"{now - start:7.1f} s  {format_report_line(self.last_report)}")
            event = self._get_event(self.events, min(deadline - now, POLL_SECONDS))
            if event is not None:
                self._record(event)
            if interactive and self.ctx.prompter.poll_enter(0):
                break
        self._live_from = None
        return start, self.ctx.monotonic()

    # --- The result ---

    def summarise(self, watched: tuple[float, float]) -> None:
        section = self.section
        if self.port_error:
            section.add("UART frames", Status.FAIL, f"the port failed: {self.port_error}")
        end = watched[1]
        changes = len(self.transitions) - 1 if self.transitions else 0
        source = "OUT pin" if self.use_pin else "UART"
        highs = sum(finish - begin for begin, finish in intervals(self.transitions, watched[0], end, True))
        total = max(end - watched[0], 1e-9)
        section.add(
            f"{source} changes",
            Status.INFO,
            f"{changes} in total; someone was there for {highs:.0f} of the {total:.0f} s watched",
        )
        short = flickers(self.transitions, self.hold)
        if short:
            longest = max(item.seconds for item in short)
            section.add(
                "Flickers",
                Status.INFO,
                f"{len(short)} shorter than {self.args.hold_ms} ms (longest {longest * 1000:.0f} ms): "
                "the agent's presence filter drops these",
            )
        else:
            section.add("Flickers", Status.INFO, f"none shorter than {self.args.hold_ms} ms")
        confirmed = agent_changes(self.transitions, self.hold, end)
        section.add(
            "Agent's view",
            Status.INFO,
            f"{len(confirmed)} confirmed change{'s' if len(confirmed) != 1 else ''} "
            f"with a hold of {self.args.hold_ms} ms",
        )
        self._hold_advice()
        if self.args.uart and self.port_error is None:
            self._gate_table()
        section.notes.append(
            "To change the sensor's range or sensitivities, use the maker's HLKRadarTool app. This probe and the agent "
            "never change them (the probe only switches engineering mode on, and back off when it ends)."
        )

    def _hold_advice(self) -> None:
        longest = max(self.dropout_lengths) if self.dropout_lengths else None
        if not self.still_run:
            return
        suggestion = suggest_hold_ms(longest, self.args.hold_ms)
        if longest is None:
            self.section.notes.append(
                f"No dropouts while sitting still, so presence.hold_ms: {self.args.hold_ms} is enough for that."
            )
        elif suggestion is None:
            self.section.notes.append(
                f"The longest dropout while sitting still was {longest:.1f} s, which a hold of {self.args.hold_ms} ms "
                "already hides."
            )
        else:
            self.section.notes.append(
                f"The longest dropout while sitting still was {longest:.1f} s, longer than the {self.args.hold_ms} ms "
                f"hold. To hide it, set presence.hold_ms to {suggestion} in /etc/wallcal-agent/config.yaml "
                f"(presence:, hold_ms: {suggestion}). The screen then waits that long before it follows a change."
            )

    def _gate_table(self) -> None:
        section = self.section
        if not self.engineering_seen:
            section.notes.append("No gate energies arrived (engineering mode was off), so there is no gate table.")
            return

        def reports(name: str, since: float = 0.0) -> "list[Ld2410Report] | None":
            kept = self.step_reports.get(name)
            if kept is None:
                return None
            # A frame stamped at the very end belongs to what comes next.
            return [report for at, report in kept if since <= at < self.step_ends[name]]

        # Only the second half of the empty step, as for the empty-room check: the first is for the person to leave.
        rows = gate_rows(self.parameters, reports("empty", self.empty_from), reports("walking"), reports("still"))
        if not rows:
            section.notes.append("The sensor sent no per-gate energies.")
            return

        def show(value: int | None) -> str:
            return "-" if value is None else str(value)

        table = [
            [
                str(row.gate),
                gate_label(row.gate),
                show(row.moving_threshold),
                show(row.still_threshold),
                "-" if row.empty is None else f"{row.empty[0]} / {row.empty[1]}",
                show(row.walking_max),
                show(row.still_max),
            ]
            for row in rows
        ]
        section.tables.append(
            Table(
                "Gate energies",
                [
                    "Gate",
                    "Distance",
                    "Moving threshold",
                    "Still threshold",
                    "Empty max (moving/still)",
                    "Walking max",
                    "Still max",
                ],
                table,
            )
        )
        section.notes.extend(gate_notes(rows))
        if self.parameters is None:
            section.notes.append("The thresholds could not be read, so nothing is compared with them.")


def run(
    args: argparse.Namespace,
    ctx: Context,
    *,
    open_pin: Callable[[int], Any] = open_pin,
    open_port: Callable[[str, int, float], Any] = open_port,
    get_event: Callable[["queue.Queue[Event]", float], Event | None] = wait_event,
) -> Section:
    section = Section("mmWave probe")
    if args.no_pin and not args.uart:
        section.add("Options", Status.FAIL, "--no-pin leaves nothing to read: add --uart, or drop --no-pin")
        return section
    try:
        ensure_agent_code()
    except AgentCodeMissing as error:
        section.add("Pi agent code", Status.FAIL, str(error))
        return section

    probe = MmwaveProbe(args, ctx, open_pin=open_pin, open_port=open_port, get_event=get_event)
    probe.section = section
    try:
        if probe.use_pin and not probe.open_pin():
            return section
        uart_ok = True
        if args.uart:
            uart_ok = probe.open_uart() and probe.setup_uart()
            if not uart_ok and not probe.use_pin:
                return section
        probe.guided()
        watched = probe.watch()
        probe.summarise(watched)
    finally:
        probe.close()
    return section
