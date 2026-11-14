import { describe, expect, it } from 'vitest'
import {
  STAR_BASE_HEIGHT, STAR_EXTRA_WIDTH, STAR_GRID_GAP, STAR_GRID_PADDING, STAR_HEAD_HEIGHT, STAR_ICON_GAP, STAR_ICON_MAX_SIZE, STAR_ICON_SIZE, STAR_ICONS_MAX_GOAL, STAR_SECTION_GAP, STAR_TILE_PADDING, STAR_TITLE_HEIGHT, STAR_WEEK_HEIGHT,
  starHeaderHeight, starIconGap, starIconGrid, starIconRow, starIconsThatFit, starProgressArea, starTileHeight, starTileWidth, starWeekFits, starsAsIcons,
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

describe('starProgressArea', () => {
  it('is the card inside its padding, under the head', () => {
    expect(starProgressArea(600, 400, false)).toEqual({
      width: 600 - 2 * STAR_TILE_PADDING,
      height: 400 - 2 * STAR_TILE_PADDING - STAR_HEAD_HEIGHT - STAR_SECTION_GAP,
    })
  })

  it('leaves room for the week strip when it is shown', () => {
    const without = starProgressArea(600, 600, false)
    const shown = starProgressArea(600, 600, true)

    expect(without.height - shown.height).toBe(STAR_SECTION_GAP + STAR_WEEK_HEIGHT)
    expect(shown.width).toBe(without.width)
  })

  it('is never negative', () => {
    expect(starProgressArea(10, 10, true)).toEqual({ width: 0, height: 0 })
  })
})

describe('starIconGap', () => {
  it('is a sixth of the icon, never under the minimum', () => {
    expect(starIconGap(STAR_ICON_SIZE)).toBe(STAR_ICON_GAP)
    expect(starIconGap(120)).toBe(20)
    expect(starIconGap(10)).toBe(STAR_ICON_GAP)
  })
})

describe('starIconGrid', () => {
  it('puts a few icons in one row in a wide, short box', () => {
    const grid = starIconGrid(5, 900, 100)

    expect(grid).toMatchObject({ perRow: 5, rows: 1 })
    expect(grid.size).toBe(100)
  })

  it('wraps into rows when a taller box makes the icons bigger', () => {
    // One row of ten is 82 wide icons at best; two rows of five reach 160 (the cap) in 900 x 400.
    const grid = starIconGrid(10, 900, 400)

    expect(grid).toMatchObject({ perRow: 5, rows: 2 })
    expect(grid.size).toBeGreaterThan(starIconGrid(10, 900, 100).size)
  })

  it('prefers fewer rows on a tie', () => {
    const grid = starIconGrid(2, 100, 100)

    expect(grid).toMatchObject({ perRow: 2, rows: 1 })
  })

  it('fits the icons and their gaps inside the box', () => {
    for (const [count, width, height] of [[7, 500, 300], [10, 412, 64], [3, 333, 777], [10, 1500, 700]] as const) {
      const { size, gap, perRow, rows } = starIconGrid(count, width, height)

      if (size > STAR_ICON_SIZE && size < STAR_ICON_MAX_SIZE) {
        expect(perRow * size + (perRow - 1) * gap).toBeLessThanOrEqual(width)
        expect(rows * size + (rows - 1) * gap).toBeLessThanOrEqual(height)
      }
      expect(perRow * rows).toBeGreaterThanOrEqual(count)
    }
  })

  it('clamps the size to the minimum and the maximum', () => {
    expect(starIconGrid(10, 100, 40).size).toBe(STAR_ICON_SIZE)
    expect(starIconGrid(1, 5000, 5000).size).toBe(STAR_ICON_MAX_SIZE)
    expect(starIconGrid(1, 5000, 5000).gap).toBe(starIconGap(STAR_ICON_MAX_SIZE))
  })

  it('is empty for no icons', () => {
    expect(starIconGrid(0, 500, 500)).toMatchObject({ perRow: 0, rows: 0 })
  })
})

describe('starIconsThatFit', () => {
  it('counts the whole icons across and down at the smallest size', () => {
    const width = 6 * STAR_ICON_SIZE + 5 * STAR_ICON_GAP
    const height = 2 * STAR_ICON_SIZE + STAR_ICON_GAP

    expect(starIconsThatFit({ width, height })).toBe(12)
    expect(starIconsThatFit({ width: width - 1, height })).toBe(10)
    expect(starIconsThatFit({ width, height: height - 1 })).toBe(6)
  })

  it('is at least 1', () => {
    expect(starIconsThatFit({ width: 0, height: 0 })).toBe(1)
  })

  it('holds a goal of ten on the smallest card, "+N" room kept', () => {
    const area = starProgressArea(MIN_STAR_TILE.width, MIN_STAR_TILE.height, false)

    expect(starIconsThatFit({ width: area.width - STAR_EXTRA_WIDTH, height: area.height })).toBeGreaterThanOrEqual(STAR_ICONS_MAX_GOAL)
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
  const area = { width: 900, height: 300 }

  it('draws the goal, fills what is earned and puts the rest past the goal in "+N"', () => {
    expect(starIconRow(3, 5, area)).toMatchObject({ icons: 5, filled: 3, extra: 0 })
    expect(starIconRow(7, 5, area)).toMatchObject({ icons: 5, filled: 5, extra: 2 })
  })

  it('sizes the icons to the area, bigger in a bigger one', () => {
    expect(starIconRow(0, 5, { width: 900, height: 300 }).size).toBeGreaterThan(STAR_ICON_SIZE)
    expect(starIconRow(0, 5, { width: 1800, height: 600 }).size).toBeGreaterThan(starIconRow(0, 5, area).size)
  })

  it('narrows the area by the "+N" room only when there is a "+N"', () => {
    const without = starIconRow(5, 5, { width: 400, height: 150 })
    const withExtra = starIconRow(6, 5, { width: 400, height: 150 })
    const narrowed = starIconGrid(5, 400 - STAR_EXTRA_WIDTH, 150)

    expect(withExtra.extra).toBe(1)
    expect(without.size).toBeGreaterThan(withExtra.size)
    expect(withExtra.size).toBe(narrowed.size)
  })

  it('draws only the earned stars with no goal, then "+N" past ten', () => {
    expect(starIconRow(0, null, area)).toMatchObject({ icons: 0, filled: 0, extra: 0 })
    expect(starIconRow(3, null, area)).toMatchObject({ icons: 3, filled: 3, extra: 0 })
    expect(starIconRow(14, null, area)).toMatchObject({ icons: STAR_ICONS_MAX_GOAL, filled: STAR_ICONS_MAX_GOAL, extra: 4 })
  })

  it('keeps the size with no goal as stars are earned', () => {
    const sizes = [0, 1, 3, 7, 10].map(total => starIconRow(total, null, area))

    expect(new Set(sizes.map(row => row.size)).size).toBe(1)
    expect(new Set(sizes.map(row => `${row.perRow}x${row.rows}`)).size).toBe(1)
    expect(sizes[0]!.size).toBe(starIconGrid(STAR_ICONS_MAX_GOAL, area.width, area.height).size)
  })

  it('never hides earned stars in an area too small for the whole goal', () => {
    const small = { width: 300, height: 60 }
    const fit = starIconsThatFit({ width: small.width - STAR_EXTRA_WIDTH, height: small.height })
    const row = starIconRow(9, 10, small)

    expect(row.icons).toBe(fit)
    expect(row.icons).toBeLessThan(10)
    expect(row.filled + row.extra).toBe(9)
  })

  it('counts every star with no goal in a small area', () => {
    const row = starIconRow(25, null, { width: 200, height: 60 })

    expect(row.icons + row.extra).toBe(25)
    expect(row.icons).toBeLessThan(STAR_ICONS_MAX_GOAL)
  })
})
