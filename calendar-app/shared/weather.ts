import { z } from 'zod'
import { addDays, todayIn, wallClockIn } from './dates'

// The weather as the server hands it to the pages (PR 2.7): the current
// conditions from a Home Assistant `weather` entity's state, and its daily
// forecast. Pure: no I/O, and no imports from server/, so the display can use
// it too. The wire format is snake_case, like the state. A view leaves out any
// part that is null, and all of it when there is no snapshot.

/** Home Assistant's weather conditions. Anything else an integration reports is read as null. */
export const WEATHER_CONDITIONS = [
  'clear-night',
  'cloudy',
  'exceptional',
  'fog',
  'hail',
  'lightning',
  'lightning-rainy',
  'partlycloudy',
  'pouring',
  'rainy',
  'snowy',
  'snowy-rainy',
  'sunny',
  'windy',
  'windy-variant',
] as const
export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number]

/** What the wall writes for each condition, as in "12° · Rain". */
export const WEATHER_LABELS: Record<WeatherCondition, string> = {
  'clear-night': 'Clear',
  'cloudy': 'Cloudy',
  'exceptional': 'Unusual weather',
  'fog': 'Fog',
  'hail': 'Hail',
  'lightning': 'Thunder',
  'lightning-rainy': 'Thunderstorms',
  'partlycloudy': 'Partly cloudy',
  'pouring': 'Heavy rain',
  'rainy': 'Rain',
  'snowy': 'Snow',
  'snowy-rainy': 'Sleet',
  'sunny': 'Sunny',
  'windy': 'Windy',
  'windy-variant': 'Windy and cloudy',
}

/** Current conditions older than this are not shown: a wall that lost the server shouldn't claim it is sunny now. */
export const CURRENT_MAX_AGE_MS = 3 * 60 * 60 * 1000

const condition = z.enum(WEATHER_CONDITIONS).nullable()
const temperature = z.number().finite().nullable()

export const weatherDaySchema = z.object({
  /** `YYYY-MM-DD` in the display's time zone. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  condition,
  high: temperature,
  low: temperature,
})

export const weatherCurrentSchema = z.object({
  condition,
  temperature,
})

export const weatherHourSchema = z.object({
  /** The start of the hour, as an ISO 8601 instant (it names a moment, not a wall-clock reading). */
  time: z.iso.datetime({ offset: true }),
  condition,
  temperature,
  /** Millimetres expected in the hour, or null when the integration doesn't say. */
  precipitation: z.number().finite().nonnegative().nullable(),
  /** The chance of rain in the hour, from 0 to 100, or null. */
  precipitation_probability: z.number().finite().min(0).max(100).nullable(),
})

export const weatherSnapshotSchema = z.object({
  current: weatherCurrentSchema,
  /** One entry per day, in date order, no date twice. Starts at the forecast's first day, which may be before today. */
  daily: z.array(weatherDaySchema),
  /**
   * The hours still to come, in time order, no instant twice. Empty when the
   * integration has no hourly forecast. The default keeps a snapshot that was
   * cached on a wall before this field existed valid.
   */
  hourly: z.array(weatherHourSchema).default([]),
  /** As Home Assistant gives it (`°C`, `°F`), or null. The wall shows only `°`. */
  temperature_unit: z.string().nullable(),
  /** When the server last fetched it successfully, as an ISO 8601 instant. */
  updated_at: z.iso.datetime(),
})

export type WeatherDay = z.output<typeof weatherDaySchema>
export type WeatherHour = z.output<typeof weatherHourSchema>
export type WeatherCurrent = z.output<typeof weatherCurrentSchema>
export type WeatherSnapshot = z.output<typeof weatherSnapshotSchema>

/** The forecast for `date` (`YYYY-MM-DD`), or null when there is none. */
export function weatherOn(snapshot: WeatherSnapshot | null, date: string): WeatherDay | null {
  const day = snapshot?.daily.find(entry => entry.date === date)
  if (!day || (day.condition === null && day.high === null && day.low === null)) return null
  return day
}

/**
 * The forecast to draw next to `date` when today is `today` (both `YYYY-MM-DD`
 * in the display's time zone): `weatherOn`, but null for a day that is over. A
 * forecast often still lists yesterday, and a date in the past shows none.
 */
export function forecastOn(snapshot: WeatherSnapshot | null, date: string, today: string): WeatherDay | null {
  return date < today ? null : weatherOn(snapshot, date)
}

/** The current conditions, or null when there are none or they are older than `CURRENT_MAX_AGE_MS` at `now`. */
export function currentWeather(snapshot: WeatherSnapshot | null, now: Date): WeatherCurrent | null {
  if (!snapshot) return null
  const { current } = snapshot
  if (current.condition === null && current.temperature === null) return null
  const age = now.getTime() - new Date(snapshot.updated_at).getTime()
  if (!(age <= CURRENT_MAX_AGE_MS)) return null
  return current
}

/** `12°`, rounded to a whole degree, whatever the unit. Never `-0°`. */
export function formatTemperature(value: number): string {
  const rounded = Math.round(value)
  return `${rounded === 0 ? 0 : rounded}°`
}

/** The label for a condition, or null for none. */
export function weatherLabel(value: WeatherCondition | null): string | null {
  return value === null ? null : WEATHER_LABELS[value]
}

/** The body of `GET /api/weather`: null when weather is off or nothing has been fetched yet. */
export interface WeatherResponse {
  weather: WeatherSnapshot | null
}

/**
 * The parts of the day the photo frame's forecast is split into, as local
 * hours in the display's time zone: an hour belongs to the part whose
 * `[from, to)` holds its hour. Nothing is shown for the night.
 */
export const FORECAST_PARTS = [
  { id: 'morning', label: 'Morning', from: 6, to: 11 },
  { id: 'noon', label: 'Noon', from: 11, to: 14 },
  { id: 'afternoon', label: 'Afternoon', from: 14, to: 18 },
  { id: 'evening', label: 'Evening', from: 18, to: 22 },
] as const
export type ForecastPartId = (typeof FORECAST_PARTS)[number]['id']

export interface ForecastPart {
  id: ForecastPartId
  label: string
  condition: WeatherCondition | null
  /** Mean of the hours' temperatures, or null when none has one. */
  temperature: number | null
  /** Sum of the hours' precipitation in mm, or null when none has one. */
  precipitation: number | null
  /** Highest chance of rain among the hours, %, or null when none has one. */
  precipitation_probability: number | null
}

export interface DayForecast {
  /** `YYYY-MM-DD` in the display zone. */
  date: string
  /** True when today's parts are all over and these are tomorrow's. */
  tomorrow: boolean
  /** In order, only parts that are not over and have at least one hour of data. Never empty. */
  parts: ForecastPart[]
}

const HOUR_MS = 60 * 60 * 1000

/** The conditions from the most to the least severe: when two are equally common in a part, the first of them is shown. */
const SEVERITY: readonly WeatherCondition[] = [
  'lightning-rainy', 'hail', 'pouring', 'snowy-rainy', 'snowy', 'lightning', 'rainy',
  'exceptional', 'fog', 'windy-variant', 'windy', 'cloudy', 'partlycloudy', 'sunny', 'clear-night',
]

/**
 * The forecast by part of day for the wall, or null when there is nothing to
 * show. Only the hours still to come count, so a part in progress is made of
 * what is left of it, and a part that is over is left out. Once the last part
 * of today is over, tomorrow's are given instead. The hours are instants, so no
 * check of the snapshot's age is needed: the ones that have passed are dropped.
 */
export function dayForecast(snapshot: WeatherSnapshot | null, now: Date, timeZone: string): DayForecast | null {
  if (!snapshot || snapshot.hourly.length === 0) return null

  const today = todayIn(now, timeZone)
  const minutesNow = wallClockIn(now, timeZone).minutes
  // The hours that are not over, with where they fall on the wall.
  const upcoming = snapshot.hourly
    .map(hour => ({ hour, start: new Date(hour.time) }))
    .filter(({ start }) => start.getTime() + HOUR_MS > now.getTime())
    .map(({ hour, start }) => {
      const { date, minutes } = wallClockIn(start, timeZone)
      return { hour, date, local: Math.floor(minutes / 60) }
    })

  const partsOn = (date: string, isToday: boolean): ForecastPart[] => {
    const parts: ForecastPart[] = []
    for (const def of FORECAST_PARTS) {
      if (isToday && minutesNow >= def.to * 60) continue
      const hours = upcoming.filter(entry => entry.date === date && entry.local >= def.from && entry.local < def.to).map(entry => entry.hour)
      if (hours.length > 0) parts.push(summarise(def.id, def.label, hours))
    }
    return parts
  }

  const todayParts = partsOn(today, true)
  if (todayParts.length > 0) return { date: today, tomorrow: false, parts: todayParts }
  // Today's parts are all over only after the last of them has ended.
  if (minutesNow < FORECAST_PARTS[FORECAST_PARTS.length - 1]!.to * 60) return null
  const tomorrow = addDays(today, 1)
  const tomorrowParts = partsOn(tomorrow, false)
  return tomorrowParts.length > 0 ? { date: tomorrow, tomorrow: true, parts: tomorrowParts } : null
}

function summarise(id: ForecastPartId, label: string, hours: WeatherHour[]): ForecastPart {
  const known = <Key extends 'temperature' | 'precipitation' | 'precipitation_probability'>(key: Key): number[] =>
    hours.map(hour => hour[key]).filter((value): value is number => value !== null)
  const temperatures = known('temperature')
  const rain = known('precipitation')
  const chances = known('precipitation_probability')
  return {
    id,
    label,
    condition: commonCondition(hours),
    temperature: temperatures.length > 0 ? temperatures.reduce((sum, value) => sum + value, 0) / temperatures.length : null,
    precipitation: rain.length > 0 ? rain.reduce((sum, value) => sum + value, 0) : null,
    precipitation_probability: chances.length > 0 ? Math.max(...chances) : null,
  }
}

/** The most frequent condition of the hours that have one; a tie goes to the more severe. */
function commonCondition(hours: WeatherHour[]): WeatherCondition | null {
  const counts = new Map<WeatherCondition, number>()
  for (const hour of hours) {
    if (hour.condition !== null) counts.set(hour.condition, (counts.get(hour.condition) ?? 0) + 1)
  }
  let best: WeatherCondition | null = null
  for (const candidate of SEVERITY) {
    const count = counts.get(candidate) ?? 0
    if (count > 0 && (best === null || count > counts.get(best)!)) best = candidate
  }
  return best
}

/** How much rain a part expects: `40%` when a chance is known, else `1.2 mm` (`0 mm` for none), else null. */
export function formatRain(part: Pick<ForecastPart, 'precipitation' | 'precipitation_probability'>): string | null {
  if (part.precipitation_probability !== null) return `${Math.round(part.precipitation_probability)}%`
  if (part.precipitation === null) return null
  const mm = Math.round(part.precipitation * 10) / 10
  return mm === 0 ? '0 mm' : `${mm.toFixed(1)} mm`
}
