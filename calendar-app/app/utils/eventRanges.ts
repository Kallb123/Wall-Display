import { addMonths } from '../../shared/display'
import type { MonthKey } from '../../shared/display'

// Which events the display asks for. Dates are `YYYY-MM-DD` strings and the
// arithmetic is on UTC dates, never the browser's local time, so the answer is
// the same wherever the page runs. Pure: no Nuxt or Vue imports.

/** A range for `GET /api/events`: `from` is included, `to` is not. Each is a date, which the server reads in the display's time zone. */
export interface DateRange {
  from: string
  to: string
}

/** The days either side of the month's own days that its grid can show. */
const GRID_DAYS_BEFORE = 7
const GRID_DAYS_AFTER = 14
/** How far ahead the side panel looks from today. */
const PANEL_DAYS = 7

/** `date` moved by `days` (negative for earlier). */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10)
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/** Today's date on a wall in `timeZone`. */
export function todayIn(now: Date, timeZone: string): string {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' })
    formatters.set(timeZone, formatter)
  }
  const fields: Record<string, string> = {}
  for (const part of formatter.formatToParts(now)) {
    if (part.type !== 'literal') fields[part.type] = part.value
  }
  return `${fields.year}-${fields.month}-${fields.day}`
}

/**
 * What to fetch to draw `shownMonth` with `today` beside it: the month's grid
 * (the week before its first day to two weeks after its last) and, if the grid
 * doesn't already cover them, the next days from today for the side panel.
 * A month pinned a year ahead needs both, and they are separate requests so
 * neither goes near the endpoint's 366-day limit.
 */
export function displayEventRanges(shownMonth: MonthKey, today: string): DateRange[] {
  const grid: DateRange = {
    from: addDays(`${shownMonth}-01`, -GRID_DAYS_BEFORE),
    to: addDays(`${addMonths(shownMonth, 1)}-01`, GRID_DAYS_AFTER),
  }
  const panel: DateRange = { from: today, to: addDays(today, PANEL_DAYS) }

  const covered = panel.from >= grid.from && panel.to <= grid.to
  return covered ? [grid] : [grid, panel]
}
