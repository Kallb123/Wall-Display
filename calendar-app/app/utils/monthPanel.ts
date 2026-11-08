import type { ItemPeople, PanelDay, PanelItem, WeekRow } from '../../shared/month-layout'

// What the month view's side panel shows of a day from `monthLayout`: its items,
// all-day first and then timed, trimmed to the rows the panel has room for.
// `monthLayout` leaves the panel untrimmed because how many rows fit belongs to
// the view. Pure: no Nuxt or Vue imports.

/** What fits under a day's heading at the size the wall draws it, counting the "+N more" row. */
export const MAX_PANEL_ROWS = 4

/**
 * What fits in the portrait month's band beside today's date (PR 5.12),
 * counting the "+N more" row, found by measuring: the band is as tall as the
 * taller of its two columns, and with seven 40 px rows 14 px apart the events
 * column (364 px, in 44 px of padding above and 47 below) makes it 464 px, which
 * is about what the date, weekday, weather and high and low need on the left
 * (mock 4a). That leaves the five weeks 289 px tiles, in which six lanes get
 * their full 34 px. Each row further adds 54 px to the band and takes about 11 px
 * from every tile, which the lanes would have to give up. With a takeover's
 * greeting the band is about 522 px, the tiles 278 px and the lanes 31.8 px:
 * test/visual/portrait.spec.ts checks that six still fit and nothing is cut.
 */
export const PORTRAIT_TODAY_ROWS = 7

/**
 * What fits in each of the portrait month's three cards under the weeks (PR
 * 5.12), counting the "+N more" row, found by measuring: the strip is 284 px
 * tall (mock 4a), and with 30 px of padding, a heading of about 40 px and 32 px
 * rows 14 px apart, four rows end 4 px above the padding at the bottom (a fifth
 * overflows by about 42 px). test/visual/portrait.spec.ts checks that a full card
 * cuts no row.
 */
export const PORTRAIT_STRIP_ROWS = 4

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

/** The badges an item gets: its first people, as many as the layout kept initials for. Keyed by person, as two can share an initial. */
export function badgesOf(item: ItemPeople): { id: string, initial: string, colour: string }[] {
  return item.initials.map((initial, index) => ({ id: item.people[index]!.id, initial, colour: item.people[index]!.colour }))
}

/** The most lanes an item may take when its title wraps: its own and two below. */
export const MAX_WRAP_LANES = 3

/** How many lanes each of a week's bars and timed rows may take (1 to `MAX_WRAP_LANES`), in the order of `bars` and `timed`. */
export interface LaneSpans {
  bars: number[]
  timed: number[]
}

/**
 * For the month grid's "wrap long titles" (architecture §4.8): a bar or timed
 * row may run down into the lanes directly below it when, in every column it
 * covers, that lane has nothing in it (no bar, no timed row, no "+N more") and
 * is still one of the layout's `lanes`. Since an item only takes lanes below its
 * own, and anything further down in its columns stops it, two items never take
 * the same lane. The view draws an item that spans more than one lane as tall as
 * its title needs, up to the lanes it was given, so a short title looks as it
 * always did.
 */
export function laneSpans(week: Pick<WeekRow, 'bars' | 'timed' | 'more'>, lanes: number, cap = MAX_WRAP_LANES): LaneSpans {
  const taken = new Set<string>()
  const key = (lane: number, column: number) => `${lane}:${column}`
  for (const bar of week.bars) for (let column = bar.column; column < bar.column + bar.span; column++) taken.add(key(bar.lane, column))
  for (const row of week.timed) taken.add(key(row.lane, row.column))
  for (const more of week.more) taken.add(key(more.lane, more.column))

  const spanOf = (lane: number, column: number, width: number): number => {
    let span = 1
    while (span < cap && lane + span < lanes) {
      const next = lane + span
      let free = true
      for (let offset = 0; offset < width; offset++) free &&= !taken.has(key(next, column + offset))
      if (!free) break
      span++
    }
    return span
  }

  return {
    bars: week.bars.map(bar => spanOf(bar.lane, bar.column, bar.span)),
    timed: week.timed.map(row => spanOf(row.lane, row.column, 1)),
  }
}
