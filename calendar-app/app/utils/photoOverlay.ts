import type { OverlayCorner, ResolvedPaneOptions } from '../../shared/layouts'
import { dodgeOverlay } from './burnIn'
import type { Corner } from './burnIn'

// Where the photo frame's overlays go (PR 5.21): the time (with the weather
// beside it, and on the full-screen frame the next event below it), the date and
// today's forecast, each in a corner of the pane that the layout chose, or in the corner the page
// walks round against burn-in (`auto`). Overlays in the same corner share one
// pill, the time's line first, then the date, then the forecast. A chosen bottom corner gives way to the overlay
// banner, at the bottom centre, as the walking one does, by taking the top
// corner on the same side. Pills in the two corners of one edge (top left and
// top right, or bottom left and bottom right) that sit close, or overlap, would
// leave a thin sliver of photo between them; `joinedEdges` says which edges that
// is true of, and the view then draws them as one continuous bar. Joining is only
// how it looks: the corners themselves, and the walking one, are as `photoPills`
// has them. Pure: no Nuxt or Vue imports.

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

/** A side of the pane that can carry a joined bar. */
export type PillEdge = 'top' | 'bottom'

/**
 * The widest gap, in stage pixels, between the left and right pill of one edge
 * that still reads as a mistake and not as two separate overlays. The pills' own
 * side padding is 96 px (44 + 52), so a gap narrower than about that and a half
 * looks like the pills were meant to touch and just missed; wider, and the photo
 * between them reads as deliberate. Layout sizes, not scaled ones.
 */
export const PILL_JOIN_GAP = 160

/**
 * The edges whose two corner pills should be drawn joined. An edge is joined when
 * it has a pill in both its left and its right corner and the gap between them, the pane's
 * width less `inset` on each side and less the two pills' widths, is under
 * `PILL_JOIN_GAP`. Pills that overlap (a negative gap) count as joined. Widths are
 * in layout pixels. In the order top, bottom.
 */
export function joinedEdges(pills: readonly { corner: Corner, width: number }[], paneWidth: number, inset: number): PillEdge[] {
  const widthAt = (corner: Corner) => pills.find(pill => pill.corner === corner)?.width
  return (['top', 'bottom'] as const).filter((edge) => {
    const left = widthAt(`${edge}-left`)
    const right = widthAt(`${edge}-right`)
    if (left === undefined || right === undefined) return false
    return paneWidth - 2 * inset - left - right < PILL_JOIN_GAP
  })
}
