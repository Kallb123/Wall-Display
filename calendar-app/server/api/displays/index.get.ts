import { PHOTO_SOURCES } from '../../../shared/display'
import type { DisplaySettings } from '../../../shared/display'

// Every display's settings from config, so the page can pick its theme and
// time zone. Only the fields the page needs: the rest of the config can hold secrets.
// `photo_sources` says which photo sources are set up (and so which the remote may offer), by name only.
export default defineEventHandler((): DisplaySettings[] => {
  const config = useConfig()
  const configured = usePhotos()?.configured() ?? []
  const photoSources = PHOTO_SOURCES.filter(source => configured.includes(source))

  return config.displays.map(display => ({
    id: display.id,
    name: display.name,
    theme: display.theme,
    month_style: display.month_style,
    week_start: display.week_start,
    timezone: config.timezone,
    photo_sources: photoSources,
  }))
})
