"""Running commands with a timeout.

A probe runs programs through a `Runner`, so tests can say what a command prints without running anything. The
real runner starts the program directly (an argument list, never a shell) and gives up after a timeout, so a hung
`cec-client` can't hang the probe. A non-zero exit is not an error here: it comes back in the `Result`, and each
probe decides what it means.
"""

import os
import subprocess
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

# How much of a command's own message goes into a report line, so a table cell stays short.
MAX_ERROR_TEXT = 200


@dataclass(frozen=True)
class Result:
    argv: tuple[str, ...]
    returncode: int
    stdout: str
    stderr: str
    seconds: float

    @property
    def ok(self) -> bool:
        return self.returncode == 0

    def first_error_line(self) -> str:
        """The first non-blank line of stderr, else of stdout, trimmed. Empty if the command printed nothing."""
        for text in (self.stderr, self.stdout):
            for line in text.splitlines():
                if line.strip():
                    return line.strip()[:MAX_ERROR_TEXT]
        return ""


class CommandMissing(Exception):
    """The program is not installed."""

    def __init__(self, program: str) -> None:
        super().__init__(f"{program} is not installed")
        self.program = program


class CommandTimeout(Exception):
    """The program took longer than its timeout and was stopped."""

    def __init__(self, program: str, timeout: float) -> None:
        super().__init__(f"{program} did not finish within {timeout:g} seconds")
        self.program = program
        self.timeout = timeout


class Runner(Protocol):
    def __call__(
        self,
        argv: Sequence[str],
        *,
        stdin: str | None = None,
        env: Mapping[str, str] | None = None,
        timeout: float = 30,
    ) -> Result: ...


def subprocess_runner() -> Runner:
    """The real runner. `env` adds to this process's own environment. Raises CommandMissing or CommandTimeout."""

    def run(
        argv: Sequence[str],
        *,
        stdin: str | None = None,
        env: Mapping[str, str] | None = None,
        timeout: float = 30,
    ) -> Result:
        command = tuple(argv)
        program = command[0]
        started = time.monotonic()
        try:
            completed = subprocess.run(
                list(command),
                env={**os.environ, **env} if env else None,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
                input=stdin,
                # With no input, close stdin rather than let the program wait on the terminal.
                stdin=None if stdin is not None else subprocess.DEVNULL,
            )
        except FileNotFoundError:
            raise CommandMissing(program) from None
        except subprocess.TimeoutExpired:
            raise CommandTimeout(program, timeout) from None
        except OSError as error:
            # Found but not runnable (no permission, say): report it like the shell does, as status 126.
            message = error.strerror or type(error).__name__
            return Result(command, 126, "", f"{program}: {message}", time.monotonic() - started)
        return Result(command, completed.returncode, completed.stdout, completed.stderr, time.monotonic() - started)

    return run
