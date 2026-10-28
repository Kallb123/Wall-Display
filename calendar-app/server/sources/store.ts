import { createHash } from 'node:crypto'
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm'
import type { CalendarConfig } from '../config/schema'
import type { Db } from '../db/client'
import { calendars, events } from '../db/schema'
import type { NewEventRow } from '../db/schema'
import type { NormalisedEvent } from './types'

// Writes a calendar's events. The store holds exactly the latest window of
// each calendar: a sync replaces it whole, inside one transaction, and only
// touches the rows that changed.

export interface ReplaceResult {
  inserted: number
  updated: number
  deleted: number
  /** Events stored for the calendar afterwards. */
  total: number
}

// SQLite allows 32 766 bound values in a statement.
const DELETE_CHUNK = 500

/**
 * Makes sure the calendar has a row, so its events and sync status have
 * something to point at. Updates the row when the config changed, and never
 * deletes it (that would take the events with it).
 */
export function ensureCalendarRow(db: Db, calendar: CalendarConfig): void {
  const values = {
    id: calendar.id,
    name: calendar.name ?? calendar.id,
    personId: calendar.person,
    sourceType: calendar.source.type,
    configHash: configHash(calendar),
  }
  db.insert(calendars).values(values).onConflictDoUpdate({
    target: calendars.id,
    set: { name: values.name, personId: values.personId, sourceType: values.sourceType, configHash: values.configHash, updatedAt: new Date() },
    // Leave a row that already says this alone, so updated_at means something.
    setWhere: or(
      ne(calendars.name, values.name),
      ne(calendars.personId, values.personId),
      ne(calendars.sourceType, values.sourceType),
      ne(calendars.configHash, values.configHash),
    ),
  }).run()
}

/**
 * A fingerprint of the parts of a calendar's config that decide who its events
 * are for. PR 1.2 adds the people to it.
 */
export function configHash(calendar: CalendarConfig): string {
  const parts = {
    person: calendar.person,
    detect_people: calendar.detect_people,
    detect_in: calendar.detect_in,
    strip_names: calendar.strip_names,
    rules: calendar.rules.map(rule => ({ match: rule.match, people: rule.people })),
  }
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

/**
 * Replaces everything stored for a calendar with `incoming`, in one
 * transaction: rows that are gone are deleted, new ones inserted, and ones
 * whose fields differ updated. Unchanged rows aren't written, so their ids
 * stay put and `updated_at` only moves when something changed. If anything
 * fails the calendar keeps what it had. Other calendars are never touched.
 */
export function replaceCalendarEvents(db: Db, calendarId: string, defaultPersonId: string, incoming: NormalisedEvent[]): ReplaceResult {
  // PR 1.2's person detection replaces the default person and the plain title.
  const wanted = new Map<string, Omit<NewEventRow, 'id' | 'updatedAt'>>()
  for (const event of incoming) {
    const key = keyOf(event.uid, event.recurrenceId)
    if (wanted.has(key)) throw new Error('two events with the same uid and recurrence id')
    wanted.set(key, {
      calendarId,
      uid: event.uid,
      recurrenceId: event.recurrenceId,
      title: event.title,
      displayTitle: event.title,
      description: event.description,
      location: event.location,
      startAt: event.startAt,
      endAt: event.endAt,
      allDay: event.allDay,
      startDate: event.startDate,
      endDate: event.endDate,
      personIds: [defaultPersonId],
    })
  }

  return db.transaction((tx) => {
    const stored = tx.select().from(events).where(eq(events.calendarId, calendarId)).all()

    const gone: number[] = []
    const changed: { id: number, row: Omit<NewEventRow, 'id' | 'updatedAt'> }[] = []
    const kept = new Set<string>()
    for (const row of stored) {
      const key = keyOf(row.uid, row.recurrenceId)
      const next = wanted.get(key)
      if (!next) gone.push(row.id)
      else {
        kept.add(key)
        if (differs(row, next)) changed.push({ id: row.id, row: next })
      }
    }
    const added = [...wanted].filter(([key]) => !kept.has(key)).map(([, row]) => row)

    for (let i = 0; i < gone.length; i += DELETE_CHUNK) {
      tx.delete(events).where(inArray(events.id, gone.slice(i, i + DELETE_CHUNK))).run()
    }
    for (const { id, row } of changed) {
      const { calendarId: _calendarId, uid: _uid, recurrenceId: _recurrenceId, ...fields } = row
      tx.update(events).set(fields).where(and(eq(events.id, id), eq(events.calendarId, calendarId))).run()
    }
    if (added.length > 0) {
      // One prepared statement, run for each row: building a multi-row INSERT
      // through the query builder costs more than SQLite does to run it.
      const insert = tx.insert(events).values({
        calendarId: sql.placeholder('calendarId'),
        uid: sql.placeholder('uid'),
        recurrenceId: sql.placeholder('recurrenceId'),
        title: sql.placeholder('title'),
        displayTitle: sql.placeholder('displayTitle'),
        description: sql.placeholder('description'),
        location: sql.placeholder('location'),
        startAt: sql.placeholder('startAt'),
        endAt: sql.placeholder('endAt'),
        allDay: sql.placeholder('allDay'),
        startDate: sql.placeholder('startDate'),
        endDate: sql.placeholder('endDate'),
        personIds: sql.placeholder('personIds'),
      }).prepare()
      for (const row of added) insert.run(row)
    }

    return { inserted: added.length, updated: changed.length, deleted: gone.length, total: wanted.size }
  })
}

function keyOf(uid: string, recurrenceId: string): string {
  return `${uid.length}:${uid}${recurrenceId}`
}

function differs(stored: typeof events.$inferSelect, next: Omit<NewEventRow, 'id' | 'updatedAt'>): boolean {
  return stored.title !== next.title
    || stored.displayTitle !== next.displayTitle
    || stored.description !== next.description
    || stored.location !== next.location
    || stored.startAt.getTime() !== next.startAt.getTime()
    || stored.endAt.getTime() !== next.endAt.getTime()
    || stored.allDay !== next.allDay
    || stored.startDate !== next.startDate
    || stored.endDate !== next.endDate
    || JSON.stringify(stored.personIds) !== JSON.stringify(next.personIds)
}
