import type { Preview, View } from '../../shared/display'
import type { SpecialDaysResolution, Takeover, TileDecoration } from '../../shared/special-days'
import { isCalendarView } from './views'

// What the display decides about special days from the resolution the server
// sent (architecture §6.5). The server works out the dates; the page only
// decides what is in force right now, and so never shows a takeover past its
// midnight. Pure: no Nuxt or Vue imports.

/** The hour of the day (wall time) from which tomorrow's art is preloaded. */
export const PRELOAD_FROM_HOUR = 18

/** Whether it is `PRELOAD_FROM_HOUR` or later in `timeZone`. */
export function isEvening(now: Date, timeZone: string): boolean {
  // hourCycle h23, so midnight is 0 and not 24, whatever the locale does.
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now)
  return Number(hour) >= PRELOAD_FROM_HOUR
}

/**
 * A preview that is still running, or null. The server clears a preview at its
 * `until`, but a wall running from its cache while the server is out of reach
 * would otherwise keep one for ever.
 */
export function activePreview(preview: Preview | null, now: Date): Preview | null {
  return preview && new Date(preview.until).getTime() > now.getTime() ? preview : null
}

/** What to ask `GET /api/special-days/preview` for. */
export function previewQuery(preview: Preview): { special_day: string } | { scene: string } {
  return 'special_day' in preview ? { special_day: preview.special_day } : { scene: preview.scene }
}

/** Two previews of the same day or scene have the same key, even if the second was started later and ends later. */
export function previewKey(preview: Preview | null): string | null {
  if (!preview) return null
  return 'special_day' in preview ? `special_day:${preview.special_day}` : `scene:${preview.scene}`
}

export interface TakeoverContext {
  /** The resolution being shown: the preview's while previewing, otherwise the socket's or the cache's. */
  resolution: SpecialDaysResolution | null
  view: View
  /** Today in the display's time zone, or null until the settings have arrived. */
  today: string | null
  previewing: boolean
}

/**
 * The takeover to draw, or null. It takes over a calendar view only, never the
 * photo frame or night view. Outside a preview it must be for today: a resolution
 * the wall has had since yesterday (cached, or the server's midnight message is
 * late) must not outlive its midnight, so the page compares the dates itself.
 * A preview is the server's word for a date that isn't today.
 */
export function takeoverInForce({ resolution, view, today, previewing }: TakeoverContext): Takeover | null {
  const takeover = resolution?.takeover ?? null
  if (!takeover || !isCalendarView(view)) return null
  return previewing || takeover.date === today ? takeover : null
}

/** The art files of a tile's decorations, in the order they are drawn. Not every decoration has some. */
export function tileArt(days: readonly TileDecoration[]): string[] {
  return days.flatMap(day => day.tile_art ?? [])
}

/**
 * The font size for a greeting in the side panel, in px. The longest greeting
 * the editor allows (80 characters) would take five lines at the full size of
 * 56 px and push the day's events off the panel, so a longer one is set smaller.
 */
export function greetingSize(greeting: string): number {
  if (greeting.length <= 28) return 56
  if (greeting.length <= 52) return 46
  return 38
}
