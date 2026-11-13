"""Finding the Pi agent's code, which the sensor probes (button, mmwave, light) reuse.

The probes tune timings and thresholds for the agent, so they run the agent's own gesture detector, presence filter,
light reporter and hardware classes: what is measured here is exactly what the agent will do. Nothing is installed
from pip. The code is found in the repo, at `<repo>/pi-agent/src` (this folder is `<repo>/tools/hw-probe`), or it is
already importable. The screen and render probes don't need it.

The hardware libraries themselves (gpiozero, pyserial, smbus2) come from apt on the Pi. The agent's classes import
them when they are used, and turn a missing one into a short error, which `library_hint` turns into the apt line.
"""

import importlib
import re
import sys
from pathlib import Path

# The agent's source folder, in a clone of the repo.
AGENT_SOURCE = Path(__file__).resolve().parent.parent.parent.parent / "pi-agent" / "src"


class AgentCodeMissing(Exception):
    """The Pi agent's code could not be found. The message says what to do about it."""


def ensure_agent_code() -> None:
    """Makes `import wallcal_agent` work, or raises AgentCodeMissing.

    An importable `wallcal_agent` (installed, or already on the path) is used as it is. Otherwise the repo's copy is
    put at the front of the path, so it wins over anything stray further along.
    """
    if _importable():
        return
    sys.path.insert(0, str(AGENT_SOURCE))
    if _importable():
        return
    sys.path.remove(str(AGENT_SOURCE))
    raise AgentCodeMissing(
        "The sensor probes use the Pi agent's code, and it was not found (looked for wallcal_agent in "
        f"{AGENT_SOURCE}). Run hw-probe from a clone of the repo, or copy pi-agent/src along with tools/hw-probe, "
        "keeping the same layout."
    )


def _importable() -> bool:
    importlib.invalidate_caches()
    try:
        importlib.import_module("wallcal_agent")
    except ImportError:
        return False
    return True


# The apt package that provides each Python module the agent's hardware code may need.
_APT_PACKAGES = {
    "gpiozero": ("python3-gpiozero", "python3-lgpio"),
    "lgpio": ("python3-gpiozero", "python3-lgpio"),
    "serial": ("python3-serial",),
    "smbus2": ("python3-smbus2",),
}
_MODULE_NAMED = re.compile(r"No module named ['\"]?([A-Za-z0-9_]+)")


def library_hint(error_text: str) -> str | None:
    """The apt command to run when an error says a library is missing, or None when it doesn't say so.

    The agent's classes mention the module by name ("No module named 'gpiozero'"), or just name the library, so both
    are looked for.
    """
    named = _MODULE_NAMED.search(error_text)
    if named is not None:
        packages = _APT_PACKAGES.get(named.group(1))
        return f"sudo apt install {' '.join(packages)}" if packages else None
    for module, packages in _APT_PACKAGES.items():
        if re.search(rf"\b{module}\b", error_text):
            return f"sudo apt install {' '.join(packages)}"
    return None
