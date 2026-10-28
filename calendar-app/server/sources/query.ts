import { and, asc, desc, eq, gt, gte, inArray, lt, or } from 'drizzle-orm'
import { z } from 'zod'
import type { CalendarEvent, EventPerson } from '../../shared/types/events'
import type { CalendarConfig, Person } from '../config/schema'
import type { Db } from '../db/client'
import { events } from '../db/schema'
import { zonedWallTimeToUtc } from './time'

// Reads stored events back out for `GET /api/events`. The handler only parses
// the query and calls these.

const DAY_MS = 24 * 60 * 60 * 1000
/** The longest range one request may ask for. */
export const MAX_RANGE_DAYS = 366

export interface EventRange {
  /** Included. */
  from: Date
  /** Not included. */
  to: Date
}

const BOUND_HELP = 'must be a date like 2026-10-01, or an ISO 8601 time with Z or an offset like 2026-10-01T09:00:00Z'
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
// A `+` in a URL query reads as a space, so a space before the offset means `+`.
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?:(Z)|([+\- ])(\d{2}):?(\d{2}))$/i

/** Whether the month has a day this number (`2026-02-31` has not). */
function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** A query value as an instant: a date means midnight at the start of that day in the display zone. */
function bound(timeZone: string) {
  return z.string({ error: 'is required' }).transform((value, ctx): Date => {
    const invalid = () => {
      ctx.issues.push({ code: 'custom', message: BOUND_HELP, input: value })
      return z.NEVER
    }

    const date = DATE.exec(value)
    if (date) {
      const [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])]
      return isRealDate(year, month, day) ? zonedWallTimeToUtc({ year, month, day }, timeZone) : invalid()
    }

    const instant = INSTANT.exec(value)
    if (!instant) return invalid()
    const [year, month, day, hour, minute] = [1, 2, 3, 4, 5].map(i => Number(instant[i]))
    const second = Number(instant[6] ?? 0)
    const offsetHours = Number(instant[10] ?? 0)
    const offsetMinutes = Number(instant[11] ?? 0)
    if (!isRealDate(year!, month!, day!) || hour! > 23 || minute! > 59 || second > 59 || offsetHours > 23 || offsetMinutes > 59) return invalid()

    const offset = (instant[8] ? 0 : (offsetHours * 60 + offsetMinutes) * 60_000) * (instant[9] === '-' ? -1 : 1)
    const millis = Number((instant[7] ?? '').slice(0, 3).padEnd(3, '0'))
    return new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!, second, millis) - offset)
  })
}

/**
 * The range a request asked for. Throws an `Error` with a short message, safe
 * to send back in a 400, if `from` or `to` is missing or not a date or an
 * instant, if `to` is not after `from`, or if the range is over 366 days.
 */
export function parseEventRange(query: unknown, timeZone: string): EventRange {
  const schema = z.object({ from: bound(timeZone), to: bound(timeZone) }).superRefine((range, ctx) => {
    if (range.to.getTime() <= range.from.getTime()) {
      ctx.addIssue({ code: 'custom', message: 'must be after from', path: ['to'] })
    } else if (range.to.getTime() - range.from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      ctx.addIssue({ code: 'custom', message: `must be at most ${MAX_RANGE_DAYS} days after from`, path: ['to'] })
    }
  })

  const parsed = schema.safeParse(query)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    throw new Error(`${issue.path.join('.') || 'query'} ${issue.message}`)
  }
  return parsed.data
}

export interface ListEventsArgs extends EventRange {
  /** The calendars in the config. Events of any other calendar are not listed. */
  calendars: readonly Pick<CalendarConfig, 'id'>[]
  people: readonly Person[]
}

/**
 * The events that overlap `[from, to)`: those that start before `to` and end
 * after `from`, and a zero-length event that starts in the range. Ordered by
 * start, then all-day events first, then id. Each carries its people, in the
 * order they were found; a person no longer in the config is left out.
 */
export function listEvents(db: Db, { from, to, calendars, people }: ListEventsArgs): CalendarEvent[] {
  if (calendars.length === 0) return []

  const rows = db.select().from(events).where(and(
    inArray(events.calendarId, calendars.map(calendar => calendar.id)),
    or(
      and(lt(events.startAt, to), gt(events.endAt, from)),
      and(eq(events.endAt, events.startAt), gte(events.startAt, from), lt(events.startAt, to)),
    ),
  )).orderBy(asc(events.startAt), desc(events.allDay), asc(events.id)).all()

  const known = new Map<string, EventPerson>(people.map(person => [person.id, { id: person.id, name: person.name, initial: person.initial, colour: person.colour }]))
  return rows.map(row => ({
    id: row.id,
    calendar_id: row.calendarId,
    title: row.title,
    display_title: row.displayTitle,
    location: row.location,
    start: row.startAt.toISOString(),
    end: row.endAt.toISOString(),
    all_day: row.allDay,
    start_date: row.startDate,
    end_date: row.endDate,
    people: row.personIds.flatMap(id => known.get(id) ?? []),
  }))
}
