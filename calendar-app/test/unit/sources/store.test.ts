import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { calendars, events } from '../../../server/db/schema'
import { configHash, ensureCalendarRow, replaceCalendarEvents } from '../../../server/sources/store'
import type { NormalisedEvent } from '../../../server/sources/types'
import { migratedMemoryDb } from '../db/helpers'
import { calendarConfig } from './helpers'

function event(overrides: Partial<NormalisedEvent> = {}): NormalisedEvent {
  return {
    uid: 'swim@example.com',
    recurrenceId: '',
    title: 'Swimming',
    description: null,
    location: null,
    startAt: new Date('2026-10-28T16:30:00Z'),
    endAt: new Date('2026-10-28T17:15:00Z'),
    allDay: false,
    startDate: null,
    endDate: null,
    ...overrides,
  }
}

function setup() {
  const { db } = migratedMemoryDb()
  ensureCalendarRow(db, calendarConfig())
  ensureCalendarRow(db, calendarConfig({ id: 'work', name: undefined, person: 'dad' }))
  return db
}

const rowsOf = (db: ReturnType<typeof setup>, calendarId = 'family') =>
  db.select().from(events).where(eq(events.calendarId, calendarId)).orderBy(events.id).all()

describe('ensureCalendarRow', () => {
  it('adds the calendar, naming it after its id when it has no name', () => {
    const db = setup()

    expect(db.select().from(calendars).orderBy(calendars.id).all().map(c => [c.id, c.name, c.personId, c.sourceType, c.configHash])).toEqual([
      ['family', 'Family', 'home', 'ics', configHash(calendarConfig())],
      ['work', 'work', 'dad', 'ics', configHash(calendarConfig({ id: 'work', person: 'dad' }))],
    ])
  })

  it('updates the row when the config changes, and leaves its events alone', () => {
    const db = setup()
    replaceCalendarEvents(db, 'family', 'home', [event()])
    const before = rowsOf(db)

    ensureCalendarRow(db, calendarConfig({ name: 'The family', person: 'mum' }))

    expect(db.select().from(calendars).where(eq(calendars.id, 'family')).get()).toMatchObject({ name: 'The family', personId: 'mum' })
    expect(rowsOf(db)).toEqual(before)
  })

  it('does not touch a row that already says the same', async () => {
    const db = setup()
    const before = db.select().from(calendars).where(eq(calendars.id, 'family')).get()!
    await new Promise(resolve => setTimeout(resolve, 5))

    ensureCalendarRow(db, calendarConfig())

    expect(db.select().from(calendars).where(eq(calendars.id, 'family')).get()).toEqual(before)
  })
})

describe('configHash', () => {
  it('changes with what decides who an event is for, and not with the source', () => {
    const base = configHash(calendarConfig())

    expect(configHash(calendarConfig())).toBe(base)
    expect(configHash(calendarConfig({ person: 'mum' }))).not.toBe(base)
    expect(configHash(calendarConfig({ strip_names: true }))).not.toBe(base)
    expect(configHash(calendarConfig({ detect_people: 'anywhere' }))).not.toBe(base)
    expect(configHash(calendarConfig({ detect_in: ['title'] }))).not.toBe(base)
    expect(configHash(calendarConfig({ rules: [{ match: 'ballet', people: ['isla'] }] }))).not.toBe(base)
    expect(configHash(calendarConfig({ name: 'Other', source: { type: 'ics', url: 'https://example.com/other.ics', poll_seconds: 300 } }))).toBe(base)
  })
})

describe('replaceCalendarEvents', () => {
  it('stores the events, for the default person, with the title shown as it is', () => {
    const db = setup()
    const result = replaceCalendarEvents(db, 'family', 'home', [
      event({ description: 'Who: Theo', location: 'Pool' }),
      event({ uid: 'half-term', title: 'Half term', allDay: true, startAt: new Date('2026-10-26T00:00:00Z'), endAt: new Date('2026-10-31T00:00:00Z'), startDate: '2026-10-26', endDate: '2026-10-31' }),
    ])

    expect(result).toEqual({ inserted: 2, updated: 0, deleted: 0, total: 2 })
    expect(rowsOf(db)).toMatchObject([
      { uid: 'swim@example.com', recurrenceId: '', title: 'Swimming', displayTitle: 'Swimming', description: 'Who: Theo', location: 'Pool', allDay: false, personIds: ['home'] },
      { uid: 'half-term', allDay: true, startDate: '2026-10-26', endDate: '2026-10-31', startAt: new Date('2026-10-26T00:00:00Z') },
    ])
  })

  it('does nothing the second time, and keeps ids and timestamps', async () => {
    const db = setup()
    const input = [event(), event({ uid: 'b', recurrenceId: '20261104T163000Z' })]
    replaceCalendarEvents(db, 'family', 'home', input)
    const before = rowsOf(db)
    await new Promise(resolve => setTimeout(resolve, 5))

    const result = replaceCalendarEvents(db, 'family', 'home', input)

    expect(result).toEqual({ inserted: 0, updated: 0, deleted: 0, total: 2 })
    expect(rowsOf(db)).toEqual(before)
  })

  it('updates an event that changed in place', async () => {
    const db = setup()
    replaceCalendarEvents(db, 'family', 'home', [event(), event({ uid: 'b' })])
    const [first, second] = rowsOf(db)
    await new Promise(resolve => setTimeout(resolve, 5))

    const result = replaceCalendarEvents(db, 'family', 'home', [
      event({ title: 'Swimming (moved)', startAt: new Date('2026-10-28T17:00:00Z'), endAt: new Date('2026-10-28T17:45:00Z') }),
      event({ uid: 'b' }),
    ])

    expect(result).toEqual({ inserted: 0, updated: 1, deleted: 0, total: 2 })
    const [afterFirst, afterSecond] = rowsOf(db)
    expect(afterFirst).toMatchObject({ id: first!.id, title: 'Swimming (moved)', displayTitle: 'Swimming (moved)', startAt: new Date('2026-10-28T17:00:00Z') })
    expect(afterFirst!.updatedAt.getTime()).toBeGreaterThan(first!.updatedAt.getTime())
    expect(afterSecond).toEqual(second)
  })

  it.each([
    ['description', { description: 'New' }],
    ['location', { location: 'New' }],
    ['end', { endAt: new Date('2026-10-28T18:00:00Z') }],
    ['all-day', { allDay: true, startDate: '2026-10-28', endDate: '2026-10-29' }],
  ])('notices a changed %s', (_name, change) => {
    const db = setup()
    replaceCalendarEvents(db, 'family', 'home', [event()])

    expect(replaceCalendarEvents(db, 'family', 'home', [event(change)])).toMatchObject({ updated: 1 })
  })

  it('notices a changed default person', () => {
    const db = setup()
    replaceCalendarEvents(db, 'family', 'home', [event()])

    expect(replaceCalendarEvents(db, 'family', 'mum', [event()])).toMatchObject({ updated: 1 })
    expect(rowsOf(db)[0]!.personIds).toEqual(['mum'])
  })

  it('deletes events that are gone, inserts new ones, and tells instances of a series apart', () => {
    const db = setup()
    replaceCalendarEvents(db, 'family', 'home', [
      event({ recurrenceId: '20261028T163000Z' }),
      event({ recurrenceId: '20261104T163000Z' }),
      event({ uid: 'old' }),
    ])
    const kept = rowsOf(db).find(r => r.recurrenceId === '20261104T163000Z')!

    const result = replaceCalendarEvents(db, 'family', 'home', [
      event({ recurrenceId: '20261104T163000Z' }),
      event({ recurrenceId: '20261111T163000Z' }),
    ])

    expect(result).toEqual({ inserted: 1, updated: 0, deleted: 2, total: 2 })
    const rows = rowsOf(db)
    expect(rows.map(r => r.recurrenceId)).toEqual(['20261104T163000Z', '20261111T163000Z'])
    expect(rows[0]!.id).toBe(kept.id)
  })

  it('stores an empty set by deleting everything', () => {
    const db = setup()
    replaceCalendarEvents(db, 'family', 'home', [event(), event({ uid: 'b' })])

    expect(replaceCalendarEvents(db, 'family', 'home', [])).toEqual({ inserted: 0, updated: 0, deleted: 2, total: 0 })
    expect(rowsOf(db)).toEqual([])
  })

  it('never touches another calendar, even one with the same uids', () => {
    const db = setup()
    replaceCalendarEvents(db, 'work', 'dad', [event(), event({ uid: 'standup' })])
    const work = rowsOf(db, 'work')

    replaceCalendarEvents(db, 'family', 'home', [event({ title: 'Family swimming' })])
    replaceCalendarEvents(db, 'family', 'home', [])

    expect(rowsOf(db, 'work')).toEqual(work)
  })

  it('rolls everything back if a write fails part way', () => {
    const db = setup()
    replaceCalendarEvents(db, 'family', 'home', [event({ uid: 'keep' }), event({ uid: 'change' }), event({ uid: 'remove' })])
    const before = rowsOf(db)
    const bad = { ...event({ uid: 'bad' }), title: null } as unknown as NormalisedEvent

    // Deletes 'remove', updates 'change', then fails inserting 'bad'.
    expect(() => replaceCalendarEvents(db, 'family', 'home', [
      event({ uid: 'keep' }),
      event({ uid: 'change', title: 'Changed' }),
      event({ uid: 'good-new' }),
      bad,
    ])).toThrow(/NOT NULL/)

    expect(rowsOf(db)).toEqual(before)
  })

  it('refuses two events with the same key before writing anything', () => {
    const db = setup()
    replaceCalendarEvents(db, 'family', 'home', [event({ uid: 'keep' })])

    expect(() => replaceCalendarEvents(db, 'family', 'home', [event({ uid: 'a' }), event({ uid: 'a' })])).toThrow(/same uid/)
    expect(rowsOf(db).map(r => r.uid)).toEqual(['keep'])
  })

  it('does not mix up uids and recurrence ids that run together', () => {
    const db = setup()

    const result = replaceCalendarEvents(db, 'family', 'home', [
      event({ uid: 'a', recurrenceId: 'bc' }),
      event({ uid: 'ab', recurrenceId: 'c' }),
    ])

    expect(result).toMatchObject({ inserted: 2, total: 2 })
  })

  it('writes thousands of events in a few chunks', () => {
    const db = setup()
    const many = Array.from({ length: 2300 }, (_, i) => event({ uid: `e${i}`, startAt: new Date(Date.UTC(2026, 0, 1, 0, i)), endAt: new Date(Date.UTC(2026, 0, 1, 1, i)) }))

    expect(replaceCalendarEvents(db, 'family', 'home', many)).toEqual({ inserted: 2300, updated: 0, deleted: 0, total: 2300 })
    expect(replaceCalendarEvents(db, 'family', 'home', many.slice(100))).toEqual({ inserted: 0, updated: 0, deleted: 100, total: 2200 })
  })
})
