import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../../server/config/load'
import { DEFAULT_DAY_PARTS } from '../../../shared/display'
import { HEAD_ITEMS, LANDSCAPE_CELL_ITEMS, PART_NAMES, PORTRAIT_CELL_ITEMS, weekPartsLayout } from '../../../shared/week-parts-layout'
import type { WeekPartsLayout, WeekPartsLayoutInput, WeekPartsRow } from '../../../shared/week-parts-layout'
import { MAX_BADGE_INITIALS } from '../../../shared/week-layout'
import type { CalendarEvent, EventPerson } from '../../../shared/types/events'

// The same family and the same Wed 28 Oct 2026 as the week layout's tests (the
// clocks went back on the 25th, so the zone is GMT for the whole week shown).

const APP_DIR = join(import.meta.dirname, '../../..')
const LONDON = 'Europe/London'
const NOW = new Date('2026-10-28T09:41:00Z')
const WED = '2026-10-28'
const dev = loadConfig({ configFile: join(APP_DIR, 'config.dev.yaml'), env: {} })

const person = (id: string): EventPerson => {
  const found = dev.people.find(candidate => candidate.id === id)!
  return { id: found.id, name: found.name, initial: found.initial, colour: found.colour }
}

let nextId = 1000

/** A timed event from `start` to `end`, both ISO instants. */
function timed(start: string, end: string, title = 'Event', people: string[] = [], id = nextId++): CalendarEvent {
  return { id, calendar_id: 'family', title, display_title: title, location: null, start, end, all_day: false, start_date: null, end_date: null, people: people.map(person) }
}

/** An event on `date` from `from` to `to` (`HH:MM`, UTC; the zone is GMT on these dates). */
function between(date: string, from: string, to: string, title = 'Event', people: string[] = [], id = nextId++): CalendarEvent {
  return timed(`${date}T${from}:00Z`, `${date}T${to}:00Z`, title, people, id)
}

/** An event on `date` at `from`, an hour long. */
function at(date: string, from: string, title = 'Event', people: string[] = [], id = nextId++): CalendarEvent {
  const end = `${String(Number(from.slice(0, 2)) + 1).padStart(2, '0')}${from.slice(2)}`
  return between(date, from, end, title, people, id)
}

/** An all-day event on `first` up to but not including `after`. */
function allDay(first: string, after: string, title = 'All day', people: string[] = [], id = nextId++): CalendarEvent {
  return { ...timed(`${first}T00:00:00.000Z`, `${after}T00:00:00.000Z`, title, people, id), all_day: true, start_date: first, end_date: after }
}

function layout(overrides: Partial<WeekPartsLayoutInput> = {}): WeekPartsLayout {
  return weekPartsLayout({ weekOf: WED, now: NOW, timeZone: LONDON, weekStart: 'monday', dayParts: DEFAULT_DAY_PARTS, events: [], ...overrides })
}

const titles = (items: { event: CalendarEvent }[]) => items.map(item => item.event.display_title)
const rowOf = (result: WeekPartsLayout, date: string): WeekPartsRow => result.rows.find(row => row.date === date)!
/** The titles in each of a day's three cells. */
const cellTitles = (result: WeekPartsLayout, date: string) => rowOf(result, date).cells.map(cell => titles(cell.items))

describe('the constants', () => {
  it('are four lines, eight in portrait, two in the head and three parts', () => {
    expect([LANDSCAPE_CELL_ITEMS, PORTRAIT_CELL_ITEMS, HEAD_ITEMS]).toEqual([4, 8, 2])
    expect(PART_NAMES).toEqual(['morning', 'afternoon', 'evening'])
    expect(MAX_BADGE_INITIALS).toBe(3)
  })
})

describe('the week and its rows', () => {
  it('runs Monday to Sunday around Wed 28 Oct 2026', () => {
    const result = layout()

    expect(result.title).toBe('26 October – 1 November 2026')
    expect(result.rows.map(row => row.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'])
    expect(result.rows.map(row => row.weekday)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(result.rows.map(row => row.row)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(result.rows.map(row => row.day)).toEqual([26, 27, 28, 29, 30, 31, 1])
  })

  it('starts on Sunday when set, from 25 to 31 October', () => {
    const result = layout({ weekStart: 'sunday' })

    expect(result.title).toBe('25 – 31 October 2026')
    expect(result.rows.map(row => row.weekday)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
    expect(layout({ weekStart: 'sunday', weekOf: '2026-11-01' }).rows[0]!.date).toBe('2026-11-01')
    expect(layout({ weekStart: 'monday', weekOf: '2026-11-01' }).rows[0]!.date).toBe('2026-10-26')
  })

  it('is the same week whichever day of it is asked for', () => {
    for (const weekOf of ['2026-10-26', '2026-10-31', '2026-11-01']) {
      expect(layout({ weekOf }).rows[0]!.date).toBe('2026-10-26')
    }
  })

  it('names both years when the week spans them', () => {
    expect(layout({ weekOf: '2026-12-30' }).title).toBe('28 December 2026 – 3 January 2027')
  })

  it('marks today and the days before it', () => {
    const result = layout()

    expect(result.rows.map(row => row.today)).toEqual([false, false, true, false, false, false, false])
    expect(result.rows.map(row => row.past)).toEqual([true, true, false, false, false, false, false])
  })

  it('takes today from now, not from the week shown', () => {
    expect(layout({ weekOf: '2026-11-04' }).rows.some(row => row.today || row.past)).toBe(false)
    expect(layout({ weekOf: '2026-10-21' }).rows.every(row => row.past && !row.today)).toBe(true)
  })

  it('goes by the wall in the display zone, not the instant in UTC', () => {
    // 23:30 UTC on Wednesday is already Thursday in Sydney (UTC+11 in October).
    const result = layout({ now: new Date('2026-10-28T23:30:00Z'), timeZone: 'Australia/Sydney' })

    expect(result.rows.find(row => row.today)!.date).toBe('2026-10-29')
  })

  it('has an empty head and three empty cells on every day of an empty week', () => {
    for (const row of layout().rows) {
      expect(row.head).toEqual({ items: [], more: 0 })
      expect(row.cells.map(cell => cell.part)).toEqual(['morning', 'afternoon', 'evening'])
      expect(row.cells.every(cell => cell.items.length === 0 && cell.more === 0)).toBe(true)
    }
  })
})

describe('the part headings', () => {
  it('name the three parts with the default hours', () => {
    expect(layout().parts).toEqual([
      { name: 'morning', label: 'Morning', hours: '00–12', start: 0, end: 720 },
      { name: 'afternoon', label: 'Afternoon', hours: '12–17', start: 720, end: 1020 },
      { name: 'evening', label: 'Evening', hours: '17–24', start: 1020, end: 1440 },
    ])
  })

  it('follow custom day parts, zero-padded', () => {
    expect(layout({ dayParts: { afternoon: 9, evening: 20 } }).parts).toEqual([
      { name: 'morning', label: 'Morning', hours: '00–09', start: 0, end: 540 },
      { name: 'afternoon', label: 'Afternoon', hours: '09–20', start: 540, end: 1200 },
      { name: 'evening', label: 'Evening', hours: '20–24', start: 1200, end: 1440 },
    ])
  })

  it('meet end to start', () => {
    const [morning, afternoon, evening] = layout({ dayParts: { afternoon: 1, evening: 23 } }).parts

    expect([morning.hours, afternoon.hours, evening.hours]).toEqual(['00–01', '01–23', '23–24'])
    expect(morning.end).toBe(afternoon.start)
    expect(afternoon.end).toBe(evening.start)
  })
})

describe('which part a timed event is in', () => {
  const day = '2026-10-27'
  const events = [
    between(day, '00:00', '00:30', 'midnight'),
    between(day, '11:59', '12:30', 'late morning'),
    between(day, '12:00', '12:30', 'noon'),
    between(day, '16:59', '17:30', 'late afternoon'),
    between(day, '17:00', '17:30', 'five'),
    between(day, '23:59', '23:59', 'last minute'),
  ]

  it('goes by the start, with a boundary belonging to the later part', () => {
    expect(cellTitles(layout({ events }), day)).toEqual([
      ['midnight', 'late morning'],
      ['noon', 'late afternoon'],
      ['five', 'last minute'],
    ])
  })

  it('keeps an event that runs on past the end of its part in the part it started in', () => {
    const result = layout({ events: [between(day, '11:00', '14:00', 'long')] })

    expect(cellTitles(result, day)).toEqual([['long'], [], []])
  })

  it('moves the boundaries with custom day parts', () => {
    const custom = [
      between(day, '08:59', '09:30', 'before'),
      between(day, '09:00', '09:30', 'on the afternoon'),
      between(day, '19:59', '20:30', 'before evening'),
      between(day, '20:00', '20:30', 'on the evening'),
    ]

    expect(cellTitles(layout({ events: custom, dayParts: { afternoon: 9, evening: 20 } }), day)).toEqual([
      ['before'],
      ['on the afternoon', 'before evening'],
      ['on the evening'],
    ])
  })

  it('puts an event of no length in its part', () => {
    expect(cellTitles(layout({ events: [between(day, '12:00', '12:00', 'instant')] }), day)).toEqual([[], ['instant'], []])
  })

  it('gives the start time, ended and ongoing flags', () => {
    const result = layout({
      cellItems: 10,
      events: [
        between(WED, '07:00', '08:00', 'over'),
        between(WED, '09:00', '10:00', 'on'),
        between(WED, '09:41', '10:00', 'just begun'),
        between(WED, '09:42', '10:00', 'soon'),
        between(WED, '08:00', '09:41', 'just over'),
      ],
    })
    const flags = Object.fromEntries(rowOf(result, WED).cells[0].items.map(item => [item.event.display_title, [item.time, item.past, item.ongoing]]))

    expect(flags).toEqual({
      'over': ['07:00', true, false],
      'just over': ['08:00', true, false],
      'on': ['09:00', false, true],
      'just begun': ['09:41', false, true],
      'soon': ['09:42', false, false],
    })
  })

  it('reads the time in the display zone', () => {
    // 23:30 UTC on the 27th is 10:30 on the 28th in Sydney: Wednesday morning.
    const result = layout({ timeZone: 'Australia/Sydney', events: [timed('2026-10-27T23:30:00Z', '2026-10-28T00:30:00Z', 'sydney')] })

    expect(cellTitles(result, WED)).toEqual([['sydney'], [], []])
    expect(rowOf(result, WED).cells[0].items[0]!.time).toBe('10:30')
    expect(cellTitles(result, '2026-10-27')).toEqual([[], [], []])
  })

  it('puts an evening event in the right part in a zone ahead of UTC', () => {
    // 07:00 UTC is 18:00 in Sydney.
    const result = layout({ timeZone: 'Australia/Sydney', events: [between(WED, '07:00', '08:00', 'tea')] })

    expect(cellTitles(result, WED)).toEqual([[], [], ['tea']])
  })
})

describe('a clock change', () => {
  it('uses the wall clock on the day the clocks go forward (29 Mar 2026)', () => {
    // 10:30 UTC is 11:30 BST. With the afternoon from 11:00 that is the afternoon, where the same minutes read in GMT would be the morning.
    const result = layout({
      weekOf: '2026-03-29',
      now: new Date('2026-03-29T08:00:00Z'),
      dayParts: { afternoon: 11, evening: 17 },
      events: [
        between('2026-03-29', '00:30', '01:00', 'before the change'),
        between('2026-03-29', '09:00', '10:00', 'ten'),
        between('2026-03-29', '10:30', '11:30', 'half eleven'),
        between('2026-03-29', '16:30', '17:30', 'half five'),
      ],
    })

    expect(result.rows.map(row => row.date)).toEqual(['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29'])
    expect(cellTitles(result, '2026-03-29')).toEqual([['before the change', 'ten'], ['half eleven'], ['half five']])
    expect(rowOf(result, '2026-03-29').cells[0].items.map(item => item.time)).toEqual(['00:30', '10:00'])
    expect(rowOf(result, '2026-03-29').cells[1].items[0]!.time).toBe('11:30')
  })

  it('finds the first morning in BST on 29 Mar with an event at 01:30 UTC (02:30 BST)', () => {
    const result = layout({ weekOf: '2026-03-29', events: [between('2026-03-29', '01:30', '02:00', 'small hours')] })

    expect(cellTitles(result, '2026-03-29')[0]).toEqual(['small hours'])
    expect(rowOf(result, '2026-03-29').cells[0].items[0]!.time).toBe('02:30')
  })

  it('uses the wall clock on the day the clocks go back (25 Oct 2026)', () => {
    // 01:30 happens twice that night (00:30 UTC in BST, 01:30 UTC in GMT); both are morning, and from 11:00 UTC the wall reads 11:00 GMT.
    const result = layout({
      weekOf: '2026-10-25',
      dayParts: { afternoon: 11, evening: 17 },
      events: [
        between('2026-10-25', '00:30', '01:00', 'first half past one'),
        between('2026-10-25', '01:30', '02:00', 'second half past one'),
        between('2026-10-25', '10:59', '11:30', 'just before eleven'),
        between('2026-10-25', '11:00', '11:30', 'eleven'),
        between('2026-10-25', '17:00', '18:00', 'five'),
      ],
    })

    expect(cellTitles(result, '2026-10-25')).toEqual([
      ['first half past one', 'second half past one', 'just before eleven'],
      ['eleven'],
      ['five'],
    ])
    expect(rowOf(result, '2026-10-25').cells[0].items.map(item => item.time)).toEqual(['01:30', '01:30', '10:59'])
  })

  it('puts a 10:00 event in the morning on both days', () => {
    const forward = layout({ weekOf: '2026-03-29', events: [timed('2026-03-29T09:00:00Z', '2026-03-29T10:00:00Z', 'ten')] })
    const back = layout({ weekOf: '2026-10-25', events: [between('2026-10-25', '10:00', '11:00', 'ten')] })

    expect(cellTitles(forward, '2026-03-29')[0]).toEqual(['ten'])
    expect(cellTitles(back, '2026-10-25')[0]).toEqual(['ten'])
  })
})

describe('order within a cell', () => {
  it('is by start, then end, then id, whatever order the events come in', () => {
    const result = layout({
      cellItems: 10,
      events: [
        between(WED, '10:00', '11:00', 'ten late id', [], 50),
        between(WED, '09:00', '10:30', 'nine long', [], 40),
        between(WED, '09:00', '09:30', 'nine short', [], 30),
        between(WED, '10:00', '11:00', 'ten early id', [], 20),
        between(WED, '08:00', '08:30', 'eight', [], 60),
      ],
    })

    expect(cellTitles(result, WED)[0]).toEqual(['eight', 'nine short', 'nine long', 'ten early id', 'ten late id'])
  })

  it('orders by the instant, not the wall clock, across the clock change', () => {
    // On the 25th the 01:30 BST event (00:30Z) is before the 01:30 GMT one (01:30Z), though they read alike.
    const result = layout({
      weekOf: '2026-10-25',
      events: [between('2026-10-25', '01:30', '02:00', 'gmt', [], 2), between('2026-10-25', '00:30', '01:00', 'bst', [], 3)],
    })

    expect(cellTitles(result, '2026-10-25')[0]).toEqual(['bst', 'gmt'])
  })
})

describe('a full cell', () => {
  const eventsIn = (count: number) => Array.from({ length: count }, (_, index) => at('2026-10-27', `${String(1 + index).padStart(2, '0')}:00`, `e${index + 1}`))

  it('holds exactly cellItems with no more', () => {
    const cell = layout({ events: eventsIn(4) }).rows[1]!.cells[0]

    expect(titles(cell.items)).toEqual(['e1', 'e2', 'e3', 'e4'])
    expect(cell.more).toBe(0)
  })

  it('shows cellItems - 1 and counts the rest when one too many', () => {
    const cell = layout({ events: eventsIn(5) }).rows[1]!.cells[0]

    expect(titles(cell.items)).toEqual(['e1', 'e2', 'e3'])
    expect(cell.more).toBe(2)
  })

  it('counts a long list', () => {
    const cell = layout({ events: eventsIn(10) }).rows[1]!.cells[0]

    expect(cell.items).toHaveLength(3)
    expect(cell.more).toBe(7)
  })

  it('takes its limit from cellItems', () => {
    const big = layout({ cellItems: PORTRAIT_CELL_ITEMS, events: eventsIn(8) }).rows[1]!.cells[0]
    const over = layout({ cellItems: PORTRAIT_CELL_ITEMS, events: eventsIn(9) }).rows[1]!.cells[0]

    expect([big.items.length, big.more]).toEqual([8, 0])
    expect([over.items.length, over.more]).toEqual([7, 2])
  })

  it('shows nothing and counts both when cellItems is 1 and there are two', () => {
    const cell = layout({ cellItems: 1, events: eventsIn(2) }).rows[1]!.cells[0]

    expect(cell.items).toEqual([])
    expect(cell.more).toBe(2)
  })

  it('shows the one event when cellItems is 1 and there is one', () => {
    const cell = layout({ cellItems: 1, events: eventsIn(1) }).rows[1]!.cells[0]

    expect(titles(cell.items)).toEqual(['e1'])
    expect(cell.more).toBe(0)
  })

  it('treats a cellItems below 1 as 1', () => {
    expect(layout({ cellItems: 0, events: eventsIn(1) }).rows[1]!.cells[0].items).toHaveLength(1)
  })

  it('counts each cell on its own', () => {
    const result = layout({ events: [...eventsIn(5), at('2026-10-27', '13:00', 'afternoon')] })

    expect(result.rows[1]!.cells.map(cell => [cell.items.length, cell.more])).toEqual([[3, 2], [1, 0], [0, 0]])
  })
})

describe('the head', () => {
  it('holds an all-day event on its day only', () => {
    const result = layout({ events: [allDay('2026-10-29', '2026-10-30', 'Bin day')] })

    expect(result.rows.map(row => titles(row.head.items))).toEqual([[], [], [], ['Bin day'], [], [], []])
    expect(rowOf(result, '2026-10-29').head.items[0]).toMatchObject({ time: null, past: false })
    expect(rowOf(result, '2026-10-29').cells.every(cell => cell.items.length === 0)).toBe(true)
  })

  it('holds a multi-day event on every day of the week it covers, cut at the week edges', () => {
    const result = layout({ events: [allDay('2026-10-20', '2026-10-28', 'Away', [], 1), allDay('2026-10-30', '2026-11-10', 'Holiday', [], 2)] })

    expect(result.rows.map(row => titles(row.head.items))).toEqual([
      ['Away'], ['Away'], [], [], ['Holiday'], ['Holiday'], ['Holiday'],
    ])
  })

  it('ignores a multi-day event that ends before the week or starts after it', () => {
    const result = layout({ events: [allDay('2026-10-19', '2026-10-26', 'before'), allDay('2026-11-02', '2026-11-05', 'after')] })

    expect(result.rows.every(row => row.head.items.length === 0)).toBe(true)
  })

  it('holds a timed overnight event on both days, with its time on the first only', () => {
    const result = layout({ events: [timed('2026-10-27T22:00:00Z', '2026-10-28T07:30:00Z', 'Sleepover')] })

    expect(titles(rowOf(result, '2026-10-27').head.items)).toEqual(['Sleepover'])
    expect(titles(rowOf(result, WED).head.items)).toEqual(['Sleepover'])
    expect(rowOf(result, '2026-10-27').head.items[0]!.time).toBe('22:00')
    expect(rowOf(result, WED).head.items[0]!.time).toBeNull()
    // It is not also a cell item on either day.
    expect(result.rows.every(row => row.cells.every(cell => cell.items.length === 0))).toBe(true)
  })

  it('holds a three-day timed event on all three days, the time on the first only', () => {
    const result = layout({ events: [timed('2026-10-26T20:00:00Z', '2026-10-28T09:00:00Z', 'Trip')] })

    expect(result.rows.map(row => row.head.items.map(item => item.time))).toEqual([['20:00'], [null], [null], [], [], [], []])
  })

  it('does not treat an event that ends exactly at midnight as overnight', () => {
    const result = layout({ events: [timed('2026-10-27T22:00:00Z', '2026-10-28T00:00:00Z', 'Late film')] })

    expect(rowOf(result, WED).head.items).toEqual([])
    expect(rowOf(result, '2026-10-27').head.items).toEqual([])
    expect(cellTitles(result, '2026-10-27')).toEqual([[], [], ['Late film']])
  })

  it('keeps an event ending a minute past midnight overnight', () => {
    const result = layout({ events: [timed('2026-10-27T22:00:00Z', '2026-10-28T00:01:00Z', 'Later film')] })

    expect(titles(rowOf(result, '2026-10-27').head.items)).toEqual(['Later film'])
    expect(titles(rowOf(result, WED).head.items)).toEqual(['Later film'])
  })

  it('orders by first day, then longest first, then id', () => {
    const result = layout({
      events: [
        allDay('2026-10-28', '2026-10-29', 'late id', [], 9),
        allDay('2026-10-28', '2026-10-29', 'early id', [], 3),
        allDay('2026-10-28', '2026-10-31', 'long', [], 8),
      ],
    })

    expect(titles(rowOf(result, WED).head.items)).toEqual(['long', 'early id'])

    const earlier = layout({ events: [allDay('2026-10-28', '2026-10-29', 'single', [], 1), allDay('2026-10-27', '2026-10-29', 'from the day before', [], 2)] })
    expect(titles(rowOf(earlier, WED).head.items)).toEqual(['from the day before', 'single'])
  })

  it('shows all of HEAD_ITEMS with no more', () => {
    const result = layout({ events: [allDay(WED, '2026-10-29', 'a', [], 1), allDay(WED, '2026-10-29', 'b', [], 2)] })

    expect(rowOf(result, WED).head).toMatchObject({ more: 0 })
    expect(rowOf(result, WED).head.items).toHaveLength(2)
  })

  it('shows the first HEAD_ITEMS and counts the rest', () => {
    const events = ['a', 'b', 'c', 'd', 'e'].map((title, index) => allDay(WED, '2026-10-29', title, [], index + 1))
    const head = rowOf(layout({ events }), WED).head

    expect(titles(head.items)).toEqual(['a', 'b'])
    expect(head.more).toBe(3)
  })

  it('counts all-day and overnight events together', () => {
    const result = layout({ events: [allDay(WED, '2026-10-29', 'a', [], 1), allDay(WED, '2026-10-29', 'b', [], 2), timed('2026-10-27T23:00:00Z', '2026-10-28T08:00:00Z', 'night', [], 3)] })

    expect(rowOf(result, WED).head.items).toHaveLength(2)
    expect(rowOf(result, WED).head.more).toBe(1)
  })

  it('drops an all-day event that ends before it starts', () => {
    expect(layout({ events: [allDay('2026-10-29', '2026-10-28', 'backwards')] }).rows.every(row => row.head.items.length === 0)).toBe(true)
  })

  it('marks an event past once it has ended', () => {
    const result = layout({
      events: [
        allDay('2026-10-26', '2026-10-27', 'Monday', [], 1),
        allDay('2026-10-29', '2026-10-30', 'Thursday', [], 2),
        timed('2026-10-27T22:00:00Z', '2026-10-28T09:41:00Z', 'Just over', [], 4),
        timed('2026-10-27T22:00:00Z', '2026-10-28T09:42:00Z', 'Not yet', [], 5),
      ],
    })
    const past = (date: string) => Object.fromEntries(rowOf(result, date).head.items.map(item => [item.event.display_title, item.past]))

    expect(past('2026-10-26')).toEqual({ Monday: true })
    expect(past('2026-10-27')).toEqual({ 'Just over': true, 'Not yet': false })
    expect(past(WED)).toEqual({ 'Just over': true, 'Not yet': false })
    expect(past('2026-10-29')).toEqual({ Thursday: false })
  })

  it('reads the day in the display zone', () => {
    // 20:00 UTC on Tuesday is already 07:00 on Wednesday in Sydney, so it is a Wednesday cell item.
    const result = layout({ timeZone: 'Australia/Sydney', events: [timed('2026-10-27T20:00:00Z', '2026-10-27T21:00:00Z', 'early start')] })

    expect(cellTitles(result, WED)).toEqual([['early start'], [], []])
  })
})

describe('the now marker', () => {
  it('is on today\'s row in the part now falls in, and on that cell only', () => {
    const result = layout()

    expect(result.now).toEqual({ row: 2, part: 'morning' })
    expect(result.rows.flatMap(row => row.cells.filter(cell => cell.now).map(cell => [row.row, cell.part]))).toEqual([[2, 'morning']])
  })

  it('follows the clock through the parts, boundaries included', () => {
    const marker = (iso: string) => layout({ now: new Date(iso) }).now
    const expected: [string, string][] = [
      ['2026-10-28T00:00:00Z', 'morning'],
      ['2026-10-28T11:59:00Z', 'morning'],
      ['2026-10-28T12:00:00Z', 'afternoon'],
      ['2026-10-28T16:59:00Z', 'afternoon'],
      ['2026-10-28T17:00:00Z', 'evening'],
      ['2026-10-28T23:59:00Z', 'evening'],
    ]

    for (const [iso, part] of expected) expect(marker(iso)).toEqual({ row: 2, part })
  })

  it('uses custom day parts', () => {
    const result = layout({ now: new Date('2026-10-28T09:41:00Z'), dayParts: { afternoon: 9, evening: 20 } })

    expect(result.now).toEqual({ row: 2, part: 'afternoon' })
    expect(rowOf(result, WED).cells.map(cell => cell.now)).toEqual([false, true, false])
  })

  it('reads the wall clock in the display zone', () => {
    // 09:41 UTC is 20:41 in Sydney: the evening.
    const result = layout({ timeZone: 'Australia/Sydney' })

    expect(result.now).toEqual({ row: 2, part: 'evening' })
    expect(rowOf(result, WED).cells.map(cell => cell.now)).toEqual([false, false, true])
  })

  it('is null when the week shown is not this one', () => {
    for (const weekOf of ['2026-11-04', '2026-10-21']) {
      const result = layout({ weekOf })

      expect(result.now).toBeNull()
      expect(result.rows.every(row => row.cells.every(cell => !cell.now))).toBe(true)
    }
  })

  it('is on the right row when the week starts on Sunday', () => {
    expect(layout({ weekStart: 'sunday' }).now).toEqual({ row: 3, part: 'morning' })
  })
})

describe('events outside the week', () => {
  it('are ignored', () => {
    const result = layout({
      events: [
        at('2026-10-25', '10:00', 'Sunday before'),
        at('2026-11-02', '10:00', 'Monday after'),
        allDay('2026-11-02', '2026-11-03', 'All day after'),
        allDay('2026-10-25', '2026-10-26', 'All day before'),
      ],
    })

    expect(result.rows.every(row => row.head.items.length === 0 && row.cells.every(cell => cell.items.length === 0))).toBe(true)
  })

  it('belong to the other end of the week when it starts on Sunday', () => {
    const result = layout({ weekStart: 'sunday', events: [at('2026-10-25', '10:00', 'Sunday')] })

    expect(cellTitles(result, '2026-10-25')).toEqual([['Sunday'], [], []])
  })

  it('count only the days inside the week for an event that runs past its edge', () => {
    const result = layout({ events: [timed('2026-11-01T22:00:00Z', '2026-11-02T08:00:00Z', 'Over the edge')] })

    expect(titles(rowOf(result, '2026-11-01').head.items)).toEqual(['Over the edge'])
    expect(rowOf(result, '2026-11-01').head.items[0]!.time).toBe('22:00')
  })
})

describe('people and badges', () => {
  it('carry on cell items, with the first person\'s colour', () => {
    const [first, second] = dev.people
    const result = layout({ events: [at(WED, '09:00', 'Together', [first!.id, second!.id]), at(WED, '10:00', 'Nobody')] })
    const [together, nobody] = rowOf(result, WED).cells[0].items

    expect(together!.people.map(p => p.id)).toEqual([first!.id, second!.id])
    expect(together!.colour).toBe(first!.colour)
    expect(together!.initials).toEqual([first!.initial, second!.initial])
    expect(nobody).toMatchObject({ people: [], colour: null, initials: [] })
  })

  it('carry on head items', () => {
    const first = dev.people[0]!
    const result = layout({ events: [allDay(WED, '2026-10-29', 'Birthday', [first.id])] })

    expect(rowOf(result, WED).head.items[0]).toMatchObject({ colour: first.colour, initials: [first.initial] })
  })

  it('stop at MAX_BADGE_INITIALS initials', () => {
    const ids = dev.people.map(p => p.id)
    const result = layout({ events: [at(WED, '09:00', 'Everyone', ids)] })
    const item = rowOf(result, WED).cells[0].items[0]!

    expect(item.people).toHaveLength(ids.length)
    expect(item.initials.length).toBe(Math.min(ids.length, MAX_BADGE_INITIALS))
  })
})

describe('another time zone', () => {
  it('places events, today and the now marker by the wall in Sydney', () => {
    const now = new Date('2026-10-28T23:30:00Z') // Thursday 10:30 in Sydney
    const result = layout({
      timeZone: 'Australia/Sydney',
      now,
      events: [
        timed('2026-10-29T01:00:00Z', '2026-10-29T02:00:00Z', 'noon-ish'), // 12:00 Thursday
        timed('2026-10-29T05:59:00Z', '2026-10-29T06:30:00Z', 'tea time'), // 16:59 Thursday
        timed('2026-10-29T06:00:00Z', '2026-10-29T07:00:00Z', 'evening'), // 17:00 Thursday
        allDay('2026-10-29', '2026-10-30', 'Thursday thing'),
      ],
    })

    expect(rowOf(result, '2026-10-29').today).toBe(true)
    expect(result.now).toEqual({ row: 3, part: 'morning' })
    expect(cellTitles(result, '2026-10-29')).toEqual([[], ['noon-ish', 'tea time'], ['evening']])
    expect(titles(rowOf(result, '2026-10-29').head.items)).toEqual(['Thursday thing'])
  })
})
