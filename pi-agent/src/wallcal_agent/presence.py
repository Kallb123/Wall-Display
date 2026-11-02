"""Turns the mmWave sensor's readings into a steady "someone is there" / "nobody" answer.

Pure: no threads, no I/O and no clock of its own. Every call is told the time (seconds, from a monotonic clock), so
a test can play any sequence of readings with exact times and the agent can wake its worker thread at exactly the
right moment. agent.py feeds it each reading the sensor gives and publishes the changes it hands back.

The sensor is jumpy. It can drop out for a moment when someone sits very still, or blip on when a door swings, and a
screen that turns on and off with every blip would be worse than none. So a change only counts once the reading has
stayed that way for `hold` seconds. The time is counted from when the reading first changed, not from when it was
confirmed, so the answer is not late by more than it has to be. A reading that flips back sooner is a flicker and is
dropped.

Unlike a button press, presence is a state and not an event: it is true until it changes. So the first reading counts
too, once it has held, and the answer is `None` (not known) until then.

One thing needs care: a change is confirmed by the clock passing its deadline, but `update` can be called after the
deadline and before anyone has called `tick`. A reading that has held long enough is confirmed before the next
reading is looked at, otherwise a long "someone is there" followed by a sudden "nobody" would look like a flicker.
"""


class PresenceFilter:
    """Debounces one sensor. Not safe to share between threads: the caller holds a lock."""

    def __init__(self, hold: float) -> None:
        self._hold = hold
        # What the sensor says right now, and since when. None until the first reading.
        self._raw: bool | None = None
        self._raw_since = 0.0
        # The confirmed answer: the last reading that held for `hold` seconds. None until there is one.
        self._state: bool | None = None
        # When the confirmed answer was confirmed, and the last one `tick` handed out.
        self._confirmed_at = 0.0
        self._reported: bool | None = None

    @property
    def state(self) -> bool | None:
        """The confirmed answer: True for someone there, False for nobody, None until a reading has held."""
        return self._state

    def update(self, present: bool, at: float) -> None:
        """Takes the sensor's reading, seen at time `at`. It may be noisy, and it may repeat."""
        # A change that has held long enough is confirmed before the new reading is looked at. See the module text.
        self._settle(at)
        if present == self._raw:
            # The same reading again. It stays dated from when it first happened.
            return
        self._raw = present
        self._raw_since = at
        # Back to what is already confirmed: the change in between was a flicker. Otherwise a new one is waiting.
        self._settle(at)

    def tick(self, now: float) -> bool | None:
        """The new confirmed answer if it has changed since the last call, otherwise None. Handed out once."""
        self._settle(now)
        if self._state is None or self._state == self._reported:
            return None
        self._reported = self._state
        return self._state

    def next_deadline(self) -> float | None:
        """The time `tick` next has something to do, or None when nothing is waiting. May be in the past."""
        deadlines = []
        # A change confirmed in passing (see the module text) that nobody has been told about yet is due already.
        if self._state is not None and self._state != self._reported:
            deadlines.append(self._confirmed_at)
        if self._raw is not None and self._raw != self._state:
            deadlines.append(self._raw_since + self._hold)
        return min(deadlines) if deadlines else None

    def _settle(self, now: float) -> None:
        """Confirms a reading that has stayed put for `hold` seconds."""
        if self._raw is not None and self._raw != self._state and now >= self._raw_since + self._hold:
            self._state = self._raw
            # When it really became true, so a worker that wakes late is not told to wait for a time already gone.
            self._confirmed_at = self._raw_since + self._hold
