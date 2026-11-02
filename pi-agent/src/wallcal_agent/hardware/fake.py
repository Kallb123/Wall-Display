"""Stand-in hardware for tests and for running the agent on a laptop."""

from collections.abc import Callable

from . import ButtonError, PresenceError, ScreenError


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


class FakeScreen:
    """A panel you can inspect and break. `power` is what a read reports, and `set_calls` is every request made.

    By default a request changes `power`, like a panel that obeys. Set `applies_requests` to False for one that
    doesn't (or can't be read back), `set_error` or `read_error` to a message to make that call fail with a
    ScreenError, and `on_set` to run something in the middle of a request (a test uses it to send more requests
    while one is being handled).
    """

    def __init__(self, power: bool | None = None) -> None:
        self.power = power
        self.applies_requests = True
        self.set_error: str | None = None
        self.read_error: str | None = None
        self.on_set: Callable[[bool], None] | None = None
        self.set_calls: list[bool] = []
        self.read_count = 0

    def set_power(self, on: bool) -> None:
        self.set_calls.append(on)
        if self.on_set is not None:
            self.on_set(on)
        if self.set_error is not None:
            raise ScreenError(self.set_error)
        if self.applies_requests:
            self.power = on

    def read_power(self) -> bool | None:
        self.read_count += 1
        if self.read_error is not None:
            raise ScreenError(self.read_error)
        return self.power


class FakeButton:
    """A button you press and release from a test. `start` and `close` are recorded.

    `press()` and `release()` call what `start` was given, as the real input does from its own thread. Before
    `start`, or after `close`, nobody is listening and they do nothing, as with a real one. `--fake-hardware` uses
    one that is never pressed.
    """

    def __init__(self) -> None:
        self.started = False
        self.closed = False
        self.start_error: str | None = None
        self._on_change: Callable[[bool], None] | None = None

    def start(self, on_change: Callable[[bool], None]) -> None:
        if self.start_error is not None:
            raise ButtonError(self.start_error)
        self.started = True
        self._on_change = on_change

    def close(self) -> None:
        self.closed = True
        self._on_change = None

    def press(self) -> None:
        if self._on_change is not None:
            self._on_change(True)

    def release(self) -> None:
        if self._on_change is not None:
            self._on_change(False)


class FakePresence:
    """A presence sensor you set from a test. `start` and `close` are recorded.

    `set(present)` calls what `start` was given, as the real input does from its own thread. Before `start`, or after
    `close`, nobody is listening and it does nothing, as with a real one. With `initial` the sensor reports that
    reading once when it starts, as the real ones report the level they find: `--fake-hardware` uses `initial=False`,
    a room with nobody in it.
    """

    def __init__(self, initial: bool | None = None) -> None:
        self.started = False
        self.closed = False
        self.start_error: str | None = None
        self._initial = initial
        self._on_change: Callable[[bool], None] | None = None

    def start(self, on_change: Callable[[bool], None]) -> None:
        if self.start_error is not None:
            raise PresenceError(self.start_error)
        self.started = True
        self._on_change = on_change
        if self._initial is not None:
            on_change(self._initial)

    def close(self) -> None:
        self.closed = True
        self._on_change = None

    def set(self, present: bool) -> None:
        if self._on_change is not None:
            self._on_change(present)
