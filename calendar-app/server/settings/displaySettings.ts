import { PHOTO_SOURCES } from '../../shared/display'
import type { DisplaySettings, PhotoSource } from '../../shared/display'
import type { AppConfig } from '../config/schema'

/** The photo sources that are set up, in the order a display falls back to them, from the names the photo service says are configured. */
export function photoSourcesOf(configured: readonly string[]): PhotoSource[] {
  return PHOTO_SOURCES.filter(source => configured.includes(source))
}

/**
 * One display's settings as the wall and the remote have them: from the
 * effective config (`useSettings().config()`), without any secret. The same
 * shape is `GET /api/displays`, the `settings.updated` socket message and what
 * a new socket is sent. Throws for an id that is not in the config.
 */
export function displaySettings(config: Pick<AppConfig, 'timezone' | 'displays'>, displayId: string, photoSources: PhotoSource[]): DisplaySettings {
  const display = config.displays.find(candidate => candidate.id === displayId)
  if (!display) throw new Error(`Unknown display "${displayId}"`)
  return {
    id: display.id,
    name: display.name,
    theme: display.theme,
    month_style: display.month_style,
    week_start: display.week_start,
    timezone: config.timezone,
    burn_in: display.burn_in,
    motion: display.motion,
    night_text: display.night_text,
    orientation: display.orientation,
    week_hours: { from: display.week_hours.from, to: display.week_hours.to },
    day_parts: { afternoon: display.day_parts.afternoon, evening: display.day_parts.evening },
    weather_on_dates: { month: display.weather_on_dates.month, week: display.weather_on_dates.week, week_parts: display.weather_on_dates.week_parts, agenda: display.weather_on_dates.agenda },
    show_locations: display.show_locations,
    photo_sources: photoSources,
  }
}
