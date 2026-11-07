import { addDays, dayOfWeek, todayIn } from './dates'
import type { DayParts } from './display'
import { eventSpan } from './event-days'
import type { EventSpan } from './event-days'
import { formatTime } from './format'
import { itemPeople } from './month-layout'
import type { ItemPeople } from './month-layout'
import { SHORT_WEEKDAYS, wallMinutes, weekTitle } from './week-layout'
import type { CalendarEvent } from './types/events'

// The week-by-part-of-day view's layout (architecture §4.5a): seven rows, one
// for each day, each split into a morning, an afternoon and an evening. A row
// has a head on the left for the all-day, multi-day and overnight events, and
// a timed event goes in the cell of the part it starts in. The view draws this
// output and adds nothing to it. Pure: no Nuxt or Vue imports, no I/O, and no
// use of the process's local time. Days are `YYYY-MM-DD` strings in the
// display's time zone.
//
// What this is not: it does not fetch events (the month's range already covers
// the week), place events on an hour scale (that is the week view) or decide
// what to draw; sizes, colours and truncation belong to the view.

/** Lines a cell holds on the landscape stage. The last gives way to "+N more" when there are more. */
export const LANDSCAPE_CELL_ITEMS = 4
/** Lines a cell holds on the portrait stage, where the rows are taller. */
export const PORTRAIT_CELL_ITEMS = 8
/** All-day items in a row's head before "+N". */
export const HEAD_ITEMS = 2

/** The three parts of a day, in order. */
export const PART_NAMES = ['morning', 'afternoon', 'evening'] as const
export type PartName = (typeof PART_NAMES)[number]

const LABELS: Record<PartName, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' }
const MINUTES_IN_DAY = 24 * 60

export interface WeekPartsLayoutInput {
  /** A date in the week to show, `YYYY-MM-DD`: today, or a previewed date. */
  weekOf: string
  /** The current moment. Today (the highlight, past days and events, and the part we are in) comes from it, whatever week is shown. */
  now: Date
  /** The display's IANA zone; events are placed on days and given times in it. */
  timeZone: string
  weekStart: 'monday' | 'sunday'
  /** The whole hours at which the afternoon and the evening begin. */
  dayParts: DayParts
  /** Each event already carries its people. */
  events: CalendarEvent[]
  /** The most lines in a cell, at least 1. `LANDSCAPE_CELL_ITEMS` when left out. */
  cellItems?: number
}

/** A column heading: a part of the day and the hours it covers. */
export interface PartHeading {
  name: PartName
  /** `Morning`, `Afternoon` or `Evening`. */
  label: string
  /** `00–12`, `12–17` or `17–24`: zero-padded hours and an en dash. */
  hours: string
  /** Minutes since midnight, the start included. */
  start: number
  /** Minutes since midnight, the end not included. */
  end: number
}

/** An all-day, multi-day or overnight event in a row's head. */
export interface HeadItem extends ItemPeople {
  event: CalendarEvent
  /** `HH:MM` start for a timed (overnight) event on the day it starts, else `null`. */
  time: string | null
  /** Ended at or before now. */
  past: boolean
}

/** A timed event in a cell. */
export interface PartItem extends ItemPeople {
  event: CalendarEvent
  /** `14:00`, the start. */
  time: string
  /** Ended at or before now. */
  past: boolean
  /** On now: it has started and not ended. */
  ongoing: boolean
}

export interface PartCell {
  part: PartName
  /** At most `cellItems`. When there are more, `cellItems - 1` of them are shown and `more` counts the rest. */
  items: PartItem[]
  /** 0 when everything fits. */
  more: number
  /** Today, and now falls in this part: the view outlines it. */
  now: boolean
}

export interface WeekPartsRow {
  /** `YYYY-MM-DD`. */
  date: string
  /** 1 to 31. */
  day: number
  /** `Mon`. */
  weekday: string
  /** 0 to 6, from the week's first day. */
  row: number
  today: boolean
  /** Before today. */
  past: boolean
  head: {
    /** At most `HEAD_ITEMS`. */
    items: HeadItem[]
    /** The items on the day that are not shown. */
    more: number
  }
  /** Morning, afternoon and evening. */
  cells: [PartCell, PartCell, PartCell]
}

export interface WeekPartsLayout {
  /** The week in long month names, as the week view's title: `26 October – 1 November 2026`. */
  title: string
  /** The column headings. */
  parts: [PartHeading, PartHeading, PartHeading]
  /** Seven, in order from the week's first day. */
  rows: WeekPartsRow[]
  /** Where now is, or `null` unless today is one of the days shown. */
  now: { row: number, part: PartName } | null
}

const pad = (hour: number) => String(hour).padStart(2, '0')

/** An event with the days it covers, worked out once. */
interface Placed {
  event: CalendarEvent
  span: EventSpan
}

/** Lays out the week of `weekOf`: the part headings, and for each day its head and three cells. */
export function weekPartsLayout({ weekOf, now, timeZone, weekStart, dayParts, events, cellItems = LANDSCAPE_CELL_ITEMS }: WeekPartsLayoutInput): WeekPartsLayout {
  const limit = Math.max(1, Math.floor(cellItems))
  const today = todayIn(now, timeZone)
  const nowInstant = now.getTime()
  const first = addDays(weekOf, -((dayOfWeek(weekOf) - (weekStart === 'monday' ? 1 : 0) + 7) % 7))
  const dates = Array.from({ length: 7 }, (_, index) => addDays(first, index))

  const bounds = [0, dayParts.afternoon * 60, dayParts.evening * 60, MINUTES_IN_DAY]
  const parts = PART_NAMES.map((name, index): PartHeading => ({
    name,
    label: LABELS[name],
    hours: `${pad(bounds[index]! / 60)}–${pad(bounds[index + 1]! / 60)}`,
    start: bounds[index]!,
    end: bounds[index + 1]!,
  })) as WeekPartsLayout['parts']

  /** The part a wall-clock minute falls in: one starting exactly on a boundary belongs to the later part. */
  const partIndex = (minutes: number) => (minutes < bounds[1]! ? 0 : minutes < bounds[2]! ? 1 : 2)

  // Which days an event is on is decided in event-days, the same as for the week and the month.
  // An all-day or overnight event goes in the heads; everything else is a timed event on its day.
  const headed: Placed[] = []
  const timed: Placed[] = []
  for (const event of events) {
    const span = eventSpan(event, timeZone)
    if (!span || span.first > dates[6]! || span.last < dates[0]!) continue
    if (event.all_day || span.first < span.last) headed.push({ event, span })
    else timed.push({ event, span })
  }
  // By start, then longest first, then id: a week away sits above a single day.
  headed.sort((a, b) => a.span.first.localeCompare(b.span.first) || (b.span.end - b.span.start) - (a.span.end - a.span.start) || a.event.id - b.event.id)
  timed.sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end || a.event.id - b.event.id)

  const nowMinutes = wallMinutes(nowInstant, timeZone)
  const nowPart = partIndex(nowMinutes)

  const rows = dates.map((date, row): WeekPartsRow => {
    const isToday = date === today

    const onDay = headed.filter(({ span }) => span.first <= date && date <= span.last)
    const headItems = onDay.slice(0, HEAD_ITEMS).map(({ event, span }): HeadItem => ({
      event,
      // The start time shows only where a timed event begins, not on the days it carries on.
      time: !event.all_day && span.first === date ? formatTime(new Date(span.start), timeZone) : null,
      past: span.end <= nowInstant,
      ...itemPeople(event),
    }))

    const buckets: PartItem[][] = [[], [], []]
    for (const { event, span } of timed) {
      if (span.first !== date) continue
      buckets[partIndex(wallMinutes(span.start, timeZone))]!.push({
        event,
        time: formatTime(new Date(span.start), timeZone),
        past: span.end <= nowInstant,
        ongoing: span.start <= nowInstant && nowInstant < span.end,
        ...itemPeople(event),
      })
    }

    const cells = buckets.map((all, index): PartCell => {
      const full = all.length > limit
      return {
        part: PART_NAMES[index]!,
        items: full ? all.slice(0, limit - 1) : all,
        more: full ? all.length - (limit - 1) : 0,
        now: isToday && index === nowPart,
      }
    }) as WeekPartsRow['cells']

    return {
      date,
      day: Number(date.slice(8, 10)),
      weekday: SHORT_WEEKDAYS[dayOfWeek(date)]!,
      row,
      today: isToday,
      past: date < today,
      head: { items: headItems, more: onDay.length - headItems.length },
      cells,
    }
  })

  const todayRow = rows.find(row => row.today)
  return {
    title: weekTitle(dates[0]!, dates[6]!),
    parts,
    rows,
    now: todayRow ? { row: todayRow.row, part: PART_NAMES[nowPart]! } : null,
  }
}
