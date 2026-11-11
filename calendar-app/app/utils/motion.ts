import type { Motion, View } from '../../shared/display'

// The rules for the wall's ambient motion (issue 75): slow, low contrast, and
// only while someone could be looking at it. Pure: no Nuxt or Vue imports, so
// the page and the views share one decision and a test can check it on its own.

/**
 * The brightness (percent) below which the wall counts as dimmed for the night
 * and nothing should move. The auto brightness curve's dark end is typically 30,
 * so a room that has gone dark is well under this, and a screen turned down by
 * hand to a comfortable 60 or so still has its motion.
 */
export const MOTION_MIN_BRIGHTNESS = 50

export interface MotionState {
  /** The display's `motion` setting. Undefined (settings cached from before it existed) counts as off. */
  motion: Motion | undefined
  /** The screen's power, from the display's state. */
  screen: 'on' | 'off'
  /** The view being shown. */
  view: View
  /** The display's brightness, 0 to 100. */
  brightness: number
}

/**
 * Whether ambient motion may run now: the display asks for it, the screen is on,
 * the night view is not showing and the wall has not been dimmed for the night.
 * Motion that is not allowed is paused where it is rather than undone, so a wall
 * that comes back in the morning carries on.
 */
export function motionRuns({ motion, screen, view, brightness }: MotionState): boolean {
  return motion === 'subtle' && screen === 'on' && view !== 'night' && brightness >= MOTION_MIN_BRIGHTNESS
}

/**
 * How far a drifting photo is scaled at its larger end: a few percent, so it is
 * barely noticed and yet is not static.
 */
export const DRIFT_SCALE = 1.04

/**
 * How far a drifting photo is panned at its larger end, as a percentage of its
 * own box. It is written after the scale, so it is measured in the scaled photo:
 * 1% of 1.04 is 1.04%, which is under the 2% of overscan the scale gives on each
 * side. An edge of the photo can therefore never come inside its box.
 */
export const DRIFT_PAN_PERCENT = 1

/** How many different drifts there are before they repeat. */
export const DRIFT_CYCLE = 4

/** The two `transform` values a photo drifts between, from the one at the start to the one at the end. */
export interface Drift {
  from: string
  to: string
}

const REST = 'scale(1)'
const zoomed = (x: -1 | 1, y: -1 | 1) => `scale(${DRIFT_SCALE}) translate(${x * DRIFT_PAN_PERCENT}%, ${y * DRIFT_PAN_PERCENT}%)`

/** The cycle: zoom in and zoom out in turn, and each towards or from a different corner. One end is always the photo as it is, so the cut at the end of a photo's life is never far from rest. */
const CYCLE: readonly Drift[] = [
  // In, towards the top left.
  { from: REST, to: zoomed(-1, -1) },
  // Out, from the bottom right.
  { from: zoomed(1, 1), to: REST },
  // In, towards the top right.
  { from: REST, to: zoomed(1, -1) },
  // Out, from the bottom left.
  { from: zoomed(-1, 1), to: REST },
]

/**
 * The drift for the `step`th photo shown: the same step always gives the same
 * drift, and neighbouring steps differ, so successive photos zoom the other way
 * and lean another way. A step that is not a whole number or is negative is
 * taken round the cycle all the same.
 */
export function photoDrift(step: number): Drift {
  const whole = Number.isFinite(step) ? Math.floor(step) : 0
  return CYCLE[((whole % DRIFT_CYCLE) + DRIFT_CYCLE) % DRIFT_CYCLE]!
}

/** The length of the photo frame's crossfade, in seconds. Keep it with `FADE_MS` in PhotoView.vue. */
export const CROSSFADE_SECONDS = 1.5

/** How long one drift lasts when the photo interval is not known. */
export const FALLBACK_DRIFT_SECONDS = 60

/**
 * The shortest a drift may last. The photo interval can be as short as 5 s, and
 * 4% of scale in 5 s would be seen as movement; over 20 s it is a slow creep.
 * A photo that is changed sooner than this is cut off part of the way, which
 * is not noticed at this size.
 */
export const MIN_DRIFT_SECONDS = 20

/**
 * How long one drift lasts: the photo interval plus the crossfade, so the photo
 * is still moving while it fades out beneath its successor and is never still
 * at the end. With no usable interval (an older server, or no answer yet) it is
 * `FALLBACK_DRIFT_SECONDS`, and never under `MIN_DRIFT_SECONDS`.
 */
export function driftSeconds(intervalSeconds: number | null | undefined): number {
  if (typeof intervalSeconds !== 'number' || !Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return FALLBACK_DRIFT_SECONDS
  return Math.max(MIN_DRIFT_SECONDS, intervalSeconds + CROSSFADE_SECONDS)
}
