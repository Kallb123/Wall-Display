import { z } from 'zod'

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

export const weatherSnapshotSchema = z.object({
  current: weatherCurrentSchema,
  /** One entry per day, in date order, no date twice. Starts at the forecast's first day, which may be before today. */
  daily: z.array(weatherDaySchema),
  /** As Home Assistant gives it (`°C`, `°F`), or null. The wall shows only `°`. */
  temperature_unit: z.string().nullable(),
  /** When the server last fetched it successfully, as an ISO 8601 instant. */
  updated_at: z.iso.datetime(),
})

export type WeatherDay = z.output<typeof weatherDaySchema>
export type WeatherCurrent = z.output<typeof weatherCurrentSchema>
export type WeatherSnapshot = z.output<typeof weatherSnapshotSchema>

/** The forecast for `date` (`YYYY-MM-DD`), or null when there is none. */
export function weatherOn(snapshot: WeatherSnapshot | null, date: string): WeatherDay | null {
  const day = snapshot?.daily.find(entry => entry.date === date)
  if (!day || (day.condition === null && day.high === null && day.low === null)) return null
  return day
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
