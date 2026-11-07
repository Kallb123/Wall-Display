import { describe, expect, it } from 'vitest'
import {
  DAY_CARD_GAP, DAY_CARD_HEIGHT, DAY_GRID_GAP, DAY_GRID_PADDING, DAY_HEAD_GAP, DAY_HEAD_HEIGHT, DAY_MORE_HEIGHT, DAY_TILE_PADDING,
  dayGridCellItems, dayTileHeight, dayTileWidth,
} from '../../../app/utils/dayGrid'
import { MAX_DAY_GRID_ROWS } from '../../../shared/layouts'

describe('dayTileHeight and dayTileWidth', () => {
  it('share the stage less the padding and the gaps', () => {
    expect(dayTileHeight(1440, 2)).toBe((1440 - 2 * DAY_GRID_PADDING - DAY_GRID_GAP) / 2)
    expect(dayTileWidth(2560, 4)).toBe((2560 - 2 * DAY_GRID_PADDING - 3 * DAY_GRID_GAP) / 4)
    expect(dayTileHeight(1440, 1)).toBe(1440 - 2 * DAY_GRID_PADDING)
  })

  it('are never negative', () => {
    expect(dayTileHeight(10, 6)).toBe(0)
    expect(dayTileWidth(10, 7)).toBe(0)
  })
})

describe('dayGridCellItems', () => {
  /** The height of a tile holding `n` lines exactly. */
  const holding = (n: number) => 2 * DAY_TILE_PADDING + DAY_HEAD_HEIGHT + DAY_HEAD_GAP + n * DAY_CARD_HEIGHT + (n - 1) * DAY_CARD_GAP

  it('counts the cards that fit under the head', () => {
    for (const n of [1, 2, 3, 6]) {
      expect(dayGridCellItems(holding(n))).toBe(n)
      expect(dayGridCellItems(holding(n) - 1)).toBe(Math.max(1, n - 1))
      expect(dayGridCellItems(holding(n) + DAY_CARD_HEIGHT)).toBe(n)
    }
  })

  it('is at least 1, even for a tile with no room', () => {
    expect(dayGridCellItems(0)).toBe(1)
    expect(dayGridCellItems(100)).toBe(1)
  })

  it('fits the cards, or the cards and the shorter "+N more" line, into the tile for every grid on both stages', () => {
    expect(DAY_MORE_HEIGHT).toBeLessThanOrEqual(DAY_CARD_HEIGHT)
    for (const stage of [1440, 2560]) {
      for (let rows = 1; rows <= MAX_DAY_GRID_ROWS; rows++) {
        const tile = dayTileHeight(stage, rows)
        const items = dayGridCellItems(tile)
        const used = 2 * DAY_TILE_PADDING + DAY_HEAD_HEIGHT + DAY_HEAD_GAP + items * DAY_CARD_HEIGHT + (items - 1) * DAY_CARD_GAP
        // Only a tile too short for a single card (the minimum tile is scaled up to 240 by paneFit) may exceed itself, and then it clips.
        if (items > 1) expect(used).toBeLessThanOrEqual(tile)
      }
    }
  })
})
