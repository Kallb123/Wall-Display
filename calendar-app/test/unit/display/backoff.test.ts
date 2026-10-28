import { describe, expect, it } from 'vitest'
import { reconnectDelay } from '../../../app/utils/backoff'

/** No jitter: `random` returns the middle of its range. */
const middle = () => 0.5

describe('reconnectDelay', () => {
  it('doubles from one second', () => {
    expect([0, 1, 2, 3, 4].map(attempt => reconnectDelay(attempt, middle))).toEqual([1000, 2000, 4000, 8000, 16_000])
  })

  it('is capped at 30 seconds', () => {
    expect(reconnectDelay(5, middle)).toBe(30_000)
    expect(reconnectDelay(50, middle)).toBe(30_000)
  })

  it('varies by up to 20% either side', () => {
    expect(reconnectDelay(2, () => 0)).toBe(3200)
    expect(reconnectDelay(2, () => 1)).toBe(4800)
    expect(reconnectDelay(10, () => 0)).toBe(24_000)
    expect(reconnectDelay(10, () => 1)).toBe(36_000)
  })

  it('stays within the bounds with real randomness', () => {
    for (let i = 0; i < 200; i++) {
      const delay = reconnectDelay(1)
      expect(delay).toBeGreaterThanOrEqual(1600)
      expect(delay).toBeLessThanOrEqual(2400)
    }
  })
})
