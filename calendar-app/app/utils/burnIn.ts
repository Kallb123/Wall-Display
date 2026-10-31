// Against burn-in and wear (architecture §4.2): the wall's content is nudged in
// a slow orbit, and the photo frame's pill walks round the corners. Both are
// worked out from the clock alone, so they are the same on every reload and a
// test can name the moment it wants. Whole pixels, so text stays sharp. Pure:
// no Nuxt or Vue imports.

/** How far the content strays from where it was laid out, in stage pixels: far enough to move the edges of every glyph, too little to see. */
export const ORBIT_RADIUS = 8
/** The orbit has this many resting places, evenly round the circle. */
const ORBIT_STEPS = 8
/** How long the content rests at each. A full orbit is 24 minutes. */
const ORBIT_STEP_MS = 3 * 60_000

/** Where to rest the content at `now`, as an offset from its usual place. Moves clockwise (y grows downwards), starting at the top. */
export function burnInOffset(now: Date): { x: number, y: number } {
  const step = Math.floor(now.getTime() / ORBIT_STEP_MS) % ORBIT_STEPS
  const angle = (step / ORBIT_STEPS) * 2 * Math.PI
  // `+ 0` turns a negative zero into a plain one.
  return { x: Math.round(ORBIT_RADIUS * Math.sin(angle)) + 0, y: Math.round(-ORBIT_RADIUS * Math.cos(angle)) + 0 }
}

/** The corners the photo frame's pill can sit in, in the order it visits them: clockwise. */
export type Corner = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left'

const CORNERS: readonly Corner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left']
/** How long the pill stays in a corner. */
const CORNER_MS = 15 * 60_000

/**
 * The corner the pill is in at `now`. While an overlay banner is showing (a
 * wide pill at the bottom centre, up to 2200 px across) a bottom corner would
 * run into it, so the pill takes the top corner on the same side instead.
 */
export function pillCorner(now: Date, options: { overlay: boolean }): Corner {
  const corner = CORNERS[Math.floor(now.getTime() / CORNER_MS) % CORNERS.length]!
  if (!options.overlay) return corner
  return corner === 'bottom-left' ? 'top-left' : corner === 'bottom-right' ? 'top-right' : corner
}
