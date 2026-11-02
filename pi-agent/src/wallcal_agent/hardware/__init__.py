"""What the agent needs from the Pi, behind small interfaces so everything can be tested off the Pi.

A later pull request adds the light sensor here. Each has a real implementation for the Pi and a fake one for tests
and for `--fake-hardware`.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from ..config import Config


class ScreenError(Exception):
    """The panel could not be switched or read. The message is short and says what went wrong, for the log."""


class ButtonError(Exception):
    """The button's GPIO could not be opened. The message is short and says what went wrong, for the log."""


class PresenceError(Exception):
    """The presence sensor could not be opened (its GPIO or its serial port). The message is short and says what went
    wrong, for the log."""


class SystemInfo(Protocol):
    """Facts about the Pi itself, for the diagnostic sensors."""

    def cpu_temperature(self) -> float | None:
        """The CPU temperature in degrees Celsius, or None where it can't be read."""
        ...

    def uptime_seconds(self) -> float:
        """Seconds since the Pi booted."""
        ...


class ScreenControl(Protocol):
    """The panel's power. Both calls may take seconds (they run commands), so the agent never calls them from
    paho's network thread."""

    def set_power(self, on: bool) -> None:
        """Turns the panel on or off. Raises ScreenError if that failed."""
        ...

    def read_power(self) -> bool | None:
        """Whether the panel is on, or None when that can't be told. Raises ScreenError if the check itself failed."""
        ...


class ButtonInput(Protocol):
    """The button's raw level. It does no debouncing and knows nothing about presses: the agent's gesture detector
    does that."""

    def start(self, on_change: Callable[[bool], None]) -> None:
        """Starts watching the input. `on_change(True)` means pressed and `on_change(False)` released, and it may be
        called from any thread, so it must be quick. Raises ButtonError if the input can't be opened."""
        ...

    def close(self) -> None:
        """Lets go of the input. Safe to call twice, or before `start`."""
        ...


class PresenceInput(Protocol):
    """Whether the mmWave sensor sees someone. It does no debouncing: the agent's presence filter does that."""

    def start(self, on_change: Callable[[bool], None]) -> None:
        """Starts watching the sensor. `on_change(True)` means someone is there and `on_change(False)` nobody. It is
        called once straight away with the current reading where there is one, and then on changes (or on every
        reading, for a sensor that reports them), from any thread, so it must be quick. Raises PresenceError if the
        sensor can't be opened."""
        ...

    def close(self) -> None:
        """Lets go of the sensor. Safe to call twice, or before `start`."""
        ...


@dataclass
class Hardware:
    """Everything the agent talks to on the Pi."""

    system: SystemInfo
    screen: ScreenControl
    # None when `sensors.button` is off.
    button: ButtonInput | None = None
    # None when `sensors.presence` is off.
    presence: PresenceInput | None = None


def build_hardware(fake: bool, config: Config) -> Hardware:
    """The fake hardware for `--fake-hardware`, otherwise the real thing, with the screen back end the config picks.

    The button and the presence sensor are only built when their `sensors` switch is on, so a Pi without one never
    touches the GPIO or the serial port.
    """
    # Imported here so the Linux-only code isn't loaded when it isn't wanted.
    if fake:
        import time

        from .fake import FakeButton, FakePresence, FakeScreen, FakeSystemInfo

        return Hardware(
            system=FakeSystemInfo(clock=time.monotonic),
            screen=FakeScreen(power=True),
            # Never pressed: there is no finger to press it.
            button=FakeButton() if config.sensors.button else None,
            # Nobody is there: there is no one to walk in front of it.
            presence=FakePresence(initial=False) if config.sensors.presence else None,
        )

    from .linux import LinuxSystemInfo
    from .screen import build_screen

    button = None
    if config.sensors.button:
        from .gpio import GpioButton

        button = GpioButton(config.button.pin)
    presence: PresenceInput | None = None
    if config.sensors.presence:
        settings = config.presence
        if settings.source == "uart":
            from .ld2410 import Ld2410Uart

            presence = Ld2410Uart(settings.uart.device, settings.uart.baud)
        else:
            from .gpio import GpioPresence

            presence = GpioPresence(settings.pin)
    return Hardware(system=LinuxSystemInfo(), screen=build_screen(config.screen), button=button, presence=presence)
