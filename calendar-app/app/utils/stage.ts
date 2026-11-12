import type { Orientation } from '../../shared/display'

// The display is laid out on a fixed stage and scaled to fit the window
// (architecture §4.2): 2560×1440 for landscape, or 1440×2560 for portrait. Which
// one a device gets is decided by the page (see pages/display.vue). Pure: no
// Nuxt or Vue imports.

/** Which of the two stages is in use. Not the same as the `Orientation` preference, which also has `auto`. */
export type StageOrientation = 'landscape' | 'portrait'

/** The landscape stage, which every view can be drawn on. */
export const STAGE_WIDTH = 2560
export const STAGE_HEIGHT = 1440

/** The size of the stage for `orientation`: the landscape one turned on its side for portrait. */
export function stageSize(orientation: StageOrientation): { width: number, height: number } {
  return orientation === 'portrait'
    ? { width: STAGE_HEIGHT, height: STAGE_WIDTH }
    : { width: STAGE_WIDTH, height: STAGE_HEIGHT }
}

/** The scale that fits the stage inside a `viewportWidth` × `viewportHeight` window, with black bars on the spare side. */
export function stageScale(viewportWidth: number, viewportHeight: number, orientation: StageOrientation = 'landscape'): number {
  const { width, height } = stageSize(orientation)
  return Math.min(viewportWidth / width, viewportHeight / height)
}

/**
 * How much of a side of the window may be left spare before the stage is
 * letterboxed, as a fraction of that side. A window that is nearly the stage's
 * shape (1366×768 and 1360×768 are sold as 16:9 and are not quite) would get
 * bars a pixel or two thick, or a fraction of one, which read as a gap at the
 * edge of the screen. Under this, the stage is stretched to fill instead, which
 * at 1% is not seen.
 */
export const STAGE_FILL_TOLERANCE = 0.01

/** How the stage is put in the window: its scale along each axis, and where its top left corner goes, in window pixels. */
export interface StageFit {
  scaleX: number
  scaleY: number
  x: number
  y: number
}

/**
 * Where the stage goes in a `viewportWidth` × `viewportHeight` window: scaled
 * to fit and centred, with its edges on whole pixels. The side that fits fills
 * the window exactly. The other is letterboxed, unless the bars would be
 * thinner than `STAGE_FILL_TOLERANCE`, when it fills the window too; a
 * letterboxed side is rounded to whole pixels, and so are its bars. An edge
 * part of the way through a pixel is drawn as a blend of the stage and what is
 * behind it, a thin line of the wrong colour along that edge. The two scales
 * differ by less than the tolerance, or by under a pixel over the whole stage.
 */
export function stageFit(viewportWidth: number, viewportHeight: number, orientation: StageOrientation = 'landscape'): StageFit {
  const { width, height } = stageSize(orientation)
  const scale = stageScale(viewportWidth, viewportHeight, orientation)
  const along = (viewport: number, size: number) => {
    const fitted = size * scale
    const length = viewport - fitted <= viewport * STAGE_FILL_TOLERANCE ? viewport : Math.round(fitted)
    return { scale: length / size, offset: Math.round((viewport - length) / 2) }
  }
  const across = along(viewportWidth, width)
  const down = along(viewportHeight, height)
  return { scaleX: across.scale, scaleY: down.scale, x: across.offset, y: down.offset }
}

/**
 * The orientation this device wants, from the preference and the window. `auto`
 * follows the window's shape, and a square window is landscape, the layout every
 * view has.
 */
export function deviceOrientation(preference: Orientation, viewportWidth: number, viewportHeight: number): StageOrientation {
  if (preference === 'auto') return viewportHeight > viewportWidth ? 'portrait' : 'landscape'
  return preference
}

/** The orientation named by `?orientation=` (the first, if given more than once), or null for none or one that is not an orientation. */
export function orientationQuery(value: unknown): Orientation | null {
  const first: unknown = Array.isArray(value) ? value[0] : value
  return first === 'auto' || first === 'landscape' || first === 'portrait' ? first : null
}
