// The shape of Home Assistant's calendar API, as the fetch hands it on after
// checking it. Pure types: nothing here touches the network or the database.

/**
 * A start or end, as Home Assistant writes it: `date` (`YYYY-MM-DD`) for an
 * all-day event, `dateTime` (ISO 8601, normally with an offset) otherwise.
 */
export type HaEventTime = { date: string } | { dateTime: string }

/**
 * One event from `GET /api/calendars/<entity_id>?start&end`. Home Assistant
 * has already expanded recurring events, so each one is a single instance.
 * Integrations differ in what they fill in: `uid` and `recurrence_id` are
 * often missing, and so are `description` and `location`.
 */
export interface HaCalendarEvent {
  summary: string | null
  description: string | null
  location: string | null
  start: HaEventTime
  /** All-day events: the day after the last day. */
  end: HaEventTime
  uid: string | null
  recurrence_id: string | null
}
