import { describe, expect, it } from 'vitest'
import {
  STAR_BASE_HEIGHT, STAR_EXTRA_WIDTH, STAR_GRID_GAP, STAR_GRID_PADDING, STAR_ICON_GAP, STAR_ICON_SIZE, STAR_ICONS_MAX_GOAL, STAR_SECTION_GAP, STAR_TILE_PADDING, STAR_TITLE_HEIGHT, STAR_WEEK_HEIGHT,
  starHeaderHeight, starIconRow, starIconsThatFit, starTileHeight, starTileWidth, starWeekFits, starsAsIcons,
} from '../../../app/utils/starChart'
import { MIN_STAR_TILE } from '../../../app/utils/layouts'

describe('starTileHeight and starTileWidth', () => {
  it('share the stage less the padding, the header and the gaps', () => {
    expect(starTileHeight(1440, 2)).toBe((1440 - 2 * STAR_GRID_PADDING - STAR_GRID_GAP) / 2)
    expect(starTileHeight(1440, 2, STAR_TITLE_HEIGHT)).toBe((1440 - 2 * STAR_GRID_PADDING - STAR_TITLE_HEIGHT - STAR_GRID_GAP) / 2)
    expect(starTileWidth(2560, 4)).toBe((2560 - 2 * STAR_GRID_PADDING - 3 * STAR_GRID_GAP) / 4)
  })

  it('are never negative', () => {
    expect(starTileHeight(10, 6, STAR_TITLE_HEIGHT)).toBe(0)
    expect(starTileWidth(10, 6)).toBe(0)
  })

  it('leave out the header when the title is hidden', () => {
    expect(starHeaderHeight(true)).toBe(STAR_TITLE_HEIGHT)
    expect(starHeaderHeight(false)).toBe(0)
  })
})

describe('starWeekFits', () => {
  const needed = STAR_BASE_HEIGHT + STAR_SECTION_GAP + STAR_WEEK_HEIGHT

  it('needs room for the head, the progress row and the strip', () => {
    expect(starWeekFits(needed)).toBe(true)
    expect(starWeekFits(needed - 1)).toBe(false)
  })

  it('is false on the smallest card, which is head and progress only', () => {
    expect(starWeekFits(MIN_STAR_TILE.height)).toBe(false)
    expect(MIN_STAR_TILE.height).toBeGreaterThanOrEqual(STAR_BASE_HEIGHT)
  })
})

describe('starIconsThatFit', () => {
  it('counts the icons and gaps in the width inside the padding, less the "+N"', () => {
    const width = 2 * STAR_TILE_PADDING + STAR_EXTRA_WIDTH + 6 * STAR_ICON_SIZE + 5 * STAR_ICON_GAP

    expect(starIconsThatFit(width)).toBe(6)
    expect(starIconsThatFit(width - 1)).toBe(5)
  })

  it('is at least 1', () => {
    expect(starIconsThatFit(0)).toBe(1)
  })

  it('holds a goal of ten on the smallest card', () => {
    expect(starIconsThatFit(MIN_STAR_TILE.width)).toBeGreaterThanOrEqual(STAR_ICONS_MAX_GOAL)
  })
})

describe('starsAsIcons', () => {
  it('is icons for no goal and for a goal up to the limit, and a bar beyond it', () => {
    expect(starsAsIcons(null)).toBe(true)
    expect(starsAsIcons(STAR_ICONS_MAX_GOAL)).toBe(true)
    expect(starsAsIcons(STAR_ICONS_MAX_GOAL + 1)).toBe(false)
  })
})

describe('starIconRow', () => {
  it('draws the goal, fills what is earned and puts the rest past the goal in "+N"', () => {
    expect(starIconRow(3, 5, 800)).toEqual({ icons: 5, filled: 3, extra: 0 })
    expect(starIconRow(7, 5, 800)).toEqual({ icons: 5, filled: 5, extra: 2 })
  })

  it('draws only the earned stars with no goal, up to what fits, then "+N"', () => {
    const fit = starIconsThatFit(540)

    expect(starIconRow(0, null, 540)).toEqual({ icons: 0, filled: 0, extra: 0 })
    expect(starIconRow(3, null, 540)).toEqual({ icons: 3, filled: 3, extra: 0 })
    expect(starIconRow(fit + 4, null, 540)).toEqual({ icons: fit, filled: fit, extra: 4 })
  })

  it('never hides earned stars in a card too narrow for the whole goal', () => {
    const fit = starIconsThatFit(300)
    const row = starIconRow(9, 10, 300)

    expect(row.icons).toBe(fit)
    expect(row.filled + row.extra).toBe(9)
  })
})
