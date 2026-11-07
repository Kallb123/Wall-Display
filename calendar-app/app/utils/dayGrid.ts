// The day grid's sizes (architecture §4.8a), in px on the stage the view is laid
// out on. The view sets its CSS from these, so the capacity worked out here and
// what is drawn cannot drift apart. Pure: no Nuxt or Vue imports.

/** The space between the grid and the edge of the stage. */
export const DAY_GRID_PADDING = 24
/** The gap between tiles, both ways. */
export const DAY_GRID_GAP = 14
/** The padding inside a tile. */
export const DAY_TILE_PADDING = 18
/** A tile's head: the date and weekday over the "3 events" line. */
export const DAY_HEAD_HEIGHT = 98
/** Between the head and the first card. */
export const DAY_HEAD_GAP = 10
/** An event card: the title over the time. */
export const DAY_CARD_HEIGHT = 74
/** Between cards. */
export const DAY_CARD_GAP = 8
/** The "+N more" line. It is shorter than a card and takes the place of one, so it always fits. */
export const DAY_MORE_HEIGHT = 36

/** The height of one tile when `rows` of them share a stage of `stageHeight`. */
export function dayTileHeight(stageHeight: number, rows: number): number {
  return Math.max(0, (stageHeight - 2 * DAY_GRID_PADDING - (rows - 1) * DAY_GRID_GAP) / rows)
}

/** The width of one tile when `columns` of them share a stage of `stageWidth`. */
export function dayTileWidth(stageWidth: number, columns: number): number {
  return Math.max(0, (stageWidth - 2 * DAY_GRID_PADDING - (columns - 1) * DAY_GRID_GAP) / columns)
}

/**
 * How many lines (cards, or the "+N more" line in place of the last) a tile of
 * `tileHeight` holds under its head. At least 1: a tile always has the layout's
 * one line, and the tile clips what does not fit rather than letting it spill.
 */
export function dayGridCellItems(tileHeight: number): number {
  const room = tileHeight - 2 * DAY_TILE_PADDING - DAY_HEAD_HEIGHT - DAY_HEAD_GAP
  return Math.max(1, Math.floor((room + DAY_CARD_GAP) / (DAY_CARD_HEIGHT + DAY_CARD_GAP)))
}
