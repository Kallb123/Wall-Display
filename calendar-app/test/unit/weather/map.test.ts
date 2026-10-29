import { describe, expect, it } from 'vitest'
import { weatherSnapshotSchema } from '../../../shared/weather'
import { mapWeather } from '../../../server/weather/map'
import type { HaForecastEntry, HaWeather } from '../../../server/weather/types'

const NOW = new Date('2026-10-28T12:34:56.789Z')

function weather(overrides: Partial<HaWeather> = {}): HaWeather {
  return { state: 'rainy', attributes: { temperature: 12, temperature_unit: '°C' }, forecast: [], ...overrides }
}

function entry(datetime: string, overrides: Partial<HaForecastEntry> = {}): HaForecastEntry {
  return { datetime, condition: 'cloudy', temperature: 11, templow: 6, ...overrides }
}

const daily = (forecast: HaForecastEntry[], timeZone = 'Europe/London') => mapWeather(weather({ forecast }), { timeZone, now: NOW }).daily

describe('mapWeather current conditions', () => {
  it('takes the condition from the state and the temperature and unit from the attributes', () => {
    expect(mapWeather(weather(), { timeZone: 'Europe/London', now: NOW })).toEqual({
      current: { condition: 'rainy', temperature: 12 },
      daily: [],
      temperature_unit: '°C',
      updated_at: '2026-10-28T12:34:56.789Z',
    })
  })

  it.each(['unavailable', 'unknown', '', 'drizzle', 'Rainy'])('reads the state %j as no condition', (state) => {
    expect(mapWeather(weather({ state }), { timeZone: 'Europe/London', now: NOW }).current.condition).toBeNull()
  })

  it('keeps the temperature when the condition is unknown, and the other way round', () => {
    const unknown = mapWeather(weather({ state: 'unknown' }), { timeZone: 'Europe/London', now: NOW })
    const noTemperature = mapWeather(weather({ attributes: { temperature: null, temperature_unit: null } }), { timeZone: 'Europe/London', now: NOW })

    expect(unknown.current).toEqual({ condition: null, temperature: 12 })
    expect(noTemperature.current).toEqual({ condition: 'rainy', temperature: null })
    expect(noTemperature.temperature_unit).toBeNull()
  })

  it('knows every condition Home Assistant defines', () => {
    for (const state of ['clear-night', 'cloudy', 'exceptional', 'fog', 'hail', 'lightning', 'lightning-rainy', 'partlycloudy', 'pouring', 'rainy', 'snowy', 'snowy-rainy', 'sunny', 'windy', 'windy-variant']) {
      expect(mapWeather(weather({ state }), { timeZone: 'UTC', now: NOW }).current.condition).toBe(state)
    }
  })

  it('stamps the snapshot with the time it was fetched', () => {
    expect(mapWeather(weather(), { timeZone: 'UTC', now: new Date('2026-01-02T03:04:05Z') }).updated_at).toBe('2026-01-02T03:04:05.000Z')
  })

  it('makes something the pages accept', () => {
    const snapshot = mapWeather(weather({ forecast: [entry('2026-10-28T11:00:00+00:00'), entry('bad')] }), { timeZone: 'Europe/London', now: NOW })

    expect(weatherSnapshotSchema.parse(snapshot)).toEqual(snapshot)
  })
})

describe('mapWeather daily forecast', () => {
  it('maps the condition, the high and the low', () => {
    expect(daily([entry('2026-10-28T11:00:00+00:00', { condition: 'rainy', temperature: 14, templow: 8 })])).toEqual([
      { date: '2026-10-28', condition: 'rainy', high: 14, low: 8 },
    ])
  })

  it('reads a missing low or high as null, and an unknown condition as none', () => {
    expect(daily([
      entry('2026-10-28T11:00:00+00:00', { templow: null }),
      entry('2026-10-29T11:00:00+00:00', { temperature: null }),
      entry('2026-10-30T11:00:00+00:00', { condition: 'drizzle' }),
      entry('2026-10-31T11:00:00+00:00', { condition: null }),
    ])).toEqual([
      { date: '2026-10-28', condition: 'cloudy', high: 11, low: null },
      { date: '2026-10-29', condition: 'cloudy', high: null, low: 6 },
      { date: '2026-10-30', condition: null, high: 11, low: 6 },
      { date: '2026-10-31', condition: null, high: 11, low: 6 },
    ])
  })

  it('puts a time on the date it falls on in the display zone, not the date in UTC', () => {
    // Midnight on the 29th in Auckland (NZDT, UTC+13) is 11:00 on the 28th in UTC.
    expect(daily([entry('2026-10-28T11:00:00+00:00')], 'Pacific/Auckland').map(day => day.date)).toEqual(['2026-10-29'])
    // And 23:00 on the 28th in UTC is already the 29th in Berlin (UTC+1 once the clocks have gone back).
    expect(daily([entry('2026-10-28T23:00:00Z')], 'Europe/Berlin').map(day => day.date)).toEqual(['2026-10-29'])
    // Midnight on the 28th in New York (EDT, UTC-4) is 04:00 UTC, so a minute earlier is still the 27th.
    expect(daily([entry('2026-10-28T03:59:00Z')], 'America/New_York').map(day => day.date)).toEqual(['2026-10-27'])
    expect(daily([entry('2026-10-28T04:00:00Z')], 'America/New_York').map(day => day.date)).toEqual(['2026-10-28'])
  })

  it('reads an offset as the instant it says', () => {
    // 23:30 on the 28th at UTC-1 is 00:30 on the 29th in UTC, and the 29th in London.
    expect(daily([entry('2026-10-28T23:30:00-01:00')]).map(day => day.date)).toEqual(['2026-10-29'])
    expect(daily([entry('2026-10-29T00:30:00+01:00')]).map(day => day.date)).toEqual(['2026-10-28'])
  })

  it('follows the clocks going back: the day of the change has 25 hours', () => {
    // London went back on 25 October 2026, so midnight local that day was 23:00 UTC on the 24th (BST), and the 26th began at 00:00 UTC.
    expect(daily([
      entry('2026-10-24T23:00:00+00:00'),
      entry('2026-10-25T23:00:00+00:00'),
      entry('2026-10-26T00:00:00+00:00'),
    ]).map(day => day.date)).toEqual(['2026-10-25', '2026-10-26'])
  })

  it('does not depend on the time zone of the process', () => {
    // Vitest runs the unit tests in Pacific/Auckland, where 23:30 UTC on the 28th is already the 29th.
    expect(daily([entry('2026-10-28T23:30:00Z')], 'Europe/London').map(day => day.date)).toEqual(['2026-10-28'])
    expect(daily([entry('2026-10-28T23:30:00')], 'Europe/London').map(day => day.date)).toEqual(['2026-10-28'])
  })

  it('takes a date alone, or a time with no offset, as the day it names', () => {
    expect(daily([entry('2026-10-28'), entry('2026-10-29T00:00:00'), entry('2026-10-30T23:59'), entry('2026-10-31T12:00:00.5')], 'Pacific/Auckland').map(day => day.date)).toEqual([
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
    ])
  })

  it('leaves out a day whose time cannot be read, and keeps the rest', () => {
    expect(daily([
      entry('tomorrow'),
      entry(''),
      entry('2026-02-30'),
      entry('2026-13-01T00:00:00Z'),
      entry('2026-10-28T25:00:00Z'),
      entry('2026-10-28T11:00:00+25:00'),
      entry('2026-10-28 11:00:00+00:00'),
      entry('2026-10-28T11:00:00+0000'),
      entry('2026-10-29T11:00:00+00:00'),
    ]).map(day => day.date)).toEqual(['2026-10-29'])
  })

  it('keeps the first entry for a date', () => {
    expect(daily([
      entry('2026-10-28T11:00:00+00:00', { condition: 'rainy', temperature: 14 }),
      entry('2026-10-28T15:00:00+00:00', { condition: 'sunny', temperature: 20 }),
      // The same date at the display, though not in UTC.
      entry('2026-10-27T23:30:00-01:00', { condition: 'fog', temperature: 1 }),
    ])).toEqual([{ date: '2026-10-28', condition: 'rainy', high: 14, low: 6 }])
  })

  it('puts the days in date order whatever order Home Assistant gave them', () => {
    expect(daily([entry('2026-10-30'), entry('2026-10-28'), entry('2026-12-01'), entry('2026-10-29'), entry('2027-01-01')]).map(day => day.date)).toEqual([
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-12-01',
      '2027-01-01',
    ])
  })

  it('keeps a day that has nothing in it: the pages leave it out themselves', () => {
    expect(daily([entry('2026-10-28', { condition: null, temperature: null, templow: null })])).toEqual([{ date: '2026-10-28', condition: null, high: null, low: null }])
  })
})
