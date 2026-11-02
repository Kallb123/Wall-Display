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
    ...           engineering data, type 01 only
    55 00         tail and check (the check byte is always 00)

The sensor also answers the commands it is sent, in frames with their own header (FD FC FB FA). Nothing here sends
commands, so those are skipped.
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
    # Whether it was an engineering report. Its extra per-gate numbers are not kept: nothing here needs them.
    engineering: bool = False

    @property
    def present(self) -> bool:
        """Whether the sensor sees someone, moving or still."""
        return self.target != 0


class Ld2410Parser:
    """Finds report frames in a stream of bytes. Pure: no I/O, no clock.

    Bytes arrive in whatever pieces the serial port gives them, so a frame may be split anywhere, and the stream may
    start in the middle of one or hold garbage (a baud rate that was wrong for a while, a sensor that was switched
    on mid-frame). `feed` keeps what it hasn't used yet and picks up from there. It never raises on any input.
    """

    def __init__(self) -> None:
        self._buffer = bytearray()

    def feed(self, data: bytes) -> list[Ld2410Report]:
        """Takes the next bytes, and returns the reports they complete, in order. Each is returned once."""
        self._buffer += data
        reports: list[Ld2410Report] = []
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
    return Ld2410Report(
        target=target,
        moving_distance=data[3] | data[4] << 8,
        moving_energy=data[5],
        stationary_distance=data[6] | data[7] << 8,
        stationary_energy=data[8],
        detection_distance=data[9] | data[10] << 8,
        engineering=data[0] == TYPE_ENGINEERING,
    )


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
