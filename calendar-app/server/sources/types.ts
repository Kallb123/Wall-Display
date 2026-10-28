// The shapes shared by the calendar sources (ICS now, Home Assistant later).
// Pure types: nothing here touches the network or the database.

/**
 * One event or one instance of a recurring event, as every source hands it to
 * the store. Person detection adds the people and the display title when it is stored.
 */
export interface NormalisedEvent {
  /** The source's own id for the event (the ICS UID). */
  uid: string
  /** '' for a one-off event. Otherwise the original start of this instance: `YYYYMMDD` for an all-day series, else the UTC instant as `YYYYMMDDTHHMMSSZ`. */
  recurrenceId: string
  title: string
  description: string | null
  location: string | null
  /** A UTC instant. For an all-day event, midnight of its first day in the display time zone. */
  startAt: Date
  endAt: Date
  allDay: boolean
  /** All-day events only: `YYYY-MM-DD`. */
  startDate: string | null
  /** All-day events only: `YYYY-MM-DD`, the day after the last day. */
  endDate: string | null
}

/** The span of time a sync keeps events for: `start` is included, `end` is not. */
export interface SyncWindow {
  start: Date
  end: Date
}
