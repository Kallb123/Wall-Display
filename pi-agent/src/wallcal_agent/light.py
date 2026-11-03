"""Decides which light readings are worth publishing.

Pure: no threads, no I/O and no clock of its own. Every call is told the time (seconds, from a monotonic clock), so a
test can play any sequence of readings with exact times. agent.py reads the sensor every `sample_ms` and asks this
whether each reading should go out.

The sensor is read often, and most readings are the same room again. Publishing every one would fill the broker and
Home Assistant's history for nothing. So a reading is published when it differs meaningfully from the last one that
was, and otherwise only every `report_interval`, so a subscriber is never more than that out of date. That heartbeat
is also how Home Assistant tells a steady room from a sensor that has stopped.

"Meaningfully" has two parts. A change must be at least `change_percent` of the last published value, so a bright
room has to move a good deal and a dim one only a little. It must also be at least `change_lux`, because in the dark
a few hundredths of a lux are more than 10% and are only noise.
"""


class LightReporter:
    """Decides for one sensor. Not safe to share between threads: the caller holds a lock."""

    def __init__(self, change_percent: float, change_lux: float, report_interval: float) -> None:
        self._change_percent = change_percent
        self._change_lux = change_lux
        self._report_interval = report_interval
        # The last reading that was published, and when. None until there is one (and again after `reset`).
        self._published: float | None = None
        self._published_at = 0.0

    def offer(self, lux: float, now: float) -> bool:
        """Whether this reading, taken at time `now`, should be published. Saying yes records it as published.

        That is the first reading (or the first after `reset`), a meaningful change from the last one published, or
        the first one `report_interval` after the last one published.
        """
        if self._published is None:
            return self._publish(lux, now)
        # The clock is meant to be monotonic, but if it steps back the heartbeat counts from the new time, and not
        # from a time that may be a long way ahead.
        if now < self._published_at:
            self._published_at = now
        threshold = max(self._published * self._change_percent / 100, self._change_lux)
        if abs(lux - self._published) >= threshold or now - self._published_at >= self._report_interval:
            return self._publish(lux, now)
        return False

    def reset(self) -> None:
        """Forgets what was published, so the next reading is. Called on every connect: a broker that has just been
        reached has not been told anything yet."""
        self._published = None

    def _publish(self, lux: float, now: float) -> bool:
        self._published = lux
        self._published_at = now
        return True
