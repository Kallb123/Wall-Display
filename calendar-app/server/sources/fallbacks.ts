import { and, asc, eq, gt, gte, lt, or } from 'drizzle-orm'
import { createPeopleResolver } from '../../shared/people'
import type { FallbackEvent } from '../../shared/settings'
import type { CalendarConfig, Person } from '../config/schema'
import type { Db } from '../db/client'
import { events } from '../db/schema'

// Finds the events that fell through to their calendar's default person, for
// the settings page's Calendars tab: no name, alias or rule matched them, so
// each is a prompt to add one (architecture §3.3, §7.6). `matchedBy` isn't
// stored, so it is worked out here, on read, by running person detection again
// over the stored title and description.

export interface FallbackOptions {
  /** How far before now to look, in days. Default 30. */
  daysBack?: number
  /** How far after now to look, in days. Default 30. */
  daysAhead?: number
  /** The most events to return. Default 20. */
  limit?: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The calendar's events in the window that nothing matched, one per `uid` (a
 * recurring event's instances share it, so they are grouped and counted), in
 * start order. When there are more than `limit`, the ones nearest to now are
 * kept, and each shows its occurrence nearest to now. Always empty when the
 * calendar has detection off: everything on it is the default person's by
 * choice, so nothing "fell through".
 */
export function recentFallbacks(
  db: Db,
  calendar: CalendarConfig,
  people: readonly Person[],
  now: Date,
  { daysBack = 30, daysAhead = 30, limit = 20 }: FallbackOptions = {},
): FallbackEvent[] {
  if (calendar.detect_people === false) return []

  const from = new Date(now.getTime() - daysBack * DAY_MS)
  const to = new Date(now.getTime() + daysAhead * DAY_MS)
  // The same overlap rule as the events list: a zero-length event counts if it starts in the window.
  const rows = db.select({
    uid: events.uid,
    title: events.title,
    description: events.description,
    personIds: events.personIds,
    startAt: events.startAt,
    allDay: events.allDay,
    startDate: events.startDate,
  }).from(events).where(and(
    eq(events.calendarId, calendar.id),
    or(
      and(lt(events.startAt, to), gt(events.endAt, from)),
      and(eq(events.endAt, events.startAt), gte(events.startAt, from), lt(events.startAt, to)),
    ),
  )).orderBy(asc(events.startAt), asc(events.id)).all()

  const resolve = createPeopleResolver(calendar, people)
  const groups = new Map<string, { nearest: (typeof rows)[number], occurrences: number }>()
  for (const row of rows) {
    // Anything that matched has other people, or the default one named; skip it without the regular expressions.
    if (row.personIds.length !== 1 || row.personIds[0] !== calendar.person) continue
    if (resolve(row).matchedBy !== 'default') continue

    const group = groups.get(row.uid)
    if (!group) groups.set(row.uid, { nearest: row, occurrences: 1 })
    else {
      group.occurrences++
      // Rows come in start order, so a tie keeps the earlier one.
      if (distance(row.startAt, now) < distance(group.nearest.startAt, now)) group.nearest = row
    }
  }

  return [...groups.values()]
    .sort((a, b) => distance(a.nearest.startAt, now) - distance(b.nearest.startAt, now) || a.nearest.startAt.getTime() - b.nearest.startAt.getTime())
    .slice(0, limit)
    .sort((a, b) => a.nearest.startAt.getTime() - b.nearest.startAt.getTime())
    .map(({ nearest, occurrences }) => ({
      title: nearest.title,
      start: nearest.startAt.toISOString(),
      all_day: nearest.allDay,
      start_date: nearest.startDate,
      occurrences,
    }))
}

function distance(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime())
}
