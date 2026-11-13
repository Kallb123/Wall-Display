import argparse
import queue
import threading
import time
from collections import deque
from typing import Any

import pytest
from wallcal_agent.hardware import PresenceError
from wallcal_agent.hardware.ld2410 import (
    CMD_ENABLE_CONFIG,
    CMD_END_CONFIG,
    CMD_ENGINEERING_OFF,
    CMD_ENGINEERING_ON,
    CMD_READ_FIRMWARE,
    CMD_READ_PARAMETERS,
    Ld2410Parameters,
    Ld2410Parser,
    Ld2410Report,
)

from hw_probe import mmwave
from hw_probe.agent_code import AgentCodeMissing
from hw_probe.context import Context
from hw_probe.mmwave import Event, GateRow, Reader
from hw_probe.report import Status

from .fakes import FakeClock, ScriptedPrompter

HEADER = bytes.fromhex("F4F3F2F1")
FOOTER = bytes.fromhex("F8F7F6F5")
ACK_HEADER = bytes.fromhex("FDFCFBFA")
ACK_FOOTER = bytes.fromhex("04030201")


def u16(value: int) -> bytes:
    return value.to_bytes(2, "little")


def report_frame(
    target: int = 0,
    moving: int = 0,
    moving_energy: int = 0,
    still: int = 0,
    still_energy: int = 0,
    moving_gates: tuple[int, ...] | None = None,
    still_gates: tuple[int, ...] | None = None,
) -> bytes:
    """A report frame: an engineering one if gate energies are given, otherwise a basic one."""
    body = u16(moving) + bytes((moving_energy,)) + u16(still) + bytes((still_energy,)) + u16(0)
    if moving_gates is None:
        data = bytes((0x02, 0xAA, target)) + body + bytes((0x55, 0x00))
    else:
        assert still_gates is not None
        gates = bytes((len(moving_gates) - 1, len(still_gates) - 1)) + bytes(moving_gates) + bytes(still_gates)
        data = bytes((0x01, 0xAA, target)) + body + gates + bytes((0x55, 0x00))
    return HEADER + u16(len(data)) + data + FOOTER


def ack_frame(command: int, status: int = 0, data: bytes = b"") -> bytes:
    body = u16(command | 0x0100) + u16(status) + data
    return ACK_HEADER + u16(len(body)) + body + ACK_FOOTER


MOVING_THRESHOLDS = (50, 50, 40, 40, 30, 30, 20, 20, 20)
STILL_THRESHOLDS = (0, 0, 40, 40, 40, 40, 40, 40, 40)
PARAMETERS = bytes((0xAA, 8, 8, 8)) + bytes(MOVING_THRESHOLDS) + bytes(STILL_THRESHOLDS) + u16(5)
FIRMWARE = u16(0x0100) + bytes((0x2C, 0x02, 0x10, 0x24, 0x06, 0x24))
QUIET = (0,) * 9


class SimPort:
    """A serial port that never blocks. `read` returns what was fed in, and `write` records the command and, if it
    can, answers it as the sensor would."""

    def __init__(self, silent: set[int] | None = None, refuse: set[int] | None = None) -> None:
        self.chunks: deque[bytes] = deque()
        self.written: list[bytes] = []
        self.closed = False
        self.broken = False
        # How many frames were fed in that the reader has not yet put on the queue.
        self.expected = 0
        self.silent = silent or set()
        self.refuse = refuse or set()
        self._counter = Ld2410Parser()

    def feed(self, data: bytes) -> None:
        if not self.broken:
            self.expected += len(self._counter.feed_frames(data))
        self.chunks.append(data)

    def read(self, size: int) -> bytes:
        if self.broken:
            raise OSError("device disconnected")
        try:
            return self.chunks.popleft()
        except IndexError:
            time.sleep(0.001)
            return b""

    def write(self, data: bytes) -> int:
        self.written.append(bytes(data))
        command = data[6] | data[7] << 8
        if command not in self.silent:
            replies = {CMD_READ_FIRMWARE: FIRMWARE, CMD_READ_PARAMETERS: PARAMETERS}
            self.feed(ack_frame(command, 1 if command in self.refuse else 0, replies.get(command, b"")))
        return len(data)

    def close(self) -> None:
        self.closed = True

    def commands(self) -> list[int]:
        return [frame[6] | frame[7] << 8 for frame in self.written]


class FakePresence:
    def __init__(self, initial: bool = False, error: Exception | None = None) -> None:
        self.initial = initial
        self.error = error
        self.on_change: Any = None
        self.closed = False

    def start(self, on_change: Any) -> None:
        if self.error is not None:
            raise self.error
        self.on_change = on_change
        on_change(self.initial)

    def close(self) -> None:
        self.closed = True


class Sim:
    """Plays a timeline against the fake clock. The main loop's wait asks it for the next event: anything already
    queued first, then a frame the reader is about to deliver, then the next thing on the timeline, otherwise time
    just passes. Pin changes go through the probe's own callback, and frames through its real reader thread."""

    def __init__(self, clock: FakeClock, presence: FakePresence | None = None, port: SimPort | None = None) -> None:
        self.clock = clock
        self.presence = presence
        self.port = port
        self.timeline: list[tuple[float, str, Any]] = []

    def pin(self, at: float, present: bool) -> None:
        self.timeline.append((at, "pin", present))
        self.timeline.sort(key=lambda item: item[0])

    def frame(self, at: float, data: bytes) -> None:
        self.timeline.append((at, "bytes", data))
        self.timeline.sort(key=lambda item: item[0])

    def unplug(self, at: float) -> None:
        self.timeline.append((at, "unplug", None))
        self.timeline.sort(key=lambda item: item[0])

    def get_event(self, events: "queue.Queue[Event]", timeout: float) -> Event | None:
        while True:
            if not events.empty():
                return events.get_nowait()
            if self.port is not None and self.port.expected > 0:
                self.port.expected -= 1
                return events.get(timeout=5)
            if self.timeline and self.timeline[0][0] <= self.clock.now + timeout:
                at, kind, value = self.timeline.pop(0)
                self.clock.now = max(self.clock.now, at)
                if kind == "pin":
                    assert self.presence is not None and self.presence.on_change is not None
                    self.presence.on_change(value)
                elif kind == "bytes":
                    assert self.port is not None
                    self.port.feed(value)
                else:
                    assert self.port is not None
                    self.port.broken = True
                    self.port.expected += 1
                continue
            self.clock.now += timeout
            return None


def parse(*argv: str) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    mmwave.add_arguments(parser)
    return parser.parse_args(argv)


def run_probe(
    ctx: Context, *argv: str, presence: FakePresence | None = None, port: SimPort | None = None, sim: Sim | None = None
):
    return mmwave.run(
        parse(*argv),
        ctx,
        open_pin=lambda pin: presence,
        open_port=lambda device, baud, timeout: port,
        get_event=sim.get_event if sim else mmwave.wait_event,
    )


def checks(section) -> dict[str, tuple[Status, str]]:
    return {check.name: (check.status, check.detail) for check in section.checks}


def report(
    target: int = 0,
    moving: int = 0,
    moving_energy: int = 0,
    still: int = 0,
    still_energy: int = 0,
    moving_gates: tuple[int, ...] = (),
    still_gates: tuple[int, ...] = (),
) -> Ld2410Report:
    return Ld2410Report(
        target, moving, moving_energy, still, still_energy, 0, bool(moving_gates), moving_gates, still_gates
    )


# --- The analysis ---

CHANGES = [(0.0, False), (10.0, True), (20.0, False)]


def test_state_at_is_none_before_the_first_reading():
    assert mmwave.state_at(CHANGES, -1) is None
    assert mmwave.state_at(CHANGES, 0) is False
    assert mmwave.state_at(CHANGES, 10) is True
    assert mmwave.state_at(CHANGES, 99) is False


def test_intervals_are_clipped_to_the_window():
    assert mmwave.intervals(CHANGES, 5, 25, True) == [(10, 20)]
    assert mmwave.intervals(CHANGES, 12, 15, True) == [(12, 15)]
    assert mmwave.intervals(CHANGES, 0, 30, False) == [(0, 10), (20, 30)]
    assert mmwave.intervals(CHANGES, -5, 5, False) == [(0, 5)]
    assert mmwave.intervals([], 0, 5, True) == []


def test_an_empty_room_reads_nobody_for_the_second_half():
    verdict = mmwave.check_empty([(1000, True), (1005, False)], 1000, 1020)
    assert verdict.ok
    assert verdict.detail == "read nobody for the last 10 s"


def test_an_empty_room_that_still_reads_someone_is_described():
    verdict = mmwave.check_empty([(1000, False), (1012, True)], 1000, 1020)
    assert not verdict.ok
    assert verdict.detail == "saw someone for 8.0 s of the last 10 s, first at 12.0 s"


def test_an_empty_room_with_no_readings_fails():
    assert not mmwave.check_empty([], 0, 20).ok


def test_walking_is_seen_after_some_seconds():
    verdict = mmwave.check_walking([(0, False), (7, True)], 0, 20)
    assert verdict == mmwave.Verdict(True, "seen 7.0 s after the step began")


def test_walking_already_seen_at_the_start_says_so():
    verdict = mmwave.check_walking([(0, True)], 0, 20)
    assert verdict.ok
    assert "already" in verdict.detail


def test_walking_never_seen_fails():
    verdict = mmwave.check_walking([(0, False)], 0, 20)
    assert verdict == mmwave.Verdict(False, "nothing seen in 20 s")


def test_sitting_still_with_no_gaps_passes():
    assert mmwave.check_still([(0, True)], 0, 20) == mmwave.Verdict(True, "no dropouts")


def test_a_dropout_while_still_is_counted():
    verdict = mmwave.check_still([(0, True), (5, False), (7.5, True)], 0, 20)
    assert verdict == mmwave.Verdict(False, "1 dropout, longest 2.5 s")


def test_several_dropouts_and_one_that_lasts_to_the_end():
    changes = [(0, True), (2, False), (3, True), (15, False)]
    assert mmwave.dropouts(changes, 0, 20) == [(2, 3), (15, 20)]
    assert mmwave.check_still(changes, 0, 20) == mmwave.Verdict(False, "2 dropouts, longest 5.0 s")


def test_sitting_still_never_seen_fails():
    assert mmwave.check_still([(0, False)], 0, 20) == mmwave.Verdict(False, "never seen in 20 s")


def test_clear_time_is_counted_from_enter():
    changes = [(0, True), (8, False)]
    assert mmwave.clear_time(changes, 3, 20) == 5.0
    assert mmwave.clear_time(changes, 9, 20) == 0.0
    assert mmwave.clear_time(changes, 3, 6) is None
    assert mmwave.clear_time([(0, True)], 3, 20) is None
    assert mmwave.clear_time([], 3, 20) is None


def test_flickers_leave_out_the_first_and_last_runs():
    changes = [(0, False), (10, True), (10.2, False), (20, True), (20.1, False)]
    found = mmwave.flickers(changes, 0.5)
    assert [(item.at, item.present) for item in found] == [(10, True), (20, True)]
    assert found[0].seconds == pytest.approx(0.2)


def test_the_agents_filter_drops_flickers_and_confirms_the_rest():
    changes = [(0, False), (10, True), (10.2, False), (20, True), (25, False)]
    confirmed = mmwave.agent_changes(changes, 0.5, 30)
    assert [state for _, state in confirmed] == [False, True, False]
    assert [at for at, _ in confirmed] == pytest.approx([0.5, 20.5, 25.5])


def test_a_hold_of_nothing_confirms_every_change():
    confirmed = mmwave.agent_changes([(0, False), (1, True), (1.1, False)], 0, 5)
    assert confirmed == [(0, False), (1, True), (1.1, False)]


def test_a_change_not_held_by_the_end_is_not_confirmed():
    assert mmwave.agent_changes([(0, False), (4.9, True)], 0.5, 5) == [(0.5, False)]


def test_no_readings_give_no_changes():
    assert mmwave.agent_changes([], 0.5, 5) == []


@pytest.mark.parametrize(
    ("dropout", "current", "expected"),
    [
        (None, 500, None),
        (0.3, 500, None),
        (1.2, 500, 1500),
        (0.5, 500, 600),
        (20, 500, 10000),
    ],
)
def test_the_suggested_hold_hides_the_longest_dropout(dropout, current, expected):
    assert mmwave.suggest_hold_ms(dropout, current) == expected


def test_a_gate_is_labelled_with_its_distances():
    assert mmwave.gate_label(0) == "0.00-0.75 m"
    assert mmwave.gate_label(1) == "0.75-1.50 m"
    assert mmwave.gate_label(2, 0.2) == "0.40-0.60 m"


def test_peak_energies_take_the_highest_per_gate_and_skip_basic_reports():
    reports = [
        report(moving_gates=(1, 9, 3), still_gates=(0, 0, 0)),
        report(moving_gates=(5, 2, 3), still_gates=(0, 7, 0)),
        report(target=1),
    ]
    assert mmwave.peak_energies(reports, True) == [5, 9, 3]
    assert mmwave.peak_energies(reports, False) == [0, 7, 0]
    assert mmwave.peak_energies([], True) == []


PARAMS = Ld2410Parameters(2, 2, 2, (50, 40, 30), (60, 50, 40), 5)


def sample_rows() -> list[GateRow]:
    empty = [report(moving_gates=(10, 20, 35), still_gates=(5, 5, 5))]
    walking = [report(moving_gates=(80, 60, 10), still_gates=(0, 0, 0))]
    still = [report(moving_gates=(0, 0, 0), still_gates=(70, 55, 10))]
    return mmwave.gate_rows(PARAMS, empty, walking, still)


def test_gate_rows_join_thresholds_and_the_three_steps():
    rows = sample_rows()
    assert rows[2] == GateRow(2, 30, 40, (35, 5), 10, 10)
    assert rows[0] == GateRow(0, 50, 60, (10, 5), 80, 70)
    assert len(rows) == 3


def test_gate_rows_without_parameters_or_steps_have_blanks():
    rows = mmwave.gate_rows(None, None, [report(moving_gates=(80, 60))], None)
    assert rows == [GateRow(0, None, None, None, 80, None), GateRow(1, None, None, None, 60, None)]
    assert mmwave.gate_rows(None, None, None, None) == []


def test_notes_name_the_gates_that_picked_up_the_empty_room_and_how_far_you_were_seen():
    notes = mmwave.gate_notes(sample_rows())
    assert len(notes) == 2
    assert "gate 2 (1.50-2.25 m): moving 35 against 30" in notes[0]
    assert "Raise that gate's threshold" in notes[0]
    assert "out to gate 1 (0.75-1.50 m)" in notes[1]


def test_a_quiet_empty_room_is_reported_as_such():
    rows = mmwave.gate_rows(PARAMS, [report(moving_gates=(1, 1, 1), still_gates=(1, 1, 1))], None, None)
    assert mmwave.gate_notes(rows) == ["No gate reached its threshold in the empty room."]


def test_thresholds_never_reached_by_a_person_are_said_to_be_too_high():
    rows = mmwave.gate_rows(PARAMS, None, [report(moving_gates=(1, 1, 1), still_gates=(0, 0, 0))], None)
    notes = mmwave.gate_notes(rows)
    assert len(notes) == 1
    assert "lower them" in notes[0]


def test_no_data_gives_no_gate_notes():
    assert mmwave.gate_notes([]) == []


def test_the_live_line_shows_the_state_and_both_targets():
    line = mmwave.format_report_line(report(target=3, moving=120, moving_energy=65, still=210, still_energy=40))
    assert line == "someone  moving 1.20 m at 65  still 2.10 m at 40"
    assert mmwave.format_report_line(report()) == "nobody   moving -  still -"


# --- Defaults and options ---


def test_the_defaults_match_the_agents_config():
    pytest.importorskip("yaml")
    from wallcal_agent import config

    presence = config.PresenceConfig()
    assert presence.pin == mmwave.DEFAULT_PIN
    assert presence.hold_ms == mmwave.DEFAULT_HOLD_MS
    assert presence.uart.device == mmwave.DEFAULT_DEVICE
    assert presence.uart.baud == mmwave.DEFAULT_BAUD
    assert mmwave.UART_BAUDS == config.UART_BAUDS


def test_the_options_have_the_documented_defaults():
    args = parse()
    assert (args.pin, args.no_pin, args.uart, args.device, args.baud) == (27, False, False, "/dev/serial0", 256000)
    assert (args.hold_ms, args.step_seconds, args.seconds) == (500, 20, 120)


def test_a_baud_rate_the_agent_does_not_know_is_refused():
    with pytest.raises(SystemExit):
        parse("--baud", "12345")


# --- The reader ---


def test_the_reader_puts_frames_on_the_queue_with_the_time_they_arrived():
    port = SimPort()
    events: queue.Queue[Event] = queue.Queue()
    reader = Reader(port, events.put, lambda: 42.0)
    port.feed(report_frame(target=1) + ack_frame(CMD_ENABLE_CONFIG))
    reader.start()
    try:
        first = events.get(timeout=5)
        second = events.get(timeout=5)
    finally:
        reader.stop()
    assert (first.kind, first.at, first.value.target) == ("frame", 42.0, 1)
    assert second.value.command == CMD_ENABLE_CONFIG


def test_the_reader_says_so_when_the_port_fails_and_stops():
    port = SimPort()
    port.broken = True
    events: queue.Queue[Event] = queue.Queue()
    reader = Reader(port, events.put, lambda: 7.0)
    reader.start()
    event = events.get(timeout=5)
    reader.stop()
    assert (event.kind, event.at, event.value) == ("lost", 7.0, "device disconnected")


def test_the_reader_stops_when_asked():
    reader = Reader(SimPort(), queue.Queue().put, lambda: 0.0)
    reader.start()
    reader.stop()
    assert threading.active_count() >= 1
    assert not reader._thread.is_alive()


def test_wait_event_gives_none_on_a_timeout():
    events: queue.Queue[Event] = queue.Queue()
    assert mmwave.wait_event(events, 0) is None
    events.put(Event("pin", 1.0, True))
    assert mmwave.wait_event(events, 0).value is True


# --- Running the probe ---


def test_no_pin_without_uart_is_a_usage_error(ctx):
    section = run_probe(ctx, "--no-pin")
    assert checks(section)["Options"][0] is Status.FAIL


def test_a_missing_agent_is_a_failed_check(ctx, monkeypatch):
    def missing() -> None:
        raise AgentCodeMissing("not here")

    monkeypatch.setattr(mmwave, "ensure_agent_code", missing)
    section = run_probe(ctx)
    assert checks(section) == {"Pi agent code": (Status.FAIL, "not here")}


def test_a_pin_that_cannot_be_opened_fails_with_the_library_hint(ctx):
    presence = FakePresence(error=PresenceError("No module named 'gpiozero'"))
    section = run_probe(ctx, presence=presence)
    status, detail = checks(section)["OUT pin"]
    assert status is Status.FAIL
    assert "gpiozero" in detail
    assert section.notes[0].startswith("sudo apt install python3-gpiozero python3-lgpio. ")
    assert "gpio group" in section.notes[0]
    assert presence.closed


def test_a_pin_factory_that_raises_is_a_failed_check_too(ctx):
    def broken(pin: int):
        raise ImportError("No module named 'gpiozero'")

    section = mmwave.run(parse(), ctx, open_pin=broken)
    assert checks(section)["OUT pin"][0] is Status.FAIL


def test_a_port_that_cannot_be_opened_fails_with_hints(ctx):
    def broken(device: str, baud: int, timeout: float):
        raise OSError(f"could not open port {device}")

    section = mmwave.run(parse("--no-pin", "--uart"), ctx, open_port=broken)
    status, detail = checks(section)["UART port"]
    assert status is Status.FAIL
    assert "/dev/serial0" in detail
    assert "GPIO15" in section.notes[0]
    assert "dialout" in section.notes[0]


def test_a_missing_serial_library_gets_its_apt_line(ctx):
    def broken(device: str, baud: int, timeout: float):
        raise ModuleNotFoundError("No module named 'serial'")

    section = mmwave.run(parse("--no-pin", "--uart"), ctx, open_port=broken)
    assert section.notes[0].startswith("sudo apt install python3-serial. ")


def test_a_pin_only_watch_without_a_person_skips_the_steps_and_analyses_the_changes(ctx, clock, out):
    presence = FakePresence()
    sim = Sim(clock, presence)
    start = clock.now
    sim.pin(start + 2, True)
    sim.pin(start + 2.2, False)  # a blip
    sim.pin(start + 4, True)
    sim.pin(start + 8, False)
    prompter = ScriptedPrompter(interactive=False)
    ctx.prompter = prompter
    section = run_probe(ctx, "--seconds", "10", presence=presence, sim=sim)

    found = checks(section)
    assert found["OUT pin"][0] is Status.PASS
    for name in ("Empty room", "Walking", "Still", "Clear time"):
        assert found[name][0] is Status.SKIP
    assert found["OUT pin changes"] == (Status.INFO, "4 in total; someone was there for 4 of the 10 s watched")
    assert found["Flickers"][1].startswith("1 shorter than 500 ms (longest 200 ms)")
    assert found["Agent's view"][1] == "3 confirmed changes with a hold of 500 ms"
    assert presence.closed
    assert not section.tables
    assert "someone is there" in out.getvalue()
    assert "HLKRadarTool" in section.notes[-1]
    assert clock.now == pytest.approx(start + 10)


def test_the_guided_steps_with_the_pin_only(ctx, clock):
    presence = FakePresence()
    sim = Sim(clock, presence)
    t = clock.now
    sim.pin(t + 25, True)  # seen 5 s into walking
    sim.pin(t + 50, False)  # a 2 s dropout while still
    sim.pin(t + 52, True)
    sim.pin(t + 70, False)  # 7 s after Enter
    ctx.prompter = ScriptedPrompter(enter=[3.0])
    section = run_probe(ctx, "--seconds", "5", presence=presence, sim=sim)

    found = checks(section)
    assert found["Empty room"] == (Status.PASS, "OUT: read nobody for the last 10 s")
    assert found["Walking"] == (Status.PASS, "OUT: seen 5.0 s after the step began")
    assert found["Still"] == (Status.FAIL, "OUT: 1 dropout, longest 2.0 s")
    assert found["Clear time"] == (Status.INFO, "7.0 s from Enter until it read nobody")
    assert any("presence.hold_ms to 2400" in note for note in section.notes)
    assert len(ctx.prompter.pauses) == 3
    assert ctx.prompter.waits[0][0] == "Press Enter as you leave."
    assert section.failed


def test_a_steady_sitter_needs_no_longer_hold(ctx, clock):
    presence = FakePresence(initial=True)
    sim = Sim(clock, presence)
    t = clock.now
    sim.pin(t + 5, False)
    sim.pin(t + 25, True)
    ctx.prompter = ScriptedPrompter(enter=[None])
    section = run_probe(ctx, "--seconds", "5", presence=presence, sim=sim)

    found = checks(section)
    assert found["Empty room"][0] is Status.PASS
    assert found["Walking"][0] is Status.PASS
    assert found["Still"] == (Status.PASS, "OUT: no dropouts")
    assert found["Clear time"][0] is Status.SKIP
    assert any("No dropouts while sitting still" in note for note in section.notes)


def test_the_clear_time_that_never_comes_is_said_so(ctx, clock):
    presence = FakePresence(initial=True)
    sim = Sim(clock, presence)
    ctx.prompter = ScriptedPrompter(enter=[1.0])
    section = run_probe(ctx, "--seconds", "1", "--step-seconds", "4", presence=presence, sim=sim)
    assert checks(section)["Clear time"] == (Status.INFO, "still seeing someone 4 s after Enter")


def test_the_free_watch_ends_when_enter_is_pressed(ctx, clock):
    presence = FakePresence()
    sim = Sim(clock, presence)
    ctx.prompter = ScriptedPrompter(enter=[None], enter_polls=[False, False, True])
    start = clock.now
    run_probe(ctx, "--seconds", "100", "--step-seconds", "1", presence=presence, sim=sim)
    # Three one-second steps, then three polls of a quarter second each.
    assert clock.now - start == pytest.approx(3 + 0.75)
    assert set(ctx.prompter.poll_timeouts) == {0}


def test_a_pin_and_a_free_watch_with_nothing_else_to_report_is_not_a_failure(ctx, clock):
    presence = FakePresence()
    ctx.prompter = ScriptedPrompter(interactive=False)
    section = run_probe(ctx, "--seconds", "2", presence=presence, sim=Sim(clock, presence))
    assert not section.failed


# --- The serial port ---


def uart_probe_timeline(sim: Sim, base: float) -> None:
    """Frames once a second from `base`, and pin changes, for the three guided steps of 20 s each."""
    empty = report_frame(moving_gates=(5, 10, 20, 55, 5, 5, 5, 5, 5), still_gates=QUIET)
    walking = report_frame(
        target=1, moving=300, moving_energy=80, moving_gates=(10, 30, 50, 60, 45, 10, 5, 5, 5), still_gates=QUIET
    )
    sitting = report_frame(
        target=2, still=200, still_energy=60, moving_gates=QUIET, still_gates=(0, 0, 10, 20, 50, 50, 10, 5, 5)
    )
    for second in range(0, 60):
        frame = empty if second < 20 else walking if second < 40 else sitting
        sim.frame(base + second, frame)
    sim.pin(base + 25, True)
    sim.pin(base + 70, False)


def test_the_uart_setup_reads_the_sensor_and_leaves_it_as_it_found_it(ctx, clock):
    presence = FakePresence()
    port = SimPort()
    sim = Sim(clock, presence, port)
    base = clock.now + 0.5
    uart_probe_timeline(sim, base)
    ctx.prompter = ScriptedPrompter(enter=[2.0])
    section = run_probe(ctx, "--uart", "--seconds", "2", presence=presence, port=port, sim=sim)

    found = checks(section)
    assert found["UART port"] == (Status.PASS, "/dev/serial0 at 256000 baud")
    assert found["UART frames"][0] is Status.PASS
    assert section.fact_value("Sensor firmware") == "V2.2C.24062410"
    assert port.commands() == [
        CMD_ENABLE_CONFIG,
        CMD_READ_FIRMWARE,
        CMD_READ_PARAMETERS,
        CMD_ENGINEERING_ON,
        CMD_END_CONFIG,
        CMD_ENABLE_CONFIG,
        CMD_ENGINEERING_OFF,
        CMD_END_CONFIG,
    ]
    assert port.closed
    assert presence.closed
    assert section.fact_value("Sensor no-one time") == "5 s"
    assert section.fact_value("Moving thresholds") == "50 50 40 40 30 30 20 20 20"
    assert "gate 8" in (section.fact_value("Sensor range") or "")
    assert found["Walking"][0] is Status.PASS
    assert found["Clear time"] == (
        Status.INFO,
        "8.0 s from Enter until it read nobody (the sensor's no-one time is 5 s)",
    )


def test_the_gate_table_and_notes(ctx, clock):
    presence = FakePresence()
    port = SimPort()
    sim = Sim(clock, presence, port)
    uart_probe_timeline(sim, clock.now + 0.5)
    ctx.prompter = ScriptedPrompter(enter=[2.0])
    section = run_probe(ctx, "--uart", "--seconds", "2", presence=presence, port=port, sim=sim)

    (table,) = section.tables
    assert table.title == "Gate energies"
    assert table.headers[:4] == ["Gate", "Distance", "Moving threshold", "Still threshold"]
    assert len(table.rows) == 9
    # Gate 3 saw 55 in the empty room against a moving threshold of 40; the walker was strongest there too.
    assert table.rows[3] == ["3", "2.25-3.00 m", "40", "40", "55 / 0", "60", "20"]
    assert table.rows[4][5:] == ["45", "50"]
    assert any("gate 3 (2.25-3.00 m): moving 55 against 40" in note for note in section.notes)
    assert any("out to gate 5 (3.75-4.50 m)" in note for note in section.notes)


def test_the_empty_room_numbers_ignore_the_first_half_of_the_step(ctx, clock):
    presence = FakePresence()
    port = SimPort()
    sim = Sim(clock, presence, port)
    base = clock.now + 0.5
    noisy = report_frame(moving_gates=(90,) * 9, still_gates=QUIET)
    quiet = report_frame(moving_gates=(1,) * 9, still_gates=QUIET)
    for second in range(0, 20):
        sim.frame(base + second, noisy if second < 10 else quiet)
    ctx.prompter = ScriptedPrompter(enter=[None])
    section = run_probe(ctx, "--uart", "--seconds", "1", presence=presence, port=port, sim=sim)
    (table,) = section.tables
    assert table.rows[0][4] == "1 / 0"


def test_uart_only_uses_the_frames_for_presence(ctx, clock):
    port = SimPort()
    sim = Sim(clock, None, port)
    base = clock.now + 0.5
    for second in range(0, 12):
        sim.frame(base + second, report_frame(target=1 if 3 <= second < 8 else 0, moving=100, moving_energy=70))
    ctx.prompter = ScriptedPrompter(interactive=False)
    section = run_probe(ctx, "--no-pin", "--uart", "--seconds", "11", port=port, sim=sim)
    found = checks(section)
    assert "OUT pin" not in found
    assert found["UART changes"][1].startswith("2 in total")
    assert "Engineering mode" not in found
    assert not section.failed


def test_no_frames_fails_and_sends_no_commands(ctx, clock):
    port = SimPort()
    sim = Sim(clock, None, port)
    section = run_probe(ctx, "--no-pin", "--uart", port=port, sim=sim)
    status, detail = checks(section)["UART frames"]
    assert status is Status.FAIL
    assert "no frames" in detail
    assert port.written == []
    assert port.closed
    assert clock.now == pytest.approx(1000 + 3)


def test_no_frames_still_lets_the_pin_be_watched(ctx, clock):
    presence = FakePresence()
    port = SimPort()
    sim = Sim(clock, presence, port)
    ctx.prompter = ScriptedPrompter(interactive=False)
    section = run_probe(ctx, "--uart", "--seconds", "2", presence=presence, port=port, sim=sim)
    found = checks(section)
    assert found["UART frames"][0] is Status.FAIL
    assert found["OUT pin changes"][0] is Status.INFO
    assert port.closed


def test_a_sensor_that_ignores_commands_is_carried_on_with(ctx, clock):
    presence = FakePresence()
    port = SimPort(silent={CMD_ENABLE_CONFIG})
    sim = Sim(clock, presence, port)
    sim.frame(clock.now + 0.5, report_frame(target=1))
    ctx.prompter = ScriptedPrompter(interactive=False)
    section = run_probe(ctx, "--uart", "--seconds", "2", presence=presence, port=port, sim=sim)
    status, detail = checks(section)["UART commands"]
    assert status is Status.FAIL
    assert "basic frames" in detail
    assert port.closed
    assert port.commands().count(CMD_ENABLE_CONFIG) == 3  # asked twice, and once more on the way out


def test_engineering_mode_that_will_not_switch_on_is_not_switched_off(ctx, clock):
    presence = FakePresence()
    port = SimPort(refuse={CMD_ENGINEERING_ON})
    sim = Sim(clock, presence, port)
    sim.frame(clock.now + 0.5, report_frame(target=1))
    ctx.prompter = ScriptedPrompter(interactive=False)
    section = run_probe(ctx, "--uart", "--seconds", "2", presence=presence, port=port, sim=sim)
    assert checks(section)["Engineering mode"][0] is Status.FAIL
    assert CMD_ENGINEERING_OFF not in port.commands()
    assert port.commands()[-2:] == [CMD_ENABLE_CONFIG, CMD_END_CONFIG]
    assert not section.tables
    assert any("No gate energies arrived" in note for note in section.notes)


def test_a_command_is_sent_again_once_if_unanswered(ctx, clock):
    presence = FakePresence()
    port = SimPort()
    original = port.write
    dropped = []

    def flaky(data: bytes) -> int:
        if not dropped and (data[6] | data[7] << 8) == CMD_READ_FIRMWARE:
            dropped.append(data)
            port.written.append(bytes(data))
            return len(data)
        return original(data)

    port.write = flaky  # type: ignore[method-assign]
    sim = Sim(clock, presence, port)
    sim.frame(clock.now + 0.5, report_frame(target=1))
    ctx.prompter = ScriptedPrompter(interactive=False)
    section = run_probe(ctx, "--uart", "--seconds", "1", presence=presence, port=port, sim=sim)
    assert port.commands().count(CMD_READ_FIRMWARE) == 2
    assert section.fact_value("Sensor firmware") is not None


def test_a_port_that_fails_mid_watch_is_reported_and_still_released(ctx, clock):
    presence = FakePresence()
    port = SimPort()
    sim = Sim(clock, presence, port)
    base = clock.now + 0.5
    sim.frame(base, report_frame(target=0))
    sim.unplug(base + 5)
    ctx.prompter = ScriptedPrompter(interactive=False)
    section = run_probe(ctx, "--uart", "--seconds", "60", presence=presence, port=port, sim=sim)
    failures = [check for check in section.checks if check.status is Status.FAIL]
    assert any("device disconnected" in check.detail for check in failures)
    assert port.closed
    assert presence.closed


def test_ctrl_c_still_puts_the_sensor_back(ctx, clock):
    presence = FakePresence()
    port = SimPort()
    sim = Sim(clock, presence, port)
    base = clock.now + 0.5
    for second in range(0, 40):
        sim.frame(base + second, report_frame(target=0, moving_gates=QUIET, still_gates=QUIET))
    ctx.prompter = ScriptedPrompter(enter=[None], enter_polls=[False, KeyboardInterrupt])
    with pytest.raises(KeyboardInterrupt):
        run_probe(ctx, "--uart", "--seconds", "60", "--step-seconds", "1", presence=presence, port=port, sim=sim)
    assert port.commands()[-3:] == [CMD_ENABLE_CONFIG, CMD_ENGINEERING_OFF, CMD_END_CONFIG]
    assert port.closed
    assert presence.closed


def test_the_pin_callback_stamps_events_with_the_probes_clock(ctx, clock):
    presence = FakePresence()
    probe = mmwave.MmwaveProbe(
        parse(), ctx, open_pin=lambda pin: presence, open_port=lambda *a: None, get_event=mmwave.wait_event
    )
    assert probe.open_pin()
    clock.now = 1234.5
    presence.on_change(True)
    events = [probe.events.get_nowait(), probe.events.get_nowait()]
    assert [(event.kind, event.at, event.value) for event in events] == [("pin", 1000.0, False), ("pin", 1234.5, True)]
