"""What the agent does on its own while the app is away: turn the screen off when nobody is there, on when someone is.

Pure: no threads, no I/O and no clock of its own. Every call is told the time (seconds, from a monotonic clock), so a
test can play any sequence of events with exact times and the agent can wake its worker thread at exactly the right
moment. agent.py tells it whether the app is up and what the presence filter has confirmed, and carries out the
actions `tick` hands back.

The app is "down" when the agent is not connected to the broker, or has not heard the app say it is online. Once it has
been down for `timeout` seconds without a break, the fallback takes over (TAKE_OVER). At the start the app counts as
down from the moment the policy is made, so a Pi that boots while the server is away still takes over in time. The
moment the app is up again the fallback hands back (HAND_BACK): the app publishes the screen state when it connects, so
nothing more is needed. An app that comes back before the timeout never notices anything, and the timer starts afresh
the next time it goes down.

While in charge, the screen follows the people in the room:
- Someone arrives (presence goes on): SCREEN_ON, at once. Presence that is already on when the fallback takes over does
  nothing by itself, because the screen is left as the app left it.
- Nobody there for `off_after` seconds: SCREEN_OFF, once. The wait counts from when presence went off, or from when the
  fallback took over if that is later: an empty room that the app was already looking after is not "empty for ten
  minutes" the moment the app drops out. Presence that is not known cancels the wait and does nothing to the screen.
- Someone else turns the screen on while nobody is there (`screen_turned_on`): the wait starts again from then, so the
  screen still goes off later.

Two things need care. First, deadlines are judged by the time they fell due and not by the time `tick` happened to run,
so a late tick gives the same answer as one on time. For that, `app`, `presence` and `screen_turned_on` first settle
whatever fell due before them, like presence.py does for a confirmed reading: with the app down at 0 and a timeout of
300, presence arriving at 400 with no tick in between still arrives while the fallback is in charge. Second, an action
that fell due but was never handed out can be overtaken by events. A take-over that the app's return cancelled before
`tick` ran is dropped silently, since nobody was told the fallback was in charge. A screen action is dropped by a
hand-back, and a SCREEN_OFF that nobody has been told about is dropped when someone turns the screen on after it fell
due. A tick never returns SCREEN_ON and SCREEN_OFF together: the later of the two replaces the earlier, which leaves the
screen in the state it would have ended up in anyway.
"""

TAKE_OVER = "take_over"
HAND_BACK = "hand_back"
SCREEN_ON = "screen_on"
SCREEN_OFF = "screen_off"


class FallbackPolicy:
    """Decides when the agent looks after the screen itself. Not safe to share: the caller holds a lock."""

    def __init__(self, timeout: float, off_after: float, now: float) -> None:
        self._timeout = timeout
        self._off_after = off_after
        # When the app went down, or None while it is up. It is down from the start, until it is said to be up.
        self._down_since: float | None = now
        # Whether the fallback has taken over, and what is waiting to be handed out by `tick`, each with the time it
        # fell due. A hand-back and a take-over can both wait, for an app that came and went between two ticks.
        self._in_charge = False
        self._take_over_due: float | None = None
        self._hand_back_due: float | None = None
        # True from when a take-over has been handed out until the hand-back has been: the only time one is owed.
        self._announced = False
        # The one screen action waiting, with the time it fell due. A newer one replaces an older one.
        self._screen: tuple[str, float] | None = None
        # The confirmed presence, and since when. Remembered while not in charge too, for the day it takes over.
        self._present: bool | None = None
        self._present_since = 0.0
        # When the wait for an empty room started, or None when there is none (or it has run out: see _off_done).
        self._off_from: float | None = None
        self._off_done = False

    @property
    def in_charge(self) -> bool:
        """True from the take-over until the app is up again. A take-over not yet settled by a call is not counted."""
        return self._in_charge

    def app(self, up: bool, at: float) -> None:
        """Whether the app is up, at time `at`. It may repeat: down stays dated from when it first went down."""
        self._settle(at)
        if not up:
            if self._down_since is None:
                self._down_since = at
            return
        self._down_since = None
        if not self._in_charge:
            return
        self._in_charge = False
        self._screen = None
        self._off_from = None
        if self._take_over_due is not None:
            # The take-over was never handed out, so there is nothing to hand back. Nobody was told.
            self._take_over_due = None
        elif self._announced:
            self._hand_back_due = at

    def presence(self, present: bool | None, at: float) -> None:
        """The confirmed presence: True someone there, False nobody, None not known. It may repeat."""
        self._settle(at)
        if present == self._present:
            return
        self._present = present
        self._present_since = at
        if not self._in_charge:
            return
        self._off_from = at if present is False else None
        self._off_done = False
        if present:
            self._screen = (SCREEN_ON, at)

    def screen_turned_on(self, at: float) -> None:
        """Someone else turned the screen on (a live request while in charge)."""
        self._settle(at)
        if not self._in_charge or self._present is not False:
            return
        # Whatever the screen did before, it is on now and the room is empty: wait again, and allow another SCREEN_OFF.
        self._off_from = at
        self._off_done = False
        if self._screen is not None and self._screen[0] == SCREEN_OFF:
            self._screen = None

    def tick(self, now: float) -> list[str]:
        """What has happened by `now`, in order. Each action is handed out once."""
        self._settle(now)
        # A hand-back goes out alone. A take-over that fell due after it waits for the next tick.
        if self._hand_back_due is not None:
            self._hand_back_due = None
            self._announced = False
            return [HAND_BACK]
        out: list[str] = []
        if self._take_over_due is not None:
            self._take_over_due = None
            self._announced = True
            out.append(TAKE_OVER)
        if self._screen is not None:
            out.append(self._screen[0])
            self._screen = None
        return out

    def next_deadline(self) -> float | None:
        """The time `tick` next has something to do, or None when nothing is waiting. May be in the past."""
        deadlines = []
        # Anything waiting to be handed out is due at the time it fell due, which may have been a while ago.
        if self._hand_back_due is not None:
            deadlines.append(self._hand_back_due)
        if self._take_over_due is not None:
            deadlines.append(self._take_over_due)
        if self._screen is not None:
            deadlines.append(self._screen[1])
        if not self._in_charge and self._down_since is not None:
            deadlines.append(self._down_since + self._timeout)
        if self._in_charge and self._off_from is not None and not self._off_done:
            deadlines.append(self._off_from + self._off_after)
        return min(deadlines) if deadlines else None

    def _settle(self, now: float) -> None:
        """Takes over, and then turns the screen off, if their time has come, each judged by when it fell due."""
        if not self._in_charge and self._down_since is not None and now >= self._down_since + self._timeout:
            took_over_at = self._down_since + self._timeout
            self._in_charge = True
            self._take_over_due = took_over_at
            # An empty room counts from the later of the room emptying and the take-over, never from the tick.
            if self._present is False:
                self._off_from = max(self._present_since, took_over_at)
                self._off_done = False
        if self._in_charge and self._off_from is not None and not self._off_done:
            due = self._off_from + self._off_after
            if now >= due:
                self._off_done = True
                # Replaces a SCREEN_ON that fell due earlier: the screen ends up off either way.
                self._screen = (SCREEN_OFF, due)
