"""The real button and the real presence input: each one GPIO read with gpiozero.

The button goes between the GPIO and ground, and the Pi's own pull-up resistor holds the input high until it is
pressed, so a press reads low. This class only reports the raw level. Debouncing, and telling single, double and
long presses apart, is the gesture detector's job (button.py), so it is the same however the input is read and
can be tested without any GPIO.

The presence input is the mmWave sensor's OUT pin, which the sensor drives high while it sees someone. It also only
reports the raw level: the presence filter (presence.py) decides when a change has held long enough to count.
"""

import logging
from collections.abc import Callable
from typing import Any

from . import ButtonError, PresenceError

logger = logging.getLogger(__name__)

# How much of the library's own message goes into the error, so a log line stays one line.
MAX_ERROR_TEXT = 200


class GpioButton:
    """A button on one BCM GPIO pin, with the internal pull-up.

    `pin_factory` is gpiozero's own idea, there so a test can give it a mock pin. Left out, gpiozero picks the one
    that suits the machine (lgpio on Raspberry Pi OS Bookworm, including the Pi 5).
    """

    def __init__(self, pin: int, pin_factory: Any = None) -> None:
        self._pin = pin
        self._pin_factory = pin_factory
        self._device: Any = None

    def start(self, on_change: Callable[[bool], None]) -> None:
        """Opens the pin. Raises ButtonError if that fails: no pin factory (not a Pi, or lgpio is missing), the pin
        in use by something else, or no permission for the GPIO."""
        self.close()
        try:
            # Imported here so a machine without a Pi's GPIO libraries can still import and test everything else.
            from gpiozero import Button

            # bounce_time is off because the gesture detector does its own debouncing, from the true edge times.
            device = Button(self._pin, pull_up=True, bounce_time=None, pin_factory=self._pin_factory)
        except Exception as error:
            raise ButtonError(_short(error)) from None
        device.when_pressed = lambda: on_change(True)
        device.when_released = lambda: on_change(False)
        self._device = device

    def close(self) -> None:
        """Lets go of the pin. Safe to call twice, or before `start`."""
        device, self._device = self._device, None
        if device is None:
            return
        try:
            device.close()
        except Exception as error:
            logger.debug("Could not close the button's GPIO cleanly: %s", _short(error))


class GpioPresence:
    """The mmWave sensor's OUT pin on one BCM GPIO pin.

    The pin has the internal pull-down on, so a wire that comes loose reads as "nobody" and not as someone standing
    there for ever. `pin_factory` is gpiozero's own idea, as for the button.
    """

    def __init__(self, pin: int, pin_factory: Any = None) -> None:
        self._pin = pin
        self._pin_factory = pin_factory
        self._device: Any = None

    def start(self, on_change: Callable[[bool], None]) -> None:
        """Opens the pin and reports the level it is at now, then every change. Raises PresenceError if the pin
        can't be opened, for the reasons the button's can't."""
        self.close()
        try:
            from gpiozero import DigitalInputDevice

            # bounce_time is off because the presence filter does its own debouncing, from the true change times.
            device = DigitalInputDevice(self._pin, pull_up=False, bounce_time=None, pin_factory=self._pin_factory)
        except Exception as error:
            raise PresenceError(_short(error)) from None
        device.when_activated = lambda: on_change(True)
        device.when_deactivated = lambda: on_change(False)
        self._device = device
        # The sensor may already see someone, and no edge will say so until it changes. The callbacks are set first
        # so a change between the two is not lost; the filter takes a repeated reading in its stride.
        on_change(bool(device.value))

    def close(self) -> None:
        """Lets go of the pin. Safe to call twice, or before `start`."""
        device, self._device = self._device, None
        if device is None:
            return
        try:
            device.close()
        except Exception as error:
            logger.debug("Could not close the presence GPIO cleanly: %s", _short(error))


def _short(error: Exception) -> str:
    """What went wrong, on one line: the library's message when it has one, otherwise the kind of error."""
    text = " ".join(str(error).split())
    if text == "":
        return type(error).__name__
    return text if len(text) <= MAX_ERROR_TEXT else text[:MAX_ERROR_TEXT] + "..."
