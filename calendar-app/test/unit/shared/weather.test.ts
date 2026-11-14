import { describe, expect, it } from 'vitest'
import {
  CURRENT_MAX_AGE_MS,
  WEATHER_CONDITIONS,
  WEATHER_LABELS,
  FORECAST_PARTS,
  currentWeather,
  dayForecast,
  forecastOn,
  formatRain,
  formatTemperature,
  weatherLabel,
  weatherOn,
  weatherSnapshotSchema,
} from '../../../shared/weather'
import type { WeatherHour, WeatherSnapshot } from '../../../shared/weather'

const UPDATED = '2026-10-28T09:00:00.000Z'
const NOW = new Date(UPDATED)

const snapshot = (changes: Partial<WeatherSnapshot> = {}): WeatherSnapshot => ({
  current: { condition: 'rainy', temperature: 12 },
  daily: [
    { date: '2026-10-28', condition: 'rainy', high: 14, low: 8 },
    { date: '2026-10-29', condition: null, high: null, low: null },
    { date: '2026-10-30', condition: 'sunny', high: null, low: 6 },
  ],
  hourly: [],
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

describe('forecastOn', () => {
  it('is the forecast for today and the days after', () => {
    expect(forecastOn(snapshot(), '2026-10-28', '2026-10-28')).toEqual({ date: '2026-10-28', condition: 'rainy', high: 14, low: 8 })
    expect(forecastOn(snapshot(), '2026-10-30', '2026-10-28')).toEqual({ date: '2026-10-30', condition: 'sunny', high: null, low: 6 })
  })

  it('is null for a day before today, even if the snapshot still lists it', () => {
    expect(forecastOn(snapshot(), '2026-10-28', '2026-10-29')).toBeNull()
  })

  it('is null with no entry or no snapshot', () => {
    expect(forecastOn(snapshot(), '2026-11-05', '2026-10-28')).toBeNull()
    expect(forecastOn(null, '2026-10-28', '2026-10-28')).toBeNull()
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

describe('weatherSnapshotSchema hourly', () => {
  it('reads a snapshot cached before there was an hourly forecast as having none', () => {
    const { hourly: _hourly, ...old } = snapshot()

    expect(weatherSnapshotSchema.parse(old).hourly).toEqual([])
  })

  it.each([
    ['a time with no offset', { time: '2026-10-28T09:00:00' }],
    ['negative rain', { precipitation: -1 }],
    ['a chance over 100', { precipitation_probability: 101 }],
  ])('refuses %s', (_name, change) => {
    expect(weatherSnapshotSchema.safeParse(snapshot({ hourly: [{ ...hourAt('2026-10-28T09:00:00Z'), ...change }] })).success).toBe(false)
  })
})

function hourAt(time: string, changes: Partial<WeatherHour> = {}): WeatherHour {
  return { time: new Date(time).toISOString(), condition: 'sunny', temperature: 10, precipitation: null, precipitation_probability: null, ...changes }
}

/** One hour per local hour in London on 28 October 2026 (BST ended on the 25th, so London is UTC then), from `from` to before `to`. */
function hoursOn(date: string, from: number, to: number, changes: (hour: number) => Partial<WeatherHour> = () => ({})): WeatherHour[] {
  return Array.from({ length: to - from }, (_, index) => hourAt(`${date}T${String(from + index).padStart(2, '0')}:00:00Z`, changes(from + index)))
}

const LONDON = 'Europe/London'

describe('dayForecast', () => {
  const whole = (changes: (hour: number) => Partial<WeatherHour> = () => ({})) => snapshot({ hourly: [...hoursOn('2026-10-28', 0, 24, changes), ...hoursOn('2026-10-29', 0, 24, changes)] })

  it('is the four parts of today from early morning, in order', () => {
    const forecast = dayForecast(whole(), new Date('2026-10-28T05:30:00Z'), LONDON)

    expect(forecast?.date).toBe('2026-10-28')
    expect(forecast?.tomorrow).toBe(false)
    expect(forecast?.parts.map(part => [part.id, part.label])).toEqual(FORECAST_PARTS.map(part => [part.id, part.label]))
  })

  it('is the mean temperature, the total rain and the highest chance of each part', () => {
    const forecast = dayForecast(whole(hour => ({ temperature: hour, precipitation: 0.5, precipitation_probability: hour * 2 })), new Date('2026-10-28T05:00:00Z'), LONDON)

    // Morning is 6 to 10, noon 11 to 13.
    expect(forecast?.parts[0]).toMatchObject({ id: 'morning', temperature: 8, precipitation: 2.5, precipitation_probability: 20 })
    expect(forecast?.parts[1]).toMatchObject({ id: 'noon', temperature: 12, precipitation: 1.5, precipitation_probability: 26 })
  })

  it('leaves out the hours that are over, so a part in progress is what is left of it, and the parts that are over', () => {
    const forecast = dayForecast(whole(hour => ({ temperature: hour })), new Date('2026-10-28T08:30:00Z'), LONDON)

    // The hour from 08:00 ends at 09:00, after now, so it counts: 8, 9, 10.
    expect(forecast?.parts.map(part => part.id)).toEqual(['morning', 'noon', 'afternoon', 'evening'])
    expect(forecast?.parts[0]?.temperature).toBe(9)

    const later = dayForecast(whole(hour => ({ temperature: hour })), new Date('2026-10-28T14:00:00Z'), LONDON)
    expect(later?.parts.map(part => part.id)).toEqual(['afternoon', 'evening'])
    expect(later?.parts[0]?.temperature).toBe(15.5)
  })

  it('leaves out a part whose hours have no data', () => {
    const sparse = snapshot({ hourly: [...hoursOn('2026-10-28', 6, 11), ...hoursOn('2026-10-28', 18, 22)] })

    expect(dayForecast(sparse, new Date('2026-10-28T05:00:00Z'), LONDON)?.parts.map(part => part.id)).toEqual(['morning', 'evening'])
  })

  it('shows tomorrow once the evening is over', () => {
    const forecast = dayForecast(whole(), new Date('2026-10-28T22:00:00Z'), LONDON)

    expect(forecast).toMatchObject({ date: '2026-10-29', tomorrow: true })
    expect(forecast?.parts).toHaveLength(4)
  })

  it('keeps showing the evening until 22:00, then tomorrow, in the display zone and not UTC', () => {
    // 21:30 in London is 21:30 UTC in late October; in New York it is still the afternoon.
    expect(dayForecast(whole(), new Date('2026-10-28T21:30:00Z'), LONDON)?.tomorrow).toBe(false)
    expect(dayForecast(whole(), new Date('2026-10-28T21:30:00Z'), 'America/New_York')?.parts.length).toBeGreaterThan(0)
  })

  it('is null when there is nothing to show', () => {
    expect(dayForecast(null, NOW, LONDON)).toBeNull()
    expect(dayForecast(snapshot(), NOW, LONDON)).toBeNull()
    // Only hours in the night.
    expect(dayForecast(snapshot({ hourly: hoursOn('2026-10-28', 0, 5) }), new Date('2026-10-28T00:30:00Z'), LONDON)).toBeNull()
    // Today is over and tomorrow's hours are not in the forecast.
    expect(dayForecast(snapshot({ hourly: hoursOn('2026-10-28', 6, 22) }), new Date('2026-10-28T22:30:00Z'), LONDON)).toBeNull()
    // Hours all in the past.
    expect(dayForecast(snapshot({ hourly: hoursOn('2026-10-28', 6, 10) }), new Date('2026-10-28T09:30:00Z'), LONDON)).not.toBeNull()
    expect(dayForecast(snapshot({ hourly: hoursOn('2026-10-28', 6, 10) }), new Date('2026-10-28T10:00:00Z'), LONDON)).toBeNull()
  })

  it('takes the most frequent condition of a part', () => {
    const conditions = ['rainy', 'sunny', 'sunny', 'cloudy', 'sunny'] as const
    const forecast = dayForecast(snapshot({ hourly: hoursOn('2026-10-28', 6, 11, hour => ({ condition: conditions[hour - 6] })) }), new Date('2026-10-28T05:00:00Z'), LONDON)

    expect(forecast?.parts[0]?.condition).toBe('sunny')
  })

  it('gives a tie to the more severe condition', () => {
    const conditions = ['sunny', 'rainy', 'sunny', 'rainy', null] as const
    const forecast = dayForecast(snapshot({ hourly: hoursOn('2026-10-28', 6, 11, hour => ({ condition: conditions[hour - 6] ?? null })) }), new Date('2026-10-28T05:00:00Z'), LONDON)

    expect(forecast?.parts[0]?.condition).toBe('rainy')
  })

  it('has no condition when none of the hours has one, and ignores nulls in the means', () => {
    const forecast = dayForecast(snapshot({ hourly: hoursOn('2026-10-28', 6, 8, hour => ({ condition: null, temperature: hour === 6 ? null : 7 })) }), new Date('2026-10-28T05:00:00Z'), LONDON)

    expect(forecast?.parts[0]).toMatchObject({ condition: null, temperature: 7, precipitation: null, precipitation_probability: null })
  })

  it('reads the hours as the wall does across the end of summer time', () => {
    // BST ends on 25 October 2026: the 25th has 25 hours, and 06:00 BST (05:00 UTC) is on the 24th's clock.
    const hourly = Array.from({ length: 30 }, (_, index) => hourAt(new Date(Date.UTC(2026, 9, 24, 21) + index * 3_600_000).toISOString(), { temperature: index }))
    const forecast = dayForecast(snapshot({ hourly }), new Date('2026-10-24T21:30:00Z'), LONDON)

    // It is 22:30 on the 24th in London: tomorrow's parts, with the morning starting at 06:00 GMT (06:00 UTC, index 9).
    expect(forecast).toMatchObject({ date: '2026-10-25', tomorrow: true })
    expect(forecast?.parts[0]).toMatchObject({ id: 'morning', temperature: 11 })
  })
})

describe('formatRain', () => {
  const rain = (precipitation: number | null, precipitation_probability: number | null) => formatRain({ precipitation, precipitation_probability })

  it('gives the chance when one is known, rounded', () => {
    expect(rain(1.2, 40)).toBe('40%')
    expect(rain(null, 39.6)).toBe('40%')
    expect(rain(0, 0)).toBe('0%')
  })

  it('gives the amount to one decimal otherwise, and 0 mm for none', () => {
    expect(rain(1.24, null)).toBe('1.2 mm')
    expect(rain(3, null)).toBe('3.0 mm')
    expect(rain(0, null)).toBe('0 mm')
  })

  it('is null when neither is known', () => {
    expect(rain(null, null)).toBeNull()
  })
})
