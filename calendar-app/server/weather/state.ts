import type { WeatherService } from './service'

// Holds the running weather service between the weather plugin and useWeather(). Not auto-imported.
let current: WeatherService | undefined

export function setWeather(service: WeatherService | undefined): void {
  current = service
}

export function getWeather(): WeatherService | undefined {
  return current
}
