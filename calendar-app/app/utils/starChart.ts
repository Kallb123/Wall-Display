// The star chart's sizes (PR 5.20), in px on the stage the view is laid out on.
// The view sets its CSS from these, so the capacity worked out here and what is
// drawn cannot drift apart. Pure: no Nuxt or Vue imports.

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
/** The progress row: star icons, or a bar with its "3 / 20" line. */
export const STAR_PROGRESS_HEIGHT = 48
/** One star icon in the progress row, and the gap between two. */
export const STAR_ICON_SIZE = 36
export const STAR_ICON_GAP = 6
/** The "+N" after the icons when more were earned than are shown. Room kept for it at the end of the row. */
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

/**
 * How many star icons fit in a progress row of `tileWidth`: the width inside
 * the card's padding, less room kept for the "+N", divided by an icon and its
 * gap. At least 1.
 */
export function starIconsThatFit(tileWidth: number): number {
  const room = tileWidth - 2 * STAR_TILE_PADDING - STAR_EXTRA_WIDTH
  return Math.max(1, Math.floor((room + STAR_ICON_GAP) / (STAR_ICON_SIZE + STAR_ICON_GAP)))
}

/**
 * How many icons the progress row draws for a person, and how many of them are
 * filled, and the "+N" that follows. With a goal of up to `STAR_ICONS_MAX_GOAL`
 * the row is the goal's length (as many as fit, if the card is narrower) and
 * the stars beyond the goal are the "+N"; with no goal the row is the earned
 * stars, up to what fits, then "+N" for the rest.
 */
export function starIconRow(total: number, goal: number | null, tileWidth: number): { icons: number, filled: number, extra: number } {
  const fit = starIconsThatFit(tileWidth)
  if (goal === null) {
    const icons = Math.min(total, fit)
    return { icons, filled: icons, extra: total - icons }
  }
  const icons = Math.min(goal, fit)
  const filled = Math.min(total, icons)
  // Stars past the goal are "+N"; a card too narrow for the whole goal counts the stars not drawn too, so the row never hides any.
  return { icons, filled, extra: total - filled }
}
