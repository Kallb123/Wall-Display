import { describe, expect, it } from 'vitest'
import { fitPanelDay, MAX_PANEL_ROWS } from '../../../app/utils/monthPanel'
import type { FittedPanelDay } from '../../../app/utils/monthPanel'
import type { PanelDay, PanelItem } from '../../../shared/month-layout'
import type { CalendarEvent } from '../../../shared/types/events'

// Wed 28 Oct 2026, 09:41 in London (the clocks went back on the 25th, so that is 09:41Z).
const NOW = new Date('2026-10-28T09:41:00Z')

let nextId = 1

function item(event: CalendarEvent, time: string | null): PanelItem {
  return { event, time, people: [], colour: null, initials: [] }
}

/** A timed item from `start` to `end` (`HH:MM`, UTC, on the 28th), shown at `start`. */
function timed(start: string, end: string, title = 'Event'): PanelItem {
  return item({
    id: nextId++,
    calendar_id: 'family',
    title,
    display_title: title,
    location: null,
    start: `2026-10-28T${start}:00Z`,
    end: `2026-10-28T${end}:00Z`,
    all_day: false,
    start_date: null,
    end_date: null,
    people: [],
  }, start)
}

/** An all-day item on the 28th. */
function allDay(title = 'All day'): PanelItem {
  return item({
    id: nextId++,
    calendar_id: 'family',
    title,
    display_title: title,
    location: null,
    start: '2026-10-28T00:00:00.000Z',
    end: '2026-10-29T00:00:00.000Z',
    all_day: true,
    start_date: '2026-10-28',
    end_date: '2026-10-29',
    people: [],
  }, null)
}

const day = (allDayItems: PanelItem[], timedItems: PanelItem[]): PanelDay => ({ date: '2026-10-28', label: 'Today', allDay: allDayItems, timed: timedItems })

/** `n` one-hour events from 10:00 UTC, after `NOW`. */
const upcoming = (n: number, from = 10): PanelItem[] => Array.from({ length: n }, (_, i) => timed(`${String(from + i).padStart(2, '0')}:00`, `${String(from + i).padStart(2, '0')}:30`, `Later ${i + 1}`))

const titles = (fitted: FittedPanelDay) => fitted.rows.map(row => row.item.event.display_title)

describe('fitPanelDay', () => {
  it('has room for four rows, counting "+N more"', () => {
    expect(MAX_PANEL_ROWS).toBe(4)
  })

  it('carries the day\'s date and label', () => {
    const fitted = fitPanelDay({ ...day([], []), date: '2026-10-30', label: 'Friday' }, NOW, false)

    expect(fitted).toEqual({ date: '2026-10-30', label: 'Friday', rows: [], more: 0 })
  })

  it('is empty for an empty day', () => {
    expect(fitPanelDay(day([], []), NOW, true)).toMatchObject({ rows: [], more: 0 })
  })

  it('shows exactly four items without a "+N more"', () => {
    const fitted = fitPanelDay(day([allDay('Half term')], upcoming(3)), NOW, false)

    expect(titles(fitted)).toEqual(['Half term', 'Later 1', 'Later 2', 'Later 3'])
    expect(fitted.more).toBe(0)
  })

  it('shows three items and "+2 more" for five', () => {
    const fitted = fitPanelDay(day([allDay('Half term')], upcoming(4)), NOW, false)

    expect(titles(fitted)).toEqual(['Half term', 'Later 1', 'Later 2'])
    expect(fitted.more).toBe(2)
  })

  it('counts everything cut, for a long day', () => {
    const fitted = fitPanelDay(day([], upcoming(7)), NOW, false)

    expect(fitted.rows).toHaveLength(3)
    expect(fitted.more).toBe(4)
  })

  it('puts all-day items before timed ones and keeps the order within each', () => {
    const fitted = fitPanelDay(day([allDay('First'), allDay('Second')], [timed('08:00', '09:00', 'Early'), timed('14:00', '15:00', 'Late')]), NOW, false)

    expect(titles(fitted)).toEqual(['First', 'Second', 'Early', 'Late'])
  })

  it('cuts timed items before all-day ones', () => {
    const fitted = fitPanelDay(day([allDay('A'), allDay('B'), allDay('C')], upcoming(2)), NOW, false)

    expect(titles(fitted)).toEqual(['A', 'B', 'C'])
    expect(fitted.more).toBe(2)
  })

  it('honours another number of rows', () => {
    const fitted = fitPanelDay(day([], upcoming(5)), NOW, false, 2)

    expect(titles(fitted)).toEqual(['Later 1'])
    expect(fitted.more).toBe(4)
  })

  describe('today', () => {
    it('flags a timed event that has ended, and not one that is on or still to come', () => {
      const fitted = fitPanelDay(day([allDay('Half term')], [
        timed('08:45', '09:15', 'Over'),
        timed('09:00', '10:00', 'On now'),
        timed('14:00', '15:00', 'Later'),
      ]), NOW, true)

      expect(fitted.rows.map(row => [row.item.event.display_title, row.past])).toEqual([
        ['Half term', false],
        ['Over', true],
        ['On now', false],
        ['Later', false],
      ])
    })

    it('counts an event that ends exactly now as over', () => {
      const fitted = fitPanelDay(day([], [timed('09:00', '09:41', 'Just ended')]), NOW, true)

      expect(fitted.rows[0]!.past).toBe(true)
    })

    it('never flags an all-day item', () => {
      expect(fitPanelDay(day([allDay()], []), NOW, true).rows[0]!.past).toBe(false)
    })

    it('drops past events first when the day overflows, without counting them', () => {
      // Seven items: two over, five to come. Dropping the two leaves five, which is one too many, so it shows three and "+2 more".
      const fitted = fitPanelDay(day([], [timed('06:00', '07:00', 'Over 1'), timed('08:00', '09:00', 'Over 2'), ...upcoming(5)]), NOW, true)

      expect(titles(fitted)).toEqual(['Later 1', 'Later 2', 'Later 3'])
      expect(fitted.rows.some(row => row.past)).toBe(false)
      expect(fitted.more).toBe(2)
    })

    it('can fit by dropping past events alone', () => {
      // Five items, two of them over: dropping one is enough, and it is the earliest.
      const fitted = fitPanelDay(day([], [timed('06:00', '07:00', 'Over 1'), timed('08:00', '09:00', 'Over 2'), ...upcoming(3)]), NOW, true)

      expect(titles(fitted)).toEqual(['Over 2', 'Later 1', 'Later 2', 'Later 3'])
      expect(fitted.rows.map(row => row.past)).toEqual([true, false, false, false])
      expect(fitted.more).toBe(0)
    })

    it('keeps past events when everything fits', () => {
      const fitted = fitPanelDay(day([], [timed('06:00', '07:00', 'Over 1'), timed('08:00', '09:00', 'Over 2'), ...upcoming(2)]), NOW, true)

      expect(titles(fitted)).toEqual(['Over 1', 'Over 2', 'Later 1', 'Later 2'])
    })

    it('shows "+N more" for what is still to come when past events cannot make room', () => {
      // One over, six to come: after the drop there are six, so three show and three are "+3 more".
      const fitted = fitPanelDay(day([allDay('Half term')], [timed('08:00', '09:00', 'Over'), ...upcoming(5)]), NOW, true)

      expect(titles(fitted)).toEqual(['Half term', 'Later 1', 'Later 2'])
      expect(fitted.more).toBe(3)
    })
  })

  describe('another day', () => {
    it('never marks an item as past, whatever the time', () => {
      const fitted = fitPanelDay(day([], [timed('06:00', '07:00', 'Early'), timed('08:00', '09:00', 'Morning')]), NOW, false)

      expect(fitted.rows.map(row => row.past)).toEqual([false, false])
    })

    it('does not drop early events when the day overflows', () => {
      const fitted = fitPanelDay(day([], [timed('06:00', '07:00', 'Early'), ...upcoming(5)]), NOW, false)

      expect(titles(fitted)).toEqual(['Early', 'Later 1', 'Later 2'])
      expect(fitted.more).toBe(3)
    })
  })
})
