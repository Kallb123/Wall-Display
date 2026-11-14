import type { OverlayCorner, ResolvedPaneOptions } from '../../shared/layouts'
import { dodgeOverlay } from './burnIn'
import type { Corner } from './burnIn'

// Where the photo frame's overlays go (PR 5.21): the time (with the weather
// beside it, and on the full-screen frame the next event below it), the date and
// today's forecast, each in a corner of the pane that the layout chose, or in the corner the page
// walks round against burn-in (`auto`). Overlays in the same corner share one
// pill, the time's line first, then the date, then the forecast. A chosen bottom corner gives way to the overlay
// banner, at the bottom centre, as the walking one does, by taking the top
// corner on the same side. Pure: no Nuxt or Vue imports.

/** One pill of the photo frame: the corner it is in and what it holds. */
export interface PhotoPill {
  corner: Corner
  /** The time's line: the clock if `show_time`, the weather if `show_weather` (and the next event, on the full-screen frame, with the clock). */
  time: boolean
  /** The date's line. */
  date: boolean
  /** Today's forecast by part of the day. */
  forecast: boolean
}

const ORDER: readonly Corner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left']

/** The corner an overlay set to `corner` is in: the walking one for `auto` (the page has already moved it out of the banner's way), else the chosen one, out of the banner's way. */
export function overlayCorner(corner: OverlayCorner, walking: Corner, overlay: boolean): Corner {
  return corner === 'auto' ? walking : dodgeOverlay(corner, overlay)
}

/**
 * The pills the photo frame draws with `options`, at most one per corner, in
 * clockwise order from the top left. None when every overlay is off.
 */
export function photoPills(options: Pick<ResolvedPaneOptions, 'show_time' | 'show_date' | 'show_weather' | 'show_forecast' | 'time_corner' | 'date_corner' | 'forecast_corner'>, walking: Corner, overlay: boolean): PhotoPill[] {
  const pills = new Map<Corner, PhotoPill>()
  const place = (corner: Corner, part: 'time' | 'date' | 'forecast') => {
    const pill = pills.get(corner) ?? { corner, time: false, date: false, forecast: false }
    pill[part] = true
    pills.set(corner, pill)
  }
  if (options.show_time || options.show_weather) place(overlayCorner(options.time_corner, walking, overlay), 'time')
  if (options.show_date) place(overlayCorner(options.date_corner, walking, overlay), 'date')
  if (options.show_forecast) place(overlayCorner(options.forecast_corner, walking, overlay), 'forecast')
  return ORDER.flatMap(corner => pills.get(corner) ?? [])
}
