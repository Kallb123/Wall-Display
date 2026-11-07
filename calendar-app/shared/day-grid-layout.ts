import { addDays, dayOfWeek, todayIn } from './dates'
import { entriesOn } from './event-days'
import { itemPeople } from './month-layout'
import type { ItemPeople } from './month-layout'
import type { DayGrid } from './layouts'
import { SHORT_WEEKDAYS } from './week-layout'
import type { CalendarEvent } from './types/events'

// The day grid's layout (architecture §4.8a): a grid of day tiles, `rows` by
// `columns`, one consecutive day in each, left to right and then top to bottom.
// The view draws this output and adds nothing to it. Pure: no Nuxt or Vue
// imports, no I/O, and no use of the process's local time. Days are
// `YYYY-MM-DD` strings in the display's time zone.
//
// What this is not: it does not fetch events (`dayGridDays` says which days
// are needed), and it does not decide sizes, colours or truncation of text.
// The view tells it how many lines a tile holds (`cellItems`).

/** Lines a tile holds when the caller doesn't say. The last gives way to "+N more" when there are more. */
export const DEFAULT_CELL_ITEMS = 4

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export interface DayGridLayoutInput {
  /** The current moment. Today, and which days and events are past, come from it. */
  now: Date
  /** The display's IANA zone; events are placed on days and given times in it. */
  timeZone: string
  weekStart: 'monday' | 'sunday'
  grid: DayGrid
  /** Each event already carries its people. */
  events: CalendarEvent[]
  /** The most lines in a tile, at least 1. `DEFAULT_CELL_ITEMS` when left out. */
  cellItems?: number
  /**
   * The most events a full tile shows above its "+N more" line, from 0 to
   * `cellItems`. The line is shorter than an event, so it can leave room for as
   * many events as a tile without it. `cellItems - 1` when left out.
   */
  overflowItems?: number
}

/** One event in a tile. */
export interface DayGridItem extends ItemPeople {
  event: CalendarEvent
  /** `09:00`, or `Until 11:30` for a timed event that began on an earlier day and ends on this one; `null` for an all-day item. */
  time: string | null
  /** An all-day event, or a timed one that takes the whole day (it began earlier and ends later). */
  allDay: boolean
  /** Ended at or before now. */
  past: boolean
}

export interface DayGridCell {
  /** `YYYY-MM-DD`. */
  date: string
  /** 1 to 31. */
  day: number
  /** `Mon`. */
  weekday: string
  /** `Nov` on the first tile and on the 1st of a month, else `null`. */
  month: string | null
  today: boolean
  /** Before today. */
  past: boolean
  /** All-day first, then timed. At most `cellItems`; see `more`. */
  items: DayGridItem[]
  /** The events on the day that are not shown. 0 when everything fits. */
  more: number
  /** All the events on the day, shown or not. */
  count: number
}

export interface DayGridLayout {
  /** `rows * columns` tiles, in order. */
  cells: DayGridCell[]
}

/**
 * The first day of the grid: today, or the first day of the week that today is
 * in (a Monday or a Sunday, by `weekStart`).
 */
export function dayGridFirst(grid: Pick<DayGrid, 'start'>, today: string, weekStart: 'monday' | 'sunday'): string {
  if (grid.start === 'today') return today
  return addDays(today, -((dayOfWeek(today) - (weekStart === 'monday' ? 1 : 0) + 7) % 7))
}

/**
 * The days a grid shows: `first` is the first tile's date and `last` the last
 * tile's (both included). Add a day to `last` to get the `to` of a fetch range.
 */
export function dayGridDays(grid: DayGrid, today: string, weekStart: 'monday' | 'sunday'): { first: string, last: string } {
  const first = dayGridFirst(grid, today, weekStart)
  return { first, last: addDays(first, grid.rows * grid.columns - 1) }
}

/**
 * Lays out the grid. When a day has more events than `cellItems`, it shows
 * `overflowItems` of them (by default `cellItems - 1`, so the "+N more" line
 * takes the last line, as in the week by part of day) and `more` counts the
 * rest. A day with no more events than `cellItems` shows them all.
 */
export function dayGridLayout({ now, timeZone, weekStart, grid, events, cellItems = DEFAULT_CELL_ITEMS, overflowItems }: DayGridLayoutInput): DayGridLayout {
  const limit = Math.max(1, Math.floor(cellItems))
  const fullLimit = Math.min(limit, Math.max(0, Math.floor(overflowItems ?? limit - 1)))
  const today = todayIn(now, timeZone)
  const nowInstant = now.getTime()
  const { first } = dayGridDays(grid, today, weekStart)

  const cells = Array.from({ length: grid.rows * grid.columns }, (_, index): DayGridCell => {
    const date = addDays(first, index)
    const found = entriesOn(events, date, timeZone)
    const all = [
      ...found.allDay.map(entry => ({ entry, allDay: true })),
      ...found.timed.map(entry => ({ entry, allDay: false })),
    ]
    const full = all.length > limit
    const shown = full ? all.slice(0, fullLimit) : all
    const day = Number(date.slice(8, 10))
    return {
      date,
      day,
      weekday: SHORT_WEEKDAYS[dayOfWeek(date)]!,
      month: index === 0 || day === 1 ? SHORT_MONTHS[Number(date.slice(5, 7)) - 1]! : null,
      today: date === today,
      past: date < today,
      items: shown.map(({ entry, allDay }): DayGridItem => ({
        event: entry.event,
        time: entry.time,
        allDay,
        // An all-day event has no instants of its own in the zone, so it is past only once its day is.
        past: entry.event.all_day ? date < today : entry.end <= nowInstant,
        ...itemPeople(entry.event),
      })),
      more: all.length - shown.length,
      count: all.length,
    }
  })
  return { cells }
}

