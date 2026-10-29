import type { WeatherResponse } from '../../shared/weather'

// The weather the displays are showing: the last good snapshot, or null when
// the config has no `weather` block or Home Assistant has not answered yet.
// The wire format is the one the WebSocket sends in `weather.updated`.
export default defineEventHandler((): WeatherResponse => {
  return { weather: useWeather()?.get() ?? null }
})
