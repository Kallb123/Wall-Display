// What `GET /api/events` returns, shared by the server and the pages that show
// events. The wire format is snake_case, like the state and command contract.

/** A person on an event, with what the wall needs to draw them. */
export interface EventPerson {
  id: string
  name: string
  initial: string
  colour: string
}

/** One event, or one instance of a recurring event, as the display and the remote see it. */
export interface CalendarEvent {
  id: number
  calendar_id: string
  /** The title as the source had it. */
  title: string
  /** What the wall shows: the title, with any names stripped. */
  display_title: string
  location: string | null
  /** ISO 8601 instants, in UTC. */
  start: string
  end: string
  all_day: boolean
  /** All-day events only: `YYYY-MM-DD`. */
  start_date: string | null
  /** All-day events only: `YYYY-MM-DD`, the day after the last day. */
  end_date: string | null
  /** In the order person detection found them; the first sets the colour. */
  people: EventPerson[]
}

export interface EventsResponse {
  /** The range that was asked for, as ISO 8601 instants. */
  from: string
  to: string
  events: CalendarEvent[]
}
