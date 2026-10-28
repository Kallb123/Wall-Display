import { describe, expect, it } from 'vitest'
import { STAGE_HEIGHT, STAGE_WIDTH, stageScale } from '../../../app/utils/stage'

describe('stageScale', () => {
  it('is 1 at the stage size', () => {
    expect([STAGE_WIDTH, STAGE_HEIGHT]).toEqual([2560, 1440])
    expect(stageScale(2560, 1440)).toBe(1)
  })

  it('halves the stage on a 1280×720 window', () => {
    expect(stageScale(1280, 720)).toBe(0.5)
  })

  it('fits the narrower side, leaving bars on the other', () => {
    expect(stageScale(1000, 1000)).toBe(1000 / 2560)
    expect(stageScale(3840, 1440)).toBe(1)
  })

  it('scales up on a 4K panel', () => {
    expect(stageScale(3840, 2160)).toBe(1.5)
  })
})
