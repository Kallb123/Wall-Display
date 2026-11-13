"""Facts about the Pi that go at the top of every report section."""

import platform
import re
import socket
from collections.abc import Callable
from pathlib import Path


def read_text(path: str) -> str | None:
    """The file's text, or None if it can't be read."""
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def _model(read: Callable[[str], str | None]) -> str:
    text = read("/proc/device-tree/model")
    return text.strip("\x00 \n") if text else ""


def _os_name(read: Callable[[str], str | None]) -> str:
    for line in (read("/etc/os-release") or "").splitlines():
        key, _, value = line.partition("=")
        if key == "PRETTY_NAME":
            return value.strip().strip("\"'")
    return ""


def _memory(read: Callable[[str], str | None]) -> str:
    match = re.search(r"^MemTotal:\s*(\d+)\s*kB", read("/proc/meminfo") or "", re.MULTILINE)
    if match is None:
        return ""
    return f"{int(match.group(1)) / 1024 / 1024:.1f} GiB"


def system_facts(read: Callable[[str], str | None] = read_text) -> list[tuple[str, str]]:
    return [
        ("Host", socket.gethostname() or "unknown"),
        ("Model", _model(read) or "unknown"),
        ("OS", _os_name(read) or "unknown"),
        ("Kernel", platform.release() or "unknown"),
        ("Memory", _memory(read) or "unknown"),
        ("Python", platform.python_version()),
    ]


def cpu_temperature(read: Callable[[str], str | None] = read_text) -> float | None:
    """The CPU temperature in degrees Celsius, or None if the sensor can't be read."""
    text = read("/sys/class/thermal/thermal_zone0/temp")
    try:
        return int((text or "").strip()) / 1000
    except ValueError:
        return None
