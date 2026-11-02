"""What the agent needs from the Pi, behind small interfaces so everything can be tested off the Pi.

Later pull requests add the button, presence sensor and light sensor here. Each has a real implementation for the
Pi and a fake one for tests and for `--fake-hardware`.
"""

from dataclasses import dataclass
from typing import Protocol

from ..config import ScreenConfig


class ScreenError(Exception):
    """The panel could not be switched or read. The message is short and says what went wrong, for the log."""


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


@dataclass
class Hardware:
    """Everything the agent talks to on the Pi."""

    system: SystemInfo
    screen: ScreenControl


def build_hardware(fake: bool, screen: ScreenConfig) -> Hardware:
    """The fake hardware for `--fake-hardware`, otherwise the real thing, with the screen back end the config picks."""
    # Imported here so the Linux-only code isn't loaded when it isn't wanted.
    if fake:
        import time

        from .fake import FakeScreen, FakeSystemInfo

        return Hardware(system=FakeSystemInfo(clock=time.monotonic), screen=FakeScreen(power=True))

    from .linux import LinuxSystemInfo
    from .screen import build_screen

    return Hardware(system=LinuxSystemInfo(), screen=build_screen(screen))
