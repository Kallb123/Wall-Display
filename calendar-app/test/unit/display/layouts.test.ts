import { describe, expect, it } from 'vitest'
import type { LayoutArrangement } from '../../../shared/layouts'
import { COMPONENT_MINIMUMS, MIN_DAY_TILE, MONTH_MINIMUMS_NO_SIDEBAR, layoutPanes, paneFit, photoPillAtTopRight } from '../../../app/utils/layouts'
import { stageFor, weekPhotoPanes } from '../../../app/utils/views'

const LANDSCAPE = { width: 2560, height: 1440 }
const PORTRAIT = { width: 1440, height: 2560 }

type Pane = LayoutArrangement['rows'][number]['panes'][number]

const row = (size: number, ...panes: [Pane['component'], number][]) => ({
  size,
  panes: panes.map(([component, paneSize]) => ({ component, size: paneSize })),
})

describe('layoutPanes', () => {
  it('splits a row by the panes\' weights', () => {
    const boxes = layoutPanes({ rows: [row(1, ['photo', 1], ['week', 2], ['agenda', 1])] }, LANDSCAPE)

    expect(boxes.map(({ component, x, width, y, height }) => [component, x, width, y, height])).toEqual([
      ['photo', 0, 640, 0, 1440],
      ['week', 640, 1280, 0, 1440],
      ['agenda', 1920, 640, 0, 1440],
    ])
  })

  it('splits the height by the rows\' weights', () => {
    const boxes = layoutPanes({ rows: [row(2, ['month', 1]), row(1, ['agenda', 1])] }, PORTRAIT)

    expect(boxes.map(({ y, height }) => [y, height])).toEqual([[0, 1707], [1707, 853]])
  })

  it('tiles exactly when the weights do not divide the stage, the last one taking the remainder', () => {
    for (const stage of [LANDSCAPE, PORTRAIT, { width: 1001, height: 777 }]) {
      const boxes = layoutPanes({ rows: [row(1, ['photo', 1], ['week', 1], ['agenda', 1]), row(2, ['month', 3], ['week_parts', 1]), row(1, ['month', 1])] }, stage)
      const area = boxes.reduce((sum, box) => sum + box.width * box.height, 0)

      expect(area).toBe(stage.width * stage.height)
      for (const box of boxes) expect([box.x, box.y, box.width, box.height].every(Number.isInteger)).toBe(true)
      expect(boxes.at(-1)!.x + boxes.at(-1)!.width).toBe(stage.width)
      expect(boxes.at(-1)!.y + boxes.at(-1)!.height).toBe(stage.height)
    }
  })

  it('has a lone pane fill the stage', () => {
    const [only] = layoutPanes({ rows: [row(1, ['month', 1])] }, LANDSCAPE)

    expect(only).toMatchObject({ x: 0, y: 0, ...LANDSCAPE })
  })

  it('rounds a corner unless both its edges are the stage\'s', () => {
    const [left, right] = layoutPanes({ rows: [row(1, ['photo', 1], ['week', 1])] }, LANDSCAPE)

    expect(left!.rounded).toEqual({ topLeft: false, topRight: true, bottomRight: true, bottomLeft: false })
    expect(right!.rounded).toEqual({ topLeft: true, topRight: false, bottomRight: false, bottomLeft: true })
    expect(layoutPanes({ rows: [row(1, ['photo', 1])] }, LANDSCAPE)[0]!.rounded).toEqual({ topLeft: false, topRight: false, bottomRight: false, bottomLeft: false })
  })

  it('reproduces the week and photo view: the photo on top has its lower corners rounded, and on the left its right ones', () => {
    const top = layoutPanes({ rows: [row(1, ['photo', 1]), row(1, ['week', 1])] }, PORTRAIT)[0]!
    const left = layoutPanes({ rows: [row(1, ['photo', 1], ['week', 1])] }, LANDSCAPE)[0]!

    expect(top.rounded).toEqual({ topLeft: false, topRight: false, bottomRight: true, bottomLeft: true })
    expect(left.rounded).toEqual({ topLeft: false, topRight: true, bottomRight: true, bottomLeft: false })
  })

  it('rounds the three inner corners of each pane of a grid', () => {
    const boxes = layoutPanes({ rows: [row(1, ['month', 1], ['week', 1]), row(1, ['agenda', 1], ['week_parts', 1])] }, LANDSCAPE)

    expect(boxes.map(box => Object.values(box.rounded).filter(Boolean).length)).toEqual([3, 3, 3, 3])
  })
})

describe('paneFit', () => {
  it('draws a component at its real size when the box is big enough', () => {
    expect(paneFit('month', LANDSCAPE)).toEqual({ stage: { ...LANDSCAPE, orientation: 'landscape' }, scale: 1 })
    expect(paneFit('week_parts', { width: 1700, height: 1000 })).toEqual({ stage: { width: 1700, height: 1000, orientation: 'landscape' }, scale: 1 })
  })

  it('asks for portrait when the box is taller than wide', () => {
    expect(paneFit('agenda', { width: 1200, height: 1600 }).stage.orientation).toBe('portrait')
    expect(paneFit('month', PORTRAIT).stage.orientation).toBe('portrait')
  })

  it('uses the week\'s narrow layout in any box narrower than 1800, as the week and photo view does', () => {
    const { week } = weekPhotoPanes(stageFor('week_photo', 'landscape'))

    expect(paneFit('week', { width: 1460, height: 1100 }).stage.orientation).toBe('portrait')
    expect(paneFit('week', week).stage.orientation).toBe('portrait')
    expect(paneFit('week', { width: 1800, height: 1000 }).stage.orientation).toBe('landscape')
    // Only the week: the others go by the box's shape.
    expect(paneFit('week_parts', { width: 1460, height: 1100 }).stage.orientation).toBe('landscape')
  })

  it('scales a small box down uniformly, by the tighter of the two sides', () => {
    const fit = paneFit('month', { width: 1100, height: 800 })

    expect(fit.scale).toBe(0.5)
    expect(fit.stage).toEqual({ width: 2200, height: 1600, orientation: 'landscape' })
  })

  it('keeps the box\'s shape on the virtual stage when only one side is short', () => {
    const fit = paneFit('agenda', { width: 3000, height: 675 })

    expect(fit.scale).toBe(0.5)
    expect(fit.stage).toEqual({ width: 6000, height: 1350, orientation: 'landscape' })
  })

  it('scales a narrow portrait column to fit exactly', () => {
    const fit = paneFit('month', { width: 650, height: 1440 })
    const minimum = COMPONENT_MINIMUMS.month.portrait

    expect(fit.stage.orientation).toBe('portrait')
    expect(fit.scale).toBeCloseTo(Math.min(650 / minimum.width, 1440 / minimum.height))
    expect(fit.stage.width * fit.scale).toBeCloseTo(650, 0)
    expect(fit.stage.height * fit.scale).toBeCloseTo(1440, 0)
  })

  it('never scales up', () => {
    expect(paneFit('week_parts', { width: 5000, height: 5000 }).scale).toBe(1)
  })

  it('draws the photo frame at any size, unscaled', () => {
    expect(paneFit('photo', { width: 300, height: 200 })).toEqual({ stage: { width: 300, height: 200, orientation: 'landscape' }, scale: 1 })
    expect(paneFit('photo', { width: 1100, height: 1440 }).stage.orientation).toBe('portrait')
  })
})

describe('paneFit with the month\'s sidebar hidden', () => {
  const hidden = { show_sidebar: false }

  it('draws a month at its real size in the smaller minimum', () => {
    const { landscape, portrait } = MONTH_MINIMUMS_NO_SIDEBAR

    expect(paneFit('month', landscape, undefined, hidden)).toEqual({ stage: { ...landscape, orientation: 'landscape' }, scale: 1 })
    expect(paneFit('month', portrait, undefined, hidden)).toEqual({ stage: { ...portrait, orientation: 'portrait' }, scale: 1 })
    expect(paneFit('month', landscape).scale).toBeLessThan(1)
  })

  it('has minimums smaller than the full month\'s', () => {
    expect(MONTH_MINIMUMS_NO_SIDEBAR.landscape.width).toBeLessThan(COMPONENT_MINIMUMS.month.landscape.width)
    expect(MONTH_MINIMUMS_NO_SIDEBAR.portrait.height).toBeLessThan(COMPONENT_MINIMUMS.month.portrait.height)
  })

  it('changes nothing for a shown sidebar or for any other component', () => {
    const box = { width: 1550, height: 1300 }

    expect(paneFit('month', box, undefined, { show_sidebar: true })).toEqual(paneFit('month', box))
    expect(paneFit('agenda', box, undefined, hidden)).toEqual(paneFit('agenda', box))
  })
})

describe('photoPillAtTopRight', () => {
  const panes = layoutPanes({ rows: [row(1, ['week', 1], ['photo', 1])] }, LANDSCAPE)

  it('is true when the pill is in the corner and a photo pane reaches that corner of the stage', () => {
    expect(photoPillAtTopRight(panes, LANDSCAPE.width, 'top-right')).toBe(true)
  })

  it('is false for any other corner', () => {
    expect(photoPillAtTopRight(panes, LANDSCAPE.width, 'top-left')).toBe(false)
    expect(photoPillAtTopRight(panes, LANDSCAPE.width, 'bottom-right')).toBe(false)
  })

  it('is false when the photo is not at the top right', () => {
    const left = layoutPanes({ rows: [row(1, ['photo', 1], ['week', 1])] }, LANDSCAPE)
    const below = layoutPanes({ rows: [row(1, ['week', 1]), row(1, ['photo', 1])] }, LANDSCAPE)

    expect(photoPillAtTopRight(left, LANDSCAPE.width, 'top-right')).toBe(false)
    expect(photoPillAtTopRight(below, LANDSCAPE.width, 'top-right')).toBe(false)
  })
})

describe('the day grid pane', () => {
  const grid = { rows: 2, columns: 4, start: 'today' as const }

  it('layoutPanes carries the grid of a days pane, and only that', () => {
    const arrangement: LayoutArrangement = { rows: [{ size: 1, panes: [{ component: 'days', size: 3, grid }, { component: 'photo', size: 1 }] }] }
    const [days, photo] = layoutPanes(arrangement, { width: 2560, height: 1440 })

    expect(days!.grid).toEqual(grid)
    expect(photo).not.toHaveProperty('grid')
  })

  it('draws a roomy grid at its real size, in the shape of its box', () => {
    const fit = paneFit('days', { width: 2560, height: 1440 }, grid)

    expect(fit).toEqual({ stage: { width: 2560, height: 1440, orientation: 'landscape' }, scale: 1 })
    expect(paneFit('days', { width: 1440, height: 2560 }, { rows: 4, columns: 2, start: 'today' }).stage.orientation).toBe('portrait')
  })

  it('scales down so each tile keeps its minimum, by the tighter side', () => {
    expect(MIN_DAY_TILE).toEqual({ width: 320, height: 264 })
    // 4 columns want 1280 wide and 2 rows want 528 high: the width is short by half.
    const fit = paneFit('days', { width: 640, height: 960 }, grid)

    expect(fit.scale).toBe(0.5)
    expect(fit.stage).toEqual({ width: 1280, height: 1920, orientation: 'portrait' })
    // The height is the tight side here.
    expect(paneFit('days', { width: 2560, height: 264 }, grid).scale).toBe(0.5)
  })

  it('never scales up', () => {
    expect(paneFit('days', { width: 5000, height: 5000 }, { rows: 1, columns: 1, start: 'week' }).scale).toBe(1)
  })
})
