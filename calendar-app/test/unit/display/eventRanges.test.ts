import { describe, expect, it } from 'vitest'
import { displayEventRanges, todayIn } from '../../../app/utils/eventRanges'

/** Days from `from` to `to`, to check the endpoint's 366-day limit. */
const days = (range: { from: string, to: string }) => (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000

describe('displayEventRanges', () => {
  it('asks for the month grid alone when today is inside it', () => {
    expect(displayEventRanges('2026-10', '2026-10-28')).toEqual([{ from: '2026-09-24', to: '2026-11-15' }])
  })

  it('asks for the next days too when a pinned month is a year ahead', () => {
    const ranges = displayEventRanges('2027-10', '2026-10-28')

    expect(ranges).toEqual([
      { from: '2027-09-24', to: '2027-11-15' },
      { from: '2026-10-28', to: '2026-11-04' },
    ])
    expect(ranges.every(range => days(range) <= 366)).toBe(true)
  })

  it('covers a pinned month in the past', () => {
    expect(displayEventRanges('2025-10', '2026-10-28')).toHaveLength(2)
  })

  it('crosses the year boundary', () => {
    expect(displayEventRanges('2026-12', '2026-12-20')).toEqual([{ from: '2026-11-24', to: '2027-01-15' }])
    expect(displayEventRanges('2027-01', '2026-12-31')).toEqual([{ from: '2026-12-25', to: '2027-02-15' }])
  })

  it('adds the next days when today is near the end of the grid and they run past it', () => {
    // The October grid ends before 15 November, so a week from 12 November is inside, but not a week from 14 November.
    expect(displayEventRanges('2026-10', '2026-11-08')).toEqual([{ from: '2026-09-24', to: '2026-11-15' }])
    expect(displayEventRanges('2026-10', '2026-11-09')).toEqual([
      { from: '2026-09-24', to: '2026-11-15' },
      { from: '2026-11-09', to: '2026-11-16' },
    ])
  })

  it('handles a leap February', () => {
    expect(displayEventRanges('2028-02', '2028-02-29')).toEqual([{ from: '2028-01-25', to: '2028-03-15' }])
  })
})

describe('todayIn', () => {
  it('is the date in the display zone, not the process zone (Pacific/Auckland)', () => {
    const instant = new Date('2026-10-28T23:30:00Z')

    expect(todayIn(instant, 'Europe/London')).toBe('2026-10-28')
    expect(todayIn(instant, 'Asia/Tokyo')).toBe('2026-10-29')
    expect(todayIn(instant, 'America/Los_Angeles')).toBe('2026-10-28')
  })

  it('follows the clocks changing', () => {
    // BST ends at 01:00 UTC on 25 October 2026.
    expect(todayIn(new Date('2026-10-24T23:30:00Z'), 'Europe/London')).toBe('2026-10-25')
    expect(todayIn(new Date('2026-10-25T23:30:00Z'), 'Europe/London')).toBe('2026-10-25')
  })
})
