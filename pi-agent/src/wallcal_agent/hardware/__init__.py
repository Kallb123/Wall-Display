"""What the agent needs from the Pi, behind small interfaces so everything can be tested off the Pi.

Later pull requests add the button, presence sensor, light sensor and screen here. Each has a real
implementation for the Pi and a fake one for tests and for `--fake-hardware`.
"""

from dataclasses import dataclass
from typing import Protocol


class SystemInfo(Protocol):
    """Facts about the Pi itself, for the diagnostic sensors."""

    def cpu_temperature(self) -> float | None:
        """The CPU temperature in degrees Celsius, or None where it can't be read."""
        ...

    def uptime_seconds(self) -> float:
        """Seconds since the Pi booted."""
        ...


@dataclass
class Hardware:
    """Everything the agent talks to on the Pi."""

    system: SystemInfo


def build_hardware(fake: bool) -> Hardware:
    """The fake hardware for `--fake-hardware`, otherwise the real thing."""
    # Imported here so the Linux-only reading code isn't loaded when it isn't wanted.
    if fake:
        import time

        from .fake import FakeSystemInfo

        return Hardware(system=FakeSystemInfo(clock=time.monotonic))

    from .linux import LinuxSystemInfo

    return Hardware(system=LinuxSystemInfo())
