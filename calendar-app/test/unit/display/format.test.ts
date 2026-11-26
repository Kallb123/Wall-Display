import { describe, expect, it } from 'vitest'
import { formatFullDate, formatLongDate, formatTime, formatWeekday } from '../../../app/utils/format'

describe('formatTime', () => {
  it('is 24-hour in the display zone', () => {
    expect(formatTime(new Date('2026-10-28T09:41:00Z'), 'Europe/London')).toBe('09:41')
    expect(formatTime(new Date('2026-10-28T09:41:00Z'), 'Asia/Tokyo')).toBe('18:41')
    expect(formatTime(new Date('2026-10-28T23:05:00Z'), 'Europe/London')).toBe('23:05')
  })

  it('writes midnight as 00:00', () => {
    expect(formatTime(new Date('2026-10-28T00:00:00Z'), 'Europe/London')).toBe('00:00')
  })
})

describe('formatLongDate', () => {
  it('is the weekday, day and month in British English', () => {
    expect(formatLongDate(new Date('2026-10-28T09:41:00Z'), 'Europe/London')).toBe('Wednesday 28 October')
  })

  it('uses the date in the display zone', () => {
    expect(formatLongDate(new Date('2026-10-28T23:30:00Z'), 'Asia/Tokyo')).toBe('Thursday 29 October')
  })
})

describe('formatWeekday', () => {
  it('is the long weekday in the display zone', () => {
    expect(formatWeekday(new Date('2026-10-28T09:41:00Z'), 'Europe/London')).toBe('Wednesday')
    expect(formatWeekday(new Date('2026-10-28T23:30:00Z'), 'Asia/Tokyo')).toBe('Thursday')
  })
})

describe('formatFullDate', () => {
  it('is the day, month and year in British English, in the display zone', () => {
    expect(formatFullDate(new Date('2019-07-14T13:05:00Z'), 'Europe/London')).toBe('14 July 2019')
    expect(formatFullDate(new Date('2019-12-31T23:30:00Z'), 'Asia/Tokyo')).toBe('1 January 2020')
  })
})
