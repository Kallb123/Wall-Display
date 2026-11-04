import type { DisplaySettings } from '../../../shared/display'
import { displaySettings, photoSourcesOf } from '../../settings/displaySettings'

// Every display's settings, so the page can pick its theme and time zone. They
// are the config's with any change saved on the settings page on top, and only
// the fields the page needs: the rest of the config can hold secrets.
// `photo_sources` says which photo sources are set up (and so which the remote may offer), by name only.
export default defineEventHandler((): DisplaySettings[] => {
  const config = useSettings().config()
  const photoSources = photoSourcesOf(usePhotos()?.configured() ?? [])
  return config.displays.map(display => displaySettings(config, display.id, photoSources))
})
