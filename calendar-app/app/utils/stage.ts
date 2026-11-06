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
