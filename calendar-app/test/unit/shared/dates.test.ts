import { describe, expect, it } from 'vitest'
import { addDays, dayOfWeek, todayIn } from '../../../shared/dates'

describe('addDays', () => {
  it.each([
    ['2026-10-28', 1, '2026-10-29'],
    ['2026-10-31', 1, '2026-11-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2026-10-28', 0, '2026-10-28'],
    ['2026-10-28', 400, '2027-12-02'],
  ])('%s moved by %i is %s', (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected)
  })
})

describe('dayOfWeek', () => {
  it('counts from Sunday as 0, whatever the process time zone', () => {
    expect(dayOfWeek('2026-10-28')).toBe(3)
    expect(dayOfWeek('2026-03-01')).toBe(0)
    expect(dayOfWeek('2027-02-01')).toBe(1)
    expect(dayOfWeek('2026-10-31')).toBe(6)
  })
})

describe('todayIn', () => {
  it('reads the date on a wall in the given zone', () => {
    const instant = new Date('2026-10-28T23:30:00Z')

    expect(todayIn(instant, 'Europe/London')).toBe('2026-10-28')
    expect(todayIn(instant, 'Asia/Tokyo')).toBe('2026-10-29')
  })
})
