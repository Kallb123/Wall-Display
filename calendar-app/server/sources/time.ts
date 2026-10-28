// Time zone maths for the sources, done with `Intl` alone so the answer never
// depends on the time zone of the process (a container is usually UTC, a
// laptop is not). Pure: no I/O.

import type { SyncWindow } from './types'

export interface WallTime {
  year: number
  /** 1 to 12. */
  month: number
  day: number
  hour?: number
  minute?: number
  second?: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

const unknownZones = new Set<string>()

/** True if `Intl` knows the name as a time zone (`Europe/London`, `UTC`, ...). */
export function isKnownTimeZone(timeZone: string): boolean {
  if (formatters.has(timeZone)) return true
  if (unknownZones.has(timeZone)) return false
  try {
    formatterFor(timeZone)
    return true
  } catch {
    // A feed chooses these names, so don't let it grow the set without end.
    if (unknownZones.size < 100) unknownZones.add(timeZone)
    return false
  }
}

/** The calendar and clock fields of an instant, as read on a wall in `timeZone`. */
export function wallTimeOf(instant: Date, timeZone: string): Required<WallTime> {
  const fields: Record<string, number> = {}
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') fields[part.type] = Number(part.value)
  }
  return {
    year: fields.year!,
    month: fields.month!,
    day: fields.day!,
    hour: fields.hour!,
    minute: fields.minute!,
    second: fields.second!,
  }
}

/**
 * What a zone's clocks did in one UTC year: the offset at the start of the
 * year, and each change after that. Asking `Intl` for an offset costs microseconds
 * and a sync asks thousands of times, so a year is read once and kept.
 */
interface YearOffsets {
  start: number
  changes: { at: number, offset: number }[]
}

const years = new Map<string, Map<number, YearOffsets>>()
const SAMPLE_MS = 7 * 24 * 60 * 60 * 1000

/** The zone's offset from UTC, in milliseconds, at an instant, from `Intl`. */
function readOffset(epochMs: number, timeZone: string): number {
  const whole = Math.floor(epochMs / 1000) * 1000
  const wall = wallTimeOf(new Date(whole), timeZone)
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - whole
}

function offsetsOfYear(year: number, timeZone: string): YearOffsets {
  let zone = years.get(timeZone)
  if (!zone) years.set(timeZone, zone = new Map())
  let cached = zone.get(year)
  if (!cached) {
    // Look once a week, then narrow any difference down to the second. A zone
    // doesn't change its clocks twice in a week and put them back.
    const from = Date.UTC(year, 0, 1)
    const last = Date.UTC(year + 1, 0, 1) - 1000 // the last whole second of the year
    const start = readOffset(from, timeZone)
    const changes: YearOffsets['changes'] = []
    let before = start
    let previous = from
    while (previous < last) {
      const sample = Math.min(previous + SAMPLE_MS, last)
      const after = readOffset(sample, timeZone)
      if (after !== before) {
        let low = previous // the offset `before` holds here
        let high = sample // the offset `after` holds here
        while (high - low > 1000) {
          const middle = low + Math.floor((high - low) / 2000) * 1000
          if (readOffset(middle, timeZone) === before) low = middle
          else high = middle
        }
        changes.push({ at: high, offset: after })
        before = after
      }
      previous = sample
    }
    cached = { start, changes }
    zone.set(year, cached)
  }
  return cached
}

/** The zone's offset from UTC, in milliseconds, at an instant. */
function offsetAt(epochMs: number, timeZone: string): number {
  const { start, changes } = offsetsOfYear(new Date(epochMs).getUTCFullYear(), timeZone)
  let offset = start
  for (const change of changes) {
    if (epochMs >= change.at) offset = change.offset
  }
  return offset
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The UTC instant at which the clocks in `timeZone` read `wall`. Fields may
 * overflow (month 13 is January of the next year) and are normalised.
 *
 * Twice a year the answer is not unique, and both cases are pinned by tests:
 * - A time the clocks skip (01:30 when 01:00 jumps to 02:00) is moved forward
 *   by the length of the gap, so it reads 02:30.
 * - A time the clocks show twice (01:30 when 02:00 falls back to 01:00) is the
 *   first of the two, before the change.
 */
export function zonedWallTimeToUtc(wall: WallTime, timeZone: string): Date {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour ?? 0, wall.minute ?? 0, wall.second ?? 0)
  // The offsets either side of the moment. Zones change offset at most once in
  // a day or two, so these are the offsets before and after any change near it.
  const before = offsetAt(asUtc - DAY_MS, timeZone)
  const after = offsetAt(asUtc + DAY_MS, timeZone)
  if (before === after) return new Date(asUtc - before)

  const early = asUtc - before
  const late = asUtc - after
  const earlyHolds = offsetAt(early, timeZone) === before
  const lateHolds = offsetAt(late, timeZone) === after
  if (earlyHolds && lateHolds) return new Date(Math.min(early, late))
  if (earlyHolds) return new Date(early)
  if (lateHolds) return new Date(late)
  // In the gap: the old offset puts the instant after the change, where the
  // clocks read the time shifted forward.
  return new Date(early)
}

/**
 * The window of whole months a sync keeps events for, in `timeZone`: from
 * local midnight on the 1st of the month `monthsBack` before the current one,
 * up to (not including) local midnight on the 1st of the month after the one
 * `monthsAhead` ahead.
 */
export function syncWindow(now: Date, timeZone: string, monthsBack: number, monthsAhead: number): SyncWindow {
  const { year, month } = wallTimeOf(now, timeZone)
  const current = year * 12 + (month - 1)
  const firstOfMonth = (monthIndex: number) =>
    zonedWallTimeToUtc({ year: Math.floor(monthIndex / 12), month: (monthIndex % 12) + 1, day: 1 }, timeZone)
  return {
    start: firstOfMonth(current - monthsBack),
    end: firstOfMonth(current + monthsAhead + 1),
  }
}
