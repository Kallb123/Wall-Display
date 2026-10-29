import { describe, expect, it } from 'vitest'
import type { CalendarConfig } from '../../../server/config/schema'
import type { Db } from '../../../server/db/client'
import { recentFallbacks } from '../../../server/sources/fallbacks'
import { ensureCalendarRow, replaceCalendarEvents } from '../../../server/sources/store'
import type { NormalisedEvent } from '../../../server/sources/types'
import { migratedMemoryDb } from '../db/helpers'
import { calendarConfig, PEOPLE, resolverFor } from './helpers'

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const NOW = new Date('2026-10-28T12:00:00Z')

const RULES = [{ match: 'swimming|football', people: ['theo'] }]

/** An hour-long event starting `days` from now (before now if negative). */
function event(title: string, days: number, overrides: Partial<NormalisedEvent> = {}): NormalisedEvent {
  const startAt = new Date(NOW.getTime() + days * DAY)
  return {
    uid: `${title}@example.com`,
    recurrenceId: '',
    title,
    description: null,
    location: null,
    startAt,
    endAt: new Date(startAt.getTime() + HOUR),
    allDay: false,
    startDate: null,
    endDate: null,
    ...overrides,
  }
}

/** A database holding these events as a sync of the calendar would store them. */
function setup(incoming: NormalisedEvent[], overrides: Partial<CalendarConfig> = {}) {
  const { db } = migratedMemoryDb()
  const calendar = calendarConfig({ rules: RULES, ...overrides })
  ensureCalendarRow(db, calendar, PEOPLE)
  replaceCalendarEvents(db, calendar.id, incoming, resolverFor({ rules: RULES, ...overrides }))
  return { db, calendar }
}

const fallbacks = (db: Db, calendar: CalendarConfig, options?: Parameters<typeof recentFallbacks>[4]) => recentFallbacks(db, calendar, PEOPLE, NOW, options)
const titles = (list: { title: string }[]) => list.map(entry => entry.title)

describe('recentFallbacks', () => {
  it('lists an event that no name or rule matched', () => {
    const { db, calendar } = setup([event('Dentist', 2)])

    expect(fallbacks(db, calendar)).toEqual([
      { title: 'Dentist', start: '2026-10-30T12:00:00.000Z', all_day: false, start_date: null, occurrences: 1 },
    ])
  })

  it('leaves out an event matched by a name, in the title or the description', () => {
    const { db, calendar } = setup([
      event('Isla: dentist', 1),
      event('Parents evening', 2, { description: 'Who: Theo' }),
      event('Dentist', 3),
    ])

    expect(titles(fallbacks(db, calendar))).toEqual(['Dentist'])
  })

  it('leaves out an event matched by a rule', () => {
    const { db, calendar } = setup([event('Swimming', 1), event('Football practice', 2), event('Dentist', 3)])

    expect(titles(fallbacks(db, calendar))).toEqual(['Dentist'])
  })

  it('leaves out an event whose title names the default person, which is a match even though it ends up the same', () => {
    const { db, calendar } = setup([event('Household: bin day', 1), event('Bin day', 2)])

    expect(titles(fallbacks(db, calendar))).toEqual(['Bin day'])
  })

  it('only looks at the description when the calendar detects in it', () => {
    const { db, calendar } = setup([event('Parents evening', 1, { description: 'Who: Theo' })], { detect_in: ['title'] })

    expect(titles(fallbacks(db, calendar))).toEqual(['Parents evening'])
  })

  it('reads the stored title and description, as the sync did', () => {
    const { db, calendar } = setup([event('Parents evening', 1, { description: '<p>Who: <b>Theo</b></p>' }), event('Assembly', 2, { description: '<p>Bring a coat</p>' })])

    expect(titles(fallbacks(db, calendar))).toEqual(['Assembly'])
  })

  it('keeps an all-day event\'s date', () => {
    const { db, calendar } = setup([event('Inset day', 3, { allDay: true, startDate: '2026-10-31', endDate: '2026-11-01', startAt: new Date('2026-10-31T00:00:00Z'), endAt: new Date('2026-11-01T00:00:00Z') })])

    expect(fallbacks(db, calendar)).toEqual([
      { title: 'Inset day', start: '2026-10-31T00:00:00.000Z', all_day: true, start_date: '2026-10-31', occurrences: 1 },
    ])
  })

  it('groups a recurring event\'s instances, counts them, and shows the one nearest to now', () => {
    const weekly = (days: number) => event('Book club', days, { uid: 'book-club@example.com', recurrenceId: `r${days}` })
    const { db, calendar } = setup([weekly(-14), weekly(-7), weekly(6), weekly(13), event('Dentist', 1)])

    expect(fallbacks(db, calendar)).toEqual([
      { title: 'Dentist', start: '2026-10-29T12:00:00.000Z', all_day: false, start_date: null, occurrences: 1 },
      { title: 'Book club', start: '2026-11-03T12:00:00.000Z', all_day: false, start_date: null, occurrences: 4 },
    ])
  })

  it('keeps the earlier occurrence when two are as near to now', () => {
    const both = (days: number) => event('Book club', days, { uid: 'book-club@example.com', recurrenceId: `r${days}` })
    const { db, calendar } = setup([both(-3), both(3)])

    expect(fallbacks(db, calendar)).toEqual([expect.objectContaining({ start: '2026-10-25T12:00:00.000Z', occurrences: 2 })])
  })

  it('does not count instances of a recurring event that were matched, or that fall outside the window', () => {
    const weekly = (days: number, title = 'Book club') => event(title, days, { uid: 'book-club@example.com', recurrenceId: `r${days}` })
    // One week it was renamed after a child.
    const { db, calendar } = setup([weekly(1), weekly(8, 'Isla: book club'), weekly(15), weekly(45)])

    expect(fallbacks(db, calendar)).toEqual([expect.objectContaining({ title: 'Book club', occurrences: 2 })])
  })

  it('is empty when detection is off, whatever is stored', () => {
    const { db, calendar } = setup([event('Dentist', 1), event('Swimming', 2)], { detect_people: false })

    expect(fallbacks(db, calendar)).toEqual([])
  })

  it('lists them with detection on anywhere in the text', () => {
    const { db, calendar } = setup([event('Dentist for Isla', 1), event('Dentist', 2)], { detect_people: 'anywhere' })

    expect(titles(fallbacks(db, calendar))).toEqual(['Dentist'])
  })

  it('looks 30 days back and 30 days ahead by default', () => {
    const { db, calendar } = setup([
      event('Too early', -32),
      event('Early enough', -29),
      event('Late enough', 29),
      event('Too late', 32),
    ])

    expect(titles(fallbacks(db, calendar))).toEqual(['Early enough', 'Late enough'])
  })

  it('counts an event that began before the window and is still going, and one that has no length', () => {
    const { db, calendar } = setup([
      event('Holiday', -40, { endAt: new Date(NOW.getTime() - 20 * DAY) }),
      event('Long gone', -40, { endAt: new Date(NOW.getTime() - 35 * DAY) }),
      event('Reminder', 5, { endAt: new Date(NOW.getTime() + 5 * DAY) }),
      event('Too late reminder', 45, { endAt: new Date(NOW.getTime() + 45 * DAY) }),
    ])

    expect(titles(fallbacks(db, calendar))).toEqual(['Holiday', 'Reminder'])
  })

  it('uses the window it is given', () => {
    const { db, calendar } = setup([event('Last week', -7), event('Next week', 7), event('In a fortnight', 14)])

    expect(titles(fallbacks(db, calendar, { daysBack: 8, daysAhead: 10 }))).toEqual(['Last week', 'Next week'])
    expect(titles(fallbacks(db, calendar, { daysBack: 0, daysAhead: 20 }))).toEqual(['Next week', 'In a fortnight'])
  })

  it('returns the 20 nearest to now by default, in start order', () => {
    const { db, calendar } = setup(Array.from({ length: 25 }, (_, i) => event(`Event ${i}`, i + 1)))

    const found = fallbacks(db, calendar)

    expect(found).toHaveLength(20)
    expect(titles(found)).toEqual(Array.from({ length: 20 }, (_, i) => `Event ${i}`))
  })

  it('keeps the events nearest to now when there are more than the limit, whichever side of now they are on', () => {
    const { db, calendar } = setup([
      event('Far past', -25),
      event('Near past', -2),
      event('Soon', 1),
      event('Later', 10),
      event('Far future', 25),
    ])

    expect(titles(fallbacks(db, calendar, { limit: 3 }))).toEqual(['Near past', 'Soon', 'Later'])
    expect(titles(fallbacks(db, calendar, { limit: 1 }))).toEqual(['Soon'])
  })

  it('takes the limit after grouping, so one busy recurring event does not crowd out the rest', () => {
    const daily = (days: number) => event('Medication', days, { uid: 'meds@example.com', recurrenceId: `r${days}` })
    const { db, calendar } = setup([daily(1), daily(2), daily(3), daily(4), event('Dentist', 5), event('Optician', 6)])

    expect(titles(fallbacks(db, calendar, { limit: 3 }))).toEqual(['Medication', 'Dentist', 'Optician'])
  })

  it('only looks at the calendar it is asked about', () => {
    const { db, calendar } = setup([event('Dentist', 1)])
    const other = calendarConfig({ id: 'work', name: 'Work', person: 'dad' })
    ensureCalendarRow(db, other, PEOPLE)
    replaceCalendarEvents(db, 'work', [event('Standup', 1)], resolverFor({ id: 'work', person: 'dad' }))

    expect(titles(fallbacks(db, calendar))).toEqual(['Dentist'])
    expect(titles(fallbacks(db, other))).toEqual(['Standup'])
  })

  it('is empty for a calendar with no events', () => {
    const { db, calendar } = setup([])

    expect(fallbacks(db, calendar)).toEqual([])
  })

  it('re-reads the people and rules it is given, so a rule added since the sync takes an event off the list', () => {
    const { db, calendar } = setup([event('Dentist', 1), event('Orthodontist', 2)], { rules: [] })

    expect(titles(fallbacks(db, calendar))).toEqual(['Dentist', 'Orthodontist'])
    // Stored as the default person's, but the new rule would now say otherwise.
    expect(titles(recentFallbacks(db, { ...calendar, rules: [{ match: 'orthodontist', people: ['isla'] }] }, PEOPLE, NOW))).toEqual(['Dentist'])
  })
})
