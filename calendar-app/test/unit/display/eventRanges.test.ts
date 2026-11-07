import { describe, expect, it } from 'vitest'
import { dayGridRanges, displayEventRanges, todayIn } from '../../../app/utils/eventRanges'

/** Days from `from` to `to`, to check the endpoint's 366-day limit. */
const days = (range: { from: string, to: string }) => (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000

describe('displayEventRanges with a week', () => {
  it('adds nothing when the month grid already holds the week', () => {
    expect(displayEventRanges('2026-10', '2026-10-28', '2026-10-26')).toEqual([{ from: '2026-09-24', to: '2026-11-15' }])
  })

  it('adds the week when it is far from the month and today', () => {
    const ranges = displayEventRanges('2026-10', '2026-10-28', '2027-03-01')

    expect(ranges).toEqual([
      { from: '2026-09-24', to: '2026-11-15' },
      { from: '2027-03-01', to: '2027-03-08' },
    ])
    expect(ranges.every(range => days(range) <= 366)).toBe(true)
  })

  it('counts the next days as covering it too', () => {
    // The pinned month is a year ahead, so the next days are asked for, and a week that starts today is in them.
    expect(displayEventRanges('2027-10', '2026-10-28', '2026-10-28')).toHaveLength(2)
  })
})

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

describe('displayEventRanges with extra ranges', () => {
  it('adds a range the others do not cover', () => {
    const extra = { from: '2026-12-01', to: '2026-12-20' }

    expect(displayEventRanges('2026-10', '2026-10-28', undefined, [extra])).toEqual([{ from: '2026-09-24', to: '2026-11-15' }, extra])
  })

  it('skips a range that is already covered, by the grid or by the week', () => {
    expect(displayEventRanges('2026-10', '2026-10-28', undefined, [{ from: '2026-10-28', to: '2026-11-05' }])).toEqual([{ from: '2026-09-24', to: '2026-11-15' }])
    expect(displayEventRanges('2026-10', '2026-10-28', '2026-12-07', [{ from: '2026-12-08', to: '2026-12-10' }])).toEqual([
      { from: '2026-09-24', to: '2026-11-15' },
      { from: '2026-12-07', to: '2026-12-14' },
    ])
  })

  it('is unchanged without extras', () => {
    expect(displayEventRanges('2026-10', '2026-10-28', undefined, [])).toEqual(displayEventRanges('2026-10', '2026-10-28'))
  })
})

describe('dayGridRanges', () => {
  const layout = (landscape: { rows: number, columns: number, start: 'today' | 'week' }, portrait: { rows: number, columns: number, start: 'today' | 'week' }) => ({
    name: 'Days',
    landscape: { rows: [{ size: 1, panes: [{ component: 'days' as const, size: 1, grid: landscape }] }] },
    portrait: { rows: [{ size: 1, panes: [{ component: 'days' as const, size: 1, grid: portrait }] }] },
  })

  it('runs from the first tile to the day after the last, over both arrangements', () => {
    // Sat 7 November 2026: the week starts on Monday the 2nd.
    expect(dayGridRanges(layout({ rows: 2, columns: 4, start: 'today' }, { rows: 1, columns: 7, start: 'week' }), '2026-11-07', 'monday')).toEqual([{ from: '2026-11-02', to: '2026-11-15' }])
  })

  it('is empty without a layout or a day grid', () => {
    expect(dayGridRanges(null, '2026-11-07', 'monday')).toEqual([])
    expect(dayGridRanges({ name: 'Photo', landscape: { rows: [{ size: 1, panes: [{ component: 'photo', size: 1 }] }] }, portrait: { rows: [{ size: 1, panes: [{ component: 'photo', size: 1 }] }] } }, '2026-11-07', 'monday')).toEqual([])
  })
})
