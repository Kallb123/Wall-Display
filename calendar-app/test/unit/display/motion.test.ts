import { describe, expect, it } from 'vitest'
import {
  CROSSFADE_SECONDS, DRIFT_CYCLE, DRIFT_PAN_PERCENT, DRIFT_SCALE, FALLBACK_DRIFT_SECONDS, MIN_DRIFT_SECONDS, MOTION_MIN_BRIGHTNESS,
  driftSeconds, motionRuns, photoDrift,
} from '../../../app/utils/motion'
import type { MotionState } from '../../../app/utils/motion'

const running: MotionState = { motion: 'subtle', screen: 'on', view: 'photo', brightness: 100 }

describe('motionRuns', () => {
  it('runs when the display asks for it, the screen is on, it is not the night view and the wall is bright enough', () => {
    expect(motionRuns(running)).toBe(true)
  })

  it('is off unless the display says subtle, and undefined counts as off', () => {
    expect(motionRuns({ ...running, motion: 'off' })).toBe(false)
    expect(motionRuns({ ...running, motion: undefined })).toBe(false)
  })

  it('stops with the screen off', () => {
    expect(motionRuns({ ...running, screen: 'off' })).toBe(false)
  })

  it('stops in the night view and runs in every other', () => {
    expect(motionRuns({ ...running, view: 'night' })).toBe(false)
    for (const view of ['month', 'week', 'week_parts', 'week_photo', 'agenda', 'photo', 'custom'] as const) {
      expect(motionRuns({ ...running, view }), view).toBe(true)
    }
  })

  it('stops when the wall is dimmed for the night, at the limit and above it running', () => {
    expect(motionRuns({ ...running, brightness: MOTION_MIN_BRIGHTNESS })).toBe(true)
    expect(motionRuns({ ...running, brightness: MOTION_MIN_BRIGHTNESS - 1 })).toBe(false)
    expect(motionRuns({ ...running, brightness: 30 })).toBe(false)
    expect(motionRuns({ ...running, brightness: 0 })).toBe(false)
  })
})

/** Reads a drift's end: its scale and its pan in percent of the box. */
function parse(transform: string): { scale: number, x: number, y: number } {
  const scale = /^scale\(([\d.]+)\)/.exec(transform)
  expect(scale, transform).not.toBeNull()
  const pan = /translate\((-?[\d.]+)%, (-?[\d.]+)%\)$/.exec(transform)
  return { scale: Number(scale![1]), x: pan ? Number(pan[1]) : 0, y: pan ? Number(pan[2]) : 0 }
}

describe('photoDrift', () => {
  const steps = Array.from({ length: DRIFT_CYCLE * 5 }, (_, step) => step)

  it('never lets an edge of the photo into its box, at either end', () => {
    for (const step of steps) {
      const { from, to } = photoDrift(step)
      for (const end of [from, to]) {
        const { scale, x, y } = parse(end)
        // A photo scaled about its centre has (scale - 1) / 2 of its box to spare each side, and the pan is in the scaled space.
        const spare = ((scale - 1) / 2) * 100
        expect(scale, `step ${step}: ${end}`).toBeGreaterThanOrEqual(1)
        expect(Math.abs(x) * scale, `step ${step}: ${end}`).toBeLessThanOrEqual(spare + 1e-9)
        expect(Math.abs(y) * scale, `step ${step}: ${end}`).toBeLessThanOrEqual(spare + 1e-9)
      }
    }
  })

  it('is a few percent of scale and about one percent of pan, as the constants say', () => {
    expect(DRIFT_SCALE).toBeGreaterThan(1)
    expect(DRIFT_SCALE).toBeLessThanOrEqual(1.05)
    expect(DRIFT_PAN_PERCENT).toBeLessThanOrEqual(((DRIFT_SCALE - 1) / 2) * 100 / DRIFT_SCALE)
    for (const step of steps) {
      const ends = [photoDrift(step).from, photoDrift(step).to].map(parse)
      expect(Math.max(...ends.map(end => end.scale))).toBe(DRIFT_SCALE)
      expect(Math.min(...ends.map(end => end.scale))).toBe(1)
    }
  })

  it('alternates zooming in and zooming out', () => {
    const zoomsIn = (step: number) => parse(photoDrift(step).to).scale > parse(photoDrift(step).from).scale
    for (const step of steps) expect(zoomsIn(step), `step ${step}`).toBe(step % 2 === 0)
  })

  it('differs from one photo to the next, and goes through every drift of the cycle', () => {
    for (const step of steps) expect(photoDrift(step)).not.toEqual(photoDrift(step + 1))
    expect(new Set(steps.slice(0, DRIFT_CYCLE).map(step => JSON.stringify(photoDrift(step)))).size).toBe(DRIFT_CYCLE)
  })

  it('leans each way in turn', () => {
    const leans = steps.slice(0, DRIFT_CYCLE).map((step) => {
      const { from, to } = photoDrift(step)
      const { x, y } = parse(from === 'scale(1)' ? to : from)
      return `${x},${y}`
    })
    expect(new Set(leans).size).toBe(DRIFT_CYCLE)
  })

  it('is the same for the same step, and repeats after the cycle', () => {
    for (const step of steps) {
      expect(photoDrift(step)).toEqual(photoDrift(step))
      expect(photoDrift(step + DRIFT_CYCLE)).toEqual(photoDrift(step))
    }
  })

  it('takes a negative or odd step round the cycle all the same', () => {
    expect(photoDrift(-1)).toEqual(photoDrift(DRIFT_CYCLE - 1))
    expect(photoDrift(1.7)).toEqual(photoDrift(1))
    expect(photoDrift(Number.NaN)).toEqual(photoDrift(0))
  })
})

describe('driftSeconds', () => {
  it('is the photo interval plus the crossfade, so the photo still moves while it fades out', () => {
    expect(driftSeconds(60)).toBe(60 + CROSSFADE_SECONDS)
    expect(driftSeconds(300)).toBe(300 + CROSSFADE_SECONDS)
  })

  it('never goes under the floor, even for the shortest interval the config allows', () => {
    expect(driftSeconds(5)).toBe(MIN_DRIFT_SECONDS)
    expect(driftSeconds(MIN_DRIFT_SECONDS - CROSSFADE_SECONDS - 1)).toBe(MIN_DRIFT_SECONDS)
    expect(driftSeconds(MIN_DRIFT_SECONDS)).toBe(MIN_DRIFT_SECONDS + CROSSFADE_SECONDS)
  })

  it('falls back to a minute when the interval is not known or not usable', () => {
    for (const unknown of [undefined, null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(driftSeconds(unknown), String(unknown)).toBe(FALLBACK_DRIFT_SECONDS)
  })
})
