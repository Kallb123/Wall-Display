import { createHash } from 'node:crypto'
import { and, desc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm'
import { createPeopleResolver, DETECTION_VERSION } from '../../shared/people'
import type { ResolvedPeople } from '../../shared/people'
import type { CalendarConfig, Person } from '../config/schema'
import type { Db } from '../db/client'
import { calendars, events, syncStatus } from '../db/schema'
import type { NewEventRow } from '../db/schema'
import type { NormalisedEvent } from './types'

// Writes a calendar's events. The store holds exactly the latest window of
// each calendar: a sync replaces it whole, inside one transaction, and only
// touches the rows that changed. It is also the one place person detection
// runs on a write, so no source can skip it.

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
export function ensureCalendarRow(db: Db, calendar: CalendarConfig, people: readonly Person[]): void {
  const values = {
    id: calendar.id,
    name: calendar.name ?? calendar.id,
    personId: calendar.person,
    sourceType: calendar.source.type,
    configHash: configHash(calendar, people),
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
 * A fingerprint of what decides who a calendar's events are for: the
 * calendar's detection settings and rules, the people's ids, names and aliases
 * (not their colours or initials, which change how an event looks and not who
 * it is for) and the version of the detection algorithm.
 */
export function configHash(calendar: CalendarConfig, people: readonly Person[]): string {
  const parts = {
    detection: DETECTION_VERSION,
    people: people.map(person => ({ id: person.id, name: person.name, aliases: person.aliases })),
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
 * whose fields differ updated. `resolve` decides each event's people and the
 * title shown on the wall (person detection, built for this calendar). Unchanged
 * rows aren't written, so their ids stay put and `updated_at` only moves when
 * something changed. If anything fails the calendar keeps what it had. Other
 * calendars are never touched.
 */
export function replaceCalendarEvents(
  db: Db,
  calendarId: string,
  incoming: NormalisedEvent[],
  resolve: (event: NormalisedEvent) => ResolvedPeople,
): ReplaceResult {
  const wanted = new Map<string, Omit<NewEventRow, 'id' | 'updatedAt'>>()
  for (const event of incoming) {
    const key = keyOf(event.uid, event.recurrenceId)
    if (wanted.has(key)) throw new Error('two events with the same uid and recurrence id')
    const { personIds, displayTitle } = resolve(event)
    wanted.set(key, {
      calendarId,
      uid: event.uid,
      recurrenceId: event.recurrenceId,
      title: event.title,
      displayTitle,
      description: event.description,
      location: event.location,
      startAt: event.startAt,
      endAt: event.endAt,
      allDay: event.allDay,
      startDate: event.startDate,
      endDate: event.endDate,
      personIds,
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

export interface ReresolveResult {
  /** Events the calendar had stored. */
  checked: number
  /** Events whose people or display title were different. */
  changed: number
}

/**
 * Runs person detection again over a calendar's stored events, for when the
 * people or rules in the config have changed. The title and description are
 * stored, so no fetch is needed. Only rows whose answer differs are written, and
 * the calendar's hash is updated in the same transaction, so a crash half way
 * leaves it to be done again at the next boot.
 */
export function reresolveStoredEvents(db: Db, calendar: CalendarConfig, people: readonly Person[]): ReresolveResult {
  const resolve = createPeopleResolver(calendar, people)
  return db.transaction((tx) => {
    const stored = tx.select({
      id: events.id,
      title: events.title,
      description: events.description,
      displayTitle: events.displayTitle,
      personIds: events.personIds,
    }).from(events).where(eq(events.calendarId, calendar.id)).all()

    let changed = 0
    for (const row of stored) {
      const { personIds, displayTitle } = resolve(row)
      if (displayTitle === row.displayTitle && sameIds(personIds, row.personIds)) continue
      tx.update(events).set({ personIds, displayTitle }).where(and(eq(events.id, row.id), eq(events.calendarId, calendar.id))).run()
      changed++
    }
    tx.update(calendars).set({ configHash: configHash(calendar, people) }).where(eq(calendars.id, calendar.id)).run()
    return { checked: stored.length, changed }
  })
}

export interface CalendarRowsResult {
  /** Calendars whose people or rules changed since their events were resolved. */
  reresolved: (ReresolveResult & { calendarId: string })[]
  /** Calendars that were stored but are no longer in the config. */
  removed: string[]
}

/**
 * Brings the stored calendars in line with the config, at boot: re-resolves the
 * events of a calendar whose people or rules changed, makes sure every
 * configured calendar has a row, and deletes the rows of calendars that are no
 * longer configured (their events and sync status go with them), so a removed
 * calendar stops showing on the wall.
 */
export function syncCalendarRows(db: Db, configured: readonly CalendarConfig[], people: readonly Person[]): CalendarRowsResult {
  const reresolved: CalendarRowsResult['reresolved'] = []
  for (const calendar of configured) {
    const row = db.select({ configHash: calendars.configHash }).from(calendars).where(eq(calendars.id, calendar.id)).get()
    if (row && row.configHash !== configHash(calendar, people)) {
      reresolved.push({ calendarId: calendar.id, ...reresolveStoredEvents(db, calendar, people) })
    }
    ensureCalendarRow(db, calendar, people)
  }

  const keep = new Set(configured.map(calendar => calendar.id))
  const removed = db.select({ id: calendars.id }).from(calendars).all().map(row => row.id).filter(id => !keep.has(id))
  if (removed.length > 0) db.delete(calendars).where(inArray(calendars.id, removed)).run()
  return { reresolved, removed }
}

/**
 * When the most recent successful sync finished, across all calendars, or null
 * if none has succeeded yet (a fresh database, or only failures so far). A
 * failed sync leaves `last_success_at` alone, so this is the last time any
 * calendar was known to be up to date.
 */
export function lastSyncAt(db: Db): Date | null {
  const row = db.select({ at: syncStatus.lastSuccessAt }).from(syncStatus)
    .where(isNotNull(syncStatus.lastSuccessAt))
    .orderBy(desc(syncStatus.lastSuccessAt))
    .limit(1)
    .get()
  return row?.at ?? null
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
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
    || !sameIds(stored.personIds, next.personIds!)
}
