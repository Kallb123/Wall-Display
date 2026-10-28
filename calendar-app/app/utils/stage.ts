// The display is laid out once, on a fixed 2560×1440 stage, and scaled to fit
// the window (architecture §4.2). Pure: no Nuxt or Vue imports.

export const STAGE_WIDTH = 2560
export const STAGE_HEIGHT = 1440

/** The scale that fits the stage inside a `viewportWidth` × `viewportHeight` window, with black bars on the spare side. */
export function stageScale(viewportWidth: number, viewportHeight: number): number {
  return Math.min(viewportWidth / STAGE_WIDTH, viewportHeight / STAGE_HEIGHT)
}
