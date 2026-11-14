// The star chart's sizes (PR 5.20), in px on the stage the view is laid out on.
// The view sets its CSS from these, so the capacity worked out here and what is
// drawn cannot drift apart. Pure: no Nuxt or Vue imports.
//
// The progress area is whatever is left of a card under its head (and above the
// week strip, when it is shown). Star icons scale to fill it: for a count of
// icons, `starIconGrid` tries every number of rows, sizes the icon so that
// layout just fits the area, and keeps the layout with the biggest icons (fewer
// rows on a tie), between `STAR_ICON_SIZE` and `STAR_ICON_MAX_SIZE`. A goal
// sizes for the goal; no goal sizes for `STAR_ICONS_MAX_GOAL` slots whatever
// has been earned, so earning a star does not resize the rest, and draws only the
// earned ones. A "+N" takes `STAR_EXTRA_WIDTH` off the right of the area, but only
// when there is one. When even the smallest icons do not all fit, the row draws
// what does and the rest is counted in the "+N", so it never hides a star.

/** The space between the grid (or the header above it) and the edge of the stage. */
export const STAR_GRID_PADDING = 24
/** The gap between cards, both ways. */
export const STAR_GRID_GAP = 14
/** The padding inside a card. */
export const STAR_TILE_PADDING = 22
/** The header above the grid: "Stars" and the week it is for. Shown only when the pane's `show_title` is on. */
export const STAR_TITLE_HEIGHT = 84
/** A card's head: the initial circle, the name and the total. */
export const STAR_HEAD_HEIGHT = 84
/** Between the head and the progress row, and between the progress row and the week strip. */
export const STAR_SECTION_GAP = 16
/** The least height the progress area has: the bar with room around it, and the smallest row of icons. */
export const STAR_PROGRESS_HEIGHT = 48
/** The smallest a star icon is drawn, and the least gap between two. */
export const STAR_ICON_SIZE = 36
export const STAR_ICON_GAP = 6
/** The biggest a star icon is drawn, so a lone star on a huge card is not absurd. */
export const STAR_ICON_MAX_SIZE = 160
/** The gap between the icons (or the bar) and the "+N". */
export const STAR_PROGRESS_GAP = 14
/** The "+N" after the icons when more were earned than are shown, with the gap before it. Room kept for it at the end of the area. */
export const STAR_EXTRA_WIDTH = 70
/** The week strip: weekday initial over the day's count. */
export const STAR_WEEK_HEIGHT = 96
/** The most star icons the progress row draws for a goal; a bigger goal gets a bar instead. */
export const STAR_ICONS_MAX_GOAL = 10

/** The height of one card when `rows` of them share a stage of `stageHeight`, under a header of `headerHeight` (0 when there is none). */
export function starTileHeight(stageHeight: number, rows: number, headerHeight = 0): number {
  return Math.max(0, (stageHeight - 2 * STAR_GRID_PADDING - headerHeight - (rows - 1) * STAR_GRID_GAP) / rows)
}

/** The width of one card when `columns` of them share a stage of `stageWidth`. */
export function starTileWidth(stageWidth: number, columns: number): number {
  return Math.max(0, (stageWidth - 2 * STAR_GRID_PADDING - (columns - 1) * STAR_GRID_GAP) / columns)
}

/** The header's height: `STAR_TITLE_HEIGHT` when the title is shown, else 0. */
export const starHeaderHeight = (showTitle: boolean): number => showTitle ? STAR_TITLE_HEIGHT : 0

/** The height a card needs for its head and progress row alone. */
export const STAR_BASE_HEIGHT = 2 * STAR_TILE_PADDING + STAR_HEAD_HEIGHT + STAR_SECTION_GAP + STAR_PROGRESS_HEIGHT

/** Whether a card of `tileHeight` has room under its progress row for the week strip. A shorter card is head and progress only. */
export function starWeekFits(tileHeight: number): boolean {
  return tileHeight >= STAR_BASE_HEIGHT + STAR_SECTION_GAP + STAR_WEEK_HEIGHT
}

/** Whether the progress is star icons (a goal of `STAR_ICONS_MAX_GOAL` or fewer, or no goal) and not a bar. */
export const starsAsIcons = (goal: number | null): boolean => goal === null || goal <= STAR_ICONS_MAX_GOAL

/** The gap between star icons of `size`: a sixth of the icon, never under `STAR_ICON_GAP` (a whole px, so the maths and the CSS agree). */
export const starIconGap = (size: number): number => Math.max(STAR_ICON_GAP, Math.floor(size / 6))

/** A box the progress area gives its icons, in px. */
export interface StarArea { width: number, height: number }

/**
 * The space a card of `tileWidth` by `tileHeight` leaves for its progress
 * area: the height under the head (and above the week strip when `showWeek`),
 * and the width inside the padding. Never negative. The "+N" room is not taken
 * off here; the icon row does it when there is a "+N".
 */
export function starProgressArea(tileWidth: number, tileHeight: number, showWeek: boolean): StarArea {
  const week = showWeek ? STAR_SECTION_GAP + STAR_WEEK_HEIGHT : 0
  return {
    width: Math.max(0, tileWidth - 2 * STAR_TILE_PADDING),
    height: Math.max(0, tileHeight - 2 * STAR_TILE_PADDING - STAR_HEAD_HEIGHT - STAR_SECTION_GAP - week),
  }
}

/**
 * The icon size and layout for `count` icons in a `width` by `height` box: of
 * every row count from 1 to `count` (`perRow` = count / rows, rounded up), the
 * one whose icons come out biggest, fewer rows on a tie. An icon is
 * `size` with a gap of `starIconGap(size)` between two, floored to a whole px,
 * and clamped to `STAR_ICON_SIZE`..`STAR_ICON_MAX_SIZE` (so in a box too small
 * the layout overflows it; `starIconsThatFit` is what keeps the count honest).
 */
export function starIconGrid(count: number, width: number, height: number): { size: number, gap: number, perRow: number, rows: number } {
  if (count <= 0) return { size: STAR_ICON_SIZE, gap: starIconGap(STAR_ICON_SIZE), perRow: 0, rows: 0 }
  let best = { size: -1, perRow: count, rows: 1 }
  for (let rows = 1; rows <= count; rows++) {
    const perRow = Math.ceil(count / rows)
    // With gap = size / 6 the row is size * (perRow + (perRow - 1) / 6) wide, and the same down the box. Flooring the size keeps the floored gap inside it.
    const byWidth = width / (perRow + (perRow - 1) / 6)
    const byHeight = height / (rows + (rows - 1) / 6)
    const size = Math.floor(Math.min(byWidth, byHeight))
    if (size > best.size) best = { size, perRow, rows }
  }
  const size = Math.min(STAR_ICON_MAX_SIZE, Math.max(STAR_ICON_SIZE, best.size))
  return { size, gap: starIconGap(size), perRow: best.perRow, rows: best.rows }
}

/**
 * How many icons fit in `area` at the smallest size: whole icons across and
 * down, with the minimum gap. At least 1.
 */
export function starIconsThatFit(area: StarArea): number {
  const across = Math.max(1, Math.floor((area.width + STAR_ICON_GAP) / (STAR_ICON_SIZE + STAR_ICON_GAP)))
  const down = Math.max(1, Math.floor((area.height + STAR_ICON_GAP) / (STAR_ICON_SIZE + STAR_ICON_GAP)))
  return across * down
}

/** What the progress area draws for icons: how many, how many filled, the "+N", and the layout (`size`, `gap`, `perRow`, `rows`). */
export interface StarIconRow { icons: number, filled: number, extra: number, size: number, gap: number, perRow: number, rows: number }

/** The row for `total` stars in a box exactly `area`: sized for `slots` icons (at most what fits), the goal's or, with no goal, a stable ten. */
function iconRowIn(total: number, goal: number | null, area: StarArea): StarIconRow {
  const slots = Math.min(goal ?? STAR_ICONS_MAX_GOAL, starIconsThatFit(area))
  const grid = starIconGrid(slots, area.width, area.height)
  // The goal is drawn whole, its earned ones filled; with no goal only the earned ones are drawn, so the grid sizes for ten slots but may hold fewer.
  const icons = goal === null ? Math.min(total, slots) : slots
  const filled = Math.min(total, icons)
  // Stars past the goal are "+N"; a card too small for the whole goal counts the stars not drawn too, so the row never hides any.
  return { icons, filled, extra: total - filled, ...grid }
}

/**
 * The icons the progress area draws for a person: how many, how many of them
 * are filled, the "+N" that follows, and the size and layout to draw them at.
 * With a goal of up to `STAR_ICONS_MAX_GOAL` the row is the goal's length (as
 * many as fit, if the area is small) and the stars beyond the goal are the
 * "+N"; with no goal it is the earned stars, up to ten, sized for ten so it
 * stays put as stars come in. Icons fill the area; when there is a "+N", the
 * area is first narrowed by `STAR_EXTRA_WIDTH` and the icons are sized again.
 */
export function starIconRow(total: number, goal: number | null, area: StarArea): StarIconRow {
  const whole = iconRowIn(total, goal, area)
  if (whole.extra === 0) return whole
  return iconRowIn(total, goal, { width: Math.max(0, area.width - STAR_EXTRA_WIDTH), height: area.height })
}
