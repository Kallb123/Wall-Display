import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../../server/config/load'
import { expandIcs } from '../../../server/sources/ics/expand'
import { syncWindow } from '../../../server/sources/time'
import { LANES, MAX_BADGE_INITIALS, monthLayout, PANEL_DAYS, WEEK_ROWS } from '../../../shared/month-layout'
import type { MonthLayout, MonthLayoutInput, WeekRow } from '../../../shared/month-layout'
import { createPeopleResolver } from '../../../shared/people'
import type { CalendarEvent, EventPerson } from '../../../shared/types/events'

// The family from config.dev.yaml and its two ICS fixtures, set around Wed 28
// Oct 2026 (the clocks went back on the 25th). Hand-checked against the real
// calendar: 1 Oct 2026 is a Thursday, 1 Mar 2026 a Sunday and 1 Feb 2027 a Monday.

const APP_DIR = join(import.meta.dirname, '../../..')
const LONDON = 'Europe/London'
const TODAY = '2026-10-28'
const dev = loadConfig({ configFile: join(APP_DIR, 'config.dev.yaml'), env: {} })

const person = (id: string): EventPerson => {
  const found = dev.people.find(candidate => candidate.id === id)!
  return { id: found.id, name: found.name, initial: found.initial, colour: found.colour }
}

/** The fixtures' events as the API returns them: expanded, with their people and display titles resolved. */
function fixtureEvents(): CalendarEvent[] {
  const window = syncWindow(new Date(`${TODAY}T12:00:00Z`), LONDON, 12, 12)
  let id = 1
  return dev.calendars.flatMap((calendar) => {
    const resolve = createPeopleResolver(calendar, dev.people)
    const { events } = expandIcs(readFileSync(join(APP_DIR, 'test/fixtures/ics', `${calendar.id}.ics`), 'utf8'), window, { timeZone: LONDON })
    return events.map((event): CalendarEvent => {
      const resolved = resolve(event)
      return {
        id: id++,
        calendar_id: calendar.id,
        title: event.title,
        display_title: resolved.displayTitle,
        location: event.location,
        start: event.startAt.toISOString(),
        end: event.endAt.toISOString(),
        all_day: event.allDay,
        start_date: event.startDate,
        end_date: event.endDate,
        people: resolved.personIds.map(person),
      }
    })
  })
}

const FIXTURES = fixtureEvents()

let nextId = 1000

/** A timed event from `start` to `end`, both ISO instants. */
function timed(start: string, end: string, title = 'Event', people: string[] = [], id = nextId++): CalendarEvent {
  return { id, calendar_id: 'family', title, display_title: title, location: null, start, end, all_day: false, start_date: null, end_date: null, people: people.map(person) }
}

/** An hour-long event starting at `time` (`HH:MM`, UTC) on `date`. */
function at(date: string, time: string, title = 'Event', people: string[] = [], id = nextId++): CalendarEvent {
  const start = new Date(`${date}T${time}:00Z`)
  return timed(start.toISOString(), new Date(start.getTime() + 3_600_000).toISOString(), title, people, id)
}

/** An all-day event on `first` up to but not including `after`. */
function allDay(first: string, after: string, title = 'All day', people: string[] = [], id = nextId++): CalendarEvent {
  return { ...timed(`${first}T00:00:00.000Z`, `${after}T00:00:00.000Z`, title, people, id), all_day: true, start_date: first, end_date: after }
}

function layout(month: string, overrides: Partial<MonthLayoutInput> = {}): MonthLayout {
  return monthLayout({ month, today: TODAY, timeZone: LONDON, weekStart: 'monday', events: [], ...overrides })
}

const dates = (row: WeekRow) => row.cells.map(cell => cell.date)
const titles = (items: { event: CalendarEvent }[]) => items.map(item => item.event.display_title)
const barsOf = (row: WeekRow, title: string) => row.bars.filter(bar => bar.event.display_title === title)

/** A bar, reduced to where it is drawn. */
const shape = (bar: WeekRow['bars'][number]) => ({ lane: bar.lane, column: bar.column, span: bar.span, roundStart: bar.roundStart, roundEnd: bar.roundEnd })

describe('the constants', () => {
  it('are five rows, four lanes, four panel days and three initials', () => {
    expect([WEEK_ROWS, LANES, PANEL_DAYS, MAX_BADGE_INITIALS]).toEqual([5, 4, 4, 3])
  })
})

describe('October 2026, as in the mocks', () => {
  const result = layout('2026-10', { events: FIXTURES })
  const row0 = result.rows[0]!
  const row4 = result.rows[4]!

  it('is five rows of seven, Monday first, from 28 September to 1 November', () => {
    expect(result.month).toBe('2026-10')
    expect(result.weekdays).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(result.rows).toHaveLength(5)
    expect(result.rows.every(row => row.cells.length === 7)).toBe(true)
    expect(dates(row0)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
    expect(dates(row4)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'])
    expect(result.rows.flatMap(row => row.cells).map(cell => cell.column)).toEqual(Array.from({ length: 35 }, (_, i) => i % 7))
  })

  it('does not wrap, and marks the days outside October', () => {
    const cells = result.rows.flatMap(row => row.cells)

    expect(cells.some(cell => cell.wrapped)).toBe(false)
    expect(cells.filter(cell => !cell.inMonth).map(cell => cell.date)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-11-01'])
    expect(row0.cells[3]).toMatchObject({ date: '2026-10-01', day: 1, inMonth: true })
  })

  it('marks today, and the days before it as past', () => {
    const cells = result.rows.flatMap(row => row.cells)

    expect(cells.filter(cell => cell.today).map(cell => cell.date)).toEqual(['2026-10-28'])
    expect(row4.cells[2]).toMatchObject({ date: '2026-10-28', day: 28, column: 2, today: true, past: false })
    expect(cells.filter(cell => cell.past).map(cell => cell.date)).toEqual(cells.map(cell => cell.date).filter(date => date < TODAY))
  })

  it('veils whole rows 1 to 4 and Monday to Tuesday of row 5', () => {
    expect(result.rows.map(row => row.veils)).toEqual([
      [{ column: 0, span: 7 }],
      [{ column: 0, span: 7 }],
      [{ column: 0, span: 7 }],
      [{ column: 0, span: 7 }],
      [{ column: 0, span: 2 }],
    ])
  })

  it('draws Half term, 26 to 30 October, as one round-ended bar of five columns', () => {
    const half = barsOf(row4, 'Half term')

    expect(half).toHaveLength(1)
    expect(shape(half[0]!)).toEqual({ lane: 0, column: 0, span: 5, roundStart: true, roundEnd: true })
    expect(half[0]).toMatchObject({ colour: '#D9A93F', initials: ['H'] })
  })

  it('gives the shared Dentist both people, two initials and the first person\'s colour', () => {
    const dentist = row4.timed.filter(row => row.event.display_title === 'Dentist')

    expect(dentist).toHaveLength(1)
    expect(dentist[0]).toMatchObject({ column: 1, lane: 1, time: '14:30', colour: '#D27FA0', initials: ['I', 'T'] })
    expect(dentist[0]!.people.map(p => p.id)).toEqual(['isla', 'theo'])
    expect(dentist[0]!.event.title).toBe('[Isla & Theo] Dentist')
  })

  it('shows three of Wednesday\'s five items and counts the other two', () => {
    // Half term (a bar), then Nursery 08:45, 1:1 14:00, Swimming 16:30 and Pilates 19:30: lane 3 is "+2 more".
    expect(row4.more.filter(label => label.column === 2)).toEqual([{ column: 2, lane: 3, count: 2 }])
    expect(row4.timed.filter(row => row.column === 2).map(row => [row.lane, row.time, row.event.display_title])).toEqual([
      [1, '08:45', 'Nursery'],
      [2, '14:00', '1:1 with Priya'],
    ])
  })

  it('shows Saturday\'s seven timed events as three and "+4 more"', () => {
    expect(row4.timed.filter(row => row.column === 5).map(row => [row.lane, row.time, row.event.display_title])).toEqual([
      [0, '07:30', 'Cycling club'],
      [1, '09:30', 'Ballet'],
      [2, '11:00', 'Football'],
    ])
    expect(row4.more).toEqual([{ column: 2, lane: 3, count: 2 }, { column: 5, lane: 3, count: 4 }])
  })

  it('keeps the days around them whole', () => {
    // Thursday: Half term, the bin (both all-day) and the moved stand-up.
    expect(barsOf(row4, 'General waste bin').map(shape)).toEqual([{ lane: 1, column: 3, span: 1, roundStart: true, roundEnd: true }])
    expect(row4.timed.filter(row => row.column === 3).map(row => [row.lane, row.time, row.event.display_title])).toEqual([[2, '10:00', 'Team stand-up (moved)']])
    // Sunday 1 November: Rent due is a bar of one, in the last cell.
    expect(barsOf(row4, 'Rent due').map(shape)).toEqual([{ lane: 0, column: 6, span: 1, roundStart: true, roundEnd: true }])
  })

  it('has the side panel for Today, Tomorrow, Friday and Saturday, all-day items before timed', () => {
    const [today, tomorrow, friday, saturday] = result.panel as [typeof result.panel[number], ...typeof result.panel]

    expect(result.panel.map(day => [day.date, day.label])).toEqual([
      ['2026-10-28', 'Today'],
      ['2026-10-29', 'Tomorrow'],
      ['2026-10-30', 'Friday'],
      ['2026-10-31', 'Saturday'],
    ])

    expect(titles(today.allDay)).toEqual(['Half term'])
    expect(today.allDay[0]!.time).toBeNull()
    expect(today.timed.map(item => [item.time, item.event.display_title])).toEqual([
      ['08:45', 'Nursery'],
      ['14:00', '1:1 with Priya'],
      ['16:30', 'Swimming'],
      ['19:30', 'Pilates'],
    ])

    expect(titles(tomorrow.allDay)).toEqual(['Half term', 'General waste bin'])
    expect(tomorrow.timed.map(item => [item.time, item.event.display_title])).toEqual([['10:00', 'Team stand-up (moved)']])

    expect(titles(friday.allDay)).toEqual(['Half term'])
    expect(friday.timed.map(item => [item.time, item.event.display_title])).toEqual([['15:00', 'Sprint review']])

    expect(saturday.allDay).toEqual([])
    expect(saturday.timed.map(item => [item.time, item.event.display_title])).toEqual([
      ['07:30', 'Cycling club'],
      ['09:30', 'Ballet'],
      ['11:00', 'Football'],
      ['14:00', 'Hair appointment'],
      ['15:00', 'Pumpkin carving'],
      ['16:30', 'Halloween party at Maya\'s'],
      ['18:00', 'Trick or treating'],
    ])
  })

  it('gives each panel item its people', () => {
    const trick = result.panel[3]!.timed.at(-1)!

    expect(trick).toMatchObject({ colour: '#5F94C4', initials: ['T', 'P'] })
    expect(trick.people.map(p => p.id)).toEqual(['theo', 'poppy'])
  })

  it('is the same whatever order the events arrive in', () => {
    expect(layout('2026-10', { events: [...FIXTURES].reverse() })).toEqual(result)
  })

  it('draws nothing in a lane past the fourth, or in the fourth where "+N more" is', () => {
    for (const row of result.rows) {
      expect(row.bars.every(bar => bar.lane < LANES)).toBe(true)
      expect(row.timed.every(item => item.lane < LANES)).toBe(true)
      for (const label of row.more) {
        const drawn = [...row.bars.filter(bar => bar.column <= label.column && label.column < bar.column + bar.span), ...row.timed.filter(item => item.column === label.column)]
        expect(drawn.every(item => item.lane < LANES - 1)).toBe(true)
      }
    }
  })
})

describe('March 2026, which needs a sixth row and has a clock change', () => {
  // Sunday 1 March 2026, Monday first: six leading days and 31 days make 37 cells.
  const base = layout('2026-03', { today: '2026-03-10' })

  it('wraps 30 and 31 March into the top row\'s first cells', () => {
    const [top, , , , last] = base.rows as [WeekRow, WeekRow, WeekRow, WeekRow, WeekRow]

    expect(dates(top)).toEqual(['2026-03-30', '2026-03-31', '2026-02-25', '2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01'])
    expect(top.cells.map(cell => cell.wrapped)).toEqual([true, true, false, false, false, false, false])
    expect(top.cells.map(cell => cell.inMonth)).toEqual([true, true, false, false, false, false, true])
    expect(top.cells.map(cell => cell.column)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(dates(last)).toEqual(['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29'])
    expect(base.rows.map(row => row.cells[0]!.date)).toEqual(['2026-03-30', '2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23'])
    expect(base.rows.flatMap(row => row.cells).filter(cell => cell.inMonth)).toHaveLength(31)
  })

  it('veils the past days of the top row from 25 February, leaving the wrapped days clear', () => {
    // Today is Tuesday 10 March.
    expect(base.rows.map(row => row.veils)).toEqual([
      [{ column: 2, span: 5 }],
      [{ column: 0, span: 7 }],
      [{ column: 0, span: 1 }],
      [],
      [],
    ])
  })

  it('draws one veil across the wrap when every day is past', () => {
    const later = layout('2026-03', { today: '2026-04-15' })

    expect(later.rows.map(row => row.veils)).toEqual(Array.from({ length: 5 }, () => [{ column: 0, span: 7 }]))
  })

  it('splits an event over the wrap into two pieces that never meet the 25 February cell', () => {
    // 29 to 31 March: end_date is the day after.
    const result = layout('2026-03', { today: '2026-03-10', events: [allDay('2026-03-29', '2026-04-01', 'Camping')] })

    expect(result.rows[4]!.bars.map(shape)).toEqual([{ lane: 0, column: 6, span: 1, roundStart: true, roundEnd: false }])
    expect(result.rows[0]!.bars.map(shape)).toEqual([{ lane: 0, column: 0, span: 2, roundStart: false, roundEnd: true }])
    expect(result.rows.slice(1, 4).every(row => row.bars.length === 0)).toBe(true)
  })

  it('does not join the two runs of the top row when an event covers both', () => {
    // 28 February to 1 March is the second run's last two columns; 30 March to 2 April reaches the wrapped days.
    const result = layout('2026-03', { today: '2026-03-10', events: [allDay('2026-02-28', '2026-03-02', 'Weekend away'), allDay('2026-03-30', '2026-04-03', 'Trip')] })
    const top = result.rows[0]!

    expect(barsOf(top, 'Weekend away').map(shape)).toEqual([{ lane: 0, column: 5, span: 2, roundStart: true, roundEnd: true }])
    expect(barsOf(top, 'Trip').map(shape)).toEqual([{ lane: 0, column: 0, span: 2, roundStart: true, roundEnd: false }])
  })

  it('keeps one lane for an event across both runs of the top row', () => {
    // 26 February to 31 March covers columns 3 to 6 (26 Feb to 1 Mar) and, after the wrap, columns 0 and 1.
    const result = layout('2026-03', { today: '2026-03-10', events: [allDay('2026-02-26', '2026-04-01', 'Long', [], 2), allDay('2026-02-26', '2026-02-28', 'Early', [], 1)] })
    const top = result.rows[0]!

    // "Early" (26 and 27 Feb, columns 3 and 4) is shorter, so the long event has lane 0 in both runs.
    expect(barsOf(top, 'Long').map(shape)).toEqual([
      { lane: 0, column: 0, span: 2, roundStart: false, roundEnd: true },
      { lane: 0, column: 3, span: 4, roundStart: true, roundEnd: false },
    ])
    expect(barsOf(top, 'Early').map(shape)).toEqual([{ lane: 1, column: 3, span: 2, roundStart: true, roundEnd: true }])
  })

  it('puts a late event on the wrapped day it falls on, across the clock change', () => {
    // BST began at 01:00Z on Sunday 29 March: 23:30Z on the 29th is 00:30 on the 30th.
    // 01:30 does not exist that morning, so the last GMT half hour (00:30Z) and the first BST one (01:30Z = 02:30) are used.
    const result = layout('2026-03', {
      today: '2026-03-10',
      events: [
        at('2026-03-29', '23:30', 'After midnight', [], 1),
        at('2026-03-29', '00:30', 'Before the change', [], 2),
        at('2026-03-29', '01:30', 'After the change', [], 3),
        at('2026-03-28', '22:30', 'Late Saturday', [], 4),
      ],
    })
    const top = result.rows[0]!
    const last = result.rows[4]!

    expect(top.timed.map(row => [row.event.display_title, row.column, row.time])).toEqual([['After midnight', 0, '00:30']])
    expect(top.cells[0]).toMatchObject({ date: '2026-03-30', wrapped: true })
    expect(last.timed.map(row => [row.event.display_title, row.column, row.lane, row.time])).toEqual([
      ['Late Saturday', 5, 0, '22:30'],
      ['Before the change', 6, 0, '00:30'],
      ['After the change', 6, 1, '02:30'],
    ])
  })

  it('still gives the previous month\'s days in the grid their events', () => {
    const result = layout('2026-03', { today: '2026-03-10', events: [at('2026-02-28', '12:00', 'Last of February')] })

    expect(result.rows[0]!.timed.map(row => [row.column, row.time])).toEqual([[5, '12:00']])
    expect(result.rows[0]!.cells[5]).toMatchObject({ date: '2026-02-28', inMonth: false })
  })
})

describe('February 2027, four rows of February and one of March', () => {
  const result = layout('2027-02', { today: '2027-02-10' })

  it('starts on Monday 1 February and runs 28 days', () => {
    expect(result.rows[0]!.cells[0]).toMatchObject({ date: '2027-02-01', day: 1, column: 0, inMonth: true, wrapped: false })
    expect(result.rows[3]!.cells[6]).toMatchObject({ date: '2027-02-28', inMonth: true })
    expect(result.rows.slice(0, 4).flatMap(row => row.cells).every(cell => cell.inMonth && !cell.wrapped)).toBe(true)
  })

  it('shows 1 to 7 March in the fifth row, all outside the month', () => {
    expect(dates(result.rows[4]!)).toEqual(['2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05', '2027-03-06', '2027-03-07'])
    expect(result.rows[4]!.cells.every(cell => !cell.inMonth && !cell.wrapped && !cell.past)).toBe(true)
  })

  it('has today on the 10th and veils before it', () => {
    expect(result.rows.flatMap(row => row.cells).filter(cell => cell.today).map(cell => cell.date)).toEqual(['2027-02-10'])
    expect(result.rows.map(row => row.veils)).toEqual([[{ column: 0, span: 7 }], [{ column: 0, span: 2 }], [], [], []])
  })
})

describe('Sunday-first weeks', () => {
  it('starts the header on Sunday and puts the 1st in the right column', () => {
    const result = layout('2026-10', { weekStart: 'sunday', events: FIXTURES })

    expect(result.weekdays).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
    // 1 October 2026 is a Thursday: column 4, after 27 to 30 September.
    expect(dates(result.rows[0]!)).toEqual(['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'])
    expect(result.rows[0]!.cells[4]).toMatchObject({ date: '2026-10-01', column: 4, inMonth: true })
    // 4 leading days and 31 days fill 35 cells exactly.
    expect(dates(result.rows[4]!)).toEqual(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'])
    expect(result.rows.flatMap(row => row.cells).some(cell => cell.wrapped)).toBe(false)
  })

  it('moves Half term to the Monday to Friday columns', () => {
    const half = barsOf(layout('2026-10', { weekStart: 'sunday', events: FIXTURES }).rows[4]!, 'Half term')

    expect(half.map(shape)).toEqual([{ lane: 0, column: 1, span: 5, roundStart: true, roundEnd: true }])
  })

  it('wraps by one day in a 31-day month starting on a Friday', () => {
    // May 2026: Friday 1 May. Sunday first, 5 leading days and 31 days make 36 cells.
    const result = layout('2026-05', { weekStart: 'sunday', today: '2026-05-10' })

    expect(dates(result.rows[0]!)).toEqual(['2026-05-31', '2026-04-27', '2026-04-28', '2026-04-29', '2026-04-30', '2026-05-01', '2026-05-02'])
    expect(result.rows[0]!.cells.map(cell => cell.wrapped)).toEqual([true, false, false, false, false, false, false])
    expect(dates(result.rows[4]!)).toEqual(['2026-05-24', '2026-05-25', '2026-05-26', '2026-05-27', '2026-05-28', '2026-05-29', '2026-05-30'])
  })

  it('wraps one day in August 2026 and in November 2026, Monday first', () => {
    // Saturday 1 August has 31 days: 5 leading days and 36 cells.
    const august = layout('2026-08', { today: '2026-08-10' })
    // Sunday 1 November has 30 days: 6 leading days and 36 cells.
    const november = layout('2026-11', { today: '2026-11-10' })

    expect(dates(august.rows[0]!)[0]).toBe('2026-08-31')
    expect(dates(november.rows[0]!)[0]).toBe('2026-11-30')
    expect(dates(november.rows[4]!)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'])
  })
})

describe('bars across a week boundary', () => {
  // Thursday 15 to Monday 19 October 2026: five days over two rows.
  const result = layout('2026-10', { events: [allDay('2026-10-15', '2026-10-20', 'Holiday')] })

  it('is two pieces, round at the event\'s own ends and square where it carries on', () => {
    expect(result.rows[2]!.bars.map(shape)).toEqual([{ lane: 0, column: 3, span: 4, roundStart: true, roundEnd: false }])
    expect(result.rows[3]!.bars.map(shape)).toEqual([{ lane: 0, column: 0, span: 1, roundStart: false, roundEnd: true }])
    expect(result.rows.flatMap(row => row.bars)).toHaveLength(2)
  })

  it('is one bar of the whole event when it fits inside a row', () => {
    const inside = layout('2026-10', { events: [allDay('2026-10-13', '2026-10-16', 'Trip')] })

    expect(inside.rows[2]!.bars.map(shape)).toEqual([{ lane: 0, column: 1, span: 3, roundStart: true, roundEnd: true }])
  })

  it('draws a timed event over several days as a bar', () => {
    // 23:00 on Wednesday 14 October to 09:00 on Friday the 16th, London time (BST).
    const overnight = layout('2026-10', { events: [timed('2026-10-14T22:00:00Z', '2026-10-16T08:00:00Z', 'Sleepover')] })

    expect(overnight.rows[2]!.bars.map(shape)).toEqual([{ lane: 0, column: 2, span: 3, roundStart: true, roundEnd: true }])
    expect(overnight.rows[2]!.timed).toEqual([])
  })

  it('does not extend a timed event that ends exactly at midnight into the next day', () => {
    const result = layout('2026-10', { events: [timed('2026-10-14T09:00:00Z', '2026-10-15T23:00:00Z', 'Ends at midnight')] })

    // 23:00Z is 00:00 on the 16th in London, so the event is over by then: Wednesday and Thursday only.
    expect(result.rows[2]!.bars.map(shape)).toEqual([{ lane: 0, column: 2, span: 2, roundStart: true, roundEnd: true }])
  })

  it('keeps a zero-length event on its start day, as a timed row', () => {
    const result = layout('2026-10', { events: [timed('2026-10-14T09:00:00Z', '2026-10-14T09:00:00Z', 'Instant')] })

    expect(result.rows[2]!.bars).toEqual([])
    expect(result.rows[2]!.timed.map(row => [row.column, row.time])).toEqual([[2, '10:00']])
  })
})

describe('a busy day', () => {
  // Wednesday 14 October 2026 is row 3, column 2.
  const busy = (count: number) => layout('2026-10', { events: Array.from({ length: count }, (_, i) => at('2026-10-14', `${String(8 + i).padStart(2, '0')}:00`, `Event ${i + 1}`, [], i + 1)) }).rows[2]!

  it('shows seven items as three and "+4 more" in the fourth lane', () => {
    const row = busy(7)

    expect(row.timed.map(item => [item.column, item.lane, item.event.display_title])).toEqual([[2, 0, 'Event 1'], [2, 1, 'Event 2'], [2, 2, 'Event 3']])
    expect(row.more).toEqual([{ column: 2, lane: 3, count: 4 }])
  })

  it('shows exactly four items in all four lanes, without a label', () => {
    const row = busy(4)

    expect(row.timed.map(item => item.lane)).toEqual([0, 1, 2, 3])
    expect(row.more).toEqual([])
  })

  it('counts five items as three and "+2 more"', () => {
    const row = busy(5)

    expect(row.timed).toHaveLength(3)
    expect(row.more).toEqual([{ column: 2, lane: 3, count: 2 }])
  })

  it('counts a bar among the items', () => {
    const row = layout('2026-10', { events: [allDay('2026-10-14', '2026-10-15', 'Bar'), ...Array.from({ length: 4 }, (_, i) => at('2026-10-14', `${String(8 + i).padStart(2, '0')}:00`, `Event ${i + 1}`, [], i + 1))] }).rows[2]!

    // Five items: the bar and four timed events. Lanes 0 to 2 are drawn, and the two in lanes 3 and 4 are counted.
    expect(row.bars.map(shape)).toEqual([{ lane: 0, column: 2, span: 1, roundStart: true, roundEnd: true }])
    expect(row.timed.map(item => item.lane)).toEqual([1, 2])
    expect(row.more).toEqual([{ column: 2, lane: 3, count: 2 }])
  })

  it('splits a bar in the fourth lane around the "+N more" day it crosses', () => {
    // Three five-day bars take lanes 0 to 2. A shorter one from Tuesday to Thursday takes lane 3,
    // and Wednesday has three timed events on top, so its fourth lane becomes "+4 more".
    const row = layout('2026-10', {
      events: [
        allDay('2026-10-12', '2026-10-17', 'A', [], 1),
        allDay('2026-10-12', '2026-10-17', 'B', [], 2),
        allDay('2026-10-12', '2026-10-17', 'C', [], 3),
        allDay('2026-10-13', '2026-10-16', 'D', [], 4),
        at('2026-10-14', '08:00', 'T1', [], 5),
        at('2026-10-14', '09:00', 'T2', [], 6),
        at('2026-10-14', '10:00', 'T3', [], 7),
      ],
    }).rows[2]!

    expect(row.bars.map(bar => [bar.event.display_title, ...Object.values(shape(bar))])).toEqual([
      ['A', 0, 0, 5, true, true],
      ['B', 1, 0, 5, true, true],
      ['C', 2, 0, 5, true, true],
      ['D', 3, 1, 1, true, false],
      ['D', 3, 3, 1, false, true],
    ])
    expect(row.more).toEqual([{ column: 2, lane: 3, count: 4 }])
    expect(row.timed).toEqual([])
  })

  it('shows "+1 more" for a day with one item that packing pushed below the fourth lane', () => {
    // A to D take lanes 0 to 3 on Monday and Tuesday. E starts on Tuesday, so it is packed after them: lane 4.
    // Tuesday then has five items, and Wednesday has only E, but E is below the last lane there too.
    const row = layout('2026-10', {
      events: [
        allDay('2026-10-12', '2026-10-14', 'A', [], 1),
        allDay('2026-10-12', '2026-10-14', 'B', [], 2),
        allDay('2026-10-12', '2026-10-14', 'C', [], 3),
        allDay('2026-10-12', '2026-10-14', 'D', [], 4),
        allDay('2026-10-13', '2026-10-15', 'E', [], 5),
      ],
    }).rows[2]!

    expect(row.bars.map(bar => [bar.event.display_title, ...Object.values(shape(bar))])).toEqual([
      ['A', 0, 0, 2, true, true],
      ['B', 1, 0, 2, true, true],
      ['C', 2, 0, 2, true, true],
      ['D', 3, 0, 1, true, false],
    ])
    expect(row.more).toEqual([{ column: 1, lane: 3, count: 2 }, { column: 2, lane: 3, count: 1 }])
  })
})

describe('lane order', () => {
  it('puts a longer all-day bar above a shorter one that starts the same day', () => {
    const row = layout('2026-10', {
      events: [
        allDay('2026-10-13', '2026-10-14', 'Short', [], 1),
        allDay('2026-10-13', '2026-10-16', 'Long', [], 2),
        allDay('2026-10-12', '2026-10-13', 'Earlier', [], 3),
      ],
    }).rows[2]!

    expect(row.bars.map(bar => [bar.event.display_title, bar.lane, bar.column])).toEqual([
      ['Earlier', 0, 0],
      ['Long', 0, 1],
      ['Short', 1, 1],
    ])
  })

  it('breaks a tie of start and length by event id', () => {
    const row = layout('2026-10', { events: [allDay('2026-10-13', '2026-10-14', 'Second', [], 9), allDay('2026-10-13', '2026-10-14', 'First', [], 4)] }).rows[2]!

    expect(row.bars.map(bar => [bar.event.display_title, bar.lane])).toEqual([['First', 0], ['Second', 1]])
  })

  it('fills the lowest free lane with timed rows in time order, under the bars', () => {
    // Tuesday 13 October has two bars; Thursday the 15th has none.
    const row = layout('2026-10', {
      events: [
        allDay('2026-10-13', '2026-10-14', 'Bar 1', [], 1),
        allDay('2026-10-13', '2026-10-14', 'Bar 2', [], 2),
        at('2026-10-13', '10:00', 'Later', [], 3),
        at('2026-10-13', '08:00', 'Earlier', [], 4),
        at('2026-10-15', '12:00', 'Noon', [], 5),
        at('2026-10-15', '07:00', 'Morning', [], 6),
      ],
    }).rows[2]!

    expect(row.timed.map(item => [item.column, item.lane, item.event.display_title])).toEqual([
      [1, 2, 'Earlier'],
      [1, 3, 'Later'],
      [3, 0, 'Morning'],
      [3, 1, 'Noon'],
    ])
  })

  it('orders timed events that start together by end and then id', () => {
    const row = layout('2026-10', {
      events: [
        timed('2026-10-14T09:00:00Z', '2026-10-14T11:00:00Z', 'Long', [], 1),
        timed('2026-10-14T09:00:00Z', '2026-10-14T10:00:00Z', 'Short B', [], 3),
        timed('2026-10-14T09:00:00Z', '2026-10-14T10:00:00Z', 'Short A', [], 2),
      ],
    }).rows[2]!

    expect(row.timed.map(item => [item.lane, item.event.display_title])).toEqual([[0, 'Short A'], [1, 'Short B'], [2, 'Long']])
  })

  it('lets a lane freed by a short bar be used by a later bar in the same row', () => {
    const row = layout('2026-10', {
      events: [
        allDay('2026-10-12', '2026-10-13', 'Mon', [], 1),
        allDay('2026-10-12', '2026-10-15', 'Mon to Wed', [], 2),
        allDay('2026-10-14', '2026-10-15', 'Wed', [], 3),
      ],
    }).rows[2]!

    // "Mon to Wed" is longer, so it has lane 0. "Mon" takes lane 1, and "Wed" can reuse it because "Mon" is over by then.
    expect(row.bars.map(bar => [bar.event.display_title, bar.lane, bar.column])).toEqual([
      ['Mon to Wed', 0, 0],
      ['Mon', 1, 0],
      ['Wed', 1, 2],
    ])
  })
})

describe('people on items', () => {
  it('keeps all the people but shows three initials when there are more', () => {
    const event = at('2026-10-14', '09:00', 'Everyone', ['mum', 'dad', 'isla', 'theo', 'poppy'])
    const result = layout('2026-10', { events: [event, allDay('2026-10-14', '2026-10-15', 'Everyone all day', ['mum', 'dad', 'isla', 'theo'])], today: '2026-10-14' })
    const row = result.rows[2]!

    expect(row.timed[0]!.people.map(p => p.id)).toEqual(['mum', 'dad', 'isla', 'theo', 'poppy'])
    expect(row.timed[0]).toMatchObject({ initials: ['M', 'D', 'I'], colour: '#C67139' })
    expect(row.bars[0]!.people).toHaveLength(4)
    expect(row.bars[0]).toMatchObject({ initials: ['M', 'D', 'I'], colour: '#C67139' })
    expect(result.panel[0]!.timed[0]).toMatchObject({ initials: ['M', 'D', 'I'], colour: '#C67139' })
    expect(result.panel[0]!.timed[0]!.people).toHaveLength(5)
  })

  it('has no colour and no initials for an event nobody is on', () => {
    const row = layout('2026-10', { events: [at('2026-10-14', '09:00', 'Nobody')] }).rows[2]!

    expect(row.timed[0]).toMatchObject({ people: [], colour: null, initials: [] })
  })
})

describe('a month pinned a year ahead', () => {
  const result = layout('2027-10', { events: FIXTURES })

  it('has no today cell, no past days and no veils', () => {
    const cells = result.rows.flatMap(row => row.cells)

    expect(cells.some(cell => cell.today || cell.past)).toBe(false)
    expect(result.rows.every(row => row.veils.length === 0)).toBe(true)
  })

  it('is October 2027, Friday the 1st, with no wrap', () => {
    expect(result.rows[0]!.cells[4]).toMatchObject({ date: '2027-10-01', column: 4, inMonth: true })
    expect(result.rows.flatMap(row => row.cells).some(cell => cell.wrapped)).toBe(false)
    expect(result.rows[4]!.cells[6]!.date).toBe('2027-10-31')
  })

  it('still has the side panel for today and the next three days', () => {
    expect(result.panel.map(day => [day.date, day.label])).toEqual([
      ['2026-10-28', 'Today'],
      ['2026-10-29', 'Tomorrow'],
      ['2026-10-30', 'Friday'],
      ['2026-10-31', 'Saturday'],
    ])
    expect(titles(result.panel[0]!.allDay)).toEqual(['Half term'])
    expect(result.panel[3]!.timed).toHaveLength(7)
  })
})

describe('the side panel', () => {
  it('crosses a month and a year', () => {
    const result = layout('2026-12', { today: '2026-12-30' })

    expect(result.panel.map(day => [day.date, day.label])).toEqual([
      ['2026-12-30', 'Today'],
      ['2026-12-31', 'Tomorrow'],
      ['2027-01-01', 'Friday'],
      ['2027-01-02', 'Saturday'],
    ])
  })

  it('is always four days, with nothing in them when there are no events', () => {
    const result = layout('2026-10')

    expect(result.panel).toHaveLength(PANEL_DAYS)
    expect(result.panel.every(day => day.allDay.length === 0 && day.timed.length === 0)).toBe(true)
  })

  it('takes a timed event over several days as all-day in the middle and "Until" on its last day', () => {
    // From 10:00 on Tuesday 13 October to 10:00 on Friday the 16th, London time (BST).
    const result = layout('2026-10', { today: '2026-10-14', events: [timed('2026-10-13T09:00:00Z', '2026-10-16T09:00:00Z', 'Camp')] })

    expect(result.panel.map(day => [day.label, day.allDay.map(item => item.time), day.timed.map(item => item.time)])).toEqual([
      ['Today', [null], []],
      ['Tomorrow', [null], []],
      ['Friday', [], ['Until 10:00']],
      ['Saturday', [], []],
    ])
  })

  it('orders all-day items by start and then longest first, and timed ones by time', () => {
    const result = layout('2026-10', {
      today: '2026-10-14',
      events: [
        allDay('2026-10-14', '2026-10-15', 'Today only', [], 1),
        allDay('2026-10-14', '2026-10-17', 'Three days', [], 2),
        allDay('2026-10-13', '2026-10-15', 'Began yesterday', [], 3),
        at('2026-10-14', '15:00', 'Afternoon', [], 4),
        at('2026-10-14', '08:00', 'Morning', [], 5),
      ],
    })

    expect(titles(result.panel[0]!.allDay)).toEqual(['Began yesterday', 'Three days', 'Today only'])
    expect(result.panel[0]!.timed.map(item => [item.time, item.event.display_title])).toEqual([['09:00', 'Morning'], ['16:00', 'Afternoon']])
  })

  it('is not trimmed', () => {
    const events = Array.from({ length: 12 }, (_, i) => at('2026-10-14', `${String(6 + i).padStart(2, '0')}:00`, `Event ${i}`, [], i + 1))
    const result = layout('2026-10', { today: '2026-10-14', events })

    expect(result.panel[0]!.timed).toHaveLength(12)
  })
})

describe('time zones', () => {
  it('places timed events on days, and gives their times, in the display zone', () => {
    // 20:00Z on the 14th is 21:00 that evening in London but 05:00 on the 15th in Tokyo.
    const events = [at('2026-10-14', '20:00', 'Evening')]
    const london = layout('2026-10', { events }).rows[2]!
    const tokyo = layout('2026-10', { events, timeZone: 'Asia/Tokyo', today: '2026-10-15' }).rows[2]!

    expect(london.timed.map(row => [row.column, row.time])).toEqual([[2, '21:00']])
    expect(tokyo.timed.map(row => [row.column, row.time])).toEqual([[3, '05:00']])
  })

  it('does not depend on the process time zone, which is Auckland under test', () => {
    // 11:30Z on 14 October is 00:30 on the 15th in Auckland (NZDT), but 12:30 on the 14th in London.
    const row = layout('2026-10', { events: [at('2026-10-14', '11:30', 'Midday')] }).rows[2]!

    expect(row.timed.map(item => [item.column, item.time])).toEqual([[2, '12:30']])
  })
})
