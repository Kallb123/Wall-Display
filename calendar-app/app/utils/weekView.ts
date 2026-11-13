import type { Component } from 'vue'
import { personFill } from './themes'
import { MAX_BADGE_INITIALS, shortWeekRange } from '../../shared/week-layout'
import type { AllDayBar, TimedBlock, WeekLayout } from '../../shared/week-layout'
import type { ItemPeople } from '../../shared/month-layout'
import { currentWeek, weekDiff } from '../../shared/display'

// The sums behind the Soft week view's drawing (`WeekView` and its parts under
// `components/views/week/`): sizes, inline styles and the few bits of text that
// are worked out from the layout. `weekLayout` decides what goes where; this
// turns that into pixels and percentages. No Vue in here, so it can be tested.

/** The height of a lane in the all-day strip, and the gap between lanes (px). Used for the strip's rows. */
export const LANE = 34
export const LANE_GAP = 5

/** Below this many minutes a block has room for one line only: the time and the title side by side. */
export const ONE_LINE_MINUTES = 50

/** The now pill sits over the gutter, so an hour label within this many minutes of it is hidden rather than overlapped. */
export const NOW_CLEARANCE = 25

/** The cells of a band show the first item and a "+N" for the rest. */
export const BAND_SHOWN = 1

/** The gap between side-by-side blocks, and at the tile's edge (px). Less in the narrow portrait columns. */
export const blockGapFor = (portrait: boolean): number => portrait ? 4 : 6

/** The badges an item gets: its first people, as many as the layout kept initials for. Keyed by person, as two can share an initial. */
export function weekBadgesOf(item: ItemPeople): { id: string, initial: string, colour: string }[] {
  return item.initials.slice(0, MAX_BADGE_INITIALS).map((initial, index) => ({ id: item.people[index]!.id, initial, colour: item.people[index]!.colour }))
}

/** An event's fill. With nobody on it (no person matched) it is the surface colour and has no badge. */
export const weekFillOf = (colour: string | null): string => colour ? personFill(colour) : 'var(--surface)'

export function weekBarStyle(bar: AllDayBar) {
  const start = bar.roundStart ? '999px' : '8px'
  const end = bar.roundEnd ? '999px' : '8px'
  return {
    'gridColumn': `${bar.column + 1} / span ${bar.span}`,
    'gridRow': bar.lane + 1,
    // A round end sits in from the tile's edge; a square one runs on into its neighbour.
    'margin': `0 ${bar.roundEnd ? '8px' : '0'} 0 ${bar.roundStart ? '8px' : '0'}`,
    'borderRadius': `${start} ${end} ${end} ${start}`,
    'background': weekFillOf(bar.colour),
    '--ring': weekFillOf(bar.colour),
  }
}

export function weekBlockStyle(block: TimedBlock, rangeMinutes: number) {
  // The corner that was cut by the range is square; the others are rounded.
  const top = block.clippedStart ? '6px' : '14px'
  const bottom = block.clippedEnd ? '6px' : '14px'
  return {
    'top': `${block.top / rangeMinutes * 100}%`,
    'height': `${block.height / rangeMinutes * 100}%`,
    'left': `${block.track / block.tracks * 100}%`,
    'width': `${100 / block.tracks}%`,
    'borderRadius': `${top} ${top} ${bottom} ${bottom}`,
    'background': weekFillOf(block.colour),
    '--ring': weekFillOf(block.colour),
  }
}

/** Where a position falls on the hour scale, as a percentage of its height. */
export const percentOf = (minutes: number, rangeMinutes: number): string => `${minutes / rangeMinutes * 100}%`

/** Whether the now pill would overlap the hour label at `minutes`. */
export function coveredByNow(position: number | 'early' | 'late' | undefined, minutes: number): boolean {
  return typeof position === 'number' && Math.abs(position - minutes) < NOW_CLEARANCE
}

/** The rows of the grid, top to bottom: heading, strip, early band, hours, late band. The strip and the bands take no room when empty. */
export function gridRowsOf(layout: Pick<WeekLayout, 'allDay' | 'early' | 'late'>, portrait: boolean, anyWeather: boolean): string {
  const strip = layout.allDay.lanes
  return [
    portrait ? (anyWeather ? '112px' : '68px') : (anyWeather ? '116px' : '72px'),
    strip ? `${strip * LANE + (strip - 1) * LANE_GAP + 14}px` : '0px',
    layout.early ? '48px' : '0px',
    'minmax(0, 1fr)',
    layout.late ? '48px' : '0px',
  ].join(' ')
}

/** `26 October – 1 November` and `2026`, so the year can be muted as in the month's title. A title that spans two years keeps the first one in the text. */
export function splitTitle(title: string): { range: string, year: string } {
  const match = /^(.*) (\d{4})$/.exec(title)
  return match ? { range: match[1]!, year: match[2]! } : { range: title, year: '' }
}

/** The pane's title: `26 Oct – 1 Nov` and, muted, "This week", "Next week", "Last week" or else the year of the week's first day. */
export function paneTitle(first: string, last: string, now: Date, timeZone: string, weekStart: 'monday' | 'sunday'): { range: string, label: string } {
  const range = shortWeekRange(first, last)
  const offset = weekDiff(currentWeek(now, timeZone, weekStart), first)
  const label = offset === 0 ? 'This week' : offset === 1 ? 'Next week' : offset === -1 ? 'Last week' : first.slice(0, 4)
  return { range, label }
}

/** A day's forecast as the heading draws it: an icon and `14° / 8°`, either of which can be missing. */
export interface DayForecast {
  icon: Component | null
  text: string | null
}
