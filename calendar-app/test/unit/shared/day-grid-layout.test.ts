import { describe, expect, it } from 'vitest'
import { dayGridDays, dayGridFirst, dayGridLayout } from '../../../shared/day-grid-layout'
import type { DayGridLayoutInput } from '../../../shared/day-grid-layout'
import type { DayGrid } from '../../../shared/layouts'
import type { CalendarEvent, EventPerson } from '../../../shared/types/events'

// Sat 7 November 2026, 10:00 in London (the clocks went back on 25 October).
const LONDON = 'Europe/London'
const NOW = new Date('2026-11-07T10:00:00Z')

const anna: EventPerson = { id: 'anna', name: 'Anna', initial: 'A', colour: '#ff0000' }

let nextId = 1

function timed(start: string, end: string, title = 'Event', people: EventPerson[] = []): CalendarEvent {
  return { id: nextId++, calendar_id: 'family', title, display_title: title, location: null, start, end, all_day: false, start_date: null, end_date: null, people }
}

/** An all-day event on `first` up to but not including `after`. */
function allDay(first: string, after: string, title = 'All day'): CalendarEvent {
  return { id: nextId++, calendar_id: 'family', title, display_title: title, location: null, start: `${first}T00:00:00Z`, end: `${after}T00:00:00Z`, all_day: true, start_date: first, end_date: after, people: [] }
}

const grid = (rows: number, columns: number, start: DayGrid['start'] = 'today'): DayGrid => ({ rows, columns, start })

function lay(overrides: Partial<DayGridLayoutInput> & { grid: DayGrid }) {
  return dayGridLayout({ now: NOW, timeZone: LONDON, weekStart: 'monday', events: [], ...overrides })
}

describe('dayGridFirst and dayGridDays', () => {
  it('starts today, or on the first day of the week by the week start', () => {
    expect(dayGridFirst({ start: 'today' }, '2026-11-07', 'monday')).toBe('2026-11-07')
    expect(dayGridFirst({ start: 'week' }, '2026-11-07', 'monday')).toBe('2026-11-02')
    expect(dayGridFirst({ start: 'week' }, '2026-11-07', 'sunday')).toBe('2026-11-01')
    // A Sunday is the last day of a Monday week and the first of a Sunday one.
    expect(dayGridFirst({ start: 'week' }, '2026-11-08', 'monday')).toBe('2026-11-02')
    expect(dayGridFirst({ start: 'week' }, '2026-11-08', 'sunday')).toBe('2026-11-08')
    expect(dayGridFirst({ start: 'week' }, '2026-11-02', 'monday')).toBe('2026-11-02')
  })

  it('gives the first and last tile', () => {
    expect(dayGridDays(grid(2, 4), '2026-11-07', 'monday')).toEqual({ first: '2026-11-07', last: '2026-11-14' })
    expect(dayGridDays(grid(1, 1, 'week'), '2026-11-07', 'monday')).toEqual({ first: '2026-11-02', last: '2026-11-02' })
  })
})

describe('dayGridLayout', () => {
  it('lays out rows times columns tiles in order from today', () => {
    const { cells } = lay({ grid: grid(2, 4) })

    expect(cells).toHaveLength(8)
    expect(cells.map(cell => cell.date)).toEqual(['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'])
    expect(cells.map(cell => cell.weekday)).toEqual(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
    expect(cells.map(cell => cell.day)).toEqual([7, 8, 9, 10, 11, 12, 13, 14])
  })

  it('starts on Monday or on Sunday for a week start', () => {
    expect(lay({ grid: grid(1, 7, 'week') }).cells.map(cell => cell.date)[0]).toBe('2026-11-02')
    const sunday = lay({ grid: grid(1, 7, 'week'), weekStart: 'sunday' }).cells
    expect(sunday[0]).toMatchObject({ date: '2026-11-01', weekday: 'Sun' })
    expect(sunday[6]).toMatchObject({ date: '2026-11-07', weekday: 'Sat', today: true })
  })

  it('marks today and the days before it', () => {
    const { cells } = lay({ grid: grid(2, 4, 'week') })

    expect(cells.map(cell => cell.past)).toEqual([true, true, true, true, true, false, false, false])
    expect(cells.filter(cell => cell.today).map(cell => cell.date)).toEqual(['2026-11-07'])
    expect(lay({ grid: grid(1, 3) }).cells.map(cell => cell.past)).toEqual([false, false, false])
  })

  it('names the month on the first tile and on the 1st of a month', () => {
    const early = lay({ grid: grid(1, 7, 'week') }).cells
    expect(early.map(cell => cell.month)).toEqual(['Nov', null, null, null, null, null, null])

    const crossing = dayGridLayout({ now: new Date('2026-11-27T10:00:00Z'), timeZone: LONDON, weekStart: 'monday', grid: grid(1, 7), events: [] }).cells
    expect(crossing.map(cell => cell.date)).toEqual(['2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03'])
    expect(crossing.map(cell => cell.month)).toEqual(['Nov', null, null, null, 'Dec', null, null])
  })

  it('puts all-day items first, then timed ones by start, with their people and times', () => {
    const events = [
      timed('2026-11-07T14:00:00Z', '2026-11-07T15:00:00Z', 'Late'),
      timed('2026-11-07T08:00:00Z', '2026-11-07T09:00:00Z', 'Early', [anna]),
      allDay('2026-11-07', '2026-11-08', 'Birthday'),
    ]
    const [today] = lay({ grid: grid(1, 1), events, cellItems: 6 }).cells

    expect(today!.items.map(item => item.event.title)).toEqual(['Birthday', 'Early', 'Late'])
    expect(today!.items.map(item => item.time)).toEqual([null, '08:00', '14:00'])
    expect(today!.items.map(item => item.allDay)).toEqual([true, false, false])
    expect(today!.items[1]).toMatchObject({ colour: '#ff0000', initials: ['A'] })
    expect(today).toMatchObject({ more: 0, count: 3 })
  })

  it('marks timed events that have ended as past, and all-day ones only once their day is', () => {
    const events = [
      timed('2026-11-07T08:00:00Z', '2026-11-07T09:00:00Z', 'Done'),
      timed('2026-11-07T09:30:00Z', '2026-11-07T10:00:00Z', 'Just ended'),
      timed('2026-11-07T09:30:00Z', '2026-11-07T10:30:00Z', 'Now'),
      allDay('2026-11-07', '2026-11-08', 'Today'),
      allDay('2026-11-06', '2026-11-07', 'Yesterday'),
    ]
    const { cells } = lay({ grid: grid(1, 7, 'week'), events, cellItems: 8 })
    const byTitle = Object.fromEntries(cells.flatMap(cell => cell.items).map(item => [item.event.title, item.past]))

    expect(byTitle).toEqual({ Done: true, 'Just ended': true, Now: false, Today: false, Yesterday: true })
  })

  it('shows cellItems - 1 items and counts the rest when a day is full', () => {
    const events = [1, 2, 3, 4, 5].map(hour => timed(`2026-11-07T0${hour}:00:00Z`, `2026-11-07T0${hour}:30:00Z`, `E${hour}`))
    const [full] = lay({ grid: grid(1, 1), events, cellItems: 4 }).cells

    expect(full!.items.map(item => item.event.title)).toEqual(['E1', 'E2', 'E3'])
    expect(full).toMatchObject({ more: 2, count: 5 })

    // Exactly as many as fit all show.
    expect(lay({ grid: grid(1, 1), events: events.slice(0, 4), cellItems: 4 }).cells[0]).toMatchObject({ more: 0, count: 4 })
    expect(lay({ grid: grid(1, 1), events: events.slice(0, 4), cellItems: 4 }).cells[0]!.items).toHaveLength(4)
  })

  it('shows overflowItems events above "+N more", held to 0 to cellItems', () => {
    const events = [1, 2, 3, 4, 5].map(hour => timed(`2026-11-07T0${hour}:00:00Z`, `2026-11-07T0${hour}:30:00Z`, `E${hour}`))

    expect(lay({ grid: grid(1, 1), events, cellItems: 3, overflowItems: 3 }).cells[0]).toMatchObject({ more: 2, count: 5 })
    expect(lay({ grid: grid(1, 1), events, cellItems: 3, overflowItems: 9 }).cells[0]!.items).toHaveLength(3)
    expect(lay({ grid: grid(1, 1), events, cellItems: 3, overflowItems: -1 }).cells[0]).toMatchObject({ items: [], more: 5 })
    // A day that fits ignores it.
    expect(lay({ grid: grid(1, 1), events: events.slice(0, 3), cellItems: 3, overflowItems: 1 }).cells[0]!.items).toHaveLength(3)
  })

  it('shows only "+N more" for a crowded day when a tile holds one line, and a lone event always', () => {
    const two = [timed('2026-11-07T08:00:00Z', '2026-11-07T09:00:00Z'), timed('2026-11-07T10:00:00Z', '2026-11-07T11:00:00Z')]

    expect(lay({ grid: grid(1, 1), events: two, cellItems: 1 }).cells[0]).toMatchObject({ items: [], more: 2, count: 2 })
    expect(lay({ grid: grid(1, 1), events: two.slice(0, 1), cellItems: 1 }).cells[0]).toMatchObject({ more: 0, count: 1 })
    // With room for one event beside the line, a crowded day keeps it.
    expect(lay({ grid: grid(1, 1), events: two, cellItems: 1, overflowItems: 1 }).cells[0]).toMatchObject({ more: 1, count: 2 })
    // Nonsense limits are held to 1.
    expect(lay({ grid: grid(1, 1), events: two, cellItems: 0 }).cells[0]).toMatchObject({ items: [], more: 2 })
  })

  it('puts a multi-day all-day event on each of its days', () => {
    const events = [allDay('2026-11-08', '2026-11-11', 'Trip')]
    const { cells } = lay({ grid: grid(1, 5), events })

    expect(cells.map(cell => cell.items.map(item => item.event.title))).toEqual([[], ['Trip'], ['Trip'], ['Trip'], []])
    expect(cells.map(cell => cell.count)).toEqual([0, 1, 1, 1, 0])
  })

  it('puts a timed event that spans midnight on both days', () => {
    const events = [timed('2026-11-07T22:00:00Z', '2026-11-08T02:30:00Z', 'Party')]
    const [first, second] = lay({ grid: grid(1, 2), events }).cells

    expect(first!.items[0]).toMatchObject({ time: '22:00', allDay: false })
    expect(second!.items[0]).toMatchObject({ time: 'Until 02:30', allDay: false })
  })

  it('places events by the display\'s zone across the clocks going back (Europe/London)', () => {
    // Sat 24 Oct is BST. The clocks go back at 02:00 BST on Sun 25th.
    const now = new Date('2026-10-24T12:00:00Z')
    const events = [
      timed('2026-10-24T23:30:00Z', '2026-10-25T00:00:00Z', 'After midnight BST'),
      timed('2026-10-25T23:30:00Z', '2026-10-26T00:30:00Z', 'Before midnight GMT'),
      timed('2026-10-26T00:10:00Z', '2026-10-26T00:40:00Z', 'After midnight GMT'),
    ]
    const { cells } = dayGridLayout({ now, timeZone: LONDON, weekStart: 'monday', grid: grid(1, 4), events })

    expect(cells.map(cell => cell.date)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'])
    expect(cells[0]!.items).toHaveLength(0)
    expect(cells[1]!.items.map(item => [item.event.title, item.time])).toEqual([['After midnight BST', '00:30'], ['Before midnight GMT', '23:30']])
    expect(cells[2]!.items.map(item => [item.event.title, item.time])).toEqual([['Before midnight GMT', 'Until 00:30'], ['After midnight GMT', '00:10']])
  })

  it('reads today in the zone, not in UTC', () => {
    const late = new Date('2026-11-07T23:30:00Z')
    const tokyo = dayGridLayout({ now: late, timeZone: 'Asia/Tokyo', weekStart: 'monday', grid: grid(1, 2), events: [] }).cells

    expect(tokyo.map(cell => cell.date)).toEqual(['2026-11-08', '2026-11-09'])
    expect(tokyo[0]!.today).toBe(true)
  })
})
