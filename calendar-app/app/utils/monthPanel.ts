import type { PanelDay, PanelItem } from '../../shared/month-layout'

// What the month view's side panel shows of a day from `monthLayout`: its items,
// all-day first and then timed, trimmed to the rows the panel has room for.
// `monthLayout` leaves the panel untrimmed because how many rows fit belongs to
// the view. Pure: no Nuxt or Vue imports.

/** What fits under a day's heading at the size the wall draws it, counting the "+N more" row. */
export const MAX_PANEL_ROWS = 4

/** One row of a panel day. */
export interface PanelRow {
  item: PanelItem
  /** Today only: a timed event that has ended, drawn dimmed. */
  past: boolean
}

export interface FittedPanelDay {
  /** `YYYY-MM-DD`. */
  date: string
  /** `Today`, `Tomorrow`, then the weekday. */
  label: string
  /** At most `maxRows` including the "+N more" row, which is not one of these. */
  rows: PanelRow[]
  /** How many items did not fit and are summarised as "+N more". */
  more: number
}

/**
 * Trims `day` to `maxRows` rows, counting the "+N more" row. `isToday` is for
 * the first panel day only (the view passes `index === 0`): only today has
 * events that are over, which are those timed ones that ended at or before
 * `now`. When today overflows, past events go first, earliest first and
 * without a mention: they are the least use, and "+N more" is for what is
 * still to come, the same rule as the agenda (app/utils/agenda.ts). If that
 * isn't enough, one row becomes "+N more" and the last items go.
 */
export function fitPanelDay(day: PanelDay, now: Date, isToday: boolean, maxRows = MAX_PANEL_ROWS): FittedPanelDay {
  const limit = Math.max(1, Math.floor(maxRows))
  const nowMs = now.getTime()

  // An all-day item (no time) is never over, even if its event is a timed one covering the whole day.
  const rows: PanelRow[] = [...day.allDay, ...day.timed].map(item => ({
    item,
    past: isToday && item.time !== null && new Date(item.event.end).getTime() <= nowMs,
  }))
  const result = (shown: PanelRow[], more: number): FittedPanelDay => ({ date: day.date, label: day.label, rows: shown, more })

  const excess = rows.length - limit
  if (excess <= 0) return result(rows, 0)

  // Only as many past rows go as are needed, so the ones that can stay are still shown.
  const dropped = new Set(rows.filter(row => row.past).slice(0, excess))
  const kept = rows.filter(row => !dropped.has(row))
  if (excess <= dropped.size) return result(kept, 0)

  return result(kept.slice(0, limit - 1), kept.length - (limit - 1))
}
