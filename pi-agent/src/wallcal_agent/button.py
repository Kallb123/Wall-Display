"""Turns the raw ups and downs of a push button into single, double and long presses.

Pure: no threads, no I/O and no clock of its own. Every call is told the time (seconds, from a monotonic clock), so
a test can play any sequence of presses with exact times and the agent can wake its worker thread at exactly the
right moment. agent.py feeds it the input's changes and publishes the gestures it hands back.

How a press is read:

- The input is debounced here, not by the GPIO library. A change counts once the input has stayed that way for
  `bounce` seconds, and it is dated from when it first happened, not from when it was confirmed. A change that
  flips back sooner is noise and is dropped.
- A press that is let go before `long_press` is a short press. It might be the first half of a double, so a
  single is only reported once `double_press` has passed with no second press.
- A second press within `double_press` of the first release is a double, reported at once. Holding that second
  press, or letting it go, adds nothing.
- A press held for `long_press` is a long press, reported while the button is still down, so the person gets
  their answer without having to let go. Letting go afterwards adds nothing.

One thing needs care: confirming a change takes `bounce` seconds, so a decision that depends on a deadline can
fall due while a change is still being confirmed. Those decisions wait. When the change is confirmed it is applied
at the time it really happened, and only then are the deadlines looked at. Otherwise a second press that was
quick enough, but confirmed a little late, would turn a double into a single followed by a single.
"""

SINGLE = "single"
DOUBLE = "double"
LONG = "long"


class GestureDetector:
    """Classifies one button's presses. Not safe to share between threads: the caller holds a lock."""

    def __init__(self, bounce: float, double_press: float, long_press: float) -> None:
        self._bounce = bounce
        self._double_press = double_press
        self._long_press = long_press

        # What the input says right now, and since when. A button starts out released, so one that is held down at
        # start-up does nothing until it has been let go and pressed again.
        self._raw = False
        self._raw_since = 0.0
        # The debounced state: the last level that held for `bounce` seconds. True is pressed.
        self._stable = False

        # While pressed: when it began, and whether it has already been used up (as the second press of a double,
        # or by reporting a long press), so letting go does not also report a single.
        self._press_start = 0.0
        self._consumed = False
        # While a short press waits to see whether a second one follows: when it was let go.
        self._released_at: float | None = None

        # Gestures decided while an edge was being handled, handed out by the next `tick`.
        self._ready: list[str] = []
        self._ready_since = 0.0

    def edge(self, pressed: bool, at: float) -> None:
        """Takes the input's level, True for pressed, seen at time `at`. It may be noisy, and may repeat."""
        # A change that has been steady long enough is confirmed before the new level is looked at. Otherwise a
        # real press followed by a long silence and then a release would look like a blip that flipped back.
        self._settle(at)
        if pressed == self._raw:
            return
        self._raw = pressed
        self._raw_since = at
        # Back to where it was before it was confirmed: that was noise.
        self._settle(at)

    def tick(self, now: float) -> list[str]:
        """The gestures that are due by `now`, in the order they happened. Each is handed out once."""
        self._settle(now)
        if not self._unsettled():
            self._fire_due(now)
        ready, self._ready = self._ready, []
        return ready

    def next_deadline(self) -> float | None:
        """The time `tick` next has something to do, or None when the button is idle. May be in the past."""
        if self._unsettled():
            deadlines = [self._raw_since + self._bounce]
        else:
            deadlines = []
            if self._released_at is not None:
                deadlines.append(self._released_at + self._double_press)
            if self._stable and not self._consumed:
                deadlines.append(self._press_start + self._long_press)
        if self._ready:
            deadlines.append(self._ready_since)
        return min(deadlines) if deadlines else None

    def _unsettled(self) -> bool:
        """Whether the input has changed and is still being checked for bounce."""
        return self._raw != self._stable

    def _settle(self, now: float) -> None:
        """Confirms a change that has stayed put for `bounce` seconds, and drops one that went back."""
        if self._unsettled() and now >= self._raw_since + self._bounce:
            self._stable = self._raw
            if self._raw:
                self._pressed(self._raw_since)
            else:
                self._released(self._raw_since)
            self._ready_since = now

    def _pressed(self, at: float) -> None:
        """A confirmed press that really happened at `at`."""
        if self._released_at is not None and at > self._released_at + self._double_press:
            # The window closed before this press began. The earlier one was a single after all.
            self._ready.append(SINGLE)
            self._released_at = None
        if self._released_at is not None:
            self._released_at = None
            self._ready.append(DOUBLE)
            self._consumed = True
        else:
            self._consumed = False
        self._press_start = at

    def _released(self, at: float) -> None:
        """A confirmed release that really happened at `at`."""
        if not self._consumed and at >= self._press_start + self._long_press:
            # The long press was due before the button came up, so it was a long press even though nothing has
            # asked for it yet.
            self._ready.append(LONG)
            self._consumed = True
        if not self._consumed:
            self._released_at = at

    def _fire_due(self, now: float) -> None:
        """Reports a single or a long press whose time has come, when no change is waiting to be confirmed.

        The deadlines are worked out exactly as `next_deadline` works them out, so a worker that wakes at one always
        finds it due: subtracting instead could come out a hair short with floating point and leave it spinning.
        """
        if self._released_at is not None and now >= self._released_at + self._double_press:
            self._released_at = None
            self._ready.append(SINGLE)
        if self._stable and not self._consumed and now >= self._press_start + self._long_press:
            self._consumed = True
            self._ready.append(LONG)
