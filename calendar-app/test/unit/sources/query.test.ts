import { describe, expect, it } from 'vitest'
import type { Db } from '../../../server/db/client'
import { listEvents, MAX_RANGE_DAYS, parseEventRange } from '../../../server/sources/query'
import { ensureCalendarRow, replaceCalendarEvents } from '../../../server/sources/store'
import type { NormalisedEvent } from '../../../server/sources/types'
import { migratedMemoryDb } from '../db/helpers'
import { calendarConfig, PEOPLE, resolverFor } from './helpers'

const ZONE = 'Europe/London'
const iso = (range: { from: Date, to: Date }) => [range.from.toISOString(), range.to.toISOString()]
const parse = (from: string | undefined, to: string | undefined) => parseEventRange({ from, to }, ZONE)

describe('parseEventRange', () => {
  it('reads a date as midnight at the start of that day in the display time zone', () => {
    // BST until the clocks went back on Sunday 25 October 2026.
    expect(iso(parse('2026-10-01', '2026-11-01'))).toEqual(['2026-09-30T23:00:00.000Z', '2026-11-01T00:00:00.000Z'])
    expect(iso(parse('2026-10-25', '2026-10-26'))).toEqual(['2026-10-24T23:00:00.000Z', '2026-10-26T00:00:00.000Z'])
  })

  it('uses the time zone it is given', () => {
    expect(iso(parseEventRange({ from: '2026-10-01', to: '2026-10-02' }, 'America/New_York'))).toEqual(['2026-10-01T04:00:00.000Z', '2026-10-02T04:00:00.000Z'])
  })

  it.each([
    ['2026-10-28T10:00:00Z', '2026-10-28T10:00:00.000Z'],
    ['2026-10-28T10:00Z', '2026-10-28T10:00:00.000Z'],
    ['2026-10-28t10:00:00z', '2026-10-28T10:00:00.000Z'],
    ['2026-10-28T10:00:00.5Z', '2026-10-28T10:00:00.500Z'],
    ['2026-10-28T10:00:00.123456Z', '2026-10-28T10:00:00.123Z'],
    ['2026-10-28T10:00:00+01:00', '2026-10-28T09:00:00.000Z'],
    ['2026-10-28T10:00:00+0100', '2026-10-28T09:00:00.000Z'],
    ['2026-10-28T10:00:00-05:30', '2026-10-28T15:30:00.000Z'],
    // A "+" that came through a URL as a space.
    ['2026-10-28T10:00:00 01:00', '2026-10-28T09:00:00.000Z'],
  ])('reads the instant %s', (value, expected) => {
    expect(parse(value, '2027-10-28T10:00:00Z').from.toISOString()).toBe(expected)
  })

  it('takes a date and an instant together', () => {
    expect(iso(parse('2026-10-28', '2026-10-28T23:00:00+00:00'))).toEqual(['2026-10-28T00:00:00.000Z', '2026-10-28T23:00:00.000Z'])
  })

  it.each([
    ['nope', 'from must be a date'],
    ['', 'from must be a date'],
    ['2026-02-31', 'from must be a date'],
    ['2026-13-01', 'from must be a date'],
    ['2026-10-28T10:00:00', 'from must be a date'],
    ['2026-10-28 10:00:00Z', 'from must be a date'],
    ['2026-10-28T24:00:00Z', 'from must be a date'],
    ['2026-10-28T10:60:00Z', 'from must be a date'],
    ['2026-10-28T10:00:00+24:00', 'from must be a date'],
    ['1790400000', 'from must be a date'],
    ['2026-10-28T10:00:00Z; drop table', 'from must be a date'],
  ])('rejects "%s" with a short reason', (from, message) => {
    expect(() => parse(from, '2027-01-01')).toThrow(message)
  })

  it('rejects a missing from or to, naming it', () => {
    expect(() => parse(undefined, '2026-11-01')).toThrow('from is required')
    expect(() => parse('2026-10-01', undefined)).toThrow('to is required')
    expect(() => parseEventRange({}, ZONE)).toThrow('from is required')
    expect(() => parseEventRange(undefined, ZONE)).toThrow()
  })

  it('rejects a repeated parameter, which arrives as a list', () => {
    expect(() => parseEventRange({ from: ['2026-10-01', '2026-10-02'], to: '2026-11-01' }, ZONE)).toThrow('from')
  })

  it('needs to to be after from', () => {
    expect(() => parse('2026-11-01', '2026-10-01')).toThrow('to must be after from')
    expect(() => parse('2026-10-01', '2026-10-01')).toThrow('to must be after from')
    expect(() => parse('2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z')).toThrow('to must be after from')
    expect(parse('2026-10-01T10:00:00Z', '2026-10-01T10:00:01Z').to.getTime()).toBeGreaterThan(parse('2026-10-01T10:00:00Z', '2026-10-01T10:00:01Z').from.getTime())
  })

  it('allows at most 366 days', () => {
    expect(MAX_RANGE_DAYS).toBe(366)
    expect(() => parse('2026-01-01T00:00:00Z', '2027-01-02T00:00:00Z')).not.toThrow() // 366 days
    expect(() => parse('2026-01-01T00:00:00Z', '2027-01-02T00:00:01Z')).toThrow('at most 366 days')
    expect(() => parse('2020-01-01', '2026-01-01')).toThrow('at most 366 days')
  })
})

const MINUTE = 60_000

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

const at = (time: string, minutes = 0) => new Date(new Date(`2026-10-28T${time}:00Z`).getTime() + minutes * MINUTE)

/** A timed event from `start` to `start` + minutes. */
const timed = (uid: string, start: string, minutes: number) => event({ uid, title: uid, startAt: at(start), endAt: at(start, minutes) })

function setup(events: NormalisedEvent[]) {
  const { db } = migratedMemoryDb()
  const family = calendarConfig()
  ensureCalendarRow(db, family, PEOPLE)
  replaceCalendarEvents(db, 'family', events, resolverFor())
  return { db, family }
}

function list(db: Db, from: Date, to: Date, overrides: Partial<Parameters<typeof listEvents>[1]> = {}) {
  return listEvents(db, { from, to, calendars: [calendarConfig()], people: PEOPLE, ...overrides })
}

const titles = (events: { title: string }[]) => events.map(e => e.title)

describe('listEvents', () => {
  it('lists events that overlap the range, and only those', () => {
    const { db } = setup([
      timed('before', '08:00', 60), // ends exactly as the range starts
      timed('overlaps-start', '09:30', 60), // 09:30-10:30
      timed('inside', '11:00', 30),
      timed('overlaps-end', '11:45', 60), // 11:45-12:45
      timed('after', '12:00', 60), // starts exactly as the range ends
      timed('spans', '07:00', 360), // 07:00-13:00
      timed('later', '15:00', 60),
    ])

    const found = list(db, at('09:00'), at('12:00'))

    expect(titles(found)).toEqual(['spans', 'overlaps-start', 'inside', 'overlaps-end'])
  })

  it('includes an event that starts at the start of the range and excludes one that ends at it', () => {
    const { db } = setup([timed('starts-at-from', '09:00', 30), timed('ends-at-from', '08:30', 30)])

    expect(titles(list(db, at('09:00'), at('10:00')))).toEqual(['starts-at-from'])
  })

  it('includes a zero-length event that starts in the range, from included and to excluded', () => {
    const { db } = setup([
      timed('at-from', '09:00', 0),
      timed('inside', '09:30', 0),
      timed('at-to', '10:00', 0),
      timed('before', '08:59', 0),
    ])

    expect(titles(list(db, at('09:00'), at('10:00')))).toEqual(['at-from', 'inside'])
  })

  it('includes an all-day event that covers the range', () => {
    const { db } = setup([event({
      uid: 'half-term',
      title: 'Half term',
      allDay: true,
      startAt: new Date('2026-10-26T00:00:00Z'),
      endAt: new Date('2026-10-31T00:00:00Z'),
      startDate: '2026-10-26',
      endDate: '2026-10-31',
    })])

    expect(titles(list(db, at('09:00'), at('10:00')))).toEqual(['Half term'])
    expect(list(db, new Date('2026-10-31T00:00:00Z'), new Date('2026-11-01T00:00:00Z'))).toEqual([])
  })

  it('orders by start, then all-day first, then id', () => {
    const { db } = setup([
      timed('b-late', '10:00', 30),
      event({ uid: 'timed-midnight', title: 'timed-midnight', startAt: at('00:00'), endAt: at('00:00', 60) }),
      event({ uid: 'all-day', title: 'all-day', allDay: true, startAt: at('00:00'), endAt: at('00:00', 1440), startDate: '2026-10-28', endDate: '2026-10-29' }),
      timed('a-same-time', '10:00', 60),
      timed('early', '08:00', 30),
    ])

    const found = list(db, at('00:00'), at('23:00'))

    expect(titles(found)).toEqual(['all-day', 'timed-midnight', 'early', 'b-late', 'a-same-time'])
  })

  it('shapes each event for the wire: snake_case, with people, and no description', () => {
    const { db } = setup([
      event({ title: 'Theo: Swimming', description: 'Who: Theo, Isla', location: 'Pool' }),
      event({ uid: 'half-term', title: 'Half term', allDay: true, startAt: at('00:00'), endAt: at('00:00', 1440), startDate: '2026-10-28', endDate: '2026-10-29' }),
    ])
    const rows = db.$client.prepare('select id from events order by id').all() as { id: number }[]

    const found = list(db, at('00:00'), at('23:00'))

    expect(found).toEqual([
      {
        id: rows[1]!.id,
        calendar_id: 'family',
        title: 'Half term',
        display_title: 'Half term',
        location: null,
        start: '2026-10-28T00:00:00.000Z',
        end: '2026-10-29T00:00:00.000Z',
        all_day: true,
        start_date: '2026-10-28',
        end_date: '2026-10-29',
        people: [{ id: 'home', name: 'Household', initial: 'H', colour: '#D9A93F' }],
      },
      {
        id: rows[0]!.id,
        calendar_id: 'family',
        title: 'Theo: Swimming',
        display_title: 'Theo: Swimming',
        location: 'Pool',
        start: '2026-10-28T16:30:00.000Z',
        end: '2026-10-28T17:15:00.000Z',
        all_day: false,
        start_date: null,
        end_date: null,
        people: [
          { id: 'theo', name: 'Theo', initial: 'T', colour: '#5F94C4' },
          { id: 'isla', name: 'Isla', initial: 'I', colour: '#D27FA0' },
        ],
      },
    ])
    expect(JSON.stringify(found)).not.toContain('description')
    expect(JSON.stringify(found)).not.toContain('Who:')
  })

  it('leaves out a person who is no longer in the config, and keeps the event', () => {
    const { db } = setup([event({ title: 'Theo: Swimming', description: 'Who: Theo, Isla' })])

    const found = list(db, at('00:00'), at('23:00'), { people: PEOPLE.filter(person => person.id !== 'theo') })

    expect(found).toHaveLength(1)
    expect(found[0]!.people.map(person => person.id)).toEqual(['isla'])
  })

  it('lists only the calendars that are in the config', () => {
    const { db } = setup([timed('family-event', '10:00', 30)])
    ensureCalendarRow(db, calendarConfig({ id: 'removed', person: 'dad' }), PEOPLE)
    replaceCalendarEvents(db, 'removed', [timed('removed-event', '10:00', 30)], resolverFor({ id: 'removed', person: 'dad' }))
    ensureCalendarRow(db, calendarConfig({ id: 'work', person: 'dad' }), PEOPLE)
    replaceCalendarEvents(db, 'work', [timed('work-event', '10:00', 30)], resolverFor({ id: 'work', person: 'dad' }))

    const found = list(db, at('00:00'), at('23:00'), { calendars: [calendarConfig(), calendarConfig({ id: 'work', person: 'dad' })] })

    expect(found.map(e => [e.calendar_id, e.title])).toEqual([['family', 'family-event'], ['work', 'work-event']])
    expect(list(db, at('00:00'), at('23:00'), { calendars: [] })).toEqual([])
  })

  it('returns nothing for a range with no events', () => {
    const { db } = setup([timed('inside', '10:00', 30)])

    expect(list(db, new Date('2027-01-01T00:00:00Z'), new Date('2027-02-01T00:00:00Z'))).toEqual([])
  })
})
