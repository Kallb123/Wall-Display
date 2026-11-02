"""Stand-in hardware for tests and for running the agent on a laptop."""

from collections.abc import Callable


class FakeSystemInfo:
    """A Pi with values you set. Change `temperature` and `uptime` at any time.

    With a `clock` (for example `time.monotonic`), uptime counts up from the moment this object was made, so a
    development run against a real broker shows values that change.
    """

    def __init__(
        self,
        cpu_temperature: float | None = 45.0,
        uptime: float = 0.0,
        clock: Callable[[], float] | None = None,
    ) -> None:
        # Named `temperature`, not `cpu_temperature`, because the latter is the method the agent calls.
        self.temperature = cpu_temperature
        self.uptime = uptime
        self._clock = clock
        self._started = clock() if clock is not None else 0.0

    def cpu_temperature(self) -> float | None:
        return self.temperature

    def uptime_seconds(self) -> float:
        if self._clock is None:
            return self.uptime
        return self.uptime + (self._clock() - self._started)
