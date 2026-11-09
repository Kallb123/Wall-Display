import { describe, expect, it } from 'vitest'
import {
  clampStars, DEFAULT_STAR_SETTINGS, MAX_STARS_PER_DAY, STAR_HISTORY_DAYS, starAdjustBodySchema, starChartSchema, starHistory,
  starSettingsBodySchema, starsOn, starTotal, starWeek, starWeekStart,
} from '../../../shared/stars'

// The star chart's pure helpers and schemas. 2026-11-09 is a Monday.

describe('starWeek', () => {
  it('runs Monday to Sunday for a monday week start', () => {
    expect(starWeek('2026-11-11', 'monday')).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'])
    expect(starWeekStart('2026-11-15', 'monday')).toBe('2026-11-09')
    expect(starWeekStart('2026-11-09', 'monday')).toBe('2026-11-09')
  })

  it('runs Sunday to Saturday for a sunday week start', () => {
    expect(starWeek('2026-11-11', 'sunday')[0]).toBe('2026-11-08')
    expect(starWeek('2026-11-11', 'sunday')[6]).toBe('2026-11-14')
    expect(starWeekStart('2026-11-15', 'sunday')).toBe('2026-11-15')
  })

  it('crosses a month and a year', () => {
    expect(starWeek('2027-01-01', 'monday')[0]).toBe('2026-12-28')
  })
})

describe('starTotal', () => {
  const chart = { counts: { isla: { '2026-11-08': 4, '2026-11-09': 1, '2026-11-11': 2, '2026-11-15': 3 } } }

  it('counts only today for a day chart', () => {
    expect(starTotal(chart, { id: 'isla', period: 'day' }, '2026-11-11', 'monday')).toBe(2)
    expect(starTotal(chart, { id: 'isla', period: 'day' }, '2026-11-10', 'monday')).toBe(0)
  })

  it('adds up the week for a week chart, by the week start', () => {
    expect(starTotal(chart, { id: 'isla', period: 'week' }, '2026-11-11', 'monday')).toBe(6)
    expect(starTotal(chart, { id: 'isla', period: 'week' }, '2026-11-11', 'sunday')).toBe(7)
  })

  it('reads a missing person as 0', () => {
    expect(starTotal(chart, { id: 'theo', period: 'week' }, '2026-11-11', 'monday')).toBe(0)
    expect(starsOn(chart, 'theo', '2026-11-11')).toBe(0)
  })
})

describe('clampStars and starHistory', () => {
  it('keeps a count between 0 and the most a day holds, as a whole number', () => {
    expect(clampStars(-3)).toBe(0)
    expect(clampStars(5)).toBe(5)
    expect(clampStars(MAX_STARS_PER_DAY + 4)).toBe(MAX_STARS_PER_DAY)
    expect(clampStars(2.6)).toBe(3)
  })

  it('spans the history days ending today', () => {
    expect(starHistory('2026-11-09')).toEqual({ first: '2026-10-27', last: '2026-11-09' })
    expect(STAR_HISTORY_DAYS).toBe(14)
  })
})

describe('starAdjustBodySchema', () => {
  it('accepts a delta with or without a date', () => {
    expect(starAdjustBodySchema.safeParse({ delta: 1 }).success).toBe(true)
    expect(starAdjustBodySchema.safeParse({ delta: -10, date: '2026-11-09' }).success).toBe(true)
  })

  it('refuses a zero, fractional or too large delta, a bad date and an extra key', () => {
    for (const body of [{}, { delta: 0 }, { delta: 1.5 }, { delta: 11 }, { delta: -11 }, { delta: '1' }, { delta: 1, date: '2026-02-30' }, { delta: 1, date: '9/11/2026' }, { delta: 1, extra: true }]) {
      expect(starAdjustBodySchema.safeParse(body).success, JSON.stringify(body)).toBe(false)
    }
  })
})

describe('starSettingsBodySchema', () => {
  it('accepts the defaults and a goal', () => {
    expect(starSettingsBodySchema.safeParse(DEFAULT_STAR_SETTINGS).success).toBe(true)
    expect(starSettingsBodySchema.safeParse({ enabled: true, period: 'day', goal: 5 }).success).toBe(true)
  })

  it('refuses a missing field, an unknown period and a goal out of range', () => {
    for (const body of [{ enabled: true, period: 'week' }, { enabled: 'yes', period: 'week', goal: null }, { enabled: true, period: 'month', goal: null }, { enabled: true, period: 'week', goal: 0 }, { enabled: true, period: 'week', goal: 100 }, { enabled: true, period: 'week', goal: 2.5 }, { enabled: true, period: 'week', goal: null, extra: 1 }]) {
      expect(starSettingsBodySchema.safeParse(body).success, JSON.stringify(body)).toBe(false)
    }
  })
})

describe('starChartSchema', () => {
  const person = { id: 'isla', name: 'Isla', initial: 'I', colour: '#D27FA0', period: 'week', goal: null }

  it('accepts a chart, and one with fields it does not know', () => {
    expect(starChartSchema.safeParse({ people: [person], counts: { isla: { '2026-11-09': 3 } } }).success).toBe(true)
    expect(starChartSchema.safeParse({ people: [{ ...person, extra: 1 }], counts: {}, more: 1 }).success).toBe(true)
  })

  it('refuses a bad colour, a bad date and a negative count', () => {
    expect(starChartSchema.safeParse({ people: [{ ...person, colour: 'red' }], counts: {} }).success).toBe(false)
    expect(starChartSchema.safeParse({ people: [person], counts: { isla: { today: 1 } } }).success).toBe(false)
    expect(starChartSchema.safeParse({ people: [person], counts: { isla: { '2026-11-09': -1 } } }).success).toBe(false)
  })
})
