import { ORBIT_RADIUS } from './burnIn'
import type { RoundedCorners } from './layouts'

// Against burn-in the page nudges everything on the stage a few pixels round a
// slow orbit (`burnInOffset`), and the strip that uncovers at an edge shows the
// stage's ground. Beside a calendar that is the colour the calendar is drawn on,
// and nobody sees it; beside a photo pane it is a line of the theme's ground
// down the edge of the screen. So a photo pane that touches the stage's edge
// draws its photo a little past it (the bleed), which the stage crops while the
// content is at rest and which fills the strip when it moves. Pure: no Nuxt or
// Vue imports.

/**
 * How far past the stage's edge a photo pane draws its photo, in stage pixels.
 * The orbit strays at most `ORBIT_RADIUS` along either axis, and the slide
 * between two of its points never further; this is twice that, as the page's
 * own fill for the full-screen photo is, so an edge part of the way through a
 * pixel is still photo on both sides.
 */
export const EDGE_BLEED = 2 * ORBIT_RADIUS

/** How far a pane draws past each of its sides, in stage pixels. */
export interface Bleed {
  top: number
  right: number
  bottom: number
  left: number
}

export const NO_BLEED: Bleed = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 })

/** Whether `bleed` reaches past any side at all. */
export function bleeds(bleed: Bleed | undefined): bleed is Bleed {
  return !!bleed && (bleed.top > 0 || bleed.right > 0 || bleed.bottom > 0 || bleed.left > 0)
}

/**
 * The bleed of a pane at `box` on a stage of `stage`'s size: `EDGE_BLEED` past
 * each side that lies on the stage's edge, and none past a side that meets
 * another pane. None at all while burn-in shifting is off, when nothing moves.
 */
export function edgeBleed(box: { x: number, y: number, width: number, height: number }, stage: { width: number, height: number }, burnIn: boolean): Bleed {
  if (!burnIn) return NO_BLEED
  return {
    top: box.y <= 0 ? EDGE_BLEED : 0,
    right: box.x + box.width >= stage.width ? EDGE_BLEED : 0,
    bottom: box.y + box.height >= stage.height ? EDGE_BLEED : 0,
    left: box.x <= 0 ? EDGE_BLEED : 0,
  }
}

/** The radius of a photo pane's rounded corners, in stage pixels: the week and photo view's, from its mock. */
export const PANE_RADIUS = 64

/**
 * The outline a photo pane of `width` × `height` is clipped to, as a CSS
 * `path()`, in the pane's own pixels: its box, pushed out by `bleed` on each
 * side, with the `rounded` corners rounded by `radius` where they are now. An
 * edge of the stage meets a rounded corner only on one of its sides (a corner
 * on the stage's edge both ways is square), and on that side the outline runs
 * on from the end of the curve, straight out to the bleed, so a corner touching
 * the top of the screen keeps its curve and the shift uncovers the ground beside
 * it, as it does beside the pane next door.
 */
export function paneClipPath(width: number, height: number, rounded: RoundedCorners, bleed: Bleed, radius = PANE_RADIUS): string {
  const { top: t, right: r, bottom: b, left: l } = bleed
  const W = width
  const H = height
  const R = radius
  const steps: string[] = []
  const line = (x: number, y: number) => steps.push(`${steps.length ? 'L' : 'M'} ${x} ${y}`)
  const arc = (x: number, y: number) => steps.push(`A ${R} ${R} 0 0 1 ${x} ${y}`)

  // Clockwise from the top left corner.
  if (rounded.topLeft) {
    line(-l, R)
    line(0, R)
    arc(R, 0)
    line(R, -t)
  } else line(-l, -t)
  if (rounded.topRight) {
    line(W - R, -t)
    line(W - R, 0)
    arc(W, R)
    line(W + r, R)
  } else line(W + r, -t)
  if (rounded.bottomRight) {
    line(W + r, H - R)
    line(W, H - R)
    arc(W - R, H)
    line(W - R, H + b)
  } else line(W + r, H + b)
  if (rounded.bottomLeft) {
    line(R, H + b)
    line(R, H)
    arc(0, H - R)
    line(-l, H - R)
  } else line(-l, H + b)
  return `path('${steps.join(' ')} Z')`
}
