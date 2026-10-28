import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { calendars, events, syncStatus } from '../../../server/db/schema'
import type { CalendarConfig } from '../../../server/config/schema'
import type { Db } from '../../../server/db/client'
import { configHash, ensureCalendarRow, replaceCalendarEvents, reresolveStoredEvents, syncCalendarRows } from '../../../server/sources/store'
import type { NormalisedEvent } from '../../../server/sources/types'
import { migratedMemoryDb } from '../db/helpers'
import { calendarConfig, PEOPLE, resolverFor } from './helpers'

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
  ensureCalendarRow(db, calendarConfig(), PEOPLE)
  ensureCalendarRow(db, calendarConfig({ id: 'work', name: undefined, person: 'dad' }), PEOPLE)
  return db
}

/** A sync's write: person detection for the calendar, then the store. */
function replace(db: Db, incoming: NormalisedEvent[], overrides: Partial<CalendarConfig> = {}, calendarId = 'family') {
  return replaceCalendarEvents(db, calendarId, incoming, resolverFor(overrides))
}

const rowsOf = (db: ReturnType<typeof setup>, calendarId = 'family') =>
  db.select().from(events).where(eq(events.calendarId, calendarId)).orderBy(events.id).all()

describe('ensureCalendarRow', () => {
  it('adds the calendar, naming it after its id when it has no name', () => {
    const db = setup()

    expect(db.select().from(calendars).orderBy(calendars.id).all().map(c => [c.id, c.name, c.personId, c.sourceType, c.configHash])).toEqual([
      ['family', 'Family', 'home', 'ics', configHash(calendarConfig(), PEOPLE)],
      ['work', 'work', 'dad', 'ics', configHash(calendarConfig({ id: 'work', person: 'dad' }), PEOPLE)],
    ])
  })

  it('updates the row when the config changes, and leaves its events alone', () => {
    const db = setup()
    replace(db, [event()])
    const before = rowsOf(db)

    ensureCalendarRow(db, calendarConfig({ name: 'The family', person: 'mum' }), PEOPLE)

    expect(db.select().from(calendars).where(eq(calendars.id, 'family')).get()).toMatchObject({ name: 'The family', personId: 'mum' })
    expect(rowsOf(db)).toEqual(before)
  })

  it('does not touch a row that already says the same', async () => {
    const db = setup()
    const before = db.select().from(calendars).where(eq(calendars.id, 'family')).get()!
    await new Promise(resolve => setTimeout(resolve, 5))

    ensureCalendarRow(db, calendarConfig(), PEOPLE)

    expect(db.select().from(calendars).where(eq(calendars.id, 'family')).get()).toEqual(before)
  })
})

describe('configHash', () => {
  const hash = (overrides: Partial<CalendarConfig> = {}, people = PEOPLE) => configHash(calendarConfig(overrides), people)
  const withPerson = (id: string, change: Partial<(typeof PEOPLE)[number]>) => PEOPLE.map(person => person.id === id ? { ...person, ...change } : person)

  it('changes with what decides who an event is for, and not with the source', () => {
    const base = hash()

    expect(hash()).toBe(base)
    expect(hash({ person: 'mum' })).not.toBe(base)
    expect(hash({ strip_names: true })).not.toBe(base)
    expect(hash({ detect_people: 'anywhere' })).not.toBe(base)
    expect(hash({ detect_in: ['title'] })).not.toBe(base)
    expect(hash({ rules: [{ match: 'ballet', people: ['isla'] }] })).not.toBe(base)
    expect(hash({ name: 'Other', source: { type: 'ics', url: 'https://example.com/other.ics', poll_seconds: 300 } })).toBe(base)
  })

  it('changes with the rules\' patterns and people', () => {
    const rule = (match: string, people: string[]) => hash({ rules: [{ match, people }] })

    expect(rule('ballet', ['isla'])).not.toBe(rule('ballet|brownies', ['isla']))
    expect(rule('ballet', ['isla'])).not.toBe(rule('ballet', ['isla', 'poppy']))
  })

  it('changes with the people\'s ids, names and aliases', () => {
    const base = hash()

    expect(hash({}, PEOPLE.filter(person => person.id !== 'poppy'))).not.toBe(base)
    expect(hash({}, withPerson('theo', { name: 'Theodore' }))).not.toBe(base)
    expect(hash({}, withPerson('theo', { aliases: ['Teddy'] }))).not.toBe(base)
    expect(hash({}, withPerson('mum', { aliases: ['Mummy'] }))).not.toBe(base)
    expect(hash({}, withPerson('theo', { id: 'theodore' }))).not.toBe(base)
  })

  it('does not change with colours or initials, which are not who an event is for', () => {
    const base = hash()

    expect(hash({}, withPerson('theo', { colour: '#000000' }))).toBe(base)
    expect(hash({}, withPerson('theo', { initial: 'X' }))).toBe(base)
  })
})

describe('replaceCalendarEvents', () => {
  it('stores the events with their people and the title shown on the wall', () => {
    const db = setup()
    const result = replace(db, [
      event({ title: 'Theo: Swimming', description: 'Who: Theo, Isla', location: 'Pool' }),
      event({ uid: 'half-term', title: 'Half term', allDay: true, startAt: new Date('2026-10-26T00:00:00Z'), endAt: new Date('2026-10-31T00:00:00Z'), startDate: '2026-10-26', endDate: '2026-10-31' }),
    ], { strip_names: true })

    expect(result).toEqual({ inserted: 2, updated: 0, deleted: 0, total: 2 })
    expect(rowsOf(db)).toMatchObject([
      { uid: 'swim@example.com', recurrenceId: '', title: 'Theo: Swimming', displayTitle: 'Swimming', description: 'Who: Theo, Isla', location: 'Pool', allDay: false, personIds: ['theo', 'isla'] },
      { uid: 'half-term', allDay: true, startDate: '2026-10-26', endDate: '2026-10-31', startAt: new Date('2026-10-26T00:00:00Z'), personIds: ['home'] },
    ])
  })

  it('does nothing the second time, and keeps ids and timestamps', async () => {
    const db = setup()
    const input = [event(), event({ uid: 'b', recurrenceId: '20261104T163000Z' })]
    replace(db, input)
    const before = rowsOf(db)
    await new Promise(resolve => setTimeout(resolve, 5))

    const result = replace(db, input)

    expect(result).toEqual({ inserted: 0, updated: 0, deleted: 0, total: 2 })
    expect(rowsOf(db)).toEqual(before)
  })

  it('updates an event that changed in place', async () => {
    const db = setup()
    replace(db, [event(), event({ uid: 'b' })])
    const [first, second] = rowsOf(db)
    await new Promise(resolve => setTimeout(resolve, 5))

    const result = replace(db, [
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
    replace(db, [event()])

    expect(replace(db, [event(change)])).toMatchObject({ updated: 1 })
  })

  it('finds the people again when a title changes who an event is for', async () => {
    const db = setup()
    replace(db, [event({ title: 'Swimming' }), event({ uid: 'b', title: 'Ballet' })], { strip_names: true })
    const [first, second] = rowsOf(db)
    expect(first).toMatchObject({ personIds: ['home'], displayTitle: 'Swimming' })
    await new Promise(resolve => setTimeout(resolve, 5))

    const result = replace(db, [event({ title: 'Isla: Swimming' }), event({ uid: 'b', title: 'Ballet' })], { strip_names: true })

    expect(result).toMatchObject({ inserted: 0, updated: 1, deleted: 0 })
    const [afterFirst, afterSecond] = rowsOf(db)
    expect(afterFirst).toMatchObject({ id: first!.id, title: 'Isla: Swimming', displayTitle: 'Swimming', personIds: ['isla'] })
    expect(afterFirst!.updatedAt.getTime()).toBeGreaterThan(first!.updatedAt.getTime())
    expect(afterSecond).toEqual(second)
  })

  it('finds the people again when a description does', () => {
    const db = setup()
    replace(db, [event({ description: 'Pool 2' })])

    expect(replace(db, [event({ description: 'Pool 2\nWho: Theo' })])).toMatchObject({ updated: 1 })

    expect(rowsOf(db)[0]).toMatchObject({ personIds: ['theo'], displayTitle: 'Swimming' })
  })

  it('notices a changed default person', () => {
    const db = setup()
    replace(db, [event()])

    expect(replace(db, [event()], { person: 'mum' })).toMatchObject({ updated: 1 })
    expect(rowsOf(db)[0]!.personIds).toEqual(['mum'])
  })

  it('deletes events that are gone, inserts new ones, and tells instances of a series apart', () => {
    const db = setup()
    replace(db, [
      event({ recurrenceId: '20261028T163000Z' }),
      event({ recurrenceId: '20261104T163000Z' }),
      event({ uid: 'old' }),
    ])
    const kept = rowsOf(db).find(r => r.recurrenceId === '20261104T163000Z')!

    const result = replace(db, [
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
    replace(db, [event(), event({ uid: 'b' })])

    expect(replace(db, [])).toEqual({ inserted: 0, updated: 0, deleted: 2, total: 0 })
    expect(rowsOf(db)).toEqual([])
  })

  it('never touches another calendar, even one with the same uids', () => {
    const db = setup()
    replace(db, [event(), event({ uid: 'standup' })], { person: 'dad' }, 'work')
    const work = rowsOf(db, 'work')

    replace(db, [event({ title: 'Family swimming' })])
    replace(db, [])

    expect(rowsOf(db, 'work')).toEqual(work)
  })

  it('rolls everything back if a write fails part way', () => {
    const db = setup()
    replace(db, [event({ uid: 'keep' }), event({ uid: 'change' }), event({ uid: 'remove' })])
    const before = rowsOf(db)
    const bad = { ...event({ uid: 'bad' }), title: null } as unknown as NormalisedEvent

    // Deletes 'remove', updates 'change', then fails inserting 'bad'.
    expect(() => replace(db, [
      event({ uid: 'keep' }),
      event({ uid: 'change', title: 'Changed' }),
      event({ uid: 'good-new' }),
      bad,
    ])).toThrow(/NOT NULL/)

    expect(rowsOf(db)).toEqual(before)
  })

  it('refuses two events with the same key before writing anything', () => {
    const db = setup()
    replace(db, [event({ uid: 'keep' })])

    expect(() => replace(db, [event({ uid: 'a' }), event({ uid: 'a' })])).toThrow(/same uid/)
    expect(rowsOf(db).map(r => r.uid)).toEqual(['keep'])
  })

  it('does not mix up uids and recurrence ids that run together', () => {
    const db = setup()

    const result = replace(db, [
      event({ uid: 'a', recurrenceId: 'bc' }),
      event({ uid: 'ab', recurrenceId: 'c' }),
    ])

    expect(result).toMatchObject({ inserted: 2, total: 2 })
  })

  it('writes thousands of events in a few chunks', () => {
    const db = setup()
    const many = Array.from({ length: 2300 }, (_, i) => event({ uid: `e${i}`, startAt: new Date(Date.UTC(2026, 0, 1, 0, i)), endAt: new Date(Date.UTC(2026, 0, 1, 1, i)) }))

    expect(replace(db, many)).toEqual({ inserted: 2300, updated: 0, deleted: 0, total: 2300 })
    expect(replace(db, many.slice(100))).toEqual({ inserted: 0, updated: 0, deleted: 100, total: 2200 })
  })
})

describe('reresolveStoredEvents', () => {
  const family = (overrides: Partial<CalendarConfig> = {}) => calendarConfig({ strip_names: true, ...overrides })

  function stored() {
    const db = setup()
    replace(db, [
      event({ uid: 'swim', title: 'Theo: Swimming' }),
      event({ uid: 'ballet', title: 'Ballet' }),
      event({ uid: 'bins', title: 'Bin day' }),
    ], { strip_names: true })
    return db
  }

  it('writes only the events whose answer is different, and the new hash', async () => {
    const db = stored()
    const before = rowsOf(db)
    await new Promise(resolve => setTimeout(resolve, 5))

    // Ballet now means Isla.
    const rules = [{ match: 'ballet', people: ['isla'] }]
    const result = reresolveStoredEvents(db, family({ rules }), PEOPLE)

    expect(result).toEqual({ checked: 3, changed: 1 })
    const after = rowsOf(db)
    expect(after.map(row => row.id)).toEqual(before.map(row => row.id))
    expect(after[1]).toMatchObject({ uid: 'ballet', personIds: ['isla'], displayTitle: 'Ballet' })
    expect(after[1]!.updatedAt.getTime()).toBeGreaterThan(before[1]!.updatedAt.getTime())
    expect(after[0]).toEqual(before[0])
    expect(after[2]).toEqual(before[2])
    expect(db.select().from(calendars).where(eq(calendars.id, 'family')).get()!.configHash).toBe(configHash(family({ rules }), PEOPLE))
  })

  it('follows a person who gains an alias, and a strip_names that is turned off', () => {
    const db = stored()
    replace(db, [event({ uid: 'swim', title: 'Teddy: Swimming' })], { strip_names: true })
    expect(rowsOf(db)[0]).toMatchObject({ personIds: ['home'], displayTitle: 'Teddy: Swimming' })

    const people = PEOPLE.map(person => person.id === 'theo' ? { ...person, aliases: ['Teddy'] } : person)
    expect(reresolveStoredEvents(db, family(), people)).toMatchObject({ changed: 1 })
    expect(rowsOf(db)[0]).toMatchObject({ personIds: ['theo'], displayTitle: 'Swimming' })

    expect(reresolveStoredEvents(db, family({ strip_names: false }), people)).toMatchObject({ changed: 1 })
    expect(rowsOf(db)[0]).toMatchObject({ personIds: ['theo'], displayTitle: 'Teddy: Swimming' })
  })

  it('changes nothing when nothing changed, and leaves other calendars alone', async () => {
    const db = stored()
    replace(db, [event({ title: 'Theo: Swimming' })], {}, 'work')
    const family0 = rowsOf(db)
    const work = rowsOf(db, 'work')
    await new Promise(resolve => setTimeout(resolve, 5))

    expect(reresolveStoredEvents(db, family(), PEOPLE)).toEqual({ checked: 3, changed: 0 })
    expect(reresolveStoredEvents(db, family({ id: 'work', person: 'dad', strip_names: true }), PEOPLE)).toEqual({ checked: 1, changed: 1 })

    expect(rowsOf(db)).toEqual(family0)
    expect(rowsOf(db, 'work')).not.toEqual(work)
  })

  it('does nothing to a calendar with no events', () => {
    const db = setup()

    expect(reresolveStoredEvents(db, family(), PEOPLE)).toEqual({ checked: 0, changed: 0 })
  })
})

describe('syncCalendarRows', () => {
  it('adds a row for each configured calendar and re-resolves nothing the first time', () => {
    const { db } = migratedMemoryDb()

    const result = syncCalendarRows(db, [calendarConfig(), calendarConfig({ id: 'work', person: 'dad' })], PEOPLE)

    expect(result).toEqual({ reresolved: [], removed: [] })
    expect(db.select().from(calendars).orderBy(calendars.id).all().map(row => row.id)).toEqual(['family', 'work'])
  })

  it('re-resolves the calendars whose people or rules changed, and only those', () => {
    const db = setup()
    replace(db, [event({ title: 'Theo: Swimming' }), event({ uid: 'b', title: 'Ballet' })])
    replace(db, [event({ title: 'Ballet' })], { person: 'dad' }, 'work')
    const work = rowsOf(db, 'work')
    const rules = [{ match: 'ballet', people: ['isla'] }]

    const result = syncCalendarRows(db, [calendarConfig({ rules }), calendarConfig({ id: 'work', name: undefined, person: 'dad' })], PEOPLE)

    expect(result.reresolved).toEqual([{ calendarId: 'family', checked: 2, changed: 1 }])
    expect(result.removed).toEqual([])
    expect(rowsOf(db).map(row => row.personIds)).toEqual([['theo'], ['isla']])
    expect(rowsOf(db, 'work')).toEqual(work)

    // And once it has, the next boot has nothing to do.
    expect(syncCalendarRows(db, [calendarConfig({ rules }), calendarConfig({ id: 'work', name: undefined, person: 'dad' })], PEOPLE).reresolved).toEqual([])
  })

  it('re-resolves when a person is renamed, but not when only their colour changes', () => {
    const db = setup()
    replace(db, [event({ title: 'Teddy: Swimming' })])
    const renamed = PEOPLE.map(person => person.id === 'theo' ? { ...person, aliases: ['Teddy'] } : person)
    const recoloured = renamed.map(person => person.id === 'theo' ? { ...person, colour: '#000000' } : person)

    expect(syncCalendarRows(db, [calendarConfig()], renamed).reresolved).toMatchObject([{ calendarId: 'family', changed: 1 }])
    expect(syncCalendarRows(db, [calendarConfig()], recoloured).reresolved).toEqual([])
    expect(rowsOf(db)[0]!.personIds).toEqual(['theo'])
  })

  it('deletes the calendars that are no longer configured, with their events and sync status', () => {
    const db = setup()
    replace(db, [event()])
    replace(db, [event(), event({ uid: 'standup' })], {}, 'work')
    db.insert(syncStatus).values({ calendarId: 'work', eventCount: 2 }).run()

    const result = syncCalendarRows(db, [calendarConfig()], PEOPLE)

    expect(result.removed).toEqual(['work'])
    expect(db.select().from(calendars).all().map(row => row.id)).toEqual(['family'])
    expect(rowsOf(db, 'work')).toEqual([])
    expect(db.select().from(syncStatus).all()).toEqual([])
    expect(rowsOf(db)).toHaveLength(1)
  })

  it('updates the name and default person of a calendar that stays', () => {
    const db = setup()

    syncCalendarRows(db, [calendarConfig({ name: 'The family', person: 'mum' })], PEOPLE)

    expect(db.select().from(calendars).where(eq(calendars.id, 'family')).get()).toMatchObject({ name: 'The family', personId: 'mum' })
  })
})
