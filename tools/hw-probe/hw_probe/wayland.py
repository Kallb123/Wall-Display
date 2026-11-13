"""Finding the compositor's session and listing its outputs."""

import os
import re
import stat
from collections.abc import Callable, Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class Session:
    socket: str  # the full path, such as /run/user/1000/wayland-0

    def env(self) -> dict[str, str]:
        return {"WAYLAND_DISPLAY": self.socket, "XDG_RUNTIME_DIR": os.path.dirname(self.socket)}


def _list_dir(path: str) -> list[str]:
    try:
        return os.listdir(path)
    except OSError:
        return []


def _is_socket(path: str) -> bool:
    try:
        return stat.S_ISSOCK(os.stat(path).st_mode)
    except OSError:
        return False


def find_session(
    explicit: str | None,
    environ: Mapping[str, str],
    uid: int,
    list_dir: Callable[[str], list[str]] = _list_dir,
    is_socket: Callable[[str], bool] = _is_socket,
) -> Session | None:
    """The Wayland socket to talk to, or None.

    An explicit choice (a full path, or a name in the runtime folder) is used as given: if it is not a socket the
    answer is None. Otherwise WAYLAND_DISPLAY is tried, and then the first `wayland-*` socket in the runtime folder.
    """
    runtime_dir = environ.get("XDG_RUNTIME_DIR") or f"/run/user/{uid}"

    def resolve(name: str) -> str:
        return name if name.startswith("/") else os.path.join(runtime_dir, name)

    if explicit:
        path = resolve(explicit)
        return Session(path) if is_socket(path) else None
    from_environ = environ.get("WAYLAND_DISPLAY")
    if from_environ:
        path = resolve(from_environ)
        if is_socket(path):
            return Session(path)
    for name in sorted(list_dir(runtime_dir)):
        if name.startswith("wayland-") and not name.endswith(".lock"):
            path = os.path.join(runtime_dir, name)
            if is_socket(path):
                return Session(path)
    return None


@dataclass(frozen=True)
class Output:
    name: str
    enabled: bool | None
    mode: str | None  # such as "2560x1440 @ 59.951 Hz", from the mode marked current


_MODE = re.compile(r"^\s*(\d+x\d+)\s*(?:px)?,?\s*([\d.]+)\s*Hz")


def parse_wlr_randr(text: str) -> list[Output]:
    """Reads `wlr-randr`: a block per output, starting at column 0 with its name, details indented."""
    outputs: list[Output] = []
    name: str | None = None
    enabled: bool | None = None
    mode: str | None = None

    def finish() -> None:
        if name is not None:
            outputs.append(Output(name, enabled, mode))

    for line in text.splitlines():
        if not line.strip():
            continue
        if not line[0].isspace():
            finish()
            name, enabled, mode = line.split()[0], None, None
            continue
        key, _, value = line.partition(":")
        if key.strip() == "Enabled":
            enabled = {"yes": True, "no": False}.get(value.strip().lower())
        elif "current" in line:
            found = _MODE.match(line)
            if found:
                mode = f"{found.group(1)} @ {float(found.group(2)):.3f} Hz"
    finish()
    return outputs


def parse_wlopm(text: str) -> list[Output]:
    """Reads `wlopm` with no arguments: one line per output, such as `HDMI-A-1 on`."""
    outputs: list[Output] = []
    for line in text.splitlines():
        fields = line.split()
        if len(fields) == 2 and fields[1] in ("on", "off"):
            outputs.append(Output(fields[0], fields[1] == "on", None))
    return outputs
