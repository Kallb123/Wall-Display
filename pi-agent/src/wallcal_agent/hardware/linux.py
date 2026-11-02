"""Reading the Pi's own temperature and uptime from the kernel."""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

THERMAL_PATH = Path("/sys/class/thermal/thermal_zone0/temp")
UPTIME_PATH = Path("/proc/uptime")


class LinuxSystemInfo:
    """Reads /sys and /proc. The paths can be changed so a test can point them at temporary files."""

    def __init__(self, thermal_path: Path = THERMAL_PATH, uptime_path: Path = UPTIME_PATH) -> None:
        self._thermal_path = thermal_path
        self._uptime_path = uptime_path
        # The agent asks every minute, so say why the temperature is missing once, not every time.
        self._unreadable_logged = False

    def cpu_temperature(self) -> float | None:
        """The thermal file holds thousandths of a degree ("48312"). Missing or garbled gives None."""
        try:
            millidegrees = int(self._thermal_path.read_text().strip())
        except (OSError, ValueError) as error:
            if not self._unreadable_logged:
                self._unreadable_logged = True
                logger.debug("CPU temperature is not readable from %s: %s", self._thermal_path, error)
            return None
        self._unreadable_logged = False
        return millidegrees / 1000

    def uptime_seconds(self) -> float:
        """The first number in /proc/uptime is seconds since boot. Raises OSError or ValueError if unreadable."""
        fields = self._uptime_path.read_text().split()
        if not fields:
            raise ValueError(f"{self._uptime_path} is empty")
        return float(fields[0])
