"""Asking the person at the screen.

Some steps (did the monitor go to standby?) need someone watching. A `Prompter` asks them, and says it is not
interactive when there is nobody to ask, so a probe can skip those steps instead of hanging.
"""

import select
import sys
import time
from collections.abc import Callable
from typing import Protocol, TextIO


class Prompter(Protocol):
    interactive: bool

    def yes_no(self, question: str) -> bool | None:
        """Asks until the answer is yes or no. None when not interactive (or when input has ended)."""
        ...

    def wait_enter(self, message: str, timeout: float) -> float | None:
        """Prints the message and waits for Enter. Returns the seconds to Enter, None on timeout or no one there."""
        ...

    def pause(self, message: str) -> None:
        """Waits for Enter. Does nothing when not interactive."""
        ...


class NoPrompter:
    """For runs with no one watching: nothing is asked, and every question has no answer."""

    interactive = False

    def yes_no(self, question: str) -> bool | None:
        return None

    def wait_enter(self, message: str, timeout: float) -> float | None:
        return None

    def pause(self, message: str) -> None:
        return None


class TerminalPrompter:
    """Asks on the terminal. Input and output can be swapped for tests."""

    interactive = True

    def __init__(
        self,
        stdin: TextIO | None = None,
        stdout: TextIO | None = None,
        monotonic: Callable[[], float] = time.monotonic,
        wait_readable: Callable[[float], bool] | None = None,
    ) -> None:
        self._stdin = stdin if stdin is not None else sys.stdin
        self._stdout = stdout if stdout is not None else sys.stdout
        self._monotonic = monotonic
        self._wait_readable = wait_readable or self._select_stdin

    def _select_stdin(self, timeout: float) -> bool:
        ready, _, _ = select.select([self._stdin], [], [], max(timeout, 0))
        return bool(ready)

    def _print(self, text: str) -> None:
        self._stdout.write(text)
        self._stdout.flush()

    def yes_no(self, question: str) -> bool | None:
        while True:
            self._print(f"  {question} ")
            line = self._stdin.readline()
            if line == "":
                self._print("\n")
                return None
            answer = line.strip().lower()
            if answer in ("y", "yes"):
                return True
            if answer in ("n", "no"):
                return False
            self._print("  Please answer y or n.\n")

    def wait_enter(self, message: str, timeout: float) -> float | None:
        self._print(f"  {message}\n")
        started = self._monotonic()
        if not self._wait_readable(timeout):
            return None
        if self._stdin.readline() == "":
            return None
        return self._monotonic() - started

    def pause(self, message: str) -> None:
        self._print(f"  {message} Press Enter to continue. ")
        self._stdin.readline()
