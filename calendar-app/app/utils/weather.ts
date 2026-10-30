import type { Component } from 'vue'
import {
  Cloud, CloudFog, CloudHail, CloudLightning, CloudRain, CloudRainWind, CloudSnow, CloudSun, Moon, Sun, TriangleAlert, Wind,
} from 'lucide-vue-next'
import { formatTemperature, weatherLabel } from '../../shared/weather'
import type { WeatherCondition, WeatherCurrent, WeatherDay } from '../../shared/weather'

// What the views need to draw the weather (PR 2.7): an icon for each of Home
// Assistant's conditions, and a day's high and low as text. The icons are
// imported one by one so the bundle holds these and not all of Lucide, as in
// overlay.ts. Pure: no Nuxt imports. The snapshot, its labels and the whole
// degree rounding are in shared/weather.

const ICONS = {
  'sunny': Sun,
  'clear-night': Moon,
  'partlycloudy': CloudSun,
  'cloudy': Cloud,
  'fog': CloudFog,
  'rainy': CloudRain,
  'pouring': CloudRainWind,
  'snowy': CloudSnow,
  // Lucide has no sleet; snow falling from a cloud is the nearest, and the label says "Sleet".
  'snowy-rainy': CloudSnow,
  'hail': CloudHail,
  'lightning': CloudLightning,
  'lightning-rainy': CloudLightning,
  'windy': Wind,
  'windy-variant': Wind,
  'exceptional': TriangleAlert,
} as const satisfies Record<WeatherCondition, Component>

/** The icon for a condition, or null when there is none to draw. */
export function weatherIcon(condition: WeatherCondition | null): Component | null {
  return condition === null ? null : ICONS[condition]
}

/** `12° · Rain`, or just the one that is known, or null when neither is. */
export function formatCurrent(current: WeatherCurrent): string | null {
  const parts = [current.temperature === null ? null : formatTemperature(current.temperature), weatherLabel(current.condition)]
  const known = parts.filter(part => part !== null)
  return known.length ? known.join(' · ') : null
}

/** `14° / 8°`, or just the one that is known, or null when neither is. */
export function formatHighLow(day: Pick<WeatherDay, 'high' | 'low'>): string | null {
  const parts = [day.high, day.low].filter(value => value !== null).map(formatTemperature)
  return parts.length ? parts.join(' / ') : null
}
