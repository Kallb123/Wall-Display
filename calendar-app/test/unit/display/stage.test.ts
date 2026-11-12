import { describe, expect, it } from 'vitest'
import { deviceOrientation, orientationQuery, STAGE_HEIGHT, STAGE_WIDTH, stageFit, stageScale, stageSize } from '../../../app/utils/stage'

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

describe('stageFit', () => {
  it('fills a window of the stage\'s shape', () => {
    expect(stageFit(2560, 1440)).toEqual({ scaleX: 1, scaleY: 1, x: 0, y: 0 })
    expect(stageFit(1280, 720)).toEqual({ scaleX: 0.5, scaleY: 0.5, x: 0, y: 0 })
    expect(stageFit(720, 1280, 'portrait')).toEqual({ scaleX: 0.5, scaleY: 0.5, x: 0, y: 0 })
  })

  it('fills a window that is nearly the stage\'s shape, where the bars would be a pixel or two', () => {
    // 1366×768: the fitted stage is a third of a pixel short on each side.
    expect(stageFit(1366, 768)).toEqual({ scaleX: 1366 / 2560, scaleY: 768 / 1440, x: 0, y: 0 })
    // 1360×768: it is 765 px tall, a pixel and a half short above and below.
    expect(stageFit(1360, 768)).toEqual({ scaleX: 1360 / 2560, scaleY: 768 / 1440, x: 0, y: 0 })
    expect(stageFit(768, 1366, 'portrait')).toEqual({ scaleX: 768 / 1440, scaleY: 1366 / 2560, x: 0, y: 0 })
  })

  it('letterboxes any other window, centred, with the stage and its bars on whole pixels', () => {
    // 16:10: 40 px above and below.
    expect(stageFit(1280, 800)).toEqual({ scaleX: 0.5, scaleY: 0.5, x: 0, y: 40 })
    // 1000 × 0.5625 is 562.5 px tall: drawn 563, with 218 above and 219 below.
    expect(stageFit(1000, 1000)).toEqual({ scaleX: 1000 / 2560, scaleY: 563 / 1440, x: 0, y: 219 })
    // The portrait stage in a landscape window: 607.5 px wide, drawn 608.
    expect(stageFit(1920, 1080, 'portrait')).toEqual({ scaleX: 608 / 1440, scaleY: 1080 / 2560, x: 656, y: 0 })
  })

  it('never stretches by more than the tolerance', () => {
    // 2% spare is letterboxed, 1% is filled.
    expect(stageFit(2560, 1470).y).toBe(15)
    expect(stageFit(2560, 1454)).toEqual({ scaleX: 1, scaleY: 1454 / 1440, x: 0, y: 0 })
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
