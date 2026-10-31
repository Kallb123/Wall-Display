import { describe, expect, it } from 'vitest'
import { ORBIT_RADIUS, burnInOffset, pillCorner } from '../../../app/utils/burnIn'
import type { Corner } from '../../../app/utils/burnIn'

const MINUTE = 60_000
// Wed 28 Oct 2026, 09:45 UTC: a whole multiple of 15 minutes (and so of 3), the start of a step.
const START = Date.parse('2026-10-28T09:45:00Z')
const at = (minutes: number, seconds = 0) => new Date(START + minutes * MINUTE + seconds * 1000)

describe('burnInOffset', () => {
  it('moves every three minutes and rests in between', () => {
    expect(burnInOffset(at(0))).toEqual(burnInOffset(at(2, 59)))
    expect(burnInOffset(at(3))).toEqual(burnInOffset(at(5, 59)))
    expect(burnInOffset(at(3))).not.toEqual(burnInOffset(at(2, 59)))
  })

  it('goes round eight different places and is back where it began after 24 minutes', () => {
    const places = Array.from({ length: 8 }, (_, step) => burnInOffset(at(step * 3)))

    expect(new Set(places.map(place => `${place.x},${place.y}`)).size).toBe(8)
    expect(burnInOffset(at(24))).toEqual(places[0])
    expect(burnInOffset(at(24 * 5 + 6))).toEqual(places[2])
  })

  it('stays on a circle of about eight pixels, in whole pixels', () => {
    for (let step = 0; step < 8; step++) {
      const { x, y } = burnInOffset(at(step * 3))
      expect(Number.isInteger(x)).toBe(true)
      expect(Number.isInteger(y)).toBe(true)
      expect(Math.abs(Math.hypot(x, y) - ORBIT_RADIUS)).toBeLessThanOrEqual(1)
    }
  })

  it('goes clockwise on the screen, where y grows downwards', () => {
    // A quarter of the way round (two steps) from the top is the right-hand side.
    const top = burnInOffset(new Date(0))
    const right = burnInOffset(new Date(2 * 3 * MINUTE))
    const bottom = burnInOffset(new Date(4 * 3 * MINUTE))
    const left = burnInOffset(new Date(6 * 3 * MINUTE))

    expect(top).toEqual({ x: 0, y: -8 })
    expect(right).toEqual({ x: 8, y: 0 })
    expect(bottom).toEqual({ x: 0, y: 8 })
    expect(left).toEqual({ x: -8, y: 0 })
  })

  it('is the same for the same moment, whatever the process\'s time zone', () => {
    const moment = new Date('2026-03-29T00:59:00Z')

    expect(burnInOffset(moment)).toEqual(burnInOffset(new Date(moment.getTime())))
  })
})

describe('pillCorner', () => {
  const walk = (overlay: boolean): Corner[] => Array.from({ length: 5 }, (_, step) => pillCorner(at(step * 15), { overlay }))

  it('stays put for 15 minutes, then moves on', () => {
    expect(pillCorner(at(0), { overlay: false })).toBe(pillCorner(at(14, 59), { overlay: false }))
    expect(pillCorner(at(15), { overlay: false })).not.toBe(pillCorner(at(14, 59), { overlay: false }))
  })

  it('goes clockwise through all four corners and back to the first after an hour', () => {
    const corners = walk(false)

    expect(new Set(corners.slice(0, 4)).size).toBe(4)
    expect(corners[4]).toBe(corners[0])
    const clockwise: Corner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left']
    const first = clockwise.indexOf(corners[0]!)
    expect(corners.slice(0, 4)).toEqual([0, 1, 2, 3].map(step => clockwise[(first + step) % 4]))
  })

  it('takes the top corner on the same side while a banner is showing, and leaves the top corners alone', () => {
    const plain = walk(false)
    const withBanner = walk(true)

    plain.forEach((corner, step) => {
      expect(withBanner[step]).toBe(corner === 'bottom-left' ? 'top-left' : corner === 'bottom-right' ? 'top-right' : corner)
      expect(withBanner[step]!.startsWith('top')).toBe(true)
    })
  })

  it('has the pill at top left at the start of the epoch', () => {
    expect(pillCorner(new Date(0), { overlay: false })).toBe('top-left')
    expect(pillCorner(new Date(15 * MINUTE), { overlay: false })).toBe('top-right')
    expect(pillCorner(new Date(30 * MINUTE), { overlay: false })).toBe('bottom-right')
    expect(pillCorner(new Date(45 * MINUTE), { overlay: false })).toBe('bottom-left')
  })
})
