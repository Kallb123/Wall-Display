import { addDays, todayIn } from './dates'
import { formatTime } from './format'
import type { CalendarEvent } from './types/events'

// Which days an event is on, in the display's time zone, and what it looks like
// on each. One place for the rules, so the agenda, the month grid and the side
// panel agree. Days are `YYYY-MM-DD` strings and the arithmetic is on UTC dates,
// never the process's local time. Pure: no Nuxt or Vue imports.

/** The days an event covers, with its start and end as instants for comparing lengths. */
export interface EventSpan {
  /** `YYYY-MM-DD`, the first day. */
  first: string
  /** `YYYY-MM-DD`, the last day (included). */
  last: string
  /** Instants in ms. For an all-day event, midnight UTC of its first day and of the day after its last, so it compares with a timed event's length. */
  start: number
  end: number
}

/** An all-day event's days as instants. */
function dayInstant(date: string): number {
  return Date.parse(`${date}T00:00:00Z`)
}

/**
 * The days `event` covers, or `null` if it covers none (an all-day event that
 * ends before it starts). An all-day event is on `start_date <= D < end_date`.
 * A timed event is on every day from its start day to the day of `end - 1ms`:
 * one that ends exactly at midnight is over by the next day, and one with no
 * length is still on its day.
 */
export function eventSpan(event: CalendarEvent, timeZone: string): EventSpan | null {
  if (event.all_day) {
    const first = event.start_date ?? todayIn(new Date(event.start), timeZone)
    const after = event.end_date ?? addDays(first, 1)
    if (after <= first) return null
    return { first, last: addDays(after, -1), start: dayInstant(first), end: dayInstant(after) }
  }

  const start = Date.parse(event.start)
  const end = Date.parse(event.end)
  return {
    first: todayIn(new Date(start), timeZone),
    last: todayIn(new Date(Math.max(start, end - 1)), timeZone),
    start,
    end,
  }
}

/** An event as it appears on one day. */
export interface DayEntry {
  event: CalendarEvent
  /** The event's first day. */
  startDate: string
  /** Instants in ms, as in `EventSpan`. */
  start: number
  end: number
  /** `09:00`, or `Until 11:30` for a timed event that began on an earlier day. `null` for an all-day entry. */
  time: string | null
}

/**
 * Every entry on `date`, sorted: all-day first, then timed. A timed event that
 * began before `date` and ends after it takes the whole day, so it is an
 * all-day entry. All-day entries run by start and then longest first, so a
 * week away sits above a single day; timed ones by start, end and id.
 */
export function entriesOn(events: CalendarEvent[], date: string, timeZone: string): { allDay: DayEntry[], timed: DayEntry[] } {
  const allDay: DayEntry[] = []
  const timed: DayEntry[] = []

  for (const event of events) {
    const span = eventSpan(event, timeZone)
    if (!span || date < span.first || date > span.last) continue
    const entry = { event, startDate: span.first, start: span.start, end: span.end }

    // Begun on an earlier day and still going after this one: it takes the whole day.
    if (event.all_day || (span.first < date && todayIn(new Date(span.end), timeZone) > date)) {
      allDay.push({ ...entry, time: null })
      continue
    }

    const time = span.first < date ? `Until ${formatTime(new Date(span.end), timeZone)}` : formatTime(new Date(span.start), timeZone)
    timed.push({ ...entry, time })
  }

  allDay.sort((a, b) => a.startDate.localeCompare(b.startDate) || (b.end - b.start) - (a.end - a.start) || a.event.id - b.event.id)
  timed.sort((a, b) => a.start - b.start || a.end - b.end || a.event.id - b.event.id)
  return { allDay, timed }
}
