"""The LD2410's frame parser, with byte strings, and its reader thread, against a fake serial port."""

import logging
import threading
import time
from collections import deque
from collections.abc import Callable
from typing import Any

import pytest

from wallcal_agent.hardware import PresenceError
from wallcal_agent.hardware.ld2410 import (
    MAX_FRAME_DATA,
    Ld2410Parser,
    Ld2410Report,
    Ld2410Uart,
)

HEADER = bytes.fromhex("F4F3F2F1")
FOOTER = bytes.fromhex("F8F7F6F5")
ACK_HEADER = bytes.fromhex("FDFCFBFA")
ACK_FOOTER = bytes.fromhex("04030201")


def u16(value: int) -> bytes:
    return value.to_bytes(2, "little")


def frame_of(data: bytes, header: bytes = HEADER, footer: bytes = FOOTER) -> bytes:
    """Wraps `data` as a frame: header, little-endian length, data, footer."""
    return header + u16(len(data)) + data + footer


def basic_data(
    target: int = 0, moving: int = 0, moving_energy: int = 0, still: int = 0, still_energy: int = 0, detect: int = 0
) -> bytes:
    return (
        bytes((0x02, 0xAA, target))
        + u16(moving)
        + bytes((moving_energy,))
        + u16(still)
        + bytes((still_energy,))
        + u16(detect)
        + bytes((0x55, 0x00))
    )


def basic(**fields: int) -> bytes:
    return frame_of(basic_data(**fields))


def engineering(extra: bytes = bytes(range(20)), **fields: int) -> bytes:
    """An engineering report: the basic numbers, then per-gate data, then the tail."""
    data = bytearray(basic_data(**fields))
    data[0] = 0x01
    data[-2:-2] = extra
    return frame_of(bytes(data))


# A frame written out by hand, so a mistake in the helpers above can't hide a mistake in the parser: someone moving
# at 30 cm (energy 50) and someone still at 60 cm (energy 40), the detection distance 58 cm.
HAND_WRITTEN = bytes.fromhex(
    "F4F3F2F1"  # header
    "0D00"  # 13 bytes of data
    "02AA"  # basic report
    "03"  # moving and stationary
    "1E00 32"  # moving: 30 cm, energy 50
    "3C00 28"  # stationary: 60 cm, energy 40
    "3A00"  # detection distance 58 cm
    "5500"  # tail and check
    "F8F7F6F5"  # footer
)

NOBODY = Ld2410Report(0, 0, 0, 0, 0, 0)


# What a frame says


def test_a_basic_report_written_out_in_bytes() -> None:
    reports = Ld2410Parser().feed(HAND_WRITTEN)

    assert reports == [Ld2410Report(3, 30, 50, 60, 40, 58)]
    assert reports[0].engineering is False


def test_the_helper_builds_the_same_bytes_as_the_hand_written_frame() -> None:
    assert basic(target=3, moving=30, moving_energy=50, still=60, still_energy=40, detect=58) == HAND_WRITTEN


@pytest.mark.parametrize(("target", "present"), [(0, False), (1, True), (2, True), (3, True)])
def test_present_means_the_target_state_is_not_zero(target: int, present: bool) -> None:
    (report,) = Ld2410Parser().feed(basic(target=target))

    assert report.target == target
    assert report.present is present


def test_distances_are_two_bytes_little_endian() -> None:
    (report,) = Ld2410Parser().feed(basic(target=1, moving=0x0102, still=0x01FF, detect=0x2710))

    assert (report.moving_distance, report.stationary_distance, report.detection_distance) == (258, 511, 10000)


def test_energies_are_one_byte() -> None:
    (report,) = Ld2410Parser().feed(basic(target=3, moving_energy=100, still_energy=255))

    assert (report.moving_energy, report.stationary_energy) == (100, 255)


def test_an_engineering_report_gives_the_same_numbers_and_is_marked() -> None:
    (report,) = Ld2410Parser().feed(engineering(target=2, still=75, still_energy=33, detect=75))

    assert report == Ld2410Report(2, 0, 0, 75, 33, 75, engineering=True)
    assert report.present is True


def test_an_engineering_report_of_a_different_length_is_fine() -> None:
    # Firmware versions add bytes after the gate numbers. The length field says how many, and the tail is the end.
    for extra in (b"", bytes(18), bytes(22), bytes(100)):
        assert Ld2410Parser().feed(engineering(extra=extra, target=1)) == [
            Ld2410Report(1, 0, 0, 0, 0, 0, engineering=True)
        ]


def test_the_extra_bytes_of_a_basic_report_are_allowed_too() -> None:
    data = basic_data(target=1)
    longer = data[:-2] + b"\x07\x07" + data[-2:]

    assert Ld2410Parser().feed(frame_of(longer)) == [Ld2410Report(1, 0, 0, 0, 0, 0)]


# Several frames, and frames in pieces


def test_two_frames_in_one_read_give_two_reports_in_order() -> None:
    reports = Ld2410Parser().feed(basic(target=1) + basic(target=0))

    assert [r.target for r in reports] == [1, 0]


def test_a_stream_of_many_frames() -> None:
    stream = b"".join(basic(target=i % 4, moving=i) for i in range(100))

    reports = Ld2410Parser().feed(stream)

    assert [(r.target, r.moving_distance) for r in reports] == [(i % 4, i) for i in range(100)]


def test_a_frame_split_at_every_possible_place_still_gives_one_report() -> None:
    frame = basic(target=3, moving=30, moving_energy=50, still=60, still_energy=40, detect=58)

    for cut in range(1, len(frame)):
        parser = Ld2410Parser()
        first = parser.feed(frame[:cut])
        second = parser.feed(frame[cut:])

        assert first == [], cut
        assert second == [Ld2410Report(3, 30, 50, 60, 40, 58)], cut


def test_a_stream_fed_one_byte_at_a_time() -> None:
    parser = Ld2410Parser()
    stream = basic(target=1) + engineering(target=2) + basic(target=0)

    reports = [report for byte in stream for report in parser.feed(bytes((byte,)))]

    assert [r.target for r in reports] == [1, 2, 0]


def test_a_frame_split_in_three_with_a_frame_after() -> None:
    parser = Ld2410Parser()
    stream = basic(target=1) + basic(target=2)

    reports = parser.feed(stream[:7]) + parser.feed(stream[7:30]) + parser.feed(stream[30:])

    assert [r.target for r in reports] == [1, 2]


def test_an_empty_read_gives_nothing() -> None:
    parser = Ld2410Parser()

    assert parser.feed(b"") == []
    assert parser.feed(b"") == []


def test_each_report_is_returned_once() -> None:
    parser = Ld2410Parser()

    assert len(parser.feed(basic(target=1))) == 1
    assert parser.feed(b"") == []
    assert len(parser.feed(basic(target=1))) == 1


# Garbage


def test_garbage_before_a_frame_is_skipped() -> None:
    reports = Ld2410Parser().feed(b"\x00\x13\xff junk \xf4\xf3" + basic(target=1))

    assert [r.target for r in reports] == [1]


def test_garbage_between_frames_is_skipped() -> None:
    reports = Ld2410Parser().feed(basic(target=1) + b"\xde\xad\xbe\xef\xf4" + basic(target=2))

    assert [r.target for r in reports] == [1, 2]


def test_a_stream_that_starts_in_the_middle_of_a_frame_finds_the_next_one() -> None:
    reports = Ld2410Parser().feed(basic(target=3)[9:] + basic(target=1))

    assert [r.target for r in reports] == [1]


def test_only_garbage_gives_nothing_and_does_not_pile_up() -> None:
    parser = Ld2410Parser()

    assert parser.feed(bytes(range(256)) * 400) == []
    # Still working afterwards, and the buffer has not kept all that (it can only hold a header's start).
    assert len(parser._buffer) <= 3
    assert [r.target for r in parser.feed(basic(target=2))] == [2]


def test_a_header_split_across_reads_is_not_lost() -> None:
    parser = Ld2410Parser()
    frame = basic(target=1)

    assert parser.feed(b"garbage" + frame[:2]) == []
    assert parser.feed(frame[2:]) == [Ld2410Report(1, 0, 0, 0, 0, 0)]


def test_a_header_that_is_followed_by_the_start_of_another() -> None:
    # F4 F3 F2 F4 F3 F2 F1 ...: the first three bytes look like a header's start but are not one.
    reports = Ld2410Parser().feed(b"\xf4\xf3\xf2" + basic(target=1))

    assert [r.target for r in reports] == [1]


def test_a_frame_with_a_bad_footer_is_skipped_and_the_next_one_is_found() -> None:
    bad = basic(target=1)[:-1] + b"\x00"

    reports = Ld2410Parser().feed(bad + basic(target=2))

    assert [r.target for r in reports] == [2]


def test_a_good_frame_inside_what_looked_like_a_longer_frame_is_found() -> None:
    # A header that claims 60 bytes, then a real frame: the claimed footer is not there, so the parser must start
    # again just after the false header's first byte and not throw the real frame away with it.
    false_start = HEADER + u16(60)

    reports = Ld2410Parser().feed(false_start + basic(target=1) + basic(target=2) + b"\x00" * 60)

    assert [r.target for r in reports] == [1, 2]


def test_a_frame_that_claims_an_impossible_length_is_skipped_without_waiting_for_it() -> None:
    parser = Ld2410Parser()
    false_start = HEADER + u16(MAX_FRAME_DATA + 1)

    # If the parser waited for 257 bytes the frames after it would not appear until the stream had gone on.
    reports = parser.feed(false_start + basic(target=1))

    assert [r.target for r in reports] == [1]


def test_the_longest_length_allowed_is_waited_for_and_works() -> None:
    padding = bytes(MAX_FRAME_DATA - 13)
    data = basic_data(target=1)
    long_frame = frame_of(data[:-2] + padding + data[-2:])

    assert Ld2410Parser().feed(long_frame) == [Ld2410Report(1, 0, 0, 0, 0, 0)]


def test_a_length_of_ffff_is_noise() -> None:
    reports = Ld2410Parser().feed(HEADER + b"\xff\xff" + basic(target=1))

    assert [r.target for r in reports] == [1]


def test_the_buffer_is_capped_whatever_is_fed() -> None:
    parser = Ld2410Parser()

    # Headers that claim the biggest frame, over and over, with nothing behind them to complete one.
    for _ in range(200):
        parser.feed(HEADER + u16(MAX_FRAME_DATA) + b"\x01" * 50)

    assert len(parser._buffer) <= 6 + MAX_FRAME_DATA + 4
    assert [r.target for r in parser.feed(b"\x00" * 400 + basic(target=2))] == [2]


def test_a_huge_feed_is_handled_in_one_go() -> None:
    parser = Ld2410Parser()

    reports = parser.feed((basic(target=1) + b"\x5a" * 50) * 2000)

    assert len(reports) == 2000
    assert len(parser._buffer) <= 6 + MAX_FRAME_DATA + 4


# Frames that are whole but not reports


@pytest.mark.parametrize(
    "data",
    [
        b"",  # nothing at all
        bytes((0x02, 0xAA)),  # too short
        basic_data(target=1)[:-1],  # one byte short
        bytes((0x03,)) + basic_data(target=1)[1:],  # a data type this does not know
        bytes((0x00,)) + basic_data(target=1)[1:],
        basic_data(target=1)[:1] + b"\xab" + basic_data(target=1)[2:],  # wrong head
        basic_data(target=1)[:-2] + b"\x56\x00",  # wrong tail
        basic_data(target=1)[:-2] + b"\x55\x01",  # wrong check byte
        basic_data(target=4),  # not a target state
        basic_data(target=255),
    ],
    ids=[
        "empty",
        "too-short",
        "one-short",
        "type-3",
        "type-0",
        "bad-head",
        "bad-tail",
        "bad-check",
        "state-4",
        "state-255",
    ],
)
def test_a_whole_frame_whose_data_is_not_a_report_is_skipped(data: bytes) -> None:
    reports = Ld2410Parser().feed(frame_of(data) + basic(target=1))

    assert [r.target for r in reports] == [1]


def test_a_frame_with_a_wrong_length_for_its_data_is_skipped() -> None:
    data = basic_data(target=1)
    # Says 12 bytes where there are 13: the footer is then not where it says, so the frame is not one.
    wrong = HEADER + u16(12) + data + FOOTER

    reports = Ld2410Parser().feed(wrong + basic(target=2))

    assert [r.target for r in reports] == [2]


# Command replies


def test_a_command_reply_is_ignored() -> None:
    # The reply to "enable configuration": command word 01FF with its value bytes.
    ack = frame_of(bytes.fromhex("FF010000 0100 4000"), ACK_HEADER, ACK_FOOTER)

    assert Ld2410Parser().feed(ack) == []


def test_a_command_reply_between_reports_does_not_disturb_them() -> None:
    ack = frame_of(bytes.fromhex("FE0100 00"), ACK_HEADER, ACK_FOOTER)

    reports = Ld2410Parser().feed(basic(target=1) + ack + basic(target=2))

    assert [r.target for r in reports] == [1, 2]


def test_a_command_reply_split_across_reads() -> None:
    parser = Ld2410Parser()
    ack = frame_of(bytes.fromhex("FE0100 00"), ACK_HEADER, ACK_FOOTER)

    assert parser.feed(ack[:3]) == []
    assert parser.feed(ack[3:9]) == []
    assert parser.feed(ack[9:] + basic(target=3)) == [Ld2410Report(3, 0, 0, 0, 0, 0)]


def test_a_command_reply_with_a_report_footer_is_not_a_frame() -> None:
    wrong = frame_of(bytes.fromhex("FE0100 00"), ACK_HEADER, FOOTER)

    assert Ld2410Parser().feed(wrong + basic(target=1)) == [Ld2410Report(1, 0, 0, 0, 0, 0)]


def test_a_report_made_with_a_command_reply_footer_is_not_a_frame() -> None:
    wrong = frame_of(basic_data(target=1), HEADER, ACK_FOOTER)

    assert Ld2410Parser().feed(wrong + basic(target=2)) == [Ld2410Report(2, 0, 0, 0, 0, 0)]


def test_a_report_that_looks_like_a_command_reply_is_not_one() -> None:
    # The data of a report inside a reply's header: it is a reply, so there is no report in it.
    assert Ld2410Parser().feed(frame_of(basic_data(target=1), ACK_HEADER, ACK_FOOTER)) == []


# The reader thread, against a fake port


class FakeSerial:
    """A serial port that hands out what a test queues. `read` blocks briefly when there is nothing, as a real one
    does until its timeout, so the reader thread does not spin.

    Queue bytes for the next reads with `send`, and an exception to be raised by a read with `fail`.
    """

    def __init__(self) -> None:
        self._queue: deque[bytes | Exception] = deque()
        self.closed = False
        self.reads = 0

    def send(self, data: bytes) -> None:
        self._queue.append(data)

    def fail(self, error: Exception) -> None:
        self._queue.append(error)

    def read(self, size: int = 1) -> bytes:
        self.reads += 1
        try:
            item = self._queue.popleft()
        except IndexError:
            time.sleep(0.002)
            return b""
        if isinstance(item, Exception):
            raise item
        return item

    def close(self) -> None:
        self.closed = True


class FakePorts:
    """A port factory: hands out the ports in order (or raises what is queued in their place) and notes each call."""

    def __init__(self, *ports: FakeSerial | Exception) -> None:
        self._ports = deque(ports)
        self.calls: list[tuple[str, int, float]] = []

    def __call__(self, device: str, baud: int, timeout: float) -> FakeSerial:
        self.calls.append((device, baud, timeout))
        item = self._ports.popleft() if self._ports else FakeSerial()
        if isinstance(item, Exception):
            raise item
        return item


class Readings:
    """What the reader reported, from its own thread."""

    def __init__(self) -> None:
        self.seen: list[bool] = []
        self.threads: set[str] = set()

    def __call__(self, present: bool) -> None:
        self.seen.append(present)
        self.threads.add(threading.current_thread().name)


def wait_until(condition: Callable[[], bool], timeout: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(0.002)
    return condition()


def reader(ports: FakePorts, **kwargs: Any) -> Ld2410Uart:
    kwargs.setdefault("retry", 0.01)
    kwargs.setdefault("silence", 1000.0)
    return Ld2410Uart("/dev/serial0", 256000, port_factory=ports, **kwargs)


def test_the_port_is_opened_with_the_device_the_baud_rate_and_a_read_timeout() -> None:
    ports = FakePorts(FakeSerial())
    uart = reader(ports)

    uart.start(Readings())
    uart.close()

    assert ports.calls == [("/dev/serial0", 256000, 1.0)]


def test_every_report_is_passed_on_as_present_or_not_from_the_reader_thread() -> None:
    port = FakeSerial()
    readings = Readings()
    uart = reader(FakePorts(port))
    port.send(basic(target=1) + basic(target=0))
    port.send(basic(target=3))
    uart.start(readings)
    try:
        assert wait_until(lambda: len(readings.seen) == 3)
    finally:
        uart.close()

    # Every report, repeats included: the filter deals with those.
    assert readings.seen == [True, False, True]
    assert readings.threads == {"wallcal-ld2410"}


def test_a_report_split_over_reads_is_put_together() -> None:
    port = FakeSerial()
    readings = Readings()
    uart = reader(FakePorts(port))
    frame = basic(target=2)
    port.send(frame[:5])
    port.send(frame[5:20])
    port.send(frame[20:])
    uart.start(readings)
    try:
        assert wait_until(lambda: readings.seen == [True])
    finally:
        uart.close()


def test_garbage_and_command_replies_report_nothing() -> None:
    port = FakeSerial()
    readings = Readings()
    uart = reader(FakePorts(port))
    port.send(b"\x00\x01\x02 noise " + frame_of(bytes.fromhex("FE0100 00"), ACK_HEADER, ACK_FOOTER))
    port.send(basic(target=1))
    uart.start(readings)
    try:
        assert wait_until(lambda: readings.seen == [True])
    finally:
        uart.close()


def test_a_port_that_cannot_be_opened_is_a_presence_error_with_a_short_message() -> None:
    uart = reader(FakePorts(OSError("could not open port /dev/serial0:\n [Errno 13] Permission denied")))

    with pytest.raises(PresenceError) as error:
        uart.start(Readings())

    assert str(error.value) == "could not open port /dev/serial0: [Errno 13] Permission denied"


def test_an_error_with_no_message_is_reported_by_its_kind() -> None:
    with pytest.raises(PresenceError, match="FileNotFoundError"):
        reader(FakePorts(FileNotFoundError())).start(Readings())


def test_a_very_long_message_is_cut_short() -> None:
    with pytest.raises(PresenceError) as error:
        reader(FakePorts(OSError("x " * 500))).start(Readings())

    assert len(str(error.value)) < 250
    assert str(error.value).endswith("...")


def test_pyserial_missing_is_a_presence_error(monkeypatch: pytest.MonkeyPatch) -> None:
    import sys

    monkeypatch.setitem(sys.modules, "serial", None)

    with pytest.raises(PresenceError):
        Ld2410Uart("/dev/serial0", 256000).start(Readings())


def test_the_real_port_factory_opens_a_port_by_name_with_pyserial(monkeypatch: pytest.MonkeyPatch) -> None:
    import serial

    opened: list[tuple[Any, ...]] = []

    class Port:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            opened.append((args, kwargs))

        def read(self, size: int = 1) -> bytes:
            time.sleep(0.002)
            return b""

        def close(self) -> None:
            pass

    monkeypatch.setattr(serial, "Serial", Port)
    uart = Ld2410Uart("/dev/ttyUSB0", 115200)

    uart.start(Readings())
    uart.close()

    assert opened == [(("/dev/ttyUSB0", 115200), {"timeout": 1.0})]


def test_a_missing_device_is_a_presence_error_from_pyserial_itself() -> None:
    with pytest.raises(PresenceError) as error:
        Ld2410Uart("/dev/no-such-serial-port", 256000).start(Readings())

    assert "no-such-serial-port" in str(error.value)
    assert "\n" not in str(error.value)


def test_close_stops_the_thread_and_closes_the_port() -> None:
    port = FakeSerial()
    uart = reader(FakePorts(port))
    uart.start(Readings())
    thread = next(t for t in threading.enumerate() if t.name == "wallcal-ld2410")
    assert thread.daemon

    uart.close()

    assert not thread.is_alive()
    assert port.closed is True


def test_close_twice_or_before_start_is_harmless() -> None:
    uart = reader(FakePorts(FakeSerial()))

    uart.close()
    uart.start(Readings())
    uart.close()
    uart.close()


def test_nothing_is_reported_after_close() -> None:
    port = FakeSerial()
    readings = Readings()
    uart = reader(FakePorts(port))
    uart.start(readings)
    uart.close()

    port.send(basic(target=1))
    time.sleep(0.05)

    assert readings.seen == []


def test_starting_again_lets_go_of_the_first_port() -> None:
    first, second = FakeSerial(), FakeSerial()
    readings = Readings()
    uart = reader(FakePorts(first, second))

    uart.start(readings)
    uart.start(readings)
    try:
        assert first.closed is True
        assert second.closed is False
        second.send(basic(target=1))
        assert wait_until(lambda: readings.seen == [True])
    finally:
        uart.close()


# A port that fails later


def test_a_read_error_is_one_warning_and_the_port_is_closed_and_opened_again(caplog: pytest.LogCaptureFixture) -> None:
    first, second = FakeSerial(), FakeSerial()
    ports = FakePorts(first, second)
    readings = Readings()
    uart = reader(ports)
    first.send(basic(target=1))
    first.fail(OSError("device disconnected or multiple access on port?"))
    second.send(basic(target=0))
    caplog.set_level(logging.INFO)

    uart.start(readings)
    try:
        assert wait_until(lambda: readings.seen == [True, False])
    finally:
        uart.close()

    assert first.closed is True
    assert len(ports.calls) == 2
    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert warnings == [
        "Lost the LD2410 on /dev/serial0: device disconnected or multiple access on port?; trying again in 0.01 s"
    ]
    assert "Reading the LD2410 on /dev/serial0 again" in caplog.text


def test_the_last_reading_stands_while_the_port_is_down() -> None:
    first = FakeSerial()
    readings = Readings()
    ports = FakePorts(first, OSError("gone"), OSError("gone"), OSError("gone"))
    uart = reader(ports, retry=0.005)
    first.send(basic(target=1))
    first.fail(OSError("gone"))

    uart.start(readings)
    try:
        assert wait_until(lambda: len(ports.calls) >= 4)
    finally:
        uart.close()

    # Only what the sensor said: nothing was invented for the time it could not be heard.
    assert readings.seen == [True]


def test_a_port_that_stays_broken_warns_once_and_then_logs_at_debug(caplog: pytest.LogCaptureFixture) -> None:
    first = FakeSerial()
    ports = FakePorts(first, *[OSError("no such device") for _ in range(6)], FakeSerial())
    uart = reader(ports, retry=0.002)
    first.fail(OSError("no such device"))
    caplog.set_level(logging.DEBUG)

    uart.start(Readings())
    try:
        assert wait_until(lambda: len(ports.calls) >= 8)
    finally:
        uart.close()

    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    # The loss, then the first failure to open (a different message), and the rest of the same at debug.
    assert warnings == [
        "Lost the LD2410 on /dev/serial0: no such device; trying again in 0.002 s",
        "Could not open /dev/serial0: no such device; trying again in 0.002 s",
    ]
    debug = [r.getMessage() for r in caplog.records if r.levelno == logging.DEBUG]
    assert debug.count("Could not open /dev/serial0: no such device") >= 4


def test_a_port_that_opens_but_fails_every_read_warns_only_once(caplog: pytest.LogCaptureFixture) -> None:
    ports_made: list[FakeSerial] = []

    def factory(device: str, baud: int, timeout: float) -> FakeSerial:
        port = FakeSerial()
        port.fail(OSError("input/output error"))
        ports_made.append(port)
        return port

    uart = Ld2410Uart("/dev/serial0", 256000, port_factory=factory, retry=0.002, silence=1000.0)
    caplog.set_level(logging.DEBUG)

    uart.start(Readings())
    try:
        assert wait_until(lambda: len(ports_made) >= 5)
    finally:
        uart.close()

    assert len([r for r in caplog.records if r.levelno == logging.WARNING]) == 1
    assert all(port.closed for port in ports_made[:4])


def test_after_a_recovery_the_next_failure_warns_again(caplog: pytest.LogCaptureFixture) -> None:
    first, second, third = FakeSerial(), FakeSerial(), FakeSerial()
    readings = Readings()
    uart = reader(FakePorts(first, second, third))
    first.fail(OSError("gone"))
    second.send(basic(target=1))
    caplog.set_level(logging.INFO)

    uart.start(readings)
    try:
        assert wait_until(lambda: readings.seen == [True])
        second.fail(OSError("gone"))
        assert wait_until(lambda: second.closed)
    finally:
        uart.close()

    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 2


def test_closing_while_waiting_to_retry_does_not_wait_for_the_retry() -> None:
    first = FakeSerial()
    uart = reader(FakePorts(first, OSError("gone")), retry=60.0)
    first.fail(OSError("gone"))
    uart.start(Readings())
    time.sleep(0.05)

    before = time.monotonic()
    uart.close()

    assert time.monotonic() - before < 1.5


def test_a_parser_state_from_before_a_failure_does_not_leak_into_the_new_port() -> None:
    first, second = FakeSerial(), FakeSerial()
    readings = Readings()
    uart = reader(FakePorts(first, second))
    # The first port dies half way through a frame; the second's first frame must not be glued to it.
    first.send(basic(target=1)[:10])
    first.fail(OSError("gone"))
    second.send(basic(target=0))
    uart.start(readings)
    try:
        assert wait_until(lambda: readings.seen == [False])
    finally:
        uart.close()


# Silence


class StepClock:
    """A clock the test moves by hand."""

    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_ten_seconds_with_no_report_is_one_warning_and_a_report_after_it_is_one_info(
    caplog: pytest.LogCaptureFixture,
) -> None:
    port = FakeSerial()
    clock = StepClock()
    readings = Readings()
    uart = reader(FakePorts(port), silence=10.0, clock=clock)
    caplog.set_level(logging.INFO)

    uart.start(readings)
    try:
        clock.now = 9.0
        time.sleep(0.05)
        assert not [r for r in caplog.records if r.levelno == logging.WARNING]

        clock.now = 10.0
        assert wait_until(lambda: any(r.levelno == logging.WARNING for r in caplog.records))
        clock.now = 30.0
        time.sleep(0.05)
        port.send(basic(target=1))
        assert wait_until(lambda: readings.seen == [True])
    finally:
        uart.close()

    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert warnings == ["No frames from the LD2410 on /dev/serial0 for 10 s; check the wiring and the baud rate"]
    assert "Frames are coming from the LD2410 again" in caplog.text
    # Nothing was reported for the silence, and the reading that was there stands.
    assert readings.seen == [True]


def test_noise_and_command_replies_do_not_count_as_reports(caplog: pytest.LogCaptureFixture) -> None:
    port = FakeSerial()
    clock = StepClock()
    uart = reader(FakePorts(port), silence=10.0, clock=clock)
    caplog.set_level(logging.INFO)

    uart.start(Readings())
    try:
        clock.now = 5.0
        port.send(b"\x00\x01\x02\x03" * 10)
        clock.now = 11.0
        assert wait_until(lambda: any(r.levelno == logging.WARNING for r in caplog.records))
    finally:
        uart.close()


def test_a_steady_stream_never_warns_of_silence(caplog: pytest.LogCaptureFixture) -> None:
    port = FakeSerial()
    clock = StepClock()
    readings = Readings()
    uart = reader(FakePorts(port), silence=10.0, clock=clock)
    caplog.set_level(logging.INFO)

    uart.start(readings)
    try:
        for second in range(1, 60):
            clock.now = float(second)
            port.send(basic(target=second % 2))
            assert wait_until(lambda n=second: len(readings.seen) == n)
    finally:
        uart.close()

    assert not [r for r in caplog.records if r.levelno == logging.WARNING]


def test_the_silence_clock_starts_again_when_the_port_is_reopened(caplog: pytest.LogCaptureFixture) -> None:
    first, second = FakeSerial(), FakeSerial()
    clock = StepClock()
    ports = FakePorts(first, second)
    uart = reader(ports, silence=10.0, clock=clock)
    caplog.set_level(logging.INFO)

    uart.start(Readings())
    try:
        clock.now = 9.0
        first.fail(OSError("gone"))
        assert wait_until(lambda: len(ports.calls) == 2)
        clock.now = 15.0  # 15 s since the first open, but only 6 s since the second
        time.sleep(0.05)
    finally:
        uart.close()

    assert not [r for r in caplog.records if "No frames" in r.getMessage()]
