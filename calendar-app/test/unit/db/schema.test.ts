import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { calendars, displayState, events, photoAssets, specialDays, syncStatus } from '../../../server/db/schema'
import type { NewEventRow, NewSpecialDayRow } from '../../../server/db/schema'
import { insertCalendar, migratedMemoryDb } from './helpers'

function newEvent(overrides: Partial<NewEventRow> = {}): NewEventRow {
  return {
    calendarId: 'family',
    uid: 'abc@example.com',
    title: 'Theo: Swimming',
    displayTitle: 'Swimming',
    startAt: new Date('2026-10-28T16:00:00Z'),
    endAt: new Date('2026-10-28T17:00:00Z'),
    ...overrides,
  }
}

function newSpecialDay(overrides: Partial<NewSpecialDayRow> = {}): NewSpecialDayRow {
  return { id: 'halloween', name: 'Halloween', month: 10, day: 31, repeat: 'yearly', lead: 'week', ...overrides }
}

describe('events', () => {
  it('round-trips timestamps, booleans and JSON, and fills in defaults', () => {
    const { db } = migratedMemoryDb()
    insertCalendar(db)
    db.insert(events).values(newEvent({ personIds: ['theo', 'isla'], allDay: true, startDate: '2026-10-28', endDate: '2026-10-29' })).run()

    const [row] = db.select().from(events).all()

    expect(row).toMatchObject({
      calendarId: 'family',
      uid: 'abc@example.com',
      recurrenceId: '',
      description: null,
      location: null,
      allDay: true,
      startDate: '2026-10-28',
      endDate: '2026-10-29',
      personIds: ['theo', 'isla'],
    })
    expect(row?.startAt).toEqual(new Date('2026-10-28T16:00:00Z'))
    expect(row?.endAt).toBeInstanceOf(Date)
    expect(row?.updatedAt).toBeInstanceOf(Date)
  })

  it('defaults to a timed event with no people', () => {
    const { db } = migratedMemoryDb()
    insertCalendar(db)
    db.insert(events).values(newEvent()).run()

    expect(db.select().from(events).get()).toMatchObject({ allDay: false, personIds: [] })
  })

  it('rejects a second event with the same calendar, uid and recurrence id', () => {
    const { db } = migratedMemoryDb()
    insertCalendar(db)
    db.insert(events).values(newEvent()).run()

    expect(() => db.insert(events).values(newEvent()).run()).toThrow(/UNIQUE/)
  })

  it('allows the same uid for different recurrence ids, and in another calendar', () => {
    const handle = migratedMemoryDb()
    insertCalendar(handle.db)
    insertCalendar(handle.db, 'work')
    const { db } = handle

    db.insert(events).values([
      newEvent({ recurrenceId: '' }),
      newEvent({ recurrenceId: '2026-11-04T16:00:00Z' }),
      newEvent({ calendarId: 'work' }),
    ]).run()

    expect(db.select().from(events).all()).toHaveLength(3)
  })

  it('rejects an event for a calendar that does not exist', () => {
    const { db } = migratedMemoryDb()

    expect(() => db.insert(events).values(newEvent({ calendarId: 'nope' })).run()).toThrow(/FOREIGN KEY/)
  })
})

describe('deleting a calendar', () => {
  it('removes its events and sync status, and leaves other calendars alone', () => {
    const handle = migratedMemoryDb()
    insertCalendar(handle.db)
    insertCalendar(handle.db, 'work')
    const { db } = handle
    db.insert(events).values([newEvent(), newEvent({ calendarId: 'work' })]).run()
    db.insert(syncStatus).values([{ calendarId: 'family' }, { calendarId: 'work' }]).run()

    db.delete(calendars).where(eq(calendars.id, 'family')).run()

    expect(db.select().from(events).all().map(e => e.calendarId)).toEqual(['work'])
    expect(db.select().from(syncStatus).all().map(s => s.calendarId)).toEqual(['work'])
  })
})

describe('sync_status', () => {
  it('starts with nulls and a zero count, and round-trips dates', () => {
    const handle = migratedMemoryDb()
    insertCalendar(handle.db)
    const { db } = handle
    db.insert(syncStatus).values({ calendarId: 'family' }).run()

    expect(db.select().from(syncStatus).get()).toEqual({
      calendarId: 'family',
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: null,
      etag: null,
      lastModified: null,
      expansionKey: null,
      eventCount: 0,
    })

    const at = new Date('2026-10-28T12:00:00.123Z')
    db.update(syncStatus).set({ lastAttemptAt: at, lastError: 'HTTP 500' }).run()

    expect(db.select().from(syncStatus).get()).toMatchObject({ lastAttemptAt: at, lastError: 'HTTP 500' })
  })
})

describe('display_state', () => {
  it('round-trips a JSON state document', () => {
    const { db } = migratedMemoryDb()
    const state = { view: 'month', month: null, screen: 'on', brightness: 80, overlay: { text: 'Bins', ttl: 60 } }

    db.insert(displayState).values({ displayId: 'hallway', state }).run()

    const row = db.select().from(displayState).get()
    expect(row?.state).toEqual(state)
    expect(row?.updatedAt).toBeInstanceOf(Date)
  })
})

describe('photo_assets', () => {
  it('stores an asset with optional cache fields empty', () => {
    const { db } = migratedMemoryDb()

    db.insert(photoAssets).values({
      id: 'local:holiday/beach.jpg',
      provider: 'local',
      providerAssetId: 'holiday/beach.jpg',
      width: 4000,
      height: 3000,
      orientation: 'landscape',
    }).run()

    expect(db.select().from(photoAssets).get()).toMatchObject({
      id: 'local:holiday/beach.jpg',
      takenAt: null,
      cacheFile: null,
      cacheBytes: null,
      fetchedAt: null,
      lastShownAt: null,
    })
  })
})

describe('special_days', () => {
  it('round-trips a yearly day and applies defaults', () => {
    const { db } = migratedMemoryDb()

    db.insert(specialDays).values(newSpecialDay()).run()

    const row = db.select().from(specialDays).get()
    expect(row).toMatchObject({ month: 10, day: 31, year: null, repeat: 'yearly', lead: 'week', takeover: false, palette: 'warm', tileArt: null })
    expect(row?.createdAt).toBeInstanceOf(Date)
  })

  it('accepts a one-off day with a year', () => {
    const { db } = migratedMemoryDb()

    db.insert(specialDays).values(newSpecialDay({ id: 'moving', repeat: 'once', year: 2027, takeover: true, palette: 'sage' })).run()

    expect(db.select().from(specialDays).get()).toMatchObject({ year: 2027, takeover: true, palette: 'sage' })
  })

  it.each([
    ['a month of 13', { month: 13 }],
    ['a month of 0', { month: 0 }],
    ['a day of 32', { day: 32 }],
    ['a day of 0', { day: 0 }],
    ['a yearly day with a year', { year: 2027 }],
    ['a one-off day without a year', { repeat: 'once' as const }],
  ])('rejects %s', (_name, overrides) => {
    const { db } = migratedMemoryDb()

    expect(() => db.insert(specialDays).values(newSpecialDay(overrides)).run()).toThrow(/CHECK/)
  })
})
