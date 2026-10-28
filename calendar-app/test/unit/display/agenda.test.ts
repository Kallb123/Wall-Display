import { describe, expect, it } from 'vitest'
import { agendaDays, DEFAULT_MAX_ROWS } from '../../../app/utils/agenda'
import type { AgendaDay } from '../../../app/utils/agenda'
import type { CalendarEvent } from '../../../shared/types/events'

const LONDON = 'Europe/London'
// Wed 28 Oct 2026, 09:41 in London (the clocks went back on the 25th, so that is 09:41Z).
const NOW = new Date('2026-10-28T09:41:00Z')

let nextId = 1

/** A timed event from `start` to `end`, both ISO instants. */
function timed(start: string, end: string, title = 'Event', id = nextId++): CalendarEvent {
  return { id, calendar_id: 'family', title, display_title: title, location: null, start, end, all_day: false, start_date: null, end_date: null, people: [] }
}

/** An all-day event on `first` up to but not including `after`. */
function allDay(first: string, after: string, title = 'All day', id = nextId++): CalendarEvent {
  return { ...timed(`${first}T00:00:00.000Z`, `${after}T00:00:00.000Z`, title, id), all_day: true, start_date: first, end_date: after }
}

const titles = (items: AgendaDay['timed']) => items.map(item => item.event.display_title)

describe('agendaDays', () => {
  it('is always today and tomorrow, with their labels and long dates', () => {
    const [today, tomorrow] = agendaDays([], NOW, LONDON)

    expect(today).toMatchObject({ date: '2026-10-28', label: 'Today', longDate: 'Wednesday 28 October', allDay: [], timed: [], more: 0 })
    expect(tomorrow).toMatchObject({ date: '2026-10-29', label: 'Tomorrow', longDate: 'Thursday 29 October', allDay: [], timed: [], more: 0 })
  })

  it('crosses a month and a year', () => {
    const [today, tomorrow] = agendaDays([], new Date('2026-12-31T10:00:00Z'), LONDON)

    expect(today.date).toBe('2026-12-31')
    expect(tomorrow).toMatchObject({ date: '2027-01-01', longDate: 'Friday 1 January' })
  })

  it('reads the date in the display zone, not the process zone', () => {
    // 23:30Z on the 28th is 12:30 on the 29th in Auckland, which is the process zone under test.
    const late = new Date('2026-10-28T23:30:00Z')

    expect(agendaDays([], late, LONDON).map(day => day.date)).toEqual(['2026-10-28', '2026-10-29'])
    expect(agendaDays([], late, 'Asia/Tokyo').map(day => day.date)).toEqual(['2026-10-29', '2026-10-30'])
    expect(agendaDays([], late, 'America/Los_Angeles').map(day => day.date)).toEqual(['2026-10-28', '2026-10-29'])
  })

  describe('which day an event is on', () => {
    it('puts a timed event on its start day, by the display zone', () => {
      // 23:30Z on the 27th is 23:30 in London, but already the 28th in Tokyo.
      const event = timed('2026-10-27T23:30:00Z', '2026-10-27T23:45:00Z', 'Late')
      const [london] = agendaDays([event], NOW, LONDON)
      const [tokyo] = agendaDays([event], NOW, 'Asia/Tokyo')

      expect(titles(london.timed)).toEqual([])
      expect(titles(tokyo.timed)).toEqual(['Late'])
    })

    it('leaves out events on other days', () => {
      const [today, tomorrow] = agendaDays([
        timed('2026-10-27T10:00:00Z', '2026-10-27T11:00:00Z', 'Yesterday'),
        timed('2026-10-30T10:00:00Z', '2026-10-30T11:00:00Z', 'Later'),
        allDay('2026-10-30', '2026-10-31', 'Later all day'),
      ], NOW, LONDON)

      expect(today.timed).toEqual([])
      expect(tomorrow.allDay).toEqual([])
      expect(tomorrow.timed).toEqual([])
    })

    it('does not show an event that ends exactly at midnight on the next day', () => {
      const event = timed('2026-10-28T22:00:00Z', '2026-10-29T00:00:00Z', 'Until midnight')
      const [today, tomorrow] = agendaDays([event], NOW, LONDON)

      expect(titles(today.timed)).toEqual(['Until midnight'])
      expect(today.timed[0]!.time).toBe('22:00')
      expect(tomorrow.timed).toEqual([])
    })

    it('shows an event with no length on its start day only', () => {
      const [today, tomorrow] = agendaDays([timed('2026-10-28T12:00:00Z', '2026-10-28T12:00:00Z', 'Instant'), timed('2026-10-29T00:00:00Z', '2026-10-29T00:00:00Z', 'Midnight')], NOW, LONDON)

      expect(titles(today.timed)).toEqual(['Instant'])
      expect(titles(tomorrow.timed)).toEqual(['Midnight'])
    })

    it('shows an all-day event on each day it covers, and not the day its end date names', () => {
      const trip = allDay('2026-10-27', '2026-10-29', 'Trip')
      const week = allDay('2026-10-28', '2026-11-04', 'Half term')
      const single = allDay('2026-10-29', '2026-10-30', 'Single')
      const [today, tomorrow] = agendaDays([trip, week, single], NOW, LONDON)

      expect(titles(today.allDay)).toEqual(['Trip', 'Half term'])
      expect(titles(tomorrow.allDay)).toEqual(['Half term', 'Single'])
    })
  })

  describe('events across midnight', () => {
    const overnight = timed('2026-10-28T22:00:00Z', '2026-10-29T07:30:00Z', 'Sleepover')

    it('keeps the start time on the day it starts and says "Until" on the next', () => {
      const [today, tomorrow] = agendaDays([overnight], NOW, LONDON)

      expect(today.timed.map(item => item.time)).toEqual(['22:00'])
      expect(tomorrow.timed.map(item => item.time)).toEqual(['Until 07:30'])
    })

    it('sorts an "Until" row first in the timed rows', () => {
      const morning = timed('2026-10-29T06:00:00Z', '2026-10-29T07:00:00Z', 'Early')
      const [, tomorrow] = agendaDays([morning, overnight], NOW, LONDON)

      expect(titles(tomorrow.timed)).toEqual(['Sleepover', 'Early'])
    })

    it('puts an event that covers the whole day with the all-day items, with no time', () => {
      const conference = timed('2026-10-27T09:00:00Z', '2026-10-29T17:00:00Z', 'Conference')
      const [today, tomorrow] = agendaDays([conference, allDay('2026-10-28', '2026-10-29', 'Birthday')], NOW, LONDON)

      expect(titles(today.allDay)).toEqual(['Conference', 'Birthday'])
      expect(today.allDay.map(item => item.time)).toEqual([null, null])
      expect(today.timed).toEqual([])
      // It began today, so tomorrow is "Until".
      expect(tomorrow.allDay).toEqual([])
      expect(tomorrow.timed[0]).toMatchObject({ time: 'Until 17:00' })
    })

    it('treats an event from before the day to exactly midnight at its end as covering the day', () => {
      const [today, tomorrow] = agendaDays([timed('2026-10-27T12:00:00Z', '2026-10-29T00:00:00Z', 'Away')], NOW, LONDON)

      expect(titles(today.allDay)).toEqual(['Away'])
      expect(tomorrow.allDay).toEqual([])
      expect(tomorrow.timed).toEqual([])
    })
  })

  describe('ordering', () => {
    it('orders all-day events by start, then longer first, then id', () => {
      const [today] = agendaDays([
        allDay('2026-10-28', '2026-10-29', 'Short b', 12),
        allDay('2026-10-28', '2026-10-29', 'Short a', 11),
        allDay('2026-10-28', '2026-11-02', 'Long', 13),
        allDay('2026-10-26', '2026-10-29', 'Earlier', 14),
      ], NOW, LONDON)

      expect(titles(today.allDay)).toEqual(['Earlier', 'Long', 'Short a', 'Short b'])
    })

    it('orders timed events by start, then end, then id', () => {
      const [today] = agendaDays([
        timed('2026-10-28T12:00:00Z', '2026-10-28T13:00:00Z', 'Third', 23),
        timed('2026-10-28T11:00:00Z', '2026-10-28T13:00:00Z', 'Second', 22),
        timed('2026-10-28T11:00:00Z', '2026-10-28T12:00:00Z', 'First b', 21),
        timed('2026-10-28T11:00:00Z', '2026-10-28T12:00:00Z', 'First a', 20),
      ], NOW, LONDON)

      expect(titles(today.timed)).toEqual(['First a', 'First b', 'Second', 'Third'])
    })

    it('does not depend on the order the events arrive in', () => {
      const events = [timed('2026-10-28T11:00:00Z', '2026-10-28T12:00:00Z', 'B'), timed('2026-10-28T10:00:00Z', '2026-10-28T11:00:00Z', 'A')]

      expect(titles(agendaDays(events, NOW, LONDON)[0].timed)).toEqual(titles(agendaDays([...events].reverse(), NOW, LONDON)[0].timed))
    })
  })

  describe('past and ongoing', () => {
    const events = [
      timed('2026-10-28T07:00:00Z', '2026-10-28T07:45:00Z', 'Done'),
      timed('2026-10-28T09:00:00Z', '2026-10-28T10:00:00Z', 'On now'),
      timed('2026-10-28T11:00:00Z', '2026-10-28T12:00:00Z', 'Later'),
    ]

    it('flags today’s events that have ended or are on now', () => {
      const [today] = agendaDays(events, NOW, LONDON)

      expect(today.timed.map(item => [item.past, item.ongoing])).toEqual([[true, false], [false, true], [false, false]])
    })

    it('counts an event as over at its end instant, and as on at its start', () => {
      const [atEnd] = agendaDays(events, new Date('2026-10-28T10:00:00Z'), LONDON)
      const [atStart] = agendaDays(events, new Date('2026-10-28T11:00:00Z'), LONDON)

      expect(atEnd.timed.map(item => [item.past, item.ongoing])).toEqual([[true, false], [true, false], [false, false]])
      expect(atStart.timed.map(item => [item.past, item.ongoing])).toEqual([[true, false], [true, false], [false, true]])
    })

    it('never flags all-day rows, or tomorrow’s', () => {
      const [today, tomorrow] = agendaDays([
        allDay('2026-10-28', '2026-10-30', 'Away'),
        timed('2026-10-29T01:00:00Z', '2026-10-29T02:00:00Z', 'Tomorrow early'),
      ], NOW, LONDON)

      expect(today.allDay[0]).toMatchObject({ past: false, ongoing: false })
      expect(tomorrow.allDay[0]).toMatchObject({ past: false, ongoing: false })
      expect(tomorrow.timed[0]).toMatchObject({ past: false, ongoing: false })
    })
  })

  describe('the now marker', () => {
    const early = timed('2026-10-28T07:00:00Z', '2026-10-28T07:45:00Z', 'Early')
    const current = timed('2026-10-28T09:00:00Z', '2026-10-28T10:00:00Z', 'Current')
    const later = timed('2026-10-28T11:00:00Z', '2026-10-28T12:00:00Z', 'Later')

    it('goes before the first event that has not started', () => {
      expect(agendaDays([early, current, later], NOW, LONDON)[0].marker).toBe(2)
    })

    it('goes first when nothing has started', () => {
      expect(agendaDays([later], NOW, LONDON)[0].marker).toBe(0)
    })

    it('goes after the last when everything has started', () => {
      expect(agendaDays([early, current], NOW, LONDON)[0].marker).toBe(2)
    })

    it('sits after the past events and before the ones to come', () => {
      expect(agendaDays([early, later], NOW, LONDON)[0].marker).toBe(1)
    })

    it('is zero when there are no timed events', () => {
      expect(agendaDays([allDay('2026-10-28', '2026-10-29')], NOW, LONDON)[0].marker).toBe(0)
      expect(agendaDays([], NOW, LONDON)[0].marker).toBe(0)
    })

    it('treats an event starting exactly now as started', () => {
      expect(agendaDays([early, timed('2026-10-28T09:41:00Z', '2026-10-28T10:00:00Z'), later], NOW, LONDON)[0].marker).toBe(2)
    })

    it('is never on tomorrow', () => {
      expect(agendaDays([timed('2026-10-29T09:00:00Z', '2026-10-29T10:00:00Z')], NOW, LONDON)[1].marker).toBeNull()
    })
  })

  describe('overflow', () => {
    /** `count` one-hour events, one per hour from 00:00Z on the 28th, titled `E0`, `E1`, and so on. */
    const hourly = (count: number) => Array.from({ length: count }, (_, i) => {
      const hour = String(i).padStart(2, '0')
      return timed(`2026-10-28T${hour}:00:00Z`, `2026-10-28T${hour}:50:00Z`, `E${i}`)
    })

    /** The same events a day later, so nothing has passed on the clock. */
    const tomorrowOf = (events: CalendarEvent[]) => events.map(event => ({ ...event, start: event.start.replace('-28T', '-29T'), end: event.end.replace('-28T', '-29T') }))

    it('has room for eight rows by default', () => {
      expect(DEFAULT_MAX_ROWS).toBe(8)
      const [, fits] = agendaDays(tomorrowOf(hourly(8)), NOW, LONDON)
      const [, over] = agendaDays(tomorrowOf(hourly(9)), NOW, LONDON)

      expect(fits.timed).toHaveLength(8)
      expect(fits.more).toBe(0)
      expect(over.timed.length + over.allDay.length).toBe(7)
      expect(over.more).toBe(2)
    })

    it('drops past events first, earliest first, without a "+N more"', () => {
      // At 09:41 E0 to E8 are over, E9 is on now, and E10 and E11 are to come.
      const [today] = agendaDays(hourly(12), NOW, LONDON, { maxRows: 6 })

      expect(titles(today.timed)).toEqual(['E6', 'E7', 'E8', 'E9', 'E10', 'E11'])
      expect(today.more).toBe(0)
    })

    it('keeps the marker in the right place after dropping past events', () => {
      const [today] = agendaDays(hourly(12), NOW, LONDON, { maxRows: 6 })

      // The marker goes before E10, the first not yet started.
      expect(today.marker).toBe(4)
    })

    it('counts only what is still to come when dropping the past is not enough', () => {
      // Without the nine past events there are still three, for two rows.
      const [today] = agendaDays(hourly(12), NOW, LONDON, { maxRows: 2 })

      expect(titles(today.timed)).toEqual(['E9'])
      expect(today.more).toBe(2)
      expect(today.marker).toBe(1)
    })

    it('cuts from the end on tomorrow, whatever has passed on the clock', () => {
      const [, tomorrow] = agendaDays(tomorrowOf(hourly(12)), NOW, LONDON, { maxRows: 5 })

      expect(titles(tomorrow.timed)).toEqual(['E0', 'E1', 'E2', 'E3'])
      expect(tomorrow.more).toBe(8)
      expect(tomorrow.marker).toBeNull()
    })

    it('counts all-day rows, and cuts them last of all', () => {
      const events = [allDay('2026-10-28', '2026-10-29', 'A', 1), allDay('2026-10-28', '2026-10-29', 'B', 2), allDay('2026-10-28', '2026-10-29', 'C', 3), timed('2026-10-28T11:00:00Z', '2026-10-28T12:00:00Z', 'T')]
      const [fits] = agendaDays(events, NOW, LONDON, { maxRows: 4 })
      const [tight] = agendaDays(events, NOW, LONDON, { maxRows: 3 })
      const [tiny] = agendaDays(events, NOW, LONDON, { maxRows: 2 })

      expect([titles(fits.allDay.concat(fits.timed)), fits.more]).toEqual([['A', 'B', 'C', 'T'], 0])
      expect([titles(tight.allDay), titles(tight.timed), tight.more]).toEqual([['A', 'B'], [], 2])
      expect([titles(tiny.allDay), titles(tiny.timed), tiny.more]).toEqual([['A'], [], 3])
    })

    it('puts the marker at zero when every timed event was cut', () => {
      const events = [allDay('2026-10-28', '2026-10-29', 'A', 1), allDay('2026-10-28', '2026-10-29', 'B', 2), timed('2026-10-28T11:00:00Z', '2026-10-28T12:00:00Z', 'T')]
      const [today] = agendaDays(events, NOW, LONDON, { maxRows: 2 })

      expect(titles(today.allDay)).toEqual(['A'])
      expect(today.timed).toEqual([])
      expect(today.marker).toBe(0)
      expect(today.more).toBe(2)
    })
  })

  describe('clock changes in London', () => {
    it('finds tomorrow near midnight on the day the clocks go back (25 Oct 2026, 25 hours)', () => {
      // 23:30 GMT on the 25th. Midnight on the 26th is 00:00Z, so 23:00Z is still the 25th (24 hours after midnight BST would say the 26th).
      const now = new Date('2026-10-25T23:30:00Z')
      const [today, tomorrow] = agendaDays([
        timed('2026-10-25T23:00:00Z', '2026-10-25T23:15:00Z', 'Last quarter hour'),
        timed('2026-10-26T00:00:00Z', '2026-10-26T01:00:00Z', 'First hour'),
        timed('2026-10-27T00:00:00Z', '2026-10-27T01:00:00Z', 'Tuesday'),
      ], now, LONDON)

      expect([today.date, tomorrow.date]).toEqual(['2026-10-25', '2026-10-26'])
      expect(titles(today.timed)).toEqual(['Last quarter hour'])
      expect(titles(tomorrow.timed)).toEqual(['First hour'])
    })

    it('finds tomorrow from just after midnight on the day the clocks go back (25 Oct 2026)', () => {
      // 23:30Z on the 24th is 00:30 BST on the 25th, the day that has the hour twice.
      const now = new Date('2026-10-24T23:30:00Z')
      const [today, tomorrow] = agendaDays([
        timed('2026-10-24T23:45:00Z', '2026-10-25T00:15:00Z', 'Midnight BST'),
        timed('2026-10-25T23:59:00Z', '2026-10-26T00:30:00Z', 'Last minute of the 25th'),
        timed('2026-10-26T00:00:00Z', '2026-10-26T01:00:00Z', 'Monday'),
      ], now, LONDON)

      expect([today.date, tomorrow.date]).toEqual(['2026-10-25', '2026-10-26'])
      expect(titles(today.timed)).toEqual(['Midnight BST', 'Last minute of the 25th'])
      expect(titles(tomorrow.timed)).toEqual(['Last minute of the 25th', 'Monday'])
      expect(tomorrow.timed[0]!.time).toBe('Until 00:30')
    })

    it('finds tomorrow on the day before the clocks go back (24 Oct 2026)', () => {
      // 23:30 BST on the 24th is 22:30Z.
      const [today, tomorrow] = agendaDays([
        timed('2026-10-24T22:45:00Z', '2026-10-24T23:00:00Z', 'Still the 24th'),
        timed('2026-10-24T23:00:00Z', '2026-10-24T23:30:00Z', 'Midnight BST'),
      ], new Date('2026-10-24T22:30:00Z'), LONDON)

      expect([today.date, tomorrow.date]).toEqual(['2026-10-24', '2026-10-25'])
      expect(titles(today.timed)).toEqual(['Still the 24th'])
      expect(titles(tomorrow.timed)).toEqual(['Midnight BST'])
    })

    it('finds tomorrow near midnight on the day the clocks go forward (29 Mar 2026, 23 hours)', () => {
      // 23:30 GMT on the 28th. Midnight on the 30th is 23:00Z on the 29th.
      const now = new Date('2026-03-28T23:30:00Z')
      const [today, tomorrow] = agendaDays([
        timed('2026-03-28T23:45:00Z', '2026-03-29T00:30:00Z', 'Just before bed'),
        timed('2026-03-29T22:59:00Z', '2026-03-29T22:59:30Z', 'Last minute of the 29th'),
        timed('2026-03-29T23:00:00Z', '2026-03-29T23:30:00Z', 'Monday'),
      ], now, LONDON)

      expect([today.date, tomorrow.date]).toEqual(['2026-03-28', '2026-03-29'])
      expect(today.longDate).toBe('Saturday 28 March')
      expect(tomorrow.longDate).toBe('Sunday 29 March')
      expect(titles(today.timed)).toEqual(['Just before bed'])
      expect(titles(tomorrow.timed)).toEqual(['Just before bed', 'Last minute of the 29th'])
    })

    it('rolls over to the day after on the 23-hour day (29 Mar 2026)', () => {
      const [today, tomorrow] = agendaDays([], new Date('2026-03-29T22:30:00Z'), LONDON)

      expect([today.date, tomorrow.date]).toEqual(['2026-03-29', '2026-03-30'])
    })
  })
})
