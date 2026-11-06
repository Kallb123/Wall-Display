import { describe, expect, it } from 'vitest'
import { deviceOrientation, orientationQuery, STAGE_HEIGHT, STAGE_WIDTH, stageScale, stageSize } from '../../../app/utils/stage'

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

describe('stageSize', () => {
  it('is 2560×1440 for landscape and 1440×2560 for portrait', () => {
    expect(stageSize('landscape')).toEqual({ width: 2560, height: 1440 })
    expect(stageSize('portrait')).toEqual({ width: 1440, height: 2560 })
  })
})

describe('stageScale for the portrait stage', () => {
  it('is 1 at the portrait stage size, and halves on 720×1280', () => {
    expect(stageScale(1440, 2560, 'portrait')).toBe(1)
    expect(stageScale(720, 1280, 'portrait')).toBe(0.5)
  })

  it('fits the narrower side, leaving bars on the other', () => {
    expect(stageScale(1440, 3840, 'portrait')).toBe(1)
    expect(stageScale(1920, 1080, 'portrait')).toBe(1080 / 2560)
  })

  it('is the landscape scale when no orientation is given', () => {
    expect(stageScale(720, 1280)).toBe(stageScale(720, 1280, 'landscape'))
    expect(stageScale(720, 1280)).toBe(720 / 2560)
  })
})

describe('deviceOrientation', () => {
  it('follows the window\'s shape for auto, with a square window landscape', () => {
    expect(deviceOrientation('auto', 1920, 1080)).toBe('landscape')
    expect(deviceOrientation('auto', 1080, 1920)).toBe('portrait')
    expect(deviceOrientation('auto', 1000, 1000)).toBe('landscape')
  })

  it('is the preference when it is not auto, whatever the window', () => {
    expect(deviceOrientation('portrait', 1920, 1080)).toBe('portrait')
    expect(deviceOrientation('landscape', 1080, 1920)).toBe('landscape')
  })
})

describe('orientationQuery', () => {
  it('reads an orientation, the first if there are several', () => {
    expect(orientationQuery('portrait')).toBe('portrait')
    expect(orientationQuery('landscape')).toBe('landscape')
    expect(orientationQuery('auto')).toBe('auto')
    expect(orientationQuery(['landscape', 'portrait'])).toBe('landscape')
  })

  it('is null for none, or for something that is not one', () => {
    expect(orientationQuery(undefined)).toBeNull()
    expect(orientationQuery('')).toBeNull()
    expect(orientationQuery('sideways')).toBeNull()
    expect(orientationQuery(['sideways', 'portrait'])).toBeNull()
    expect(orientationQuery(null)).toBeNull()
  })
})
