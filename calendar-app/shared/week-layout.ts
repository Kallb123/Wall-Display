import { addDays, dayOfWeek, todayIn } from './dates'
import type { WeekHours } from './display'
import { eventSpan } from './event-days'
import type { EventSpan } from './event-days'
import { formatTime } from './format'
import { itemPeople, MAX_BADGE_INITIALS } from './month-layout'
import type { ItemPeople } from './month-layout'
import type { CalendarEvent } from './types/events'

// The week view's layout (architecture §4.5): seven day columns with the
// all-day and multi-day events in a strip across the top, the timed events as
// blocks on an hour scale (side by side where they overlap), the hours outside
// the configured range folded into a thin band at each end, and a "now" line.
// The view draws this output and adds nothing to it. Pure: no Nuxt or Vue
// imports, no I/O, and no use of the process's local time. Days are
// `YYYY-MM-DD` strings in the display's time zone.
//
// What this is not: it does not fetch events (the month's range already covers
// the week) or decide what to draw; sizes, colours and truncation belong to the view.

export { MAX_BADGE_INITIALS }

/** Lanes in the all-day strip. The last one holds "+N more" when a day is full. */
export const ALL_DAY_LANES = 3
/** A timed event shorter than this is laid out, and drawn, as if it were this long, so short neighbours do not sit on top of each other. */
export const MIN_BLOCK_MINUTES = 30

const MINUTES_IN_DAY = 24 * 60

export interface WeekLayoutInput {
  /** A date in the week to show, `YYYY-MM-DD`: today, or a previewed date. */
  weekOf: string
  /** The current moment. Today (the highlight, past days, past blocks and the now line) comes from it, whatever week is shown. */
  now: Date
  /** The display's IANA zone; events are placed on days and given times in it. */
  timeZone: string
  weekStart: 'monday' | 'sunday'
  /** The whole hours drawn in full, `from` inclusive to `to` exclusive (0 to 24). */
  hours: WeekHours
  /** Each event already carries its people. */
  events: CalendarEvent[]
}

export interface WeekDay {
  /** `YYYY-MM-DD`. */
  date: string
  /** 1 to 31. */
  day: number
  /** 0 to 6, from the week's first day. */
  column: number
  /** `Mon`. */
  weekday: string
  today: boolean
  /** Before today. */
  past: boolean
}

/** An all-day or multi-day event, or one piece of it: the part between hidden days. */
export interface AllDayBar extends ItemPeople {
  event: CalendarEvent
  /** 0 to `ALL_DAY_LANES - 1`. */
  lane: number
  /** The first column of this piece. */
  column: number
  /** Columns covered, at least 1. */
  span: number
  /** This piece starts on the event's first day: draw a round end. Otherwise it carries in from before the week or from behind a hidden lane. */
  roundStart: boolean
  /** This piece ends on the event's last day: draw a round end. */
  roundEnd: boolean
}

/** The "+N more" in a full day's last lane of the strip. */
export interface MoreLabel {
  column: number
  /** Always `ALL_DAY_LANES - 1`. */
  lane: number
  /** Bars on the day that are not drawn: those that would have been in the last lane or below it. */
  count: number
}

/** A timed event on a single day, placed on the hour scale. */
export interface TimedBlock extends ItemPeople {
  event: CalendarEvent
  column: number
  /** Minutes from the top of the full range (`hours.from * 60`), after clipping to it. At least 0, and `top + height` is at most `rangeMinutes`. */
  top: number
  /** Minutes. At least `MIN_BLOCK_MINUTES`, unless the end of the range cuts it short. */
  height: number
  /** Side by side: this block's track, from 0. Its left edge is `track / tracks` of the column and its width `1 / tracks`. */
  track: number
  /** The number of tracks in this block's overlap group. */
  tracks: number
  /** Starts before the full range: the view draws that edge square. */
  clippedStart: boolean
  /** Ends after the full range: the view draws that edge square. */
  clippedEnd: boolean
  /** `14:00`: the real start, even when clipped. */
  time: string
  /** `14:00–15:30`. */
  range: string
  /** Ended at or before now. */
  past: boolean
  /** On now: it has started and not ended. */
  ongoing: boolean
}

/** A timed event wholly inside a collapsed band. */
export interface BandItem extends ItemPeople {
  event: CalendarEvent
  /** `06:15`. */
  time: string
  /** Ended at or before now. */
  past: boolean
}

/** The hours folded away before the range, or after it. */
export interface Band {
  /** `00–07` for the early band, `21–24` for the late one: zero-padded hours and an en dash. */
  label: string
  /** One list per column (seven), by start time and then id. */
  items: BandItem[][]
}

/** Where now is, in today's column. */
export interface NowLine {
  column: number
  /** Minutes from the top of the full range, or the band that now falls in. */
  position: number | 'early' | 'late'
  /** `09:41`. */
  time: string
}

export interface WeekLayout {
  /**
   * The week in long month names, with an en dash and spaces: `5 – 11 October 2026`
   * in one month, `26 October – 1 November 2026` across two and
   * `28 December 2026 – 3 January 2027` across two years.
   */
  title: string
  /** Seven, in column order. */
  days: WeekDay[]
  /** The hour labels, `hours.from` to `hours.to - 1`. Each label sits at the top of its hour. */
  hours: number[]
  /** `(to - from) * 60`: the height of the hour scale, in minutes. */
  rangeMinutes: number
  allDay: {
    bars: AllDayBar[]
    more: MoreLabel[]
    /** The lanes actually used, 0 to `ALL_DAY_LANES`, so the view can shrink the strip when it is empty. */
    lanes: number
  }
  /** By column, then top, then track. */
  blocks: TimedBlock[]
  /** The hours before `hours.from`. `null` when `hours.from` is 0. */
  early: Band | null
  /** The hours from `hours.to`. `null` when `hours.to` is 24. */
  late: Band | null
  /** `null` unless today is one of the days shown. */
  now: NowLine | null
}

const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const clockFormatters = new Map<string, Intl.DateTimeFormat>()

/**
 * Minutes since midnight on the wall in `timeZone` at `instant` (ms). Read from
 * the wall clock rather than worked out from differences between instants, so a
 * day with a clock change still lines up with its hour labels.
 */
function wallMinutes(instant: number, timeZone: string): number {
  let formatter = clockFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    clockFormatters.set(timeZone, formatter)
  }
  let hours = 0
  let minutes = 0
  for (const part of formatter.formatToParts(new Date(instant))) {
    if (part.type === 'hour') hours = Number(part.value)
    if (part.type === 'minute') minutes = Number(part.value)
  }
  return (hours % 24) * 60 + minutes
}

const pad = (hour: number) => String(hour).padStart(2, '0')

/** `5 – 11 October 2026`, `26 October – 1 November 2026` or `28 December 2026 – 3 January 2027`, for the week's first and last dates. */
function weekTitle(first: string, last: string): string {
  const part = (date: string) => ({ year: date.slice(0, 4), month: MONTHS[Number(date.slice(5, 7)) - 1]!, day: String(Number(date.slice(8, 10))) })
  const a = part(first)
  const b = part(last)
  if (a.year !== b.year) return `${a.day} ${a.month} ${a.year} – ${b.day} ${b.month} ${b.year}`
  if (a.month !== b.month) return `${a.day} ${a.month} – ${b.day} ${b.month} ${b.year}`
  return `${a.day} – ${b.day} ${b.month} ${b.year}`
}

/** An event with the days it covers, worked out once. */
interface Placed {
  event: CalendarEvent
  span: EventSpan
}

/** A bar in the strip: its columns in the week (always next to each other) and the lane they share. */
interface BarPlan {
  placed: Placed
  columns: number[]
  lane: number
}

/** The strip: bars packed into lanes, "+N more" where a day is full, and bars split around the hidden cells. */
function layoutAllDay(days: WeekDay[], bars: Placed[]): WeekLayout['allDay'] {
  const taken: Set<number>[] = days.map(() => new Set())
  const lowestFree = (columns: number[]) => {
    let lane = 0
    while (columns.some(column => taken[column]!.has(lane))) lane++
    return lane
  }

  // By start, then longest first, then id: a week away sits above a single day. A bar keeps one lane across all of its columns.
  const plans: BarPlan[] = bars
    .filter(item => item.span.first <= days[6]!.date && item.span.last >= days[0]!.date)
    .sort((a, b) => a.span.first.localeCompare(b.span.first) || (b.span.end - b.span.start) - (a.span.end - a.span.start) || a.event.id - b.event.id)
    .map((placed) => {
      const columns = days.filter(day => placed.span.first <= day.date && day.date <= placed.span.last).map(day => day.column)
      const lane = lowestFree(columns)
      for (const column of columns) taken[column]!.add(lane)
      return { placed, columns, lane }
    })

  // A day with more than `ALL_DAY_LANES` bars, or one pushed below the last lane by packing, gives its last
  // lane to "+N more", which counts everything that is not drawn above it.
  const more: MoreLabel[] = []
  for (const day of days) {
    const lanes = [...taken[day.column]!]
    if (lanes.length > ALL_DAY_LANES || lanes.some(lane => lane >= ALL_DAY_LANES)) {
      more.push({ column: day.column, lane: ALL_DAY_LANES - 1, count: lanes.filter(lane => lane >= ALL_DAY_LANES - 1).length })
    }
  }
  const hasMore = new Set(more.map(label => label.column))
  const hidden = (column: number, lane: number) => hasMore.has(column) && lane >= ALL_DAY_LANES - 1

  // A bar is split around the days where its lane is hidden.
  const pieces: AllDayBar[] = plans.flatMap((plan) => {
    const { event, span } = plan.placed
    const visible: number[][] = []
    let current: number[] | null = null
    for (const column of plan.columns) {
      if (hidden(column, plan.lane)) {
        current = null
      } else if (current) {
        current.push(column)
      } else {
        current = [column]
        visible.push(current)
      }
    }
    return visible.map((columns): AllDayBar => ({
      event,
      lane: plan.lane,
      column: columns[0]!,
      span: columns.length,
      // Round only where the event itself starts or ends, not where it carries on or is cut.
      roundStart: days[columns[0]!]!.date === span.first,
      roundEnd: days[columns[columns.length - 1]!]!.date === span.last,
      ...itemPeople(event),
    }))
  }).sort((a, b) => a.lane - b.lane || a.column - b.column || a.event.id - b.event.id)

  const lanes = Math.min(ALL_DAY_LANES, Math.max(0, ...pieces.map(piece => piece.lane + 1), ...more.map(label => label.lane + 1)))
  return { bars: pieces, more, lanes }
}

/** A timed event before it is placed: its wall-clock minutes on its day. */
interface TimedPlan {
  event: CalendarEvent
  span: EventSpan
  column: number
  /** Minutes since midnight at the start. */
  start: number
  /** Minutes since midnight at the end, after the start (up to 1440). A zero-length event ends where it starts. */
  end: number
}

/** Side by side: gives each block in one column its track and the number of tracks in its overlap group. */
function assignTracks(blocks: TimedBlock[]): void {
  blocks.sort((a, b) => a.top - b.top || b.height - a.height || a.event.id - b.event.id)

  let group: TimedBlock[] = []
  let groupBottom = -Infinity
  let trackBottoms: number[] = []
  const close = () => {
    for (const block of group) block.tracks = trackBottoms.length
    group = []
    trackBottoms = []
    groupBottom = -Infinity
  }

  for (const block of blocks) {
    // Back to back is not overlapping: a group closes when the next block starts at or after everything so far has ended.
    if (group.length > 0 && block.top >= groupBottom) close()
    let track = trackBottoms.findIndex(bottom => bottom <= block.top)
    if (track === -1) track = trackBottoms.length
    trackBottoms[track] = block.top + block.height
    block.track = track
    group.push(block)
    groupBottom = Math.max(groupBottom, block.top + block.height)
  }
  close()
}

/** Lays out the week of `weekOf`: the strip, the blocks, the collapsed bands and the now line. */
export function weekLayout({ weekOf, now, timeZone, weekStart, hours, events }: WeekLayoutInput): WeekLayout {
  const today = todayIn(now, timeZone)
  const first = addDays(weekOf, -((dayOfWeek(weekOf) - (weekStart === 'monday' ? 1 : 0) + 7) % 7))
  const days = Array.from({ length: 7 }, (_, column): WeekDay => {
    const date = addDays(first, column)
    return { date, day: Number(date.slice(8, 10)), column, weekday: SHORT_WEEKDAYS[dayOfWeek(date)]!, today: date === today, past: date < today }
  })
  const columnOf = new Map(days.map(day => [day.date, day.column]))
  const rangeStart = hours.from * 60
  const rangeEnd = hours.to * 60
  const rangeMinutes = rangeEnd - rangeStart
  const nowInstant = now.getTime()

  // Which days an event is on is decided in event-days, the same as for the agenda and the month.
  // An all-day or overnight event is a bar; everything else is a timed event on its first day.
  const bars: Placed[] = []
  const timed: TimedPlan[] = []
  for (const event of events) {
    const span = eventSpan(event, timeZone)
    if (!span) continue
    if (event.all_day || span.first < span.last) {
      bars.push({ event, span })
      continue
    }
    const column = columnOf.get(span.first)
    if (column === undefined) continue

    const start = wallMinutes(span.start, timeZone)
    let end = wallMinutes(span.end, timeZone)
    // An end at midnight of the next day reads as 00:00, which is the end of this one. Any other end that is not
    // after the start (no length, or a clock change in between) is taken as no length.
    if (end === 0 && span.end > span.start) end = MINUTES_IN_DAY
    else if (end < start) end = start
    timed.push({ event, span, column, start, end })
  }

  const blocks: TimedBlock[] = []
  const bandItems = (): BandItem[][] => days.map(() => [])
  const early = bandItems()
  const late = bandItems()

  for (const item of timed) {
    const { event, span } = item
    const people = itemPeople(event)
    const time = formatTime(new Date(span.start), timeZone)
    const past = span.end <= nowInstant

    // Wholly before the range, or wholly after it: folded into a band. An event of no length at the first minute is in the range.
    if (item.end <= rangeStart && item.start < rangeStart) {
      early[item.column]!.push({ event, time, past, ...people })
      continue
    }
    if (item.start >= rangeEnd) {
      late[item.column]!.push({ event, time, past, ...people })
      continue
    }

    // Otherwise a block, cut to the range. A short one is drawn at least `MIN_BLOCK_MINUTES` long (from the cut, when cut at the top).
    const top = Math.max(item.start, rangeStart)
    const bottom = Math.min(top + Math.max(item.end - top, MIN_BLOCK_MINUTES), rangeEnd)
    blocks.push({
      event,
      column: item.column,
      top: top - rangeStart,
      height: bottom - top,
      track: 0,
      tracks: 1,
      clippedStart: item.start < rangeStart,
      clippedEnd: item.end > rangeEnd,
      time,
      range: `${time}–${formatTime(new Date(span.end), timeZone)}`,
      past,
      ongoing: span.start <= nowInstant && nowInstant < span.end,
      ...people,
    })
  }

  const ordered: TimedBlock[] = []
  for (const day of days) {
    const column = blocks.filter(block => block.column === day.column)
    assignTracks(column)
    ordered.push(...column)
  }

  const band = (label: string, items: BandItem[][]): Band => ({
    label,
    items: items.map(list => list.sort((a, b) => Date.parse(a.event.start) - Date.parse(b.event.start) || a.event.id - b.event.id)),
  })

  let nowLine: NowLine | null = null
  const todayColumn = columnOf.get(today)
  if (todayColumn !== undefined) {
    const minutes = wallMinutes(nowInstant, timeZone)
    nowLine = {
      column: todayColumn,
      position: minutes < rangeStart ? 'early' : minutes >= rangeEnd ? 'late' : minutes - rangeStart,
      time: formatTime(now, timeZone),
    }
  }

  return {
    title: weekTitle(days[0]!.date, days[6]!.date),
    days,
    hours: Array.from({ length: hours.to - hours.from }, (_, index) => hours.from + index),
    rangeMinutes,
    allDay: layoutAllDay(days, bars),
    blocks: ordered,
    early: hours.from === 0 ? null : band(`00–${pad(hours.from)}`, early),
    late: hours.to === 24 ? null : band(`${pad(hours.to)}–24`, late),
    now: nowLine,
  }
}
