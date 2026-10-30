import { getWeather } from '../weather/state'
import type { WeatherService } from '../weather/service'

/**
 * The weather service, or undefined when the config has no `weather` block.
 * Started at boot by `server/plugins/05.weather.ts`. Server code only. Call it
 * inside a handler, not at import time.
 */
export function useWeather(): WeatherService | undefined {
  return getWeather()
}
