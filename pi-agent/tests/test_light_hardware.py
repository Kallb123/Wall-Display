"""The light sensor's fake and the two real chips, driven through a fake I2C bus. Nothing here touches a real bus."""

import ctypes
import math
from typing import Any

import pytest

from wallcal_agent.config import Config, LightConfig, MqttConfig, SensorsConfig
from wallcal_agent.hardware import LightError, build_hardware
from wallcal_agent.hardware import light as light_module
from wallcal_agent.hardware.fake import FakeLight
from wallcal_agent.hardware.light import (
    VEML_HIGH,
    VEML_LOW,
    VEML_RANGE_DOWN,
    VEML_RANGE_UP,
    Bh1750,
    Veml7700,
    bh1750_lux,
    veml7700_lux,
    veml7700_range_for,
    veml7700_resolution,
)

ALS_CONF = 0x00
ALS = 0x04
LOW_CONFIG = 0x0840
HIGH_CONFIG = 0x1000


class FakeBus:
    """Stands in for smbus2's SMBus: records every call and answers reads from a script.

    `words` is what `read_word_data` returns, in order (a VEML7700's raw counts), and `data` is what a two-byte
    `i2c_rdwr` read fills in (a BH1750's bytes). `error` is raised by every call that talks to the chip, and
    `close_error` by `close`.
    """

    def __init__(self, words: list[int] | None = None, data: bytes = b"\x00\x00") -> None:
        self.words = list(words or [])
        self.data = data
        self.error: Exception | None = None
        self.close_error: Exception | None = None
        self.calls: list[tuple[Any, ...]] = []
        self.messages: list[Any] = []
        self.closed = False

    def _talk(self, *call: Any) -> None:
        self.calls.append(call)
        if self.error is not None:
            raise self.error

    def write_word_data(self, address: int, register: int, value: int) -> None:
        self._talk("write_word_data", address, register, value)

    def read_word_data(self, address: int, register: int) -> int:
        self._talk("read_word_data", address, register)
        assert self.words, "the test gave the bus no more readings"
        return self.words.pop(0)

    def write_byte(self, address: int, value: int) -> None:
        self._talk("write_byte", address, value)

    def i2c_rdwr(self, *messages: Any) -> None:
        self._talk("i2c_rdwr", len(messages))
        for message in messages:
            self.messages.append((message.addr, message.len, message.flags))
            ctypes.memmove(message.buf, self.data, message.len)

    def close(self) -> None:
        self.calls.append(("close",))
        self.closed = True
        if self.close_error is not None:
            raise self.close_error


class Buses:
    """A factory of fake buses. Each call opens a new one, so a test can see a bus being opened again."""

    def __init__(self, *buses: FakeBus) -> None:
        self.queue = list(buses)
        self.opened: list[int] = []
        self.error: Exception | None = None

    def __call__(self, number: int) -> FakeBus:
        self.opened.append(number)
        if self.error is not None:
            raise self.error
        return self.queue.pop(0) if self.queue else FakeBus()


def veml(fake: FakeBus, sleeps: list[float] | None = None, bus: int = 1) -> tuple[Veml7700, Buses]:
    buses = Buses(fake)
    sensor = Veml7700(
        bus, 0x10, smbus_factory=buses, sleep=sleeps.append if sleeps is not None else (lambda seconds: None)
    )
    return sensor, buses


def bh(fake: FakeBus, sleeps: list[float] | None = None, address: int = 0x23) -> tuple[Bh1750, Buses]:
    buses = Buses(fake)
    sensor = Bh1750(
        1, address, smbus_factory=buses, sleep=sleeps.append if sleeps is not None else (lambda seconds: None)
    )
    return sensor, buses


# The fake sensor


def test_fake_light_reads_what_it_was_given_and_counts_the_reads() -> None:
    fake = FakeLight(lux=150.0)

    assert fake.read_lux() == 150.0
    fake.lux = 3.5
    assert fake.read_lux() == 3.5
    assert fake.read_count == 2


def test_fake_light_with_nothing_to_read_fails_with_no_reading() -> None:
    fake = FakeLight()

    with pytest.raises(LightError, match="no reading"):
        fake.read_lux()
    assert fake.read_count == 1


def test_fake_light_can_be_told_to_fail_and_to_recover() -> None:
    fake = FakeLight(lux=10.0)
    fake.error = "the wire is loose"

    with pytest.raises(LightError, match="the wire is loose"):
        fake.read_lux()

    fake.error = None
    assert fake.read_lux() == 10.0


def test_fake_light_records_being_closed() -> None:
    fake = FakeLight(lux=1.0)
    assert fake.closed is False

    fake.close()

    assert fake.closed is True


# The VEML7700's arithmetic, which is pure


def test_the_resolution_is_finer_with_a_higher_gain_and_a_longer_integration_time() -> None:
    assert veml7700_resolution(gain=2, integration_ms=800) == pytest.approx(0.0042)
    assert veml7700_resolution(gain=1, integration_ms=800) == pytest.approx(0.0084)
    assert veml7700_resolution(gain=2, integration_ms=400) == pytest.approx(0.0084)
    assert veml7700_resolution(gain=0.125, integration_ms=800) == pytest.approx(0.0672)


def test_the_two_ranges_have_the_resolutions_in_the_plan() -> None:
    assert veml7700_resolution(VEML_LOW.gain, VEML_LOW.integration_ms) == pytest.approx(0.0168)
    assert veml7700_resolution(VEML_HIGH.gain, VEML_HIGH.integration_ms) == pytest.approx(0.5376)


def test_the_two_ranges_write_the_gain_and_the_integration_time_to_the_right_bits() -> None:
    # Gain x2 is 01 in bits 12 and 11, and 200 ms is 0001 in bits 9 to 6.
    assert VEML_LOW.config == LOW_CONFIG
    assert (VEML_LOW.config >> 11) & 0b11 == 0b01
    assert (VEML_LOW.config >> 6) & 0b1111 == 0b0001
    # Gain x1/8 is 10, and 100 ms is 0000.
    assert VEML_HIGH.config == HIGH_CONFIG
    assert (VEML_HIGH.config >> 11) & 0b11 == 0b10
    assert (VEML_HIGH.config >> 6) & 0b1111 == 0b0000
    # Neither sets persistence (bits 5 and 4), the interrupt (bit 1) or shutdown (bit 0): the chip is on.
    for setting in (VEML_LOW, VEML_HIGH):
        assert setting.config & 0b11_0011 == 0


@pytest.mark.parametrize(("raw", "lux"), [(0, 0.0), (1, 0.0168), (1000, 16.8), (50000, 840.0), (65535, 1100.988)])
def test_the_low_range_is_a_straight_line(raw: int, lux: float) -> None:
    assert veml7700_lux(raw, VEML_LOW) == pytest.approx(lux)


@pytest.mark.parametrize("raw", [1, 1000, 20000, 65535])
def test_the_high_range_applies_vishays_correction_to_the_straight_line(raw: int) -> None:
    linear = raw * 0.5376
    expected = 6.0135e-13 * linear**4 - 9.3924e-9 * linear**3 + 8.1488e-5 * linear**2 + 1.0023 * linear

    assert veml7700_lux(raw, VEML_HIGH) == pytest.approx(expected)


def test_the_high_range_reads_nothing_as_nothing() -> None:
    assert veml7700_lux(0, VEML_HIGH) == 0.0


def test_the_correction_raises_the_high_range_reading_and_more_so_the_brighter_it_is() -> None:
    low_end = veml7700_lux(1000, VEML_HIGH) / (1000 * 0.5376)
    top = veml7700_lux(65535, VEML_HIGH) / (65535 * 0.5376)

    assert 1.0 < low_end < top


def test_the_low_range_is_not_corrected() -> None:
    assert veml7700_lux(65535, VEML_LOW) == pytest.approx(65535 * 0.0168, rel=1e-12)


@pytest.mark.parametrize(
    ("current", "raw", "expected"),
    [
        (VEML_LOW, 0, VEML_LOW),
        (VEML_LOW, 1000, VEML_LOW),
        (VEML_LOW, VEML_RANGE_UP - 1, VEML_LOW),
        (VEML_LOW, VEML_RANGE_UP, VEML_HIGH),
        (VEML_LOW, 65535, VEML_HIGH),
        (VEML_HIGH, 65535, VEML_HIGH),
        (VEML_HIGH, VEML_RANGE_UP, VEML_HIGH),
        (VEML_HIGH, VEML_RANGE_DOWN + 1, VEML_HIGH),
        (VEML_HIGH, VEML_RANGE_DOWN, VEML_LOW),
        (VEML_HIGH, 0, VEML_LOW),
    ],
)
def test_the_range_goes_up_at_a_count_of_50000_and_back_down_at_1000(current: Any, raw: int, expected: Any) -> None:
    assert veml7700_range_for(current, raw) is expected


def test_the_two_switch_points_are_far_enough_apart_in_lux_that_a_room_cannot_flip_between_them() -> None:
    up_at = veml7700_lux(VEML_RANGE_UP, VEML_LOW)
    down_at = veml7700_lux(VEML_RANGE_DOWN, VEML_HIGH)

    assert down_at < up_at
    # Just after going up, the room reads well clear of the count that would send it down again.
    assert up_at / veml7700_resolution(VEML_HIGH.gain, VEML_HIGH.integration_ms) > 1.4 * VEML_RANGE_DOWN


# The VEML7700 on a fake bus


def test_building_a_veml7700_opens_nothing() -> None:
    sensor, buses = veml(FakeBus())

    assert buses.opened == []
    sensor.close()
    assert buses.opened == []


def test_the_first_reading_opens_the_bus_switches_the_chip_on_and_waits_a_conversion() -> None:
    bus = FakeBus(words=[1000])
    sleeps: list[float] = []
    sensor, buses = veml(bus, sleeps, bus=3)

    lux = sensor.read_lux()

    assert buses.opened == [3]
    assert bus.calls == [("write_word_data", 0x10, ALS_CONF, LOW_CONFIG), ("read_word_data", 0x10, ALS)]
    # The low range integrates for 200 ms; with a little to spare.
    assert sleeps == [pytest.approx(0.21)]
    assert lux == pytest.approx(16.8)


def test_later_readings_just_read() -> None:
    bus = FakeBus(words=[1000, 2000, 3000])
    sleeps: list[float] = []
    sensor, buses = veml(bus, sleeps)

    readings = [sensor.read_lux() for _ in range(3)]

    assert readings == [pytest.approx(16.8), pytest.approx(33.6), pytest.approx(50.4)]
    assert buses.opened == [1]
    assert [call[0] for call in bus.calls] == ["write_word_data", "read_word_data", "read_word_data", "read_word_data"]
    assert len(sleeps) == 1


def test_a_bright_reading_moves_to_the_high_range_and_is_read_again_before_it_is_returned() -> None:
    bus = FakeBus(words=[65535, 3000])
    sleeps: list[float] = []
    sensor, _ = veml(bus, sleeps)

    lux = sensor.read_lux()

    assert bus.calls == [
        ("write_word_data", 0x10, ALS_CONF, LOW_CONFIG),
        ("read_word_data", 0x10, ALS),
        ("write_word_data", 0x10, ALS_CONF, HIGH_CONFIG),
        ("read_word_data", 0x10, ALS),
    ]
    # The reading that came back is the one made in the high range, never the saturated one from the low.
    assert lux == pytest.approx(veml7700_lux(3000, VEML_HIGH))
    assert lux != pytest.approx(veml7700_lux(65535, VEML_LOW))
    # The first wait was for the low range's 200 ms, the second for the high range's 100 ms.
    assert sleeps == [pytest.approx(0.21), pytest.approx(0.11)]


def test_it_stays_in_the_high_range_while_the_light_is_bright() -> None:
    bus = FakeBus(words=[50000, 3000, 4000, 20000])
    sensor, _ = veml(bus)

    readings = [sensor.read_lux() for _ in range(3)]

    assert readings == [
        pytest.approx(veml7700_lux(3000, VEML_HIGH)),
        pytest.approx(veml7700_lux(4000, VEML_HIGH)),
        pytest.approx(veml7700_lux(20000, VEML_HIGH)),
    ]
    writes = [call for call in bus.calls if call[0] == "write_word_data"]
    assert [call[3] for call in writes] == [LOW_CONFIG, HIGH_CONFIG]


def test_a_dim_reading_in_the_high_range_moves_back_to_the_low_range_and_is_read_again() -> None:
    bus = FakeBus(words=[60000, 3000, 1000, 5000])
    sleeps: list[float] = []
    sensor, _ = veml(bus, sleeps)
    sensor.read_lux()

    lux = sensor.read_lux()

    assert [call[3] for call in bus.calls if call[0] == "write_word_data"] == [LOW_CONFIG, HIGH_CONFIG, LOW_CONFIG]
    assert bus.calls[-2:] == [("write_word_data", 0x10, ALS_CONF, LOW_CONFIG), ("read_word_data", 0x10, ALS)]
    assert lux == pytest.approx(veml7700_lux(5000, VEML_LOW))
    assert sleeps[-1] == pytest.approx(0.21)
    # And the next reading is a low-range one.
    bus.words.append(2000)
    assert sensor.read_lux() == pytest.approx(veml7700_lux(2000, VEML_LOW))


def test_a_call_switches_range_at_most_once() -> None:
    # Saturated in the low range, and the fresh reading in the high range is itself low enough to go back down. It is
    # returned as it is; the next call decides.
    bus = FakeBus(words=[65535, 900, 800, 700])
    sensor, _ = veml(bus)

    first = sensor.read_lux()
    assert first == pytest.approx(veml7700_lux(900, VEML_HIGH))
    assert [call[3] for call in bus.calls if call[0] == "write_word_data"] == [LOW_CONFIG, HIGH_CONFIG]

    second = sensor.read_lux()
    assert second == pytest.approx(veml7700_lux(700, VEML_LOW))
    assert [call[3] for call in bus.calls if call[0] == "write_word_data"] == [LOW_CONFIG, HIGH_CONFIG, LOW_CONFIG]


def test_a_reading_exactly_at_the_switch_points_switches() -> None:
    up = FakeBus(words=[VEML_RANGE_UP, 2000])
    sensor, _ = veml(up)
    sensor.read_lux()
    assert up.calls[-2] == ("write_word_data", 0x10, ALS_CONF, HIGH_CONFIG)

    stays = FakeBus(words=[VEML_RANGE_UP - 1])
    sensor, _ = veml(stays)
    sensor.read_lux()
    assert [call[0] for call in stays.calls] == ["write_word_data", "read_word_data"]


def test_a_darkness_reading_is_zero_lux() -> None:
    sensor, _ = veml(FakeBus(words=[0]))

    assert sensor.read_lux() == 0.0


def test_a_failed_read_is_a_light_error_and_the_bus_is_closed() -> None:
    bus = FakeBus(words=[1000])
    sensor, _ = veml(bus)
    sensor.read_lux()
    bus.error = OSError(121, "Remote I/O error")

    with pytest.raises(LightError) as error:
        sensor.read_lux()

    assert "Remote I/O error" in str(error.value)
    assert bus.closed is True


def test_the_next_read_after_a_failure_opens_the_bus_again_and_sets_the_chip_up_again() -> None:
    first = FakeBus(words=[1000])
    second = FakeBus(words=[2000])
    buses = Buses(first, second)
    sleeps: list[float] = []
    sensor = Veml7700(1, 0x10, smbus_factory=buses, sleep=sleeps.append)
    sensor.read_lux()
    first.error = OSError(5, "Input/output error")
    with pytest.raises(LightError):
        sensor.read_lux()

    lux = sensor.read_lux()

    assert buses.opened == [1, 1]
    assert second.calls == [("write_word_data", 0x10, ALS_CONF, LOW_CONFIG), ("read_word_data", 0x10, ALS)]
    assert lux == pytest.approx(33.6)
    assert len(sleeps) == 2


def test_after_a_failure_the_chip_starts_again_from_the_low_range_whatever_range_it_was_in() -> None:
    first = FakeBus(words=[65535, 3000])
    second = FakeBus(words=[500])
    buses = Buses(first, second)
    sensor = Veml7700(1, 0x10, smbus_factory=buses, sleep=lambda seconds: None)
    sensor.read_lux()
    first.error = OSError(5, "Input/output error")
    with pytest.raises(LightError):
        sensor.read_lux()

    lux = sensor.read_lux()

    # 500 is a low-range count (8.4 lx). In the high range it would be 270 lx.
    assert lux == pytest.approx(8.4)
    assert second.calls[0] == ("write_word_data", 0x10, ALS_CONF, LOW_CONFIG)


def test_a_failure_while_setting_the_chip_up_is_a_light_error_and_the_bus_is_closed() -> None:
    bus = FakeBus()
    bus.error = OSError(121, "Remote I/O error")
    sensor, buses = veml(bus)

    with pytest.raises(LightError, match="Remote I/O error"):
        sensor.read_lux()

    assert bus.closed is True
    # And it tries again from the beginning on the next read.
    bus.error = None
    bus.words.append(1000)
    buses.queue.append(bus)
    assert sensor.read_lux() == pytest.approx(16.8)
    assert buses.opened == [1, 1]


def test_a_failure_in_the_middle_of_a_range_change_is_a_light_error() -> None:
    bus = FakeBus(words=[65535])
    sensor, _ = veml(bus)

    original = bus.write_word_data

    def fail_on_the_second_write(address: int, register: int, value: int) -> None:
        if value == HIGH_CONFIG:
            raise OSError(5, "Input/output error")
        original(address, register, value)

    bus.write_word_data = fail_on_the_second_write  # type: ignore[method-assign]

    with pytest.raises(LightError, match="Input/output error"):
        sensor.read_lux()

    assert bus.closed is True


# What a failure to open says


def test_a_missing_bus_says_to_switch_i2c_on() -> None:
    buses = Buses()
    buses.error = FileNotFoundError(2, "No such file or directory: '/dev/i2c-1'")
    sensor = Veml7700(1, 0x10, smbus_factory=buses, sleep=lambda seconds: None)

    with pytest.raises(LightError) as error:
        sensor.read_lux()

    assert str(error.value) == "/dev/i2c-1 is not there; is I2C switched on in raspi-config?"


def test_the_message_for_a_missing_bus_names_the_bus_that_was_asked_for() -> None:
    buses = Buses()
    buses.error = FileNotFoundError(2, "No such file or directory")
    sensor = Veml7700(4, 0x10, smbus_factory=buses, sleep=lambda seconds: None)

    with pytest.raises(LightError, match=r"/dev/i2c-4 is not there"):
        sensor.read_lux()


def test_a_bus_the_service_user_may_not_open_says_to_check_the_i2c_group() -> None:
    buses = Buses()
    buses.error = PermissionError(13, "Permission denied")
    sensor = Veml7700(1, 0x10, smbus_factory=buses, sleep=lambda seconds: None)

    with pytest.raises(LightError) as error:
        sensor.read_lux()

    assert str(error.value) == "no permission for /dev/i2c-1; is the service user in the i2c group?"


def test_other_os_errors_give_the_librarys_own_short_message() -> None:
    buses = Buses()
    buses.error = OSError(16, "Device or resource busy")
    sensor = Veml7700(1, 0x10, smbus_factory=buses, sleep=lambda seconds: None)

    with pytest.raises(LightError) as error:
        sensor.read_lux()

    assert str(error.value) == "[Errno 16] Device or resource busy"


def test_an_error_with_no_message_is_reported_by_its_kind() -> None:
    buses = Buses()
    buses.error = OSError()
    sensor = Veml7700(1, 0x10, smbus_factory=buses, sleep=lambda seconds: None)

    with pytest.raises(LightError) as error:
        sensor.read_lux()

    assert str(error.value) == "OSError"


def test_a_very_long_message_is_cut_short_and_kept_to_one_line() -> None:
    buses = Buses()
    buses.error = OSError("first line\n" + "x" * 500)
    sensor = Veml7700(1, 0x10, smbus_factory=buses, sleep=lambda seconds: None)

    with pytest.raises(LightError) as error:
        sensor.read_lux()

    assert "\n" not in str(error.value)
    assert len(str(error.value)) <= light_module.MAX_ERROR_TEXT + 3
    assert str(error.value).endswith("...")


def test_a_missing_smbus2_library_is_a_light_error_and_not_a_crash(monkeypatch: pytest.MonkeyPatch) -> None:
    # A None entry makes `import smbus2` raise ImportError, as if it were not installed.
    monkeypatch.setitem(__import__("sys").modules, "smbus2", None)
    sensor = Veml7700(1, 0x10, sleep=lambda seconds: None)

    with pytest.raises(LightError, match="smbus2 library is not installed"):
        sensor.read_lux()


def test_the_light_error_does_not_chain_the_librarys_traceback() -> None:
    buses = Buses()
    buses.error = OSError(5, "Input/output error")
    sensor = Veml7700(1, 0x10, smbus_factory=buses, sleep=lambda seconds: None)

    with pytest.raises(LightError) as error:
        sensor.read_lux()

    assert error.value.__cause__ is None
    assert error.value.__suppress_context__ is True


# Closing


def test_close_lets_go_of_the_bus() -> None:
    bus = FakeBus(words=[1000])
    sensor, _ = veml(bus)
    sensor.read_lux()

    sensor.close()

    assert bus.closed is True


def test_close_twice_or_before_the_first_read_is_harmless() -> None:
    sensor, buses = veml(FakeBus(words=[1000]))

    sensor.close()
    sensor.read_lux()
    sensor.close()
    sensor.close()

    assert buses.opened == [1]


def test_a_read_after_close_opens_the_bus_again() -> None:
    first = FakeBus(words=[1000])
    second = FakeBus(words=[2000])
    buses = Buses(first, second)
    sensor = Veml7700(1, 0x10, smbus_factory=buses, sleep=lambda seconds: None)
    sensor.read_lux()
    sensor.close()

    assert sensor.read_lux() == pytest.approx(33.6)
    assert buses.opened == [1, 1]


def test_a_bus_that_will_not_close_cleanly_is_not_an_error(caplog: pytest.LogCaptureFixture) -> None:
    bus = FakeBus(words=[1000])
    bus.close_error = OSError(9, "Bad file descriptor")
    sensor, _ = veml(bus)
    sensor.read_lux()

    with caplog.at_level("DEBUG", logger="wallcal_agent.hardware.light"):
        sensor.close()

    assert "Could not close the I2C bus cleanly: [Errno 9] Bad file descriptor" in caplog.text


def test_a_failed_close_does_not_hide_the_read_error() -> None:
    bus = FakeBus(words=[1000])
    bus.close_error = OSError(9, "Bad file descriptor")
    sensor, _ = veml(bus)
    sensor.read_lux()
    bus.error = OSError(121, "Remote I/O error")

    with pytest.raises(LightError, match="Remote I/O error"):
        sensor.read_lux()


# The BH1750


@pytest.mark.parametrize(
    ("high", "low", "lux"),
    [
        (0x00, 0x00, 0.0),
        (0x00, 0x01, 1 / 2.4),
        (0x01, 0x2C, 125.0),
        (0x01, 0x00, 256 / 2.4),
        (0xFF, 0xFF, 65535 / 2.4),
    ],
)
def test_the_two_bytes_are_a_count_high_byte_first_and_a_count_is_two_and_a_half_tenths_of_a_lux(
    high: int, low: int, lux: float
) -> None:
    assert bh1750_lux(high, low) == pytest.approx(lux)


def test_a_full_scale_bh1750_reads_about_27_klux() -> None:
    assert 27000 < bh1750_lux(0xFF, 0xFF) < 27500


def test_building_a_bh1750_opens_nothing() -> None:
    sensor, buses = bh(FakeBus())

    sensor.close()

    assert buses.opened == []


def test_the_first_reading_powers_the_chip_on_starts_continuous_high_resolution_mode_2_and_waits() -> None:
    bus = FakeBus(data=b"\x01\x2c")
    sleeps: list[float] = []
    sensor, buses = bh(bus, sleeps)

    lux = sensor.read_lux()

    assert buses.opened == [1]
    assert bus.calls == [("write_byte", 0x23, 0x01), ("write_byte", 0x23, 0x11), ("i2c_rdwr", 1)]
    # The slowest the first measurement can take.
    assert sleeps == [pytest.approx(0.18)]
    assert lux == pytest.approx(125.0)


def test_a_reading_is_a_two_byte_read_with_no_command_byte_at_the_chips_address() -> None:
    bus = FakeBus(data=b"\x00\x10")
    sensor, _ = bh(bus, address=0x5C)

    sensor.read_lux()

    # (address, length, flags): flag 1 is I2C_M_RD, a read.
    assert bus.messages == [(0x5C, 2, 1)]
    assert [call[0] for call in bus.calls] == ["write_byte", "write_byte", "i2c_rdwr"]
    assert bus.calls[0][1] == 0x5C


def test_later_bh1750_readings_just_read() -> None:
    bus = FakeBus(data=b"\x00\x10")
    sleeps: list[float] = []
    sensor, _ = bh(bus, sleeps)

    sensor.read_lux()
    bus.data = b"\x02\x00"
    lux = sensor.read_lux()

    assert lux == pytest.approx(512 / 2.4)
    assert [call[0] for call in bus.calls] == ["write_byte", "write_byte", "i2c_rdwr", "i2c_rdwr"]
    assert len(sleeps) == 1


def test_a_bh1750_that_fails_is_closed_and_set_up_again_on_the_next_read() -> None:
    first = FakeBus(data=b"\x00\x10")
    second = FakeBus(data=b"\x00\x20")
    buses = Buses(first, second)
    sensor = Bh1750(1, 0x23, smbus_factory=buses, sleep=lambda seconds: None)
    sensor.read_lux()
    first.error = OSError(121, "Remote I/O error")

    with pytest.raises(LightError, match="Remote I/O error"):
        sensor.read_lux()
    assert first.closed is True

    lux = sensor.read_lux()

    assert buses.opened == [1, 1]
    assert second.calls[:2] == [("write_byte", 0x23, 0x01), ("write_byte", 0x23, 0x11)]
    assert lux == pytest.approx(32 / 2.4)


def test_a_missing_bus_says_to_switch_i2c_on_for_the_bh1750_too() -> None:
    buses = Buses()
    buses.error = FileNotFoundError(2, "No such file or directory")
    sensor = Bh1750(1, 0x23, smbus_factory=buses, sleep=lambda seconds: None)

    with pytest.raises(LightError, match="is I2C switched on in raspi-config"):
        sensor.read_lux()


def test_closing_a_bh1750_lets_go_of_the_bus_and_is_harmless_twice() -> None:
    bus = FakeBus(data=b"\x00\x10")
    sensor, _ = bh(bus)
    sensor.close()
    sensor.read_lux()

    sensor.close()
    sensor.close()

    assert bus.closed is True


def test_the_bh1750_reads_a_real_i2c_message_so_a_real_bus_gets_i2c_rdwr_and_not_read_word_data() -> None:
    # smbus2's own message type, as a real SMBus would be handed it.
    from smbus2 import i2c_msg

    bus = FakeBus(data=b"\x12\x34")
    sensor, _ = bh(bus)

    sensor.read_lux()

    message = i2c_msg.read(0x23, 2)
    assert (message.addr, message.len, message.flags) == bus.messages[0]
    assert not hasattr(bus, "read_byte_data")


# build_hardware


def make_config(**settings: Any) -> Config:
    return Config(
        display_id="hallway",
        mqtt=MqttConfig(host="broker.test", client_id="wallcal-pi-hallway"),
        sensors=SensorsConfig(light=settings.pop("light", True)),
        light=LightConfig(**settings),
    )


def test_the_light_sensor_is_only_built_when_sensors_light_is_on() -> None:
    off = make_config(light=False)

    assert build_hardware(fake=True, config=off).light is None
    assert build_hardware(fake=False, config=off).light is None
    assert isinstance(build_hardware(fake=True, config=make_config()).light, FakeLight)
    assert build_hardware(fake=False, config=make_config()).light is not None


def test_fake_hardware_has_a_light_sensor_that_reads_a_lit_room() -> None:
    sensor = build_hardware(fake=True, config=make_config()).light
    assert isinstance(sensor, FakeLight)

    assert sensor.read_lux() == 150.0


def test_fake_hardware_ignores_the_chip() -> None:
    config = make_config(chip="bh1750", address=0x23)

    assert isinstance(build_hardware(fake=True, config=config).light, FakeLight)


def test_the_real_light_sensor_is_a_veml7700_on_the_configured_bus_and_address() -> None:
    sensor = build_hardware(fake=False, config=make_config(chip="veml7700", bus=3, address=0x10)).light

    assert isinstance(sensor, Veml7700)
    assert (sensor._bus_number, sensor._address) == (3, 0x10)


@pytest.mark.parametrize("address", [0x23, 0x5C])
def test_the_real_light_sensor_can_be_a_bh1750_at_either_address(address: int) -> None:
    sensor = build_hardware(fake=False, config=make_config(chip="bh1750", bus=0, address=address)).light

    assert isinstance(sensor, Bh1750)
    assert (sensor._bus_number, sensor._address) == (0, address)


def test_building_the_real_hardware_does_not_open_the_bus(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(number: int) -> Any:
        raise AssertionError(f"opened /dev/i2c-{number}")

    monkeypatch.setattr(light_module, "_default_smbus", refuse)

    for chip, address in (("veml7700", 0x10), ("bh1750", 0x23)):
        sensor = build_hardware(fake=False, config=make_config(chip=chip, address=address)).light
        assert sensor is not None
        sensor.close()


def test_the_default_bus_opener_is_smbus2s() -> None:
    # Asking for a bus that cannot exist fails the way a Pi without I2C does, without needing one.
    with pytest.raises(FileNotFoundError):
        light_module._default_smbus(31)


def test_every_count_a_veml7700_can_give_is_a_finite_non_negative_number_of_lux() -> None:
    for setting in (VEML_LOW, VEML_HIGH):
        for raw in range(0, 65536, 257):
            lux = veml7700_lux(raw, setting)
            assert math.isfinite(lux)
            assert lux >= 0
