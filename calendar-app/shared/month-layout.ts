import { addDays, dayOfWeek } from './dates'
import type { MonthKey } from './display'
import { entriesOn, eventSpan } from './event-days'
import type { EventSpan } from './event-days'
import { formatTime } from './format'
import type { CalendarEvent, EventPerson } from './types/events'

// The month view's layout (architecture §4.4): five week rows of seven days,
// with each event placed as a bar or a timed row in one of four lanes, "+N more"
// where a day is full, a veil over each run of past days, and the side panel's
// four days. Both month styles draw this output and add nothing to it. Pure: no
// Nuxt or Vue imports, no I/O, and no use of the process's local time. Days are
// `YYYY-MM-DD` strings in the display's time zone.
//
// What this is not: it does not fetch events (`displayEventRanges` says which)
// or decide what to draw; sizes, colours and truncation belong to the view.

/** Week rows in the grid, always. A month that needs a sixth wraps into the top row. */
export const WEEK_ROWS = 5
/** Lanes for events in a day's tile, below the date. The last one holds "+N more" when the day is full. */
export const LANES = 4
/** Days in the side panel: today and the three after it. */
export const PANEL_DAYS = 4
/** Initials in a badge. A fourth person is kept in `people` but not drawn. */
export const MAX_BADGE_INITIALS = 3

export interface MonthLayoutInput {
  /** The month to lay out, `YYYY-MM` (state.month, or the current month). */
  month: MonthKey
  /** Today on the wall, `YYYY-MM-DD` in the display's zone. Today's highlight, the veils and the panel follow it, whatever month is shown. */
  today: string
  /** The display's IANA zone; timed events are placed on days and given times in it. */
  timeZone: string
  weekStart: 'monday' | 'sunday'
  /** Each event already carries its people (PR 1.2), so there is no separate people argument. */
  events: CalendarEvent[]
}

export interface DayCell {
  /** `YYYY-MM-DD`. */
  date: string
  /** 1 to 31. */
  day: number
  /** 0 to 6, from the week's first day. */
  column: number
  /** False for the previous and next month's days, whose date is drawn faint. */
  inMonth: boolean
  /** One of the month's last days, moved into the top row's empty leading cells. */
  wrapped: boolean
  today: boolean
  /** Before today. */
  past: boolean
}

/** Who an item is for, as the wall draws it. */
export interface ItemPeople {
  /** All of them, in the order detection found them. */
  people: EventPerson[]
  /** The first person's colour, or `null` if there is no one. */
  colour: string | null
  /** Up to `MAX_BADGE_INITIALS`, from the first people. */
  initials: string[]
}

/** An all-day or multi-day event, or one piece of it: the part in one week row, between hidden days. */
export interface Bar extends ItemPeople {
  event: CalendarEvent
  /** 0 to `LANES - 1`. */
  lane: number
  /** The first column of this piece. */
  column: number
  /** Columns covered, at least 1. */
  span: number
  /** This piece starts on the event's first day: draw a round end. Otherwise it carries in from another week, a wrap or a hidden lane. */
  roundStart: boolean
  /** This piece ends on the event's last day: draw a round end. */
  roundEnd: boolean
}

/** A timed event on a single day. */
export interface TimedRow extends ItemPeople {
  event: CalendarEvent
  lane: number
  column: number
  /** `HH:MM`, the start in the display's zone. */
  time: string
}

/** The "+N more" in a full day's last lane. */
export interface MoreLabel {
  column: number
  /** Always `LANES - 1`. */
  lane: number
  /** Items on the day that are not drawn: those that would have been in the last lane or below it. */
  count: number
}

/** A translucent strip over a run of adjacent past days. */
export interface Veil {
  column: number
  span: number
}

export interface WeekRow {
  /** Seven. */
  cells: DayCell[]
  /** By lane, then column, then event id. */
  bars: Bar[]
  /** By column, then lane. */
  timed: TimedRow[]
  /** By column. */
  more: MoreLabel[]
  /** By column. */
  veils: Veil[]
}

/** One event in the side panel. */
export interface PanelItem extends ItemPeople {
  event: CalendarEvent
  /** `09:00`, `Until 11:30` for an event that began on an earlier day, or `null` for an all-day item. */
  time: string | null
}

export interface PanelDay {
  /** `YYYY-MM-DD`. */
  date: string
  /** `Today`, `Tomorrow`, then the weekday (`Friday`). */
  label: string
  /** Shown first: all-day and multi-day events, and timed ones that cover the whole day. By start, then longest first. */
  allDay: PanelItem[]
  /** By start time. Not trimmed: the view decides how many fit. */
  timed: PanelItem[]
}

export interface MonthLayout {
  month: MonthKey
  /** Short weekday names in column order: `Mon` to `Sun`, or `Sun` to `Sat`. */
  weekdays: string[]
  /** Always `WEEK_ROWS`. */
  rows: WeekRow[]
  /** Today and the next three days, whatever month the grid shows. */
  panel: PanelDay[]
}

const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const LONG_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function daysInMonth(month: MonthKey): number {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
}

/**
 * The grid's dates: 35 of them from the week start on or before the 1st. A
 * month that runs past the 35th cell has its overflow last days moved into the
 * first cells of the top row, which the leading days would have held, so every
 * row stays tall enough to read.
 */
function gridCells(month: MonthKey, today: string, weekStart: MonthLayoutInput['weekStart']): DayCell[] {
  const first = `${month}-01`
  const days = daysInMonth(month)
  const leading = (dayOfWeek(first) - (weekStart === 'monday' ? 1 : 0) + 7) % 7
  const cells = WEEK_ROWS * 7
  const overflow = Math.max(0, leading + days - cells)

  return Array.from({ length: cells }, (_, index): DayCell => {
    const wrapped = index < overflow
    const date = wrapped ? addDays(first, days - overflow + index) : addDays(first, index - leading)
    return {
      date,
      day: Number(date.slice(8, 10)),
      column: index % 7,
      inMonth: date.startsWith(month),
      wrapped,
      today: date === today,
      past: date < today,
    }
  })
}

function peopleOf(event: CalendarEvent): ItemPeople {
  return {
    people: event.people,
    colour: event.people[0]?.colour ?? null,
    initials: event.people.slice(0, MAX_BADGE_INITIALS).map(person => person.initial),
  }
}

/** An event with the days it covers, worked out once. */
interface Placed {
  event: CalendarEvent
  span: EventSpan
  /** Covers more than one day, or is all-day: drawn as a bar. */
  bar: boolean
}

/** A bar being laid out in one row: the runs of columns it covers, and the lane they share. */
interface BarPlan {
  placed: Placed
  /** One piece per date-contiguous run of columns, so a bar never joins days that are not neighbours. */
  runs: number[][]
  lane: number
}

interface TimedPlan {
  placed: Placed
  column: number
  lane: number
}

/** The runs of columns whose dates follow each other (the top row of a wrapped month has two). */
function dateRuns(cells: DayCell[]): number[][] {
  const runs: number[][] = []
  for (const cell of cells) {
    const run = runs[runs.length - 1]
    if (run && addDays(cells[run[run.length - 1]!]!.date, 1) === cell.date) run.push(cell.column)
    else runs.push([cell.column])
  }
  return runs
}

/** Lays out one row. Lanes are unbounded until the "+N more" rule decides what shows. */
function layoutRow(cells: DayCell[], placed: Placed[], timeZone: string): WeekRow {
  const rowFirst = cells.reduce((min, cell) => cell.date < min ? cell.date : min, cells[0]!.date)
  const rowLast = cells.reduce((max, cell) => cell.date > max ? cell.date : max, cells[0]!.date)
  const columnOf = new Map(cells.map(cell => [cell.date, cell.column]))
  const runs = dateRuns(cells)
  const nearby = placed.filter(item => item.span.first <= rowLast && item.span.last >= rowFirst)

  // Lanes in use, per column.
  const taken: Set<number>[] = cells.map(() => new Set())
  const lowestFree = (columns: number[]) => {
    let lane = 0
    while (columns.some(column => taken[column]!.has(lane))) lane++
    return lane
  }

  // 1. Bars first, by start and then longest first. A bar keeps one lane across all of its pieces in the row.
  const bars: BarPlan[] = nearby
    .filter(item => item.bar)
    .sort((a, b) => a.span.first.localeCompare(b.span.first) || (b.span.end - b.span.start) - (a.span.end - a.span.start) || a.event.id - b.event.id)
    .flatMap((item) => {
      const pieces = runs
        .map(run => run.filter(column => item.span.first <= cells[column]!.date && cells[column]!.date <= item.span.last))
        .filter(piece => piece.length > 0)
      // The top row of a wrapped month spans more than a week of dates, so being in its range is not enough.
      if (pieces.length === 0) return []
      const lane = lowestFree(pieces.flat())
      for (const column of pieces.flat()) taken[column]!.add(lane)
      return [{ placed: item, runs: pieces, lane }]
    })

  // 2. Timed events fill what is left, in time order.
  const timed: TimedPlan[] = nearby
    .filter(item => !item.bar && columnOf.has(item.span.first))
    .sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end || a.event.id - b.event.id)
    .map((item) => {
      const column = columnOf.get(item.span.first)!
      const lane = lowestFree([column])
      taken[column]!.add(lane)
      return { placed: item, column, lane }
    })

  // 3. A day with more than `LANES` items, or with one pushed below the last lane by packing, gives its
  // last lane to "+N more", which counts everything that is not drawn above it.
  const more: MoreLabel[] = []
  for (const cell of cells) {
    const lanes = [...taken[cell.column]!]
    if (lanes.length > LANES || lanes.some(lane => lane >= LANES)) {
      more.push({ column: cell.column, lane: LANES - 1, count: lanes.filter(lane => lane >= LANES - 1).length })
    }
  }
  const hasMore = new Set(more.map(label => label.column))
  const hidden = (column: number, lane: number) => hasMore.has(column) && lane >= LANES - 1

  // 4. A bar is split around the days where its lane is hidden. A timed row there is only counted.
  const pieces: Bar[] = bars.flatMap((bar) => {
    const { event, span } = bar.placed
    return bar.runs.flatMap((run) => {
      const visible: number[][] = []
      let current: number[] | null = null
      for (const column of run) {
        if (hidden(column, bar.lane)) {
          current = null
        } else if (current) {
          current.push(column)
        } else {
          current = [column]
          visible.push(current)
        }
      }
      return visible.map((columns): Bar => ({
        event,
        lane: bar.lane,
        column: columns[0]!,
        span: columns.length,
        // Round only where the event itself starts or ends, not where it carries on or is cut.
        roundStart: cells[columns[0]!]!.date === span.first,
        roundEnd: cells[columns[columns.length - 1]!]!.date === span.last,
        ...peopleOf(event),
      }))
    })
  }).sort((a, b) => a.lane - b.lane || a.column - b.column || a.event.id - b.event.id)

  const timedRows: TimedRow[] = timed
    .filter(row => !hidden(row.column, row.lane))
    .map(row => ({
      event: row.placed.event,
      lane: row.lane,
      column: row.column,
      time: formatTime(new Date(row.placed.span.start), timeZone),
      ...peopleOf(row.placed.event),
    }))
    .sort((a, b) => a.column - b.column || a.lane - b.lane || a.event.id - b.event.id)

  // One veil per run of adjacent past columns. Across a wrap it is still one strip.
  const veils: Veil[] = []
  for (const cell of cells) {
    const last = veils[veils.length - 1]
    if (!cell.past) continue
    if (last && last.column + last.span === cell.column) last.span++
    else veils.push({ column: cell.column, span: 1 })
  }

  return { cells, bars: pieces, timed: timedRows, more, veils }
}

/** Today and the next three days, whatever month the grid shows. */
function panelDays(today: string, events: CalendarEvent[], timeZone: string): PanelDay[] {
  return Array.from({ length: PANEL_DAYS }, (_, index): PanelDay => {
    const date = addDays(today, index)
    const found = entriesOn(events, date, timeZone)
    const item = (entry: { event: CalendarEvent, time: string | null }): PanelItem => ({ event: entry.event, time: entry.time, ...peopleOf(entry.event) })
    return {
      date,
      label: index === 0 ? 'Today' : index === 1 ? 'Tomorrow' : LONG_WEEKDAYS[dayOfWeek(date)]!,
      allDay: found.allDay.map(item),
      timed: found.timed.map(item),
    }
  })
}

/** Lays out `month`: the grid with its bars, timed rows, "+N more" labels and veils, and the side panel. */
export function monthLayout({ month, today, timeZone, weekStart, events }: MonthLayoutInput): MonthLayout {
  const cells = gridCells(month, today, weekStart)

  // Which days an event is on is decided in event-days, the same as for the agenda.
  const placed: Placed[] = events.flatMap((event) => {
    const span = eventSpan(event, timeZone)
    return span ? [{ event, span, bar: event.all_day || span.first < span.last }] : []
  })

  const rows = Array.from({ length: WEEK_ROWS }, (_, row) => layoutRow(cells.slice(row * 7, row * 7 + 7), placed, timeZone))
  const firstDay = weekStart === 'monday' ? 1 : 0

  return {
    month,
    weekdays: Array.from({ length: 7 }, (_, index) => SHORT_WEEKDAYS[(firstDay + index) % 7]!),
    rows,
    panel: panelDays(today, events, timeZone),
  }
}
