import type { Component } from 'vue'
import { eventFill } from './eventFill'
import { fitPanelDay } from './monthPanel'
import type { FittedPanelDay } from './monthPanel'
import { tileArt } from './specialDays'
import { paletteAccent, personFill, tileTint } from './themes'
import { formatHighLow, weatherIcon } from './weather'
import type { DayCell } from '../../shared/month-layout'
import type { SpecialDaysResolution } from '../../shared/special-days'
import { forecastOn, formatTemperature, weatherOn } from '../../shared/weather'
import type { WeatherSnapshot } from '../../shared/weather'

// The sums and styles behind the Soft month view (MonthSoftView and the pieces
// in components/views/month): where the tiles are on the stage, what a day's
// tile is tinted, and the inline style of a bar or a timed row in the grid.
// Pure: no Nuxt or Vue state, so they can be tested without mounting anything.

/** The grid's outer padding and the gap between its columns (px), as in the view's styles. */
export const VIEW_PADDING = 48
export const SIDE_COLUMN = 640
export const VIEW_GAP = 48
export const TILE_GAP = 14
/** Below this tile width (px) the weather beside the date is the icon alone; the portrait stage's tiles are about 180 and the landscape stage's about 240. */
export const COMPACT_TILE_WIDTH = 220
/** Below this tile width (px) there is no room for even the icon beside the day number, so none is drawn. */
export const MIN_TILE_WIDTH = 120

/** How wide a day's tile is (px) on a stage `stageWidth` wide: the grid is the stage less its padding, and less the side column when that sits at its left (landscape with the sidebar). */
export function tileWidthOn(stageWidth: number, portrait: boolean, showSidebar: boolean): number {
  const side = !portrait && showSidebar ? SIDE_COLUMN + VIEW_GAP : 0
  const grid = stageWidth - 2 * VIEW_PADDING - side
  return (grid - 6 * TILE_GAP) / 7
}

/** What a decorated date has: the first day's id and accent (they set the tint) and every day's art, side by side. */
export interface Decoration {
  id: string
  accent: string
  art: string[]
}

export type Decorations = Map<string, Decoration>

export function decorationsOf(tiles: SpecialDaysResolution['tiles']): Decorations {
  return new Map(tiles.flatMap(({ date, days }) => {
    const first = days[0]
    return first ? [[date, { id: first.id, accent: paletteAccent(first.palette), art: tileArt(days) }] as const] : []
  }))
}

/** A tile's background: today's own, the month's, or the neighbouring months'; with a special day's tint mixed into it. */
export function tileBackground(cell: DayCell, decorated: Decorations): string {
  const base = cell.today ? 'var(--today-cell)' : cell.inMonth ? 'var(--tile)' : 'var(--tile-out)'
  const special = decorated.get(cell.date)
  return special ? tileTint(special.accent, base) : base
}

export function numberColours(cell: DayCell): { background: string, color: string } {
  if (cell.today) return { background: 'var(--today-num-bg)', color: 'var(--today-num-fg)' }
  return { background: 'transparent', color: cell.inMonth ? 'var(--text)' : 'var(--faint)' }
}

/** The mark in a day's date row: an icon and/or a high. */
export interface CellWeather {
  icon: Component | null
  text: string | null
}

/** The mark in a day's date row: the icon and the high (the high is left out when the tiles are compact); null for a day that is over or has no forecast, or where the art of a special day holds that end of the row. */
export function cellWeatherOf(date: string, weather: WeatherSnapshot | null, today: string, options: { shown: boolean, compact: boolean, hasArt: boolean }): CellWeather | null {
  if (!options.shown || options.hasArt) return null
  const day = forecastOn(weather, date, today)
  if (!day) return null
  const icon = weatherIcon(day.condition)
  const text = options.compact || day.high === null ? null : formatTemperature(day.high)
  return icon || text ? { icon, text } : null
}

/** A panel day's icon and `14° / 8°`, either of which can be missing; null when the forecast has neither. */
export function dayWeatherOf(weather: WeatherSnapshot | null, date: string): CellWeather | null {
  const day = weatherOn(weather, date)
  if (!day) return null
  return { icon: weatherIcon(day.condition), text: formatHighLow(day) }
}

/** A fitted panel day with its forecast: what the panel's days and the strip's cards draw. */
export type PanelDayView = FittedPanelDay & { weather: CellWeather | null }

/** A panel day trimmed to the rows that fit, with its forecast. */
export function panelDayView(day: Parameters<typeof fitPanelDay>[0], now: Date, isToday: boolean, weather: WeatherSnapshot | null, maxRows?: number): PanelDayView {
  return { ...fitPanelDay(day, now, isToday, maxRows), weather: dayWeatherOf(weather, day.date) }
}

/** `October`, from the month itself: the shown month is not always the one `now` is in. */
export function monthNameOf(month: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long' }).format(new Date(`${month}-01T00:00:00Z`))
}

/** A bar's fill. With nobody on it (no person matched) it is the surface colour and has no badge. */
export const monthBarFill = (colour: string | null): string => colour ? personFill(colour) : 'var(--surface)'

/** The grid row of an item on `lane`: its own, or, when its title may wrap, that and the free ones below it. */
export const monthLaneRow = (lane: number, span = 1) => span > 1 ? `${lane + 2} / span ${span}` : lane + 2

export function monthBarStyle(bar: { colour: string | null, column: number, span: number, lane: number, roundStart: boolean, roundEnd: boolean }, lanes = 1) {
  // A bar that may be several lines tall would be a half-circle at each end with 999px, so its ends are a lane's half height.
  const round = lanes > 1 ? '17px' : '999px'
  const start = bar.roundStart ? round : '8px'
  const end = bar.roundEnd ? round : '8px'
  return {
    'gridColumn': `${bar.column + 1} / span ${bar.span}`,
    'gridRow': monthLaneRow(bar.lane, lanes),
    // A round end sits in from the tile's edge; a square one runs on into its neighbour.
    'margin': `0 ${bar.roundEnd ? '8px' : '0'} 0 ${bar.roundStart ? '8px' : '0'}`,
    'borderRadius': `${start} ${end} ${end} ${start}`,
    'background': monthBarFill(bar.colour),
    '--ring': monthBarFill(bar.colour),
    ...(lanes > 1 ? { '--lines': lanes } : {}),
  }
}

/** A timed row in the grid: its place, and with "colour whole events" (`fillEvents`) the pill a bar has. Otherwise it is bare on the tile, ringed in `tile`, the colour of the tile it is on. */
export function monthTimedStyle(row: { people: readonly { colour: string }[], column: number, lane: number }, tile: string, fillEvents: boolean, lanes = 1) {
  const place = { gridColumn: row.column + 1, gridRow: monthLaneRow(row.lane, lanes), ...(lanes > 1 ? { '--lines': lanes } : {}) }
  if (!fillEvents) return { ...place, '--ring': tile }
  const { background, ring } = eventFill(row.people)
  return {
    ...place,
    // In from the tile's edge like a bar's round end, so the badge sits where it does on a bar.
    margin: '0 8px',
    borderRadius: lanes > 1 ? '17px' : '999px',
    background,
    '--ring': ring,
  }
}
