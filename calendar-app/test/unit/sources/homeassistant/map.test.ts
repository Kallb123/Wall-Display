import { describe, expect, it } from 'vitest'
import { mapHaEvents } from '../../../../server/sources/homeassistant/map'
import type { HaCalendarEvent } from '../../../../server/sources/homeassistant/types'
import type { SyncWindow } from '../../../../server/sources/types'
import { WINDOW } from '../helpers'

// The unit tests run in Pacific/Auckland (see vitest.config.ts), so reading
// any time in the process zone instead of London would show here. In 2026 the
// London clocks go forward at 01:00 UTC on Sun 29 March and back at 01:00 UTC
// on Sun 25 October. WINDOW is 1 September 2026 to 1 January 2027, London time.

const LONDON = 'Europe/London'

/** One event from Home Assistant. Each test names only what it is about. */
function ha(overrides: Partial<HaCalendarEvent> = {}): HaCalendarEvent {
  return {
    summary: 'Event',
    description: null,
    location: null,
    start: { dateTime: '2026-09-10T18:00:00+01:00' },
    end: { dateTime: '2026-09-10T19:00:00+01:00' },
    uid: null,
    recurrence_id: null,
    ...overrides,
  }
}

function allDay(start: string, end?: string, overrides: Partial<HaCalendarEvent> = {}): HaCalendarEvent {
  return ha({ start: { date: start }, end: { date: end ?? start }, ...overrides })
}

function timed(start: string, end: string, overrides: Partial<HaCalendarEvent> = {}): HaCalendarEvent {
  return ha({ start: { dateTime: start }, end: { dateTime: end }, ...overrides })
}

function map(raw: HaCalendarEvent[], window: SyncWindow = WINDOW, timeZone = LONDON) {
  return mapHaEvents(raw, window, { timeZone })
}

/** The start and end instants of the first event mapped. */
function times(raw: HaCalendarEvent) {
  const [event] = map([raw]).events
  return event && [event.startAt.toISOString(), event.endAt.toISOString()]
}

describe('all-day events', () => {
  it('maps a one-day event to local midnight either side of it, with an exclusive end date', () => {
    const { events, warnings } = map([allDay('2026-09-14', '2026-09-15', { summary: 'Bins' })])

    expect(warnings).toEqual([])
    expect(events).toEqual([{
      uid: expect.stringMatching(/^ha-/),
      recurrenceId: '',
      title: 'Bins',
      description: null,
      location: null,
      startAt: new Date('2026-09-13T23:00:00Z'), // 00:00 BST
      endAt: new Date('2026-09-14T23:00:00Z'),
      allDay: true,
      startDate: '2026-09-14',
      endDate: '2026-09-15',
    }])
  })

  it('maps a multi-day event, whose end date is the day after the last day', () => {
    const [event] = map([allDay('2026-09-14', '2026-09-17')]).events

    expect(event).toMatchObject({ startDate: '2026-09-14', endDate: '2026-09-17', allDay: true })
    expect(event!.endAt.toISOString()).toBe('2026-09-16T23:00:00.000Z')
  })

  it('lasts a day when the end is the same day or before the start', () => {
    for (const end of ['2026-09-14', '2026-09-10']) {
      expect(map([allDay('2026-09-14', end)]).events[0]).toMatchObject({ startDate: '2026-09-14', endDate: '2026-09-15' })
    }
  })

  it('lasts a day when the end is a time rather than a date', () => {
    const [event] = map([ha({ start: { date: '2026-09-14' }, end: { dateTime: '2026-09-15T00:00:00+01:00' } })]).events

    expect(event).toMatchObject({ allDay: true, startDate: '2026-09-14', endDate: '2026-09-15' })
  })

  it('reads midnight in the display zone across the clock change, so the day is 25 hours long', () => {
    // BST ends at 01:00 UTC on 25 October: midnight is still BST, the next midnight is GMT.
    expect(times(allDay('2026-10-25', '2026-10-26'))).toEqual(['2026-10-24T23:00:00.000Z', '2026-10-26T00:00:00.000Z'])
    expect(times(allDay('2026-10-24', '2026-10-25'))).toEqual(['2026-10-23T23:00:00.000Z', '2026-10-24T23:00:00.000Z'])
  })

  it('reads midnight in whichever zone it is told to, never the process zone', () => {
    const newYork = map([allDay('2026-09-14', '2026-09-15')], WINDOW, 'America/New_York').events[0]!

    expect(newYork.startAt.toISOString()).toBe('2026-09-14T04:00:00.000Z')
  })
})

describe('timed events', () => {
  it('honours an offset or Z, whatever the display zone', () => {
    expect(times(timed('2026-09-10T18:00:00+01:00', '2026-09-10T19:30:00+01:00'))).toEqual(['2026-09-10T17:00:00.000Z', '2026-09-10T18:30:00.000Z'])
    expect(times(timed('2026-12-10T18:00:00+00:00', '2026-12-10T19:00:00+00:00'))).toEqual(['2026-12-10T18:00:00.000Z', '2026-12-10T19:00:00.000Z'])
    expect(times(timed('2026-12-10T18:00:00Z', '2026-12-10T19:00:00Z'))).toEqual(['2026-12-10T18:00:00.000Z', '2026-12-10T19:00:00.000Z'])
    expect(times(timed('2026-09-10T18:00:00-04:00', '2026-09-11T05:00:00+05:30'))).toEqual(['2026-09-10T22:00:00.000Z', '2026-09-10T23:30:00.000Z'])
  })

  it('reads a time with no offset as a wall time in the display zone, in summer and winter', () => {
    expect(times(timed('2026-09-10T18:00:00', '2026-09-10T19:00:00'))).toEqual(['2026-09-10T17:00:00.000Z', '2026-09-10T18:00:00.000Z'])
    expect(times(timed('2026-12-10T18:00:00', '2026-12-10T19:00:00'))).toEqual(['2026-12-10T18:00:00.000Z', '2026-12-10T19:00:00.000Z'])
    expect(times(timed('2026-09-10T18:00:00', '2026-09-10T19:00:00'))).toEqual(times(timed('2026-09-10T18:00:00+01:00', '2026-09-10T19:00:00+01:00')))
  })

  it('reads a time with no offset in whichever zone it is told to', () => {
    const [event] = map([timed('2026-07-10T09:00:00', '2026-07-10T10:00:00')], { start: new Date('2026-07-01Z'), end: new Date('2026-08-01Z') }, 'America/New_York').events

    expect(event!.startAt.toISOString()).toBe('2026-07-10T13:00:00.000Z')
  })

  it('accepts a time without seconds, and with fractions of a second', () => {
    expect(times(timed('2026-09-10T18:00', '2026-09-10T19:00'))).toEqual(['2026-09-10T17:00:00.000Z', '2026-09-10T18:00:00.000Z'])
    expect(times(timed('2026-09-10T18:00:00.250+01:00', '2026-09-10T19:00:00.5Z'))).toEqual(['2026-09-10T17:00:00.250Z', '2026-09-10T19:00:00.500Z'])
    expect(times(timed('2026-09-10T18:00:00.123456', '2026-09-10T19:00:00'))).toEqual(['2026-09-10T17:00:00.123Z', '2026-09-10T18:00:00.000Z'])
  })

  it('leaves the date fields empty and is not all-day', () => {
    expect(map([timed('2026-09-10T18:00:00Z', '2026-09-10T19:00:00Z')]).events[0]).toMatchObject({ allDay: false, startDate: null, endDate: null })
  })

  it('reads an end that is a date as local midnight of it', () => {
    const [event] = map([ha({ start: { dateTime: '2026-10-24T20:00:00+01:00' }, end: { date: '2026-10-26' } })]).events

    expect(event!.endAt.toISOString()).toBe('2026-10-26T00:00:00.000Z')
    expect(event).toMatchObject({ allDay: false, endDate: null })
  })

  it('never ends before it starts', () => {
    expect(times(timed('2026-09-10T18:00:00+01:00', '2026-09-10T17:00:00+01:00'))).toEqual(['2026-09-10T17:00:00.000Z', '2026-09-10T17:00:00.000Z'])
  })

  it('keeps an event that spans the clock change at its real length', () => {
    expect(times(timed('2026-10-24T22:00:00+01:00', '2026-10-25T08:00:00+00:00'))).toEqual(['2026-10-24T21:00:00.000Z', '2026-10-25T08:00:00.000Z'])
  })
})

describe('text', () => {
  it('trims the title and falls back to (No title)', () => {
    const { events } = map([
      timed('2026-09-10T18:00:00Z', '2026-09-10T19:00:00Z', { summary: '  Swimming  ' }),
      timed('2026-09-11T18:00:00Z', '2026-09-11T19:00:00Z', { summary: null }),
      timed('2026-09-12T18:00:00Z', '2026-09-12T19:00:00Z', { summary: '   ' }),
    ])

    expect(events.map(e => e.title)).toEqual(['Swimming', '(No title)', '(No title)'])
  })

  it('maps a null or blank description and location to null, and keeps the rest as given', () => {
    const { events } = map([
      timed('2026-09-10T18:00:00Z', '2026-09-10T19:00:00Z', { description: null, location: null }),
      timed('2026-09-11T18:00:00Z', '2026-09-11T19:00:00Z', { description: '  ', location: '' }),
      timed('2026-09-12T18:00:00Z', '2026-09-12T19:00:00Z', { description: ' Bring a towel\n', location: 'Leisure centre ' }),
    ])

    expect(events.map(e => [e.description, e.location])).toEqual([
      [null, null],
      [null, null],
      [' Bring a towel\n', 'Leisure centre '],
    ])
  })
})

describe('uid and recurrence id', () => {
  it('keeps the uid and recurrence id it is given, trimmed', () => {
    const [event] = map([allDay('2026-09-14', '2026-09-15', { uid: ' abc123 ', recurrence_id: ' 20260914 ' })]).events

    expect(event).toMatchObject({ uid: 'abc123', recurrenceId: '20260914' })
  })

  it('makes a stable uid for an event without one: the same on every poll, different for different events', () => {
    const swimming = timed('2026-09-10T18:00:00Z', '2026-09-10T19:00:00Z', { summary: 'Swimming', description: 'Pool' })
    const first = map([swimming]).events[0]!.uid
    const again = map([{ ...swimming, description: 'A different description' }]).events[0]!.uid

    expect(first).toMatch(/^ha-[0-9a-f]{40}$/)
    expect(again).toBe(first)

    const others = [
      timed('2026-09-10T18:00:00Z', '2026-09-10T19:00:00Z', { summary: 'Piano' }),
      timed('2026-09-11T18:00:00Z', '2026-09-11T19:00:00Z', { summary: 'Swimming' }),
      timed('2026-09-10T18:00:00Z', '2026-09-10T20:00:00Z', { summary: 'Swimming' }),
      timed('2026-09-10T18:00:00+00:00', '2026-09-10T19:00:00+00:00', { summary: 'Swimming' }),
    ]
    expect(new Set([first, ...map(others).events.map(e => e.uid)]).size).toBe(5)
  })

  it('makes a uid for a blank uid too', () => {
    expect(map([ha({ uid: '  ' })]).events[0]!.uid).toMatch(/^ha-/)
  })

  it('leaves the recurrence id empty for a one-off event', () => {
    expect(map([ha({ uid: 'one-off' })]).events[0]!.recurrenceId).toBe('')
  })

  it('gives the instances of a repeated uid their own start as a recurrence id, all-day and timed', () => {
    const { events, warnings } = map([
      allDay('2026-09-14', '2026-09-15', { uid: 'bins' }),
      allDay('2026-09-28', '2026-09-29', { uid: 'bins' }),
      timed('2026-09-10T18:00:00+01:00', '2026-09-10T19:00:00+01:00', { uid: 'swim' }),
      timed('2026-12-10T18:00:00', '2026-12-10T19:00:00', { uid: 'swim' }),
    ])

    expect(warnings).toEqual([])
    expect(events.map(e => [e.uid, e.recurrenceId])).toEqual([
      ['bins', '20260914'],
      ['bins', '20260928'],
      ['swim', '20260910T170000Z'],
      ['swim', '20261210T180000Z'],
    ])
  })

  it('gives an instance the same recurrence id as the ICS source would', () => {
    // An all-day instance is its date; a timed one is its UTC instant.
    const [event] = map([
      timed('2026-10-28T16:00:00Z', '2026-10-28T17:00:00Z', { uid: 'x' }),
      timed('2026-10-29T16:00:00Z', '2026-10-29T17:00:00Z', { uid: 'x' }),
    ]).events

    expect(event!.recurrenceId).toBe('20261028T160000Z')
  })

  it('does not depend on the order of the response', () => {
    const raw = [
      timed('2026-09-10T18:00:00Z', '2026-09-10T19:00:00Z', { uid: 'swim' }),
      timed('2026-09-17T18:00:00Z', '2026-09-17T19:00:00Z', { uid: 'swim', recurrence_id: 'explicit' }),
      timed('2026-09-24T18:00:00Z', '2026-09-24T19:00:00Z', { uid: 'swim' }),
      allDay('2026-09-14', '2026-09-15', { uid: 'solo' }),
    ]
    const keys = (events: ReturnType<typeof map>['events']) => events.map(e => `${e.uid}/${e.recurrenceId}`).sort()

    const forwards = keys(map(raw).events)
    expect(forwards).toEqual(['solo/', 'swim/20260910T180000Z', 'swim/20260924T180000Z', 'swim/explicit'])
    expect(keys(map([...raw].reverse()).events)).toEqual(forwards)
    expect(keys(map([raw[2]!, raw[0]!, raw[3]!, raw[1]!]).events)).toEqual(forwards)
  })

  it('keeps an instance\'s recurrence id when its neighbours fall outside the window', () => {
    const { events } = map([
      allDay('2026-09-14', '2026-09-15', { uid: 'bins' }),
      allDay('2025-01-06', '2025-01-07', { uid: 'bins' }),
    ])

    expect(events.map(e => e.recurrenceId)).toEqual(['20260914'])
  })

  it('drops an exact duplicate, with one warning that counts them', () => {
    const copy = allDay('2026-09-14', '2026-09-15', { uid: 'bins', recurrence_id: '20260914', summary: 'First' })
    const { events, warnings } = map([
      copy,
      { ...copy, summary: 'Second' },
      { ...copy, summary: 'Third' },
      allDay('2026-09-28', '2026-09-29', { uid: 'bins', recurrence_id: '20260928' }),
    ])

    expect(events.map(e => [e.recurrenceId, e.title])).toEqual([['20260914', 'First'], ['20260928', 'Event']])
    expect(warnings).toEqual(['2 events appeared more than once with the same id; only the first of each was kept'])
  })

  it('drops the identical copies of an event that has no uid', () => {
    const { events, warnings } = map([ha(), ha(), ha({ summary: 'Other' })])

    expect(events.map(e => e.title)).toEqual(['Event', 'Other'])
    expect(warnings).toEqual(['1 event appeared more than once with the same id; only the first of each was kept'])
  })

  it('never hands the store two events with one key', () => {
    const { events } = map([
      allDay('2026-09-14', '2026-09-15', { uid: 'a', recurrence_id: '20260914' }),
      allDay('2026-09-14', '2026-09-15', { uid: 'a' }), // gets 20260914 from its start
      allDay('2026-09-14', '2026-09-15', { uid: 'a', recurrence_id: '' }),
    ])

    expect(events).toHaveLength(1)
  })
})

describe('events that cannot be read', () => {
  it('skips an event with an unreadable date or time, with one warning that counts them', () => {
    const { events, warnings } = map([
      allDay('2026-02-30', '2026-03-01'), // not a real date
      allDay('14/09/2026'),
      allDay('2026-09-14', 'soon'),
      timed('2026-09-10 18:00:00', '2026-09-10T19:00:00Z'),
      timed('2026-09-10T18:00:00Z', 'never'),
      timed('2026-09-10T25:00:00Z', '2026-09-10T26:00:00Z'),
      timed('2026-09-10T18:00:00+25:00', '2026-09-10T19:00:00Z'),
      timed('2026-09-10', '2026-09-11'),
      ha({ summary: 'Fine', start: { dateTime: '2026-09-10T18:00:00Z' }, end: { dateTime: '2026-09-10T19:00:00Z' } }),
    ])

    expect(events.map(e => e.title)).toEqual(['Fine'])
    expect(warnings).toEqual(['8 events with an unreadable start or end were left out'])
  })

  it('says "was" for one', () => {
    expect(map([allDay('2026-02-30')]).warnings).toEqual(['1 event with an unreadable start or end was left out'])
  })

  it('does not put what the event said in the warning', () => {
    expect(map([allDay('secret-token-abc', undefined, { summary: 'Private', uid: 'u-1' })]).warnings.join()).not.toMatch(/secret|Private|u-1/)
  })

  it('accepts the last day of February in a leap year only', () => {
    expect(map([allDay('2028-02-29')], { start: new Date('2028-01-01Z'), end: new Date('2028-12-31Z') }).events).toHaveLength(1)
    expect(map([allDay('2027-02-29')], { start: new Date('2027-01-01Z'), end: new Date('2027-12-31Z') }).events).toHaveLength(0)
  })
})

describe('the window', () => {
  // WINDOW: 2026-08-31T23:00:00Z (included) to 2027-01-01T00:00:00Z (not included).
  const kept = (...raw: HaCalendarEvent[]) => map(raw).events.map(e => e.title)

  it('keeps an event that overlaps either edge, and drops one that only touches it', () => {
    expect(kept(
      timed('2026-08-31T22:00:00Z', '2026-08-31T23:00:00Z', { summary: 'ends at the start' }),
      timed('2026-08-31T22:00:00Z', '2026-08-31T23:00:01Z', { summary: 'overlaps the start' }),
      timed('2026-12-31T23:00:00Z', '2027-01-01T00:00:00Z', { summary: 'ends at the end' }),
      timed('2026-12-31T23:59:59Z', '2027-01-01T01:00:00Z', { summary: 'overlaps the end' }),
      timed('2027-01-01T00:00:00Z', '2027-01-01T01:00:00Z', { summary: 'starts at the end' }),
      timed('2026-08-30T00:00:00Z', '2026-08-30T01:00:00Z', { summary: 'before' }),
    )).toEqual(['overlaps the start', 'ends at the end', 'overlaps the end'])
  })

  it('keeps a zero-length event that starts inside the window, including at its start but not at its end', () => {
    expect(kept(
      timed('2026-08-31T22:59:59Z', '2026-08-31T22:59:59Z', { summary: 'just before' }),
      timed('2026-08-31T23:00:00Z', '2026-08-31T23:00:00Z', { summary: 'at the start' }),
      timed('2026-09-10T12:00:00Z', '2026-09-10T12:00:00Z', { summary: 'inside' }),
      timed('2026-12-31T23:59:59Z', '2026-12-31T23:59:59Z', { summary: 'just inside the end' }),
      timed('2027-01-01T00:00:00Z', '2027-01-01T00:00:00Z', { summary: 'at the end' }),
    )).toEqual(['at the start', 'inside', 'just inside the end'])
  })

  it('judges an all-day event by its local midnights', () => {
    // 1 September is the first day of the window; 31 August is not in it at all.
    expect(kept(
      allDay('2026-08-31', '2026-09-01', { summary: '31 August' }),
      allDay('2026-08-31', '2026-09-02', { summary: '31 August to 1 September' }),
      allDay('2026-12-31', '2027-01-01', { summary: '31 December' }),
      allDay('2027-01-01', '2027-01-02', { summary: '1 January' }),
    )).toEqual(['31 August to 1 September', '31 December'])
  })

  it('does not count events that are left out as unreadable or duplicates', () => {
    const { warnings } = map([
      allDay('2025-01-01', '2025-01-02', { uid: 'a', recurrence_id: 'x' }),
      allDay('2025-01-01', '2025-01-02', { uid: 'a', recurrence_id: 'x' }),
    ])

    expect(warnings).toEqual([])
  })
})

describe('a realistic response', () => {
  it('maps a bin collection calendar: all-day instances of a few series, with a recurrence id each', () => {
    const bins = (date: string, next: string, summary: string, uid: string) =>
      ha({ summary, description: null, location: null, start: { date }, end: { date: next }, uid, recurrence_id: date.replaceAll('-', '') })
    const { events, warnings } = map([
      bins('2026-09-04', '2026-09-05', 'Green bin', '2d6f-green@local'),
      bins('2026-09-18', '2026-09-19', 'Green bin', '2d6f-green@local'),
      bins('2026-10-02', '2026-10-03', 'Green bin', '2d6f-green@local'),
      bins('2026-09-11', '2026-09-12', 'Black bin', '7a41-black@local'),
      bins('2026-09-25', '2026-09-26', 'Black bin', '7a41-black@local'),
      bins('2026-10-23', '2026-10-24', 'Black bin', '7a41-black@local'),
      bins('2026-10-30', '2026-10-31', 'Garden waste', 'c9b0-garden@local'),
      { ...bins('2026-12-25', '2026-12-26', 'Christmas Day', 'fe12-xmas@local'), recurrence_id: null },
    ])

    expect(warnings).toEqual([])
    expect(events.map(e => [e.uid, e.recurrenceId, e.title, e.startDate, e.endDate])).toEqual([
      ['2d6f-green@local', '20260904', 'Green bin', '2026-09-04', '2026-09-05'],
      ['2d6f-green@local', '20260918', 'Green bin', '2026-09-18', '2026-09-19'],
      ['2d6f-green@local', '20261002', 'Green bin', '2026-10-02', '2026-10-03'],
      ['7a41-black@local', '20260911', 'Black bin', '2026-09-11', '2026-09-12'],
      ['7a41-black@local', '20260925', 'Black bin', '2026-09-25', '2026-09-26'],
      ['7a41-black@local', '20261023', 'Black bin', '2026-10-23', '2026-10-24'],
      ['c9b0-garden@local', '20261030', 'Garden waste', '2026-10-30', '2026-10-31'],
      ['fe12-xmas@local', '', 'Christmas Day', '2026-12-25', '2026-12-26'],
    ])
    expect(events.every(e => e.allDay)).toBe(true)
    expect(events[2]!.startAt.toISOString()).toBe('2026-10-01T23:00:00.000Z')
  })

  it('maps a mixed calendar from an integration that fills in little', () => {
    const { events, warnings } = map([
      { summary: 'Parents evening', description: null, location: null, start: { dateTime: '2026-09-15T18:30:00' }, end: { dateTime: '2026-09-15T19:00:00' }, uid: null, recurrence_id: null },
      { summary: null, description: null, location: null, start: { date: '2026-10-31' }, end: { date: '2026-11-01' }, uid: null, recurrence_id: null },
      { summary: 'Holiday', description: 'Cornwall', location: 'St Ives', start: { date: '2026-10-24' }, end: { date: '2026-10-31' }, uid: 'holiday-1', recurrence_id: null },
    ])

    expect(warnings).toEqual([])
    expect(events.map(e => [e.title, e.startAt.toISOString(), e.endAt.toISOString(), e.recurrenceId])).toEqual([
      ['Parents evening', '2026-09-15T17:30:00.000Z', '2026-09-15T18:00:00.000Z', ''],
      ['(No title)', '2026-10-31T00:00:00.000Z', '2026-11-01T00:00:00.000Z', ''],
      ['Holiday', '2026-10-23T23:00:00.000Z', '2026-10-31T00:00:00.000Z', ''],
    ])
    expect(new Set(events.map(e => e.uid)).size).toBe(3)
  })
})
