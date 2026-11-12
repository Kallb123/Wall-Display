import { describe, expect, it } from 'vitest'
import { EDGE_BLEED, NO_BLEED, bleeds, edgeBleed, paneClipPath } from '../../../app/utils/bleed'
import { ORBIT_RADIUS, burnInOffset } from '../../../app/utils/burnIn'

const STAGE = { width: 2560, height: 1440 }
const square = { topLeft: false, topRight: false, bottomRight: false, bottomLeft: false }

describe('EDGE_BLEED', () => {
  it('reaches past the furthest the burn-in shift ever moves the content', () => {
    const start = Date.parse('2026-10-28T09:45:00Z')
    const furthest = Math.max(...Array.from({ length: 8 }, (_, step) => burnInOffset(new Date(start + step * 3 * 60_000))).flatMap(({ x, y }) => [Math.abs(x), Math.abs(y)]))
    expect(furthest).toBe(ORBIT_RADIUS)
    expect(EDGE_BLEED).toBeGreaterThan(furthest)
  })
})

describe('edgeBleed', () => {
  it('bleeds past the sides on the stage\'s edge and not past a side that meets another pane', () => {
    // A third of the stage on the right, top to bottom.
    expect(edgeBleed({ x: 1707, y: 0, width: 853, height: 1440 }, STAGE, true)).toEqual({ top: EDGE_BLEED, right: EDGE_BLEED, bottom: EDGE_BLEED, left: 0 })
    // The top left quarter.
    expect(edgeBleed({ x: 0, y: 0, width: 1280, height: 720 }, STAGE, true)).toEqual({ top: EDGE_BLEED, right: 0, bottom: 0, left: EDGE_BLEED })
    // The whole stage.
    expect(edgeBleed({ x: 0, y: 0, ...STAGE }, STAGE, true)).toEqual({ top: EDGE_BLEED, right: EDGE_BLEED, bottom: EDGE_BLEED, left: EDGE_BLEED })
  })

  it('does not bleed a pane in the middle of the stage', () => {
    expect(bleeds(edgeBleed({ x: 640, y: 360, width: 1280, height: 720 }, STAGE, true))).toBe(false)
  })

  it('does not bleed at all with burn-in shifting off, when nothing moves', () => {
    expect(edgeBleed({ x: 0, y: 0, ...STAGE }, STAGE, false)).toEqual(NO_BLEED)
    expect(bleeds(NO_BLEED)).toBe(false)
    expect(bleeds(undefined)).toBe(false)
  })
})

describe('paneClipPath', () => {
  it('is the box pushed out by the bleed, for square corners', () => {
    expect(paneClipPath(100, 50, square, { top: 16, right: 16, bottom: 0, left: 0 }))
      .toBe('path(\'M 0 -16 L 116 -16 L 116 50 L 0 50 Z\')')
  })

  it('is the plain rounded box with no bleed', () => {
    expect(paneClipPath(200, 100, { topLeft: true, topRight: true, bottomRight: true, bottomLeft: true }, NO_BLEED, 10)).toBe(
      'path(\'M 0 10 L 0 10 A 10 10 0 0 1 10 0 L 10 0 L 190 0 L 190 0 A 10 10 0 0 1 200 10 L 200 10 L 200 90 L 200 90 A 10 10 0 0 1 190 100 L 190 100 L 10 100 L 10 100 A 10 10 0 0 1 0 90 L 0 90 Z\')',
    )
  })

  it('keeps a rounded corner where it is and runs on from its curve to the bleed', () => {
    // A pane on the right, top to bottom: its left corners are rounded, each on the stage's edge one way.
    const path = paneClipPath(853, 1440, { topLeft: true, topRight: false, bottomRight: false, bottomLeft: true }, { top: 16, right: 16, bottom: 16, left: 0 }, 64)
    expect(path).toBe(
      'path(\'M 0 64 L 0 64 A 64 64 0 0 1 64 0 L 64 -16 L 869 -16 L 869 1456 L 64 1456 L 64 1440 A 64 64 0 0 1 0 1376 L 0 1376 Z\')',
    )
  })
})
