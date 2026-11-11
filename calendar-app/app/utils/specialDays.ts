import { DEFAULT_TAKEOVER_ART } from '../../shared/display'
import type { Preview, TakeoverArtPlace, View } from '../../shared/display'
import { layoutShowsCalendar } from '../../shared/layouts'
import type { LayoutSummary } from '../../shared/layouts'
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
  /** The layout the custom view shows, if it is the view: a custom view is taken over only if its layout has a calendar component in it. */
  layout?: LayoutSummary | null
}

/**
 * The takeover to draw, or null. It takes over a calendar view only, never the
 * photo frame or night view (a custom layout counts as a calendar view if it
 * shows any calendar component; its photo pane is never covered). Outside a
 * preview it must be for today: a resolution the wall has had since yesterday
 * (cached, or the server's midnight message is late) must not outlive its
 * midnight, so the page compares the dates itself. A preview is the server's
 * word for a date that isn't today.
 */
export function takeoverInForce({ resolution, view, today, previewing, layout }: TakeoverContext): Takeover | null {
  const takeover = resolution?.takeover ?? null
  const calendar = view === 'custom' ? !!layout && layoutShowsCalendar(layout) : isCalendarView(view)
  if (!takeover || !calendar) return null
  return previewing || takeover.date === today ? takeover : null
}

/** A takeover's art for one stage: the backdrop (always behind the view), the full art and the day's extra layer over it, each null for none. */
export interface StageArt {
  backdrop: string | null
  full: string | null
  extra: string | null
}

/**
 * The takeover's art for the stage it is drawn on: the landscape cuts on a
 * landscape stage, the portrait ones on a portrait stage, each null for none.
 * Never the other shape's, which cropped to fit wouldn't hold up, so a portrait
 * wall whose day has no portrait art shows none. (`?? null` for a resolution
 * cached before the portrait art or the backdrops, which has no such field.)
 */
export function takeoverArt(takeover: Takeover | null, orientation: 'landscape' | 'portrait'): StageArt {
  if (!takeover) return { backdrop: null, full: null, extra: null }
  return orientation === 'portrait'
    ? { backdrop: takeover.backdrop_art_portrait ?? null, full: takeover.full_art_portrait ?? null, extra: takeover.extra_art_portrait ?? null }
    : { backdrop: takeover.backdrop_art ?? null, full: takeover.full_art, extra: takeover.extra_art }
}

/**
 * Whether the takeover's art (the full art and the extra layer; never the
 * backdrop, which is always behind) goes over the view rather than behind it,
 * by the display's `takeover_art` and the stage's shape. Behind, the view's solid
 * panels hide most of it, which on the portrait stage is nearly all of it;
 * over, the whole picture shows and the view shows through its clear parts.
 * (`behind` for settings cached before `takeover_art` existed.)
 */
export function takeoverArtOver(place: TakeoverArtPlace | undefined, orientation: 'landscape' | 'portrait'): boolean {
  const chosen = place ?? DEFAULT_TAKEOVER_ART
  return chosen === 'over' || (chosen === 'over_in_portrait' && orientation === 'portrait')
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
