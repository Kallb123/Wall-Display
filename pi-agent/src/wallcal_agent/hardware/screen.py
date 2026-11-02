"""Turning the panel on and off, in the three ways the config offers.

- `black`: leave the panel alone. The display page already goes pure black when the screen is "off", so this
  needs nothing installed, works on any panel, and is the default.
- `cec`: tell the monitor to switch on or go to standby over the HDMI CEC bus, with `cec-client` (from cec-utils).
- `output`: switch the kiosk's HDMI output off and on in the Wayland compositor, with `wlopm` or `wlr-randr`.

The two that run commands do it through a `CommandRunner`, so tests can say what a command prints without running
anything. The real runner starts the program directly (an argument list, never a shell, so nothing in the config
can be taken for shell syntax) and gives up after a timeout, so a hung `cec-client` can't hang the agent.
"""

import logging
import os
import re
import subprocess
from collections.abc import Mapping, Sequence
from pathlib import PurePosixPath
from typing import Protocol

from ..config import CecConfig, OutputConfig, ScreenConfig
from . import ScreenControl, ScreenError

logger = logging.getLogger(__name__)

# How much of a failed command's own message goes into the error, so a log line stays one line.
MAX_ERROR_TEXT = 200


class CommandRunner(Protocol):
    """Runs a program and returns what it printed. Raises ScreenError if it can't run, fails or takes too long."""

    def __call__(
        self, argv: Sequence[str], *, stdin: str | None = None, env: Mapping[str, str] | None = None
    ) -> str: ...


def subprocess_runner(timeout_seconds: float) -> CommandRunner:
    """The real runner. `env` adds to the agent's own environment."""

    def run(argv: Sequence[str], *, stdin: str | None = None, env: Mapping[str, str] | None = None) -> str:
        program = argv[0]
        try:
            result = subprocess.run(
                list(argv),
                input=stdin,
                env={**os.environ, **env} if env else None,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                check=False,
            )
        except FileNotFoundError:
            raise ScreenError(f"{program} is not installed") from None
        except subprocess.TimeoutExpired:
            raise ScreenError(f"{program} did not finish within {timeout_seconds:g} seconds") from None
        except OSError as error:
            raise ScreenError(f"{program} could not be run: {error.strerror or type(error).__name__}") from None
        if result.returncode != 0:
            # Its own message is the useful part (such as "no adapter found"); keep the first line only.
            detail = next((line.strip() for line in result.stderr.splitlines() if line.strip()), "")
            suffix = f": {detail[:MAX_ERROR_TEXT]}" if detail else ""
            raise ScreenError(f"{program} exited with status {result.returncode}{suffix}")
        return result.stdout

    return run


class BlackScreen:
    """Does nothing to the panel. It only remembers the last request, so the agent can report it back."""

    def __init__(self) -> None:
        self._on: bool | None = None

    def set_power(self, on: bool) -> None:
        self._on = on

    def read_power(self) -> bool | None:
        return self._on


# What `cec-client`'s `pow` command prints after "power status:". "unknown" and anything else give None.
_CEC_POWER = {
    "on": True,
    "standby": False,
    "in transition from standby to on": True,
    "in transition from on to standby": False,
}
_CEC_POWER_LINE = re.compile(r"^\s*power status:\s*(.*?)\s*$", re.IGNORECASE | re.MULTILINE)


class CecScreen:
    """Switches a CEC device with `cec-client`. Needs cec-utils, access to /dev/cec* and the monitor's CEC enabled.

    `-s` makes cec-client run one command from stdin and exit, and `-d 1` keeps its output to errors, so what
    comes back for `pow` is just the answer.
    """

    def __init__(self, config: CecConfig, runner: CommandRunner) -> None:
        self._device = config.device
        self._runner = runner

    def set_power(self, on: bool) -> None:
        command = "on" if on else "standby"
        self._runner(["cec-client", "-s", "-d", "1"], stdin=f"{command} {self._device}\n")

    def read_power(self) -> bool | None:
        output = self._runner(["cec-client", "-s", "-d", "1"], stdin=f"pow {self._device}\n")
        match = _CEC_POWER_LINE.search(output)
        if match is None:
            return None
        return _CEC_POWER.get(match.group(1).lower())


class OutputScreen:
    """Switches one output in the Wayland compositor, with `wlopm` or `wlr-randr`.

    The agent is a system service with no desktop session, so each command is told where the compositor's socket
    is: WAYLAND_DISPLAY can be a full path, and XDG_RUNTIME_DIR is the folder it is in. The kiosk's launcher gives
    the service user access to that socket.
    """

    def __init__(self, config: OutputConfig, runner: CommandRunner) -> None:
        self._tool = config.tool
        self._name = config.name
        self._runner = runner
        self._env = {
            "WAYLAND_DISPLAY": config.wayland_display,
            "XDG_RUNTIME_DIR": str(PurePosixPath(config.wayland_display).parent),
        }

    def set_power(self, on: bool) -> None:
        if self._tool == "wlopm":
            argv = ["wlopm", "--on" if on else "--off", self._name]
        else:
            argv = ["wlr-randr", "--output", self._name, "--on" if on else "--off"]
        self._runner(argv, env=self._env)

    def read_power(self) -> bool | None:
        output = self._runner([self._tool], env=self._env)
        if self._tool == "wlopm":
            return self._read_wlopm(output)
        return self._read_wlr_randr(output)

    def _read_wlopm(self, output: str) -> bool | None:
        """`wlopm` with no arguments lists each output and its state, one per line: `HDMI-A-1 on`."""
        for line in output.splitlines():
            fields = line.split()
            if len(fields) == 2 and fields[0] == self._name and fields[1] in ("on", "off"):
                return fields[1] == "on"
        return None

    def _read_wlr_randr(self, output: str) -> bool | None:
        """`wlr-randr` prints a block per output. The block starts at column 0 with the output's name, and its
        details are indented, among them `  Enabled: yes`."""
        in_block = False
        for line in output.splitlines():
            if line and not line[0].isspace():
                in_block = line.split()[0] == self._name
            elif in_block:
                key, _, value = line.partition(":")
                if key.strip() == "Enabled":
                    return {"yes": True, "no": False}.get(value.strip().lower())
        return None


def build_screen(config: ScreenConfig) -> ScreenControl:
    """The screen back end the config asks for."""
    logger.debug("Panel power back end: %s", config.backend)
    if config.backend == "black":
        return BlackScreen()
    runner = subprocess_runner(config.command_timeout_seconds)
    if config.backend == "cec":
        return CecScreen(config.cec, runner)
    return OutputScreen(config.output, runner)
