"""The real light sensor: a VEML7700 or a BH1750 on the Pi's I2C bus, read with smbus2.

Both are small breakout boards that answer on a fixed address and give the ambient light in a 16-bit count. This file
turns the count into lux. Reading is the whole interface (see `LightSensor` in `__init__.py`): the agent asks every
`sample_ms`, so there are no callbacks and no threads here.

The bus is opened on the first reading, not when the sensor is built, so a Pi with the sensor switched off, a laptop
and the tests never touch `/dev/i2c-N`. Any failure closes the bus again, and the next reading opens it afresh and
sets the chip up again, because a loose wire can mean the chip lost its power and its settings with it.

The conversions are pure module-level functions, tested directly. `smbus_factory` and `sleep` are there for tests: a
fake bus, and no real waiting.
"""

import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from . import LightError

logger = logging.getLogger(__name__)

# How much of the library's own message goes into the error, so a log line stays one line.
MAX_ERROR_TEXT = 200

# A chip that has just been given new settings is read after one conversion has finished, plus a little to spare.
SETTLE_MARGIN = 0.01

# The VEML7700's registers (16 bits each; SMBus sends the low byte first, which is the chip's own order).
VEML_ALS_CONF = 0x00
VEML_ALS = 0x04
# The VEML7700 can't see both a dark room and daylight with one setting, so it has two, and moves between them.
# A count at or above `VEML_RANGE_UP` (the top of the scale is 65535) is too bright for the low range. A count at or
# below `VEML_RANGE_DOWN` is so low in the high range that the low range would read it far more finely. The two are
# far apart in lux (about 840 up, about 540 down), so a room near the border doesn't flip between them.
VEML_RANGE_UP = 50000
VEML_RANGE_DOWN = 1000
# The resolution at gain x2 and 800 ms, in lux per count, from Vishay's application note for the VEML7700 (revision
# 1.9 onward). Earlier revisions said 0.0036: a reading is about 15% higher than an old copy of the sheet says.
VEML_BASE_RESOLUTION = 0.0042

# The BH1750's commands. It has no registers: a command is one byte, and a reading is two bytes, high byte first.
BH_POWER_ON = 0x01
# Continuous high-resolution mode 2: 0.5 lx a count, a new reading every 120 ms (180 ms at most).
BH_CONTINUOUS_HIGH_RES_2 = 0x11
BH_FIRST_READING_SECONDS = 0.18
# The datasheet turns a count into lux by dividing by 1.2 (at the chip's default sensitivity), and mode 2 counts in
# half-lux steps, so it is divided by 2 as well.
BH_ACCURACY = 1.2
BH_MODE_2 = 2


@dataclass(frozen=True)
class VemlRange:
    """One of the VEML7700's two settings."""

    name: str
    # The ALS_CONF word with this setting and everything else off: gain in bits 12 and 11, integration time in
    # bits 9 to 6, no persistence or interrupt in bits 5 to 4 and 1, and bit 0 (shutdown) clear, so the chip is on.
    config: int
    gain: float
    integration_ms: int


# Gain x2 (bits 01) and 200 ms (bits 0001): the finest setting that is useful indoors. About 1100 lx at full scale.
VEML_LOW = VemlRange("low", config=(0b01 << 11) | (0b0001 << 6), gain=2.0, integration_ms=200)
# Gain x1/8 (bits 10) and 100 ms (bits 0000): the coarsest, for daylight. About 35 000 lx at full scale.
VEML_HIGH = VemlRange("high", config=(0b10 << 11) | (0b0000 << 6), gain=0.125, integration_ms=100)


def veml7700_resolution(gain: float, integration_ms: int) -> float:
    """Lux per count for a gain and an integration time: finer with a higher gain and a longer time."""
    return VEML_BASE_RESOLUTION * (800 / integration_ms) * (2 / gain)


def veml7700_lux(raw: int, setting: VemlRange) -> float:
    """A raw count to lux. In the high range Vishay's correction for the chip's non-linearity at low gain is applied
    too: without it a bright day reads several percent low."""
    linear = raw * veml7700_resolution(setting.gain, setting.integration_ms)
    if setting is not VEML_HIGH:
        return linear
    return 6.0135e-13 * linear**4 - 9.3924e-9 * linear**3 + 8.1488e-5 * linear**2 + 1.0023 * linear


def veml7700_range_for(current: VemlRange, raw: int) -> VemlRange:
    """The setting the next reading should use, given the raw count just read in `current`."""
    if current is VEML_LOW and raw >= VEML_RANGE_UP:
        return VEML_HIGH
    if current is VEML_HIGH and raw <= VEML_RANGE_DOWN:
        return VEML_LOW
    return current


def bh1750_lux(high: int, low: int) -> float:
    """The two bytes of a reading, high byte first, to lux."""
    return (high << 8 | low) / BH_ACCURACY / BH_MODE_2


def _default_smbus(bus: int) -> Any:
    """A real I2C bus. smbus2 is imported here, so everything else works without it."""
    from smbus2 import SMBus

    return SMBus(bus)


# Opens a bus by number. What it returns is what smbus2's SMBus is: it has the methods the chips below call, and
# `close()`.
SmbusFactory = Callable[[int], Any]


class _I2cLight:
    """What both chips share: opening the bus on demand, and turning any failure into a LightError.

    One lock covers a reading and `close()`, so the agent's stop can't close the bus out from under a reading that
    is still running. The wait is a reading long at most.
    """

    def __init__(
        self,
        bus: int,
        address: int,
        smbus_factory: SmbusFactory | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._bus_number = bus
        self._address = address
        self._smbus_factory = smbus_factory or _default_smbus
        self._sleep = sleep
        self._bus: Any = None
        self._lock = threading.Lock()

    def read_lux(self) -> float:
        """One reading in lux. Opens the bus and sets the chip up first if it isn't open. Raises LightError if that
        or the reading fails, and the bus is closed then, so the next call starts again."""
        with self._lock:
            try:
                if self._bus is None:
                    self._bus = self._smbus_factory(self._bus_number)
                    self._set_up()
                return self._read()
            except FileNotFoundError:
                self._close_bus()
                raise LightError(
                    f"/dev/i2c-{self._bus_number} is not there; is I2C switched on in raspi-config?"
                ) from None
            except PermissionError:
                self._close_bus()
                raise LightError(
                    f"no permission for /dev/i2c-{self._bus_number}; is the service user in the i2c group?"
                ) from None
            except ImportError:
                self._close_bus()
                raise LightError("the smbus2 library is not installed") from None
            except OSError as error:
                self._close_bus()
                raise LightError(_short(error)) from None

    def close(self) -> None:
        """Lets go of the bus. Safe to call twice, or before the first reading."""
        with self._lock:
            self._close_bus()

    def _close_bus(self) -> None:
        bus, self._bus = self._bus, None
        if bus is None:
            return
        try:
            bus.close()
        except Exception as error:
            logger.debug("Could not close the I2C bus cleanly: %s", _short(error))

    def _set_up(self) -> None:
        raise NotImplementedError

    def _read(self) -> float:
        raise NotImplementedError


class Veml7700(_I2cLight):
    """A VEML7700 on `bus`, at its one address (0x10), in continuous mode.

    It starts in the low range and moves between the two as the light changes (see `veml7700_range_for`). After a
    move it waits for a conversion made with the new setting, so a reading is never one taken in the old range.
    """

    def __init__(
        self,
        bus: int,
        address: int = 0x10,
        smbus_factory: SmbusFactory | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        super().__init__(bus, address, smbus_factory, sleep)
        self._range = VEML_LOW

    def _set_up(self) -> None:
        # The chip may have been off, so it starts from the low range whatever it was in last.
        self._apply(VEML_LOW)

    def _apply(self, setting: VemlRange) -> None:
        """Gives the chip this setting, and waits for it to have measured something with it."""
        self._bus.write_word_data(self._address, VEML_ALS_CONF, setting.config)
        self._range = setting
        self._sleep(setting.integration_ms / 1000 + SETTLE_MARGIN)

    def _read(self) -> float:
        raw = self._bus.read_word_data(self._address, VEML_ALS)
        wanted = veml7700_range_for(self._range, raw)
        if wanted is not self._range:
            self._apply(wanted)
            raw = self._bus.read_word_data(self._address, VEML_ALS)
        return veml7700_lux(raw, self._range)


class Bh1750(_I2cLight):
    """A BH1750 on `bus`, at 0x23 (ADDR pin low) or 0x5c (high), in continuous high-resolution mode 2."""

    def __init__(
        self,
        bus: int,
        address: int = 0x23,
        smbus_factory: SmbusFactory | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        super().__init__(bus, address, smbus_factory, sleep)

    def _set_up(self) -> None:
        self._bus.write_byte(self._address, BH_POWER_ON)
        self._bus.write_byte(self._address, BH_CONTINUOUS_HIGH_RES_2)
        self._sleep(BH_FIRST_READING_SECONDS)

    def _read(self) -> float:
        # The chip has no registers, so SMBus's "read word" (which sends a command byte first) would confuse it. A
        # plain two-byte read is what it wants.
        from smbus2 import i2c_msg

        message = i2c_msg.read(self._address, 2)
        self._bus.i2c_rdwr(message)
        high, low = bytes(message)
        return bh1750_lux(high, low)


def _short(error: Exception) -> str:
    """What went wrong, on one line: the library's message when it has one, otherwise the kind of error."""
    text = " ".join(str(error).split())
    if text == "":
        return type(error).__name__
    return text if len(text) <= MAX_ERROR_TEXT else text[:MAX_ERROR_TEXT] + "..."
