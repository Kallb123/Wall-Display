import { describe, expect, it } from 'vitest'
import { COMPACT_TILE_WIDTH, MIN_TILE_WIDTH, monthBarStyle, monthLaneRow, monthNameOf, monthTimedStyle, tileWidthOn } from '../../../app/utils/monthSoft'

describe('tileWidthOn', () => {
  it('takes the side column off the landscape grid only when the sidebar is shown', () => {
    expect(tileWidthOn(2560, false, true)).toBeCloseTo((2560 - 96 - 688 - 84) / 7)
    expect(tileWidthOn(2560, false, false)).toBeCloseTo((2560 - 96 - 84) / 7)
  })

  it('has the portrait stage full width whatever the sidebar says, with compact tiles', () => {
    expect(tileWidthOn(1440, true, true)).toBe(tileWidthOn(1440, true, false))
    expect(tileWidthOn(1440, true, true)).toBeLessThan(COMPACT_TILE_WIDTH)
    expect(tileWidthOn(1440, true, true)).toBeGreaterThan(MIN_TILE_WIDTH)
  })
})

describe('monthLaneRow', () => {
  it('is the lane after the date row, or that and the free lanes below when wrapped', () => {
    expect(monthLaneRow(0)).toBe(2)
    expect(monthLaneRow(1, 3)).toBe('3 / span 3')
  })
})

describe('monthBarStyle', () => {
  const bar = { colour: null, column: 2, span: 3, lane: 1, roundStart: true, roundEnd: false }

  it('rounds the start in from the tile edge and runs the square end on', () => {
    expect(monthBarStyle(bar)).toMatchObject({ gridColumn: '3 / span 3', gridRow: 3, margin: '0 0 0 8px', borderRadius: '999px 8px 8px 999px', background: 'var(--surface)' })
  })

  it('uses a lane-height radius and --lines for a bar that may be several lines tall', () => {
    expect(monthBarStyle(bar, 2)).toMatchObject({ gridRow: '3 / span 2', borderRadius: '17px 8px 8px 17px', '--lines': 2 })
  })
})

describe('monthTimedStyle', () => {
  it('is bare on the tile, ringed in its colour, without "colour whole events"', () => {
    const style = monthTimedStyle({ people: [], column: 4, lane: 0 }, 'red', false)
    expect(style).toEqual({ gridColumn: 5, gridRow: 2, '--ring': 'red' })
  })
})

describe('monthNameOf', () => {
  it('names the month itself', () => {
    expect(monthNameOf('2026-10')).toBe('October')
  })
})
