"""Stand-ins for the things a probe talks to: commands, the person at the screen, and the clock."""

from collections import deque
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Any

from hw_probe.runner import Result

ANY: Any = object()  # "whatever was sent on stdin"


def result(stdout: str = "", stderr: str = "", returncode: int = 0, seconds: float = 0.1) -> Result:
    return Result((), returncode, stdout, stderr, seconds)


@dataclass(frozen=True)
class Call:
    argv: tuple[str, ...]
    stdin: str | None
    env: Mapping[str, str] | None
    timeout: float


class FakeRunner:
    """Answers commands from a table keyed on (argv, stdin), and records every call.

    `on(argv, *outcomes)` registers answers for an argv with any stdin; add `stdin=` to match one input only.
    An outcome is a `Result` (see `result()`), a string (standard output of a successful run) or an exception to
    raise. With several outcomes they are used in turn and the last one repeats. An exact (argv, stdin) match wins
    over an argv-only one. A call nothing matches fails the test.
    """

    def __init__(self) -> None:
        self.calls: list[Call] = []
        self._table: dict[tuple[tuple[str, ...], Any], deque[Any]] = {}

    def on(self, argv: Sequence[str], *outcomes: Result | str | BaseException, stdin: Any = ANY) -> None:
        self._table[(tuple(argv), stdin)] = deque(outcomes or ("",))

    def __call__(
        self,
        argv: Sequence[str],
        *,
        stdin: str | None = None,
        env: Mapping[str, str] | None = None,
        timeout: float = 30,
    ) -> Result:
        command = tuple(argv)
        self.calls.append(Call(command, stdin, env, timeout))
        queue = self._table.get((command, stdin)) or self._table.get((command, ANY))
        if queue is None:
            raise AssertionError(f"unexpected command: {command!r} with stdin {stdin!r}")
        outcome = queue[0] if len(queue) == 1 else queue.popleft()
        if isinstance(outcome, BaseException):
            raise outcome
        if isinstance(outcome, str):
            outcome = result(outcome)
        return replace(outcome, argv=command)

    def argvs(self) -> list[tuple[str, ...]]:
        return [call.argv for call in self.calls]

    def stdins(self, argv: Sequence[str]) -> list[str | None]:
        return [call.stdin for call in self.calls if call.argv == tuple(argv)]


class ScriptedPrompter:
    """Gives queued answers. A queued exception (or exception class) is raised instead, to model Ctrl-C."""

    def __init__(
        self,
        yes_no: Sequence[Any] = (),
        enter: Sequence[Any] = (),
        interactive: bool = True,
        enter_polls: Sequence[Any] = (),
    ) -> None:
        self.interactive = interactive
        self._yes_no = deque(yes_no)
        self._enter = deque(enter)
        self._enter_polls = deque(enter_polls)
        self.questions: list[str] = []
        self.waits: list[tuple[str, float]] = []
        self.pauses: list[str] = []
        self.poll_timeouts: list[float] = []

    @staticmethod
    def _next(queue: deque[Any], what: str) -> Any:
        if not queue:
            raise AssertionError(f"no scripted answer left for {what}")
        answer = queue.popleft()
        if isinstance(answer, BaseException) or (isinstance(answer, type) and issubclass(answer, BaseException)):
            raise answer
        return answer

    def yes_no(self, question: str) -> bool | None:
        self.questions.append(question)
        if not self.interactive:
            return None
        return self._next(self._yes_no, f"yes_no({question!r})")

    def wait_enter(self, message: str, timeout: float) -> float | None:
        self.waits.append((message, timeout))
        if not self.interactive:
            return None
        return self._next(self._enter, f"wait_enter({message!r})")

    def pause(self, message: str) -> None:
        self.pauses.append(message)

    def poll_enter(self, timeout: float) -> bool:
        """The next queued answer (True means Enter was pressed); False when none is left or nobody is there."""
        self.poll_timeouts.append(timeout)
        if not self.interactive or not self._enter_polls:
            return False
        return bool(self._next(self._enter_polls, "poll_enter"))


class FakeClock:
    """Time that moves only when something sleeps."""

    def __init__(self, start: float = 1000.0) -> None:
        self.now = start
        self.sleeps: list[float] = []

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds

    def monotonic(self) -> float:
        return self.now
