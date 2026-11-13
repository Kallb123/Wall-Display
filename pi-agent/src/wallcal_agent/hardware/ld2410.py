"""The LD2410 read over its serial port, for when its OUT pin isn't enough.

The sensor streams a data frame about ten times a second. Each one says whether it sees someone, and how far away, so
this is the way to go if you want the distances later. The OUT pin (hardware/gpio.py) is simpler and is the default.

This file has two halves. `Ld2410Parser` is pure: bytes in, reports out, so it is tested with byte strings and
never meets a serial port. `Ld2410Uart` owns the port and one reader thread that feeds the parser. It uses pyserial.

A report frame looks like this (all numbers little-endian), taken from the LD2410's serial protocol:

    F4 F3 F2 F1   header
    nn nn         length of the data, in bytes
    ...           the data, `length` bytes (below)
    F8 F7 F6 F5   footer

and the data, for the basic report (type 02) and the engineering report (type 01), which carries extra numbers about
each distance gate between the detection distance and the tail:

    02 or 01      data type
    AA            head of the report
    ss            target state: 0 nobody, 1 moving, 2 stationary, 3 both
    nn nn  nn     moving target: distance in cm (two bytes), energy 0 to 100
    nn nn  nn     stationary target: distance in cm, energy
    nn nn         detection distance in cm
    ...           engineering data, type 01 only (below)
    55 00         tail and check (the check byte is always 00)

The engineering data starts with the last moving gate N and the last stationary gate M, then holds N+1 moving
energies and M+1 stationary energies, one byte each (0 to 100), gate 0 first. Some models add a few more bytes after
those (a light level, the OUT pin); they are ignored. A gate is a slice of distance in front of the sensor, 0.75 m
deep at the factory resolution (`GATE_METRES`).

The sensor also answers the commands it is sent, in frames with their own header (FD FC FB FA): the command word with
0x0100 added, a status (0 is success) and then whatever the command returns. The agent sends no commands, so it never
looks at those and `feed` skips them. `hw-probe mmwave --uart` does send a few (to switch engineering mode on, so the
gate energies arrive, and to read the sensor's settings), so the parser can return the replies too (`feed_frames`),
and `command_frame` builds what it sends. Changing the sensor's settings is left to the maker's app.
"""

import logging
import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from . import PresenceError

logger = logging.getLogger(__name__)

REPORT_HEADER = bytes.fromhex("F4F3F2F1")
REPORT_FOOTER = bytes.fromhex("F8F7F6F5")
ACK_HEADER = bytes.fromhex("FDFCFBFA")
ACK_FOOTER = bytes.fromhex("04030201")
_HEADERS = (REPORT_HEADER, ACK_HEADER)
_FOOTERS = {REPORT_HEADER: REPORT_FOOTER, ACK_HEADER: ACK_FOOTER}
_HEADER_AT = re.compile(re.escape(REPORT_HEADER) + b"|" + re.escape(ACK_HEADER))

# Commands the probe may send. The value of "enable configuration" is always 0001; the rest take none.
CMD_ENABLE_CONFIG = 0x00FF
CMD_END_CONFIG = 0x00FE
CMD_READ_PARAMETERS = 0x0061
CMD_ENGINEERING_ON = 0x0062
CMD_ENGINEERING_OFF = 0x0063
CMD_READ_FIRMWARE = 0x00A0
# A reply carries its command word with this bit added.
ACK_BIT = 0x0100
# The least a reply's data can be: the command word and the status.
MIN_ACK_BYTES = 4

# How deep one distance gate is, in metres, at the sensor's factory distance resolution.
GATE_METRES = 0.75

TYPE_ENGINEERING = 0x01
TYPE_BASIC = 0x02
REPORT_HEAD = 0xAA
REPORT_TAIL = bytes((0x55, 0x00))
# The data of a basic report: type, head, state, three distances and two energies, tail and check.
MIN_REPORT_BYTES = 13
# The longest data a frame may claim. A real engineering report is about 35 bytes, so a length far past this is
# noise that happens to look like a header, and waiting for it would stall the parser for no reason. This is also
# what caps the parser's buffer: it never holds more than one frame of this size (and a few bytes of a header),
# however much it is fed.
MAX_FRAME_DATA = 256

# How long one read waits for a byte, and so how often the reader thread looks at the clock and at `close()`.
READ_TIMEOUT = 1.0
READ_SIZE = 256
# How long to wait before opening the port again after it failed.
RETRY_SECONDS = 5.0
# Frames come about ten times a second, so ten seconds with none means the wiring or the baud rate is wrong, or the
# sensor has stopped.
SILENCE_SECONDS = 10.0
# How long `close()` waits for the reader thread: a read that has just begun, plus a little.
STOP_TIMEOUT = READ_TIMEOUT + 2.0
# How much of the library's own message goes into the error, so a log line stays one line.
MAX_ERROR_TEXT = 200


@dataclass(frozen=True)
class Ld2410Report:
    """One report from the sensor. Distances are in centimetres, energies are 0 to 100."""

    # 0 nobody, 1 moving, 2 stationary, 3 both.
    target: int
    moving_distance: int
    moving_energy: int
    stationary_distance: int
    stationary_energy: int
    detection_distance: int
    # Whether it was an engineering report.
    engineering: bool = False
    # The energy (0 to 100) of each distance gate, gate 0 first, from an engineering report. Empty for a basic report,
    # and for an engineering one whose gate counts don't fit inside it. The agent doesn't use them; the probe does.
    moving_gates: tuple[int, ...] = ()
    stationary_gates: tuple[int, ...] = ()

    @property
    def present(self) -> bool:
        """Whether the sensor sees someone, moving or still."""
        return self.target != 0


@dataclass(frozen=True)
class Ld2410Ack:
    """The sensor's reply to a command."""

    # The command it answers, as sent (without the 0x0100 bit a reply carries).
    command: int
    # 0 is success.
    status: int
    # What the command returns, after the status: the firmware version, the settings, and so on.
    data: bytes

    @property
    def ok(self) -> bool:
        return self.status == 0


@dataclass(frozen=True)
class Ld2410Parameters:
    """The sensor's settings, as read with `CMD_READ_PARAMETERS`."""

    # The farthest gate the sensor knows, and the farthest it uses for moving and for still targets.
    max_gate: int
    max_moving_gate: int
    max_stationary_gate: int
    # Per gate, 0 to `max_gate`: the energy (0 to 100) a gate must reach to count as someone.
    moving_sensitivity: tuple[int, ...]
    stationary_sensitivity: tuple[int, ...]
    # How long the sensor keeps saying someone is there after the last sign of them.
    no_one_seconds: int


class Ld2410Parser:
    """Finds report frames in a stream of bytes. Pure: no I/O, no clock.

    Bytes arrive in whatever pieces the serial port gives them, so a frame may be split anywhere, and the stream may
    start in the middle of one or hold garbage (a baud rate that was wrong for a while, a sensor that was switched
    on mid-frame). `feed` keeps what it hasn't used yet and picks up from there. It never raises on any input.
    """

    def __init__(self) -> None:
        self._buffer = bytearray()

    def feed(self, data: bytes) -> list[Ld2410Report]:
        """Takes the next bytes, and returns the reports they complete, in order. Each is returned once. Replies to
        commands are skipped (see `feed_frames`)."""
        return [frame for frame in self.feed_frames(data) if isinstance(frame, Ld2410Report)]

    def feed_frames(self, data: bytes) -> list[Ld2410Report | Ld2410Ack]:
        """Like `feed`, but also returns the replies to commands, all in the order they arrived."""
        self._buffer += data
        reports: list[Ld2410Report | Ld2410Ack] = []
        buffer = self._buffer
        while True:
            found = _HEADER_AT.search(buffer)
            if found is None:
                # No header yet. Whatever is here is garbage, except the end, which may be the first bytes of a
                # header that the next read finishes.
                del buffer[: len(buffer) - _partial_header_length(buffer)]
                break
            del buffer[: found.start()]
            if len(buffer) < 6:
                break
            header = bytes(buffer[:4])
            length = buffer[4] | buffer[5] << 8
            if length > MAX_FRAME_DATA:
                # Not a frame's length, so this was not a header. Skip its first byte and look again: a real
                # frame may start inside it.
                del buffer[:1]
                continue
            total = 6 + length + 4
            if len(buffer) < total:
                break
            if bytes(buffer[total - 4 : total]) != _FOOTERS[header]:
                # No footer where this frame says it ends, so it isn't one. Same as above: only the header's first
                # byte is dropped, so a good frame inside what was taken for a long one is not lost with it.
                del buffer[:1]
                continue
            data_bytes = bytes(buffer[6 : 6 + length])
            del buffer[:total]
            if header == REPORT_HEADER:
                report = _parse_report(data_bytes)
                if report is not None:
                    reports.append(report)
            else:
                ack = _parse_ack(data_bytes)
                if ack is not None:
                    reports.append(ack)
        return reports


def _partial_header_length(buffer: bytearray) -> int:
    """How many bytes at the end of `buffer` could be the start of a header, longest first (0 if none)."""
    for size in range(len(REPORT_HEADER) - 1, 0, -1):
        tail = bytes(buffer[-size:])
        if len(tail) == size and any(header.startswith(tail) for header in _HEADERS):
            return size
    return 0


def _parse_report(data: bytes) -> Ld2410Report | None:
    """The report in one frame's data, or None when the data is not one (a type this does not know, a missing head or
    tail, a state that is not 0 to 3). The frame is already known to be whole."""
    if len(data) < MIN_REPORT_BYTES or data[0] not in (TYPE_BASIC, TYPE_ENGINEERING):
        return None
    if data[1] != REPORT_HEAD or data[-2:] != REPORT_TAIL:
        return None
    target = data[2]
    if target > 3:
        return None
    engineering = data[0] == TYPE_ENGINEERING
    moving_gates, stationary_gates = _parse_gates(data) if engineering else ((), ())
    return Ld2410Report(
        target=target,
        moving_distance=data[3] | data[4] << 8,
        moving_energy=data[5],
        stationary_distance=data[6] | data[7] << 8,
        stationary_energy=data[8],
        detection_distance=data[9] | data[10] << 8,
        engineering=engineering,
        moving_gates=moving_gates,
        stationary_gates=stationary_gates,
    )


def _parse_gates(data: bytes) -> tuple[tuple[int, ...], tuple[int, ...]]:
    """The per-gate energies in an engineering report's data, or two empty tuples when they don't fit. Whatever
    follows them (the retained bytes some models add) is left alone."""
    start = MIN_REPORT_BYTES - len(REPORT_TAIL)
    body = data[: len(data) - len(REPORT_TAIL)]
    if len(body) < start + 2:
        return (), ()
    moving_count = body[start] + 1
    stationary_count = body[start + 1] + 1
    first = start + 2
    if first + moving_count + stationary_count > len(body):
        return (), ()
    moving = tuple(body[first : first + moving_count])
    stationary = tuple(body[first + moving_count : first + moving_count + stationary_count])
    return moving, stationary


def _parse_ack(data: bytes) -> Ld2410Ack | None:
    """The reply in one frame's data, or None when it is too short to be one."""
    if len(data) < MIN_ACK_BYTES:
        return None
    word = data[0] | data[1] << 8
    return Ld2410Ack(command=word & ~ACK_BIT, status=data[2] | data[3] << 8, data=bytes(data[4:]))


def command_frame(command: int, value: bytes = b"") -> bytes:
    """The bytes to send for a command: header, length, command word, its value, footer."""
    length = 2 + len(value)
    return ACK_HEADER + length.to_bytes(2, "little") + command.to_bytes(2, "little") + value + ACK_FOOTER


def parse_parameters(ack: Ld2410Ack) -> Ld2410Parameters | None:
    """The settings in the reply to `CMD_READ_PARAMETERS`, or None if it failed or is too short to hold them."""
    data = ack.data
    if not ack.ok or len(data) < 4 or data[0] != REPORT_HEAD:
        return None
    max_gate = data[1]
    count = max_gate + 1
    if len(data) < 4 + 2 * count + 2:
        return None
    moving = tuple(data[4 : 4 + count])
    stationary = tuple(data[4 + count : 4 + 2 * count])
    end = 4 + 2 * count
    return Ld2410Parameters(
        max_gate=max_gate,
        max_moving_gate=data[2],
        max_stationary_gate=data[3],
        moving_sensitivity=moving,
        stationary_sensitivity=stationary,
        no_one_seconds=data[end] | data[end + 1] << 8,
    )


def parse_firmware(ack: Ld2410Ack) -> str | None:
    """The version in the reply to `CMD_READ_FIRMWARE`, written the way ESPHome does (V2.44.24062416), or None if it
    failed or is too short."""
    data = ack.data
    if not ack.ok or len(data) < 8:
        return None
    major_lo, major_hi = data[2], data[3]
    b0, b1, b2, b3 = data[4:8]
    return f"V{major_hi}.{major_lo:02X}.{b3:02X}{b2:02X}{b1:02X}{b0:02X}"


def _default_port(device: str, baud: int, timeout: float) -> Any:
    """A real serial port. pyserial is imported here, so everything else works without it."""
    import serial

    return serial.Serial(device, baud, timeout=timeout)


# Opens a port: (device, baud, read timeout in seconds). What it returns has `read(size) -> bytes` and `close()`.
PortFactory = Callable[[str, int, float], Any]


class Ld2410Uart:
    """The LD2410 on a serial port, read by one thread.

    `start` opens the port, so a port that isn't there is an error at once. The thread then reads, feeds the parser,
    and calls `on_change(present)` for every report. It goes on calling it with a reading that hasn't changed: the
    presence filter takes repeats in its stride, and a sensor that goes quiet is found by the silence check instead.

    If the port fails later (the cable is pulled, the USB adapter resets) the thread warns once, closes it, waits
    and opens it again, for as long as it runs; the last reading stands meanwhile, because nothing says it changed.
    If the port is open but no report arrives for `silence` seconds it warns once, and says so when they come back.

    `port_factory`, `retry` and `silence` are there for tests: a fake port, and times short enough to wait for.
    """

    def __init__(
        self,
        device: str,
        baud: int,
        port_factory: PortFactory = _default_port,
        retry: float = RETRY_SECONDS,
        silence: float = SILENCE_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._device = device
        self._baud = baud
        self._port_factory = port_factory
        self._retry = retry
        self._silence = silence
        self._clock = clock
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    def start(self, on_change: Callable[[bool], None]) -> None:
        """Opens the port and starts reading. Raises PresenceError if the port can't be opened: not there, no
        permission (the service user needs the `dialout` group), in use, or pyserial missing."""
        self.close()
        port = self._open()
        self._stop = threading.Event()
        self._thread = threading.Thread(
            target=self._run, args=(port, on_change, self._stop), name="wallcal-ld2410", daemon=True
        )
        self._thread.start()

    def close(self) -> None:
        """Stops the thread and lets go of the port. Safe to call twice, or before `start`."""
        thread, self._thread = self._thread, None
        self._stop.set()
        if thread is None:
            return
        thread.join(timeout=STOP_TIMEOUT)
        if thread.is_alive():
            logger.debug("The LD2410 reader is still reading; not waiting for it")

    def _open(self) -> Any:
        try:
            return self._port_factory(self._device, self._baud, READ_TIMEOUT)
        except Exception as error:
            raise PresenceError(_short(error)) from None

    def _run(self, port: Any, on_change: Callable[[bool], None], stop: threading.Event) -> None:
        """The reader thread. `port` is open; it is None between a failure and the next successful open."""
        parser = Ld2410Parser()
        last_report = self._clock()
        silent = False
        # The last failure message, so a failure that goes on and on is a warning once and then debug lines.
        failure: str | None = None
        try:
            while not stop.is_set():
                if port is None:
                    try:
                        port = self._open()
                    except PresenceError as error:
                        failure = self._note_failure(failure, f"Could not open {self._device}: {error}")
                        if stop.wait(self._retry):
                            return
                        continue
                    parser = Ld2410Parser()
                    last_report = self._clock()
                try:
                    data = port.read(READ_SIZE)
                except Exception as error:
                    failure = self._note_failure(failure, f"Lost the LD2410 on {self._device}: {_short(error)}")
                    _close_port(port)
                    port = None
                    if stop.wait(self._retry):
                        return
                    continue
                if failure is not None:
                    logger.info("Reading the LD2410 on %s again", self._device)
                    failure = None
                for report in parser.feed(data):
                    last_report = self._clock()
                    if silent:
                        logger.info("Frames are coming from the LD2410 again")
                        silent = False
                    on_change(report.present)
                if not silent and self._clock() - last_report >= self._silence:
                    silent = True
                    logger.warning(
                        "No frames from the LD2410 on %s for %g s; check the wiring and the baud rate",
                        self._device,
                        self._silence,
                    )
        finally:
            if port is not None:
                _close_port(port)

    def _note_failure(self, previous: str | None, text: str) -> str:
        """Warns about a failure, but not the same one again: a cable that stays out would fill the journal."""
        if text == previous:
            logger.debug("%s", text)
        else:
            logger.warning("%s; trying again in %g s", text, self._retry)
        return text


def _close_port(port: Any) -> None:
    try:
        port.close()
    except Exception as error:
        logger.debug("Could not close the serial port cleanly: %s", _short(error))


def _short(error: Exception) -> str:
    """What went wrong, on one line: the library's message when it has one, otherwise the kind of error."""
    text = " ".join(str(error).split())
    if text == "":
        return type(error).__name__
    return text if len(text) <= MAX_ERROR_TEXT else text[:MAX_ERROR_TEXT] + "..."
