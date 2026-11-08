import { addDays } from '../../shared/dates'
import { dayGridDays } from '../../shared/day-grid-layout'
import { addMonths } from '../../shared/display'
import { layoutDayGrids } from '../../shared/layouts'
import type { CustomLayoutInput, LayoutArrangement } from '../../shared/layouts'
import type { MonthKey, WeekKey } from '../../shared/display'

// Which events the display asks for. Dates are `YYYY-MM-DD` strings and the
// arithmetic is on UTC dates, never the browser's local time, so the answer is
// the same wherever the page runs. Pure: no Nuxt or Vue imports.

// The date helpers live in shared/ so the month layout can use them too; this
// keeps the imports the pages already have.
export { addDays, todayIn } from '../../shared/dates'

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

/**
 * What to fetch to draw `shownMonth` with `today` beside it: the month's grid
 * (the week before its first day to two weeks after its last) and, if the grid
 * doesn't already cover them, the next days from today for the side panel.
 * A month pinned a year ahead needs both, and they are separate requests so
 * neither goes near the endpoint's 366-day limit. With `shownWeek` (the week
 * view's first day), its seven days are asked for as well, unless the others
 * already cover them: a third request at most, for the same reason. Each of
 * `extra` (the day grids of a custom layout, `dayGridRanges`) is added in turn,
 * unless a range already asked for covers it.
 */
export function displayEventRanges(shownMonth: MonthKey, today: string, shownWeek?: WeekKey, extra: DateRange[] = []): DateRange[] {
  const grid: DateRange = {
    from: addDays(`${shownMonth}-01`, -GRID_DAYS_BEFORE),
    to: addDays(`${addMonths(shownMonth, 1)}-01`, GRID_DAYS_AFTER),
  }
  const panel: DateRange = { from: today, to: addDays(today, PANEL_DAYS) }

  const covered = panel.from >= grid.from && panel.to <= grid.to
  const ranges = covered ? [grid] : [grid, panel]
  if (shownWeek !== undefined) {
    const week: DateRange = { from: shownWeek, to: addDays(shownWeek, 7) }
    if (!covers(ranges, week)) ranges.push(week)
  }
  for (const range of extra) {
    if (!covers(ranges, range)) ranges.push(range)
  }
  return ranges
}

/** Whether one of `ranges` includes all of `range`. */
const covers = (ranges: readonly DateRange[], range: DateRange): boolean => ranges.some(other => range.from >= other.from && range.to <= other.to)

/**
 * The range the day grids of `layout` need, or an empty list when it has none:
 * from the first tile of any grid, in either arrangement, to the day after the
 * last tile of any grid. One range for all of them (a device is in one
 * orientation, but the layout may be turned), as the grids are small.
 */
export function dayGridRanges(layout: CustomLayoutInput | LayoutArrangement | null | undefined, today: string, weekStart: 'monday' | 'sunday'): DateRange[] {
  if (!layout) return []
  const days = layoutDayGrids(layout).map(grid => dayGridDays(grid, today, weekStart))
  if (days.length === 0) return []
  return [{ from: days.map(day => day.first).sort()[0]!, to: addDays(days.map(day => day.last).sort().at(-1)!, 1) }]
}
