import { todayIn } from '../../shared/dates'
import { WEATHER_CONDITIONS } from '../../shared/weather'
import type { WeatherCondition, WeatherDay, WeatherSnapshot } from '../../shared/weather'
import type { HaWeather } from './types'

// Turns Home Assistant's weather into the snapshot the pages show. Pure: no
// I/O, and nothing reads the process's time zone. A forecast day belongs to
// the date its time falls on at the display, not the date in UTC.

export interface MapWeatherOptions {
  /** The display zone, which decides what date a forecast day is. */
  timeZone: string
  /** When the weather was fetched. It becomes `updated_at`. */
  now: Date
}

export function mapWeather(raw: HaWeather, { timeZone, now }: MapWeatherOptions): WeatherSnapshot {
  // Home Assistant lists the days in order, but nothing promises it, and one
  // date must not appear twice: the first entry for a date is the one kept.
  const days = new Map<string, WeatherDay>()
  for (const entry of raw.forecast) {
    const date = dateOf(entry.datetime, timeZone)
    if (date === null || days.has(date)) continue
    days.set(date, { date, condition: conditionOf(entry.condition), high: entry.temperature, low: entry.templow })
  }

  return {
    // `unavailable` and `unknown` are states, not conditions, so they come out as none.
    current: { condition: conditionOf(raw.state), temperature: raw.attributes.temperature },
    daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    temperature_unit: raw.attributes.temperature_unit,
    updated_at: now.toISOString(),
  }
}

function conditionOf(value: string | null): WeatherCondition | null {
  return (WEATHER_CONDITIONS as readonly string[]).includes(value ?? '') ? value as WeatherCondition : null
}

// 2026-10-28, optionally with a time (`T11:00`, with seconds and a fraction),
// then `Z`, an offset or nothing.
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/

/**
 * The date, `YYYY-MM-DD`, that a forecast time falls on at the display, or
 * null if it can't be read. A time with `Z` or an offset is an instant and is
 * read in `timeZone`. A date alone, or a time with no offset, already says
 * which day it is for, so that day is used as it is.
 */
function dateOf(text: string, timeZone: string): string | null {
  const match = DATE_TIME.exec(text)
  if (!match) return null
  const [, year, month, day, zone] = match
  const date = `${year}-${month}-${day}`
  if (!isCalendarDay(Number(year), Number(month), Number(day))) return null
  if (zone === undefined) return date

  // With an offset the text is unambiguous, so the parser doesn't use the process's zone.
  const instant = new Date(text)
  return Number.isNaN(instant.getTime()) ? null : todayIn(instant, timeZone)
}

function isCalendarDay(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}
