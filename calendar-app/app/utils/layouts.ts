import type { DayGrid, LayoutArrangement, LayoutComponent } from '../../shared/layouts'
import type { Corner } from './burnIn'
import type { Stage } from './views'

// The geometry of a custom layout (PR 5.17, architecture §4.8): where each pane
// goes on the stage, and how a view component is fitted to a pane that may be
// smaller than the component was designed for. Pure: no Nuxt or Vue imports.

/** Which corners of a pane are rounded: the ones that are not corners of the stage. */
export interface RoundedCorners {
  topLeft: boolean
  topRight: boolean
  bottomRight: boolean
  bottomLeft: boolean
}

/** One pane placed on the stage, in whole pixels. */
export interface PaneBox {
  component: LayoutComponent
  x: number
  y: number
  width: number
  height: number
  /** Only the photo frame uses it: a card on the stage has its inner corners rounded, as the week and photo view's does. */
  rounded: RoundedCorners
  /** Only the day grid has one: copied from the pane. */
  grid?: DayGrid
}

/** Splits `total` into whole-pixel lengths in proportion to `weights`; the last takes the remainder so they tile exactly. */
function split(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  const lengths: number[] = []
  let used = 0
  let weightSoFar = 0
  weights.forEach((weight, index) => {
    weightSoFar += weight
    // Rounding the running total, so the error never builds up, and the last edge is the stage's.
    const end = index === weights.length - 1 ? total : Math.round(total * weightSoFar / sum)
    lengths.push(end - used)
    used = end
  })
  return lengths
}

/**
 * The panes of an arrangement on a stage. Rows share the stage's height by
 * their weights and the panes of a row share its width by theirs, with no gaps
 * (the views have their own padding), and the last row and pane take the
 * remainder so everything tiles exactly. A corner is rounded unless both of its
 * edges lie on the stage's border, which makes a photo pane above the week
 * round its lower corners, as the week and photo view does.
 */
export function layoutPanes(arrangement: LayoutArrangement, stage: { width: number, height: number }): PaneBox[] {
  const heights = split(stage.height, arrangement.rows.map(row => row.size))
  const boxes: PaneBox[] = []
  let y = 0
  arrangement.rows.forEach((row, rowIndex) => {
    const widths = split(stage.width, row.panes.map(pane => pane.size))
    const height = heights[rowIndex]!
    let x = 0
    row.panes.forEach((pane, paneIndex) => {
      const width = widths[paneIndex]!
      const top = y === 0
      const left = x === 0
      const right = x + width === stage.width
      const bottom = y + height === stage.height
      boxes.push({
        component: pane.component,
        x,
        y,
        width,
        height,
        rounded: { topLeft: !(top && left), topRight: !(top && right), bottomRight: !(bottom && right), bottomLeft: !(bottom && left) },
        ...(pane.grid && { grid: pane.grid }),
      })
      x += width
    })
    y += height
  })
  return boxes
}

/** The size a component is designed for in one orientation: below it, the component is drawn at this size and scaled down. */
interface Minimum {
  width: number
  height: number
}

/**
 * The design minimum of each component, per layout orientation: the smallest
 * box its view lays out without clipping or overflowing, found by rendering
 * them. A pane smaller than this is drawn at the minimum and scaled down. The
 * photo frame has none: it draws to any box, and the day grid's depends on its
 * grid instead (`MIN_DAY_TILE`).
 */
export const COMPONENT_MINIMUMS: Record<Exclude<LayoutComponent, 'photo' | 'days'>, Record<'landscape' | 'portrait', Minimum>> = {
  month: { landscape: { width: 2200, height: 1300 }, portrait: { width: 1300, height: 2300 } },
  week: { landscape: { width: 1800, height: 1000 }, portrait: { width: 1000, height: 1200 } },
  week_parts: { landscape: { width: 1700, height: 1000 }, portrait: { width: 1100, height: 1400 } },
  agenda: { landscape: { width: 2400, height: 1350 }, portrait: { width: 1300, height: 2300 } },
}

/** The smallest a day grid's tile is drawn at: a pane with more tiles than fit at this size is drawn on a bigger stage and scaled down. */
export const MIN_DAY_TILE: Minimum = { width: 320, height: 240 }

/** The week's wide layout needs this much width; a narrower box gets the seven-column one, as the week and photo view's pane does. */
export const WEEK_WIDE_MIN_WIDTH = 1800

/** How a component is drawn in a pane: the virtual stage it lays out on, and the factor that shrinks that to the pane (1 for no shrinking). */
export interface PaneFit {
  stage: Stage
  scale: number
}

/**
 * Picks the orientation a component draws in for a box, and the virtual stage
 * it is drawn on. A box taller than wide asks for portrait; so does the week
 * when it is narrower than `WEEK_WIDE_MIN_WIDTH`. A box at least as big as the
 * component's minimum is drawn at its real size; a smaller one is drawn on a
 * stage of the box's shape that is just big enough, and shrunk uniformly. The
 * day grid has no minimum of its own: its tiles are what must not get too
 * small, so its minimum is `grid.rows` by `grid.columns` tiles of `MIN_DAY_TILE`
 * (without a grid, one tile, which is only a safe fallback).
 */
export function paneFit(component: LayoutComponent, box: { width: number, height: number }, grid?: DayGrid): PaneFit {
  const narrowWeek = component === 'week' && box.width < WEEK_WIDE_MIN_WIDTH
  const orientation = box.height > box.width || narrowWeek ? 'portrait' : 'landscape'
  if (component === 'photo') return { stage: { width: box.width, height: box.height, orientation }, scale: 1 }
  if (component === 'days') {
    const scale = Math.min(1, box.width / ((grid?.columns ?? 1) * MIN_DAY_TILE.width), box.height / ((grid?.rows ?? 1) * MIN_DAY_TILE.height))
    return { stage: { width: Math.round(box.width / scale), height: Math.round(box.height / scale), orientation: box.height > box.width ? 'portrait' : 'landscape' }, scale }
  }
  const minimum = COMPONENT_MINIMUMS[component][orientation]
  const scale = Math.min(1, box.width / minimum.width, box.height / minimum.height)
  return {
    stage: { width: Math.round(box.width / scale), height: Math.round(box.height / scale), orientation },
    scale,
  }
}

/**
 * Whether the photo frame's pill, when it is in `corner`, is at the stage's top
 * right corner: a photo pane touches that corner and the pill is in its top
 * right. The offline badge sits there too, and moves aside.
 */
export function photoPillAtTopRight(panes: readonly PaneBox[], stageWidth: number, corner: Corner): boolean {
  return corner === 'top-right' && panes.some(pane => pane.component === 'photo' && pane.y === 0 && pane.x + pane.width === stageWidth)
}
