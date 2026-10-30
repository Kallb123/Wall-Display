import { describe, expect, it } from 'vitest'
import {
  CURRENT_MAX_AGE_MS,
  WEATHER_CONDITIONS,
  WEATHER_LABELS,
  currentWeather,
  formatTemperature,
  weatherLabel,
  weatherOn,
  weatherSnapshotSchema,
} from '../../../shared/weather'
import type { WeatherSnapshot } from '../../../shared/weather'

const UPDATED = '2026-10-28T09:00:00.000Z'
const NOW = new Date(UPDATED)

const snapshot = (changes: Partial<WeatherSnapshot> = {}): WeatherSnapshot => ({
  current: { condition: 'rainy', temperature: 12 },
  daily: [
    { date: '2026-10-28', condition: 'rainy', high: 14, low: 8 },
    { date: '2026-10-29', condition: null, high: null, low: null },
    { date: '2026-10-30', condition: 'sunny', high: null, low: 6 },
  ],
  temperature_unit: '°C',
  updated_at: UPDATED,
  ...changes,
})

describe('weatherOn', () => {
  it('finds the forecast for a date', () => {
    expect(weatherOn(snapshot(), '2026-10-28')).toEqual({ date: '2026-10-28', condition: 'rainy', high: 14, low: 8 })
  })

  it('is null for a date with no entry, a day with nothing known, or no snapshot', () => {
    expect(weatherOn(snapshot(), '2026-11-05')).toBeNull()
    expect(weatherOn(snapshot(), '2026-10-29')).toBeNull()
    expect(weatherOn(null, '2026-10-28')).toBeNull()
  })

  it('keeps a day with only some of it known', () => {
    expect(weatherOn(snapshot(), '2026-10-30')).toEqual({ date: '2026-10-30', condition: 'sunny', high: null, low: 6 })
  })
})

describe('currentWeather', () => {
  it('gives the current conditions while they are fresh', () => {
    expect(currentWeather(snapshot(), NOW)).toEqual({ condition: 'rainy', temperature: 12 })
    expect(currentWeather(snapshot(), new Date(NOW.getTime() + CURRENT_MAX_AGE_MS))).not.toBeNull()
  })

  it('drops them once they are older than the limit', () => {
    expect(currentWeather(snapshot(), new Date(NOW.getTime() + CURRENT_MAX_AGE_MS + 1))).toBeNull()
  })

  it('counts a snapshot dated after now (a small clock difference) as fresh', () => {
    expect(currentWeather(snapshot(), new Date(NOW.getTime() - 60_000))).not.toBeNull()
  })

  it('is null with no snapshot or nothing known', () => {
    expect(currentWeather(null, NOW)).toBeNull()
    expect(currentWeather(snapshot({ current: { condition: null, temperature: null } }), NOW)).toBeNull()
  })

  it('keeps a half-known current', () => {
    expect(currentWeather(snapshot({ current: { condition: null, temperature: 3 } }), NOW)).toEqual({ condition: null, temperature: 3 })
  })
})

describe('formatTemperature', () => {
  it('rounds to a whole degree', () => {
    expect(formatTemperature(12.4)).toBe('12°')
    expect(formatTemperature(12.5)).toBe('13°')
    expect(formatTemperature(-3.6)).toBe('-4°')
  })

  it('never writes -0', () => {
    expect(formatTemperature(-0)).toBe('0°')
    expect(formatTemperature(-0.4)).toBe('0°')
  })
})

describe('weatherLabel', () => {
  it('has words for every condition', () => {
    for (const condition of WEATHER_CONDITIONS) expect(weatherLabel(condition), condition).toBe(WEATHER_LABELS[condition])
    expect(Object.keys(WEATHER_LABELS).sort()).toEqual([...WEATHER_CONDITIONS].sort())
    expect(weatherLabel('rainy')).toBe('Rain')
  })

  it('is null for none', () => {
    expect(weatherLabel(null)).toBeNull()
  })
})

describe('weatherSnapshotSchema', () => {
  it('accepts a snapshot and refuses a condition it does not know', () => {
    expect(weatherSnapshotSchema.safeParse(snapshot()).success).toBe(true)
    expect(weatherSnapshotSchema.safeParse(snapshot({ current: { condition: 'hot' as never, temperature: 1 } })).success).toBe(false)
    expect(weatherSnapshotSchema.safeParse({ ...snapshot(), updated_at: 'yesterday' }).success).toBe(false)
  })
})
