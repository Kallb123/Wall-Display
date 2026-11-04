import { displaySettings, photoSourcesOf } from '../settings/displaySettings'
import { getSettings, setSettings } from '../settings/state'
import { createSettingsStore } from '../settings/store'
import { getSocketHub } from '../ws/hub'

// Runs after the database plugin (01.db sorts first) and before everything that
// reads the config. It reads the preferences saved on the settings page, puts
// them on top of the config, and from then on `useSettings().config()` is the
// config in force. When a save changes a display's settings, the new ones go
// to that display's sockets, wall and remote alike, so the page re-themes
// without a reload. The services that care (control, photos, policies) hear
// the same bus event and read the config again themselves.
export default defineNitroPlugin((nitroApp) => {
  // A hot reload runs this again in the same process, so drop the old store first.
  setSettings(undefined)

  const bus = useEventBus()
  const store = createSettingsStore({ db: useDb(), config: useConfig(), bus })
  setSettings(store)

  const unsubscribe = bus.on('settings.updated', ({ displayIds }) => {
    const config = store.config()
    const photoSources = photoSourcesOf(usePhotos()?.configured() ?? [])
    for (const displayId of displayIds) {
      getSocketHub().sendToDisplay(displayId, { type: 'settings.updated', display_id: displayId, settings: displaySettings(config, displayId, photoSources) })
    }
  })

  nitroApp.hooks.hook('close', () => {
    unsubscribe()
    if (getSettings() === store) setSettings(undefined)
  })
})
