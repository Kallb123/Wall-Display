import { addDays, todayIn } from '../../shared/dates'
import { entriesOn } from '../../shared/event-days'
import type { DayEntry } from '../../shared/event-days'
import { formatLongDate } from '../../shared/format'
import type { CalendarEvent } from '../../shared/types/events'

// What the agenda view shows: today and tomorrow, each as all-day items then
// timed ones, with a "now" marker in today's. Days are `YYYY-MM-DD` strings in
// the display's time zone and the arithmetic is on UTC dates, never the
// process's local time, so a day is 23 or 25 hours long on a clock change
// without anything special happening here. Pure: no Nuxt or Vue imports.

/** One row of a day. */
export interface AgendaItem {
  event: CalendarEvent
  /** `09:00`, or `Until 11:30` for an event that began on an earlier day. `null` for an all-day row. */
  time: string | null
  /** Today only: a timed event that has ended. */
  past: boolean
  /** Today only: a timed event that is on now. */
  ongoing: boolean
}

export interface AgendaDay {
  /** `YYYY-MM-DD`. */
  date: string
  label: 'Today' | 'Tomorrow'
  /** `Wednesday 28 October`. */
  longDate: string
  /** Shown first. Includes a timed event that covers the whole day. */
  allDay: AgendaItem[]
  timed: AgendaItem[]
  /** Today only: the "now" marker goes before this index of `timed` (its length if every event has started). */
  marker: number | null
  /** How many items did not fit and are summarised as "+N more". */
  more: number
}

export interface AgendaOptions {
  /** The most rows a day can hold, counting the "+N more" row but not the marker. */
  maxRows?: number
}

/** What fits in a column at the size the wall draws it. */
export const DEFAULT_MAX_ROWS = 8

/** An item with what its sorting needs: instants in ms, and the day it starts on. */
interface Entry {
  item: AgendaItem
  start: number
  end: number
  startDate: string
}

/** Every item on `date`, sorted: all-day first, then timed. `now` is only used for today's flags. Which day an event is on is decided in shared/event-days. */
function agendaEntriesOn(events: CalendarEvent[], date: string, isToday: boolean, now: Date, timeZone: string): { allDay: Entry[], timed: Entry[] } {
  const found = entriesOn(events, date, timeZone)
  const nowMs = now.getTime()
  const entry = (day: DayEntry): Entry => ({
    item: {
      event: day.event,
      time: day.time,
      // Only a timed entry has a state: an all-day row is never over or on now.
      past: day.time !== null && isToday && day.end <= nowMs,
      ongoing: day.time !== null && isToday && day.start <= nowMs && nowMs < day.end,
    },
    start: day.start,
    end: day.end,
    startDate: day.startDate,
  })
  return { allDay: found.allDay.map(entry), timed: found.timed.map(entry) }
}

/**
 * Trims a day to `maxRows` rows. Today's past events go first, earliest first
 * and without a mention: they are the least use, and "+N more" is for what is
 * still to come. If that isn't enough, one row becomes "+N more" and the last
 * items go, timed before all-day.
 */
function fit(allDay: Entry[], timed: Entry[], isToday: boolean, maxRows: number): { allDay: Entry[], timed: Entry[], more: number } {
  let keptTimed = timed
  const excess = allDay.length + timed.length - maxRows
  if (excess <= 0) return { allDay, timed, more: 0 }

  if (isToday) {
    const past = timed.filter(entry => entry.item.past).slice(0, excess)
    keptTimed = timed.filter(entry => !past.includes(entry))
    if (excess <= past.length) return { allDay, timed: keptTimed, more: 0 }
  }

  const more = allDay.length + keptTimed.length - (maxRows - 1)
  const cutTimed = Math.min(more, keptTimed.length)
  keptTimed = keptTimed.slice(0, keptTimed.length - cutTimed)
  return { allDay: allDay.slice(0, allDay.length - (more - cutTimed)), timed: keptTimed, more }
}

/** Today and tomorrow in the display's zone, ready to draw. Always two days, whatever the events. */
export function agendaDays(events: CalendarEvent[], now: Date, timeZone: string, options: AgendaOptions = {}): [AgendaDay, AgendaDay] {
  const maxRows = Math.max(1, Math.floor(options.maxRows ?? DEFAULT_MAX_ROWS))
  const today = todayIn(now, timeZone)

  const build = (date: string, label: AgendaDay['label']): AgendaDay => {
    const isToday = label === 'Today'
    const found = agendaEntriesOn(events, date, isToday, now, timeZone)
    const shown = fit(found.allDay, found.timed, isToday, maxRows)

    // The entries are in start order, so the ones that have begun come first.
    let marker: number | null = null
    if (isToday) {
      const next = shown.timed.findIndex(entry => entry.start > now.getTime())
      marker = next === -1 ? shown.timed.length : next
    }

    return {
      date,
      label,
      // Noon UTC is on `date` whatever the zone, so the formatter reads the right day.
      longDate: formatLongDate(new Date(`${date}T12:00:00Z`), 'UTC'),
      allDay: shown.allDay.map(entry => entry.item),
      timed: shown.timed.map(entry => entry.item),
      marker,
      more: shown.more,
    }
  }

  return [build(today, 'Today'), build(addDays(today, 1), 'Tomorrow')]
}
