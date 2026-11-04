import { getSettings } from '../settings/state'
import type { SettingsStore } from '../settings/store'

/**
 * The saved preferences on top of the config (PR 5.6). `config()` is the config
 * in force, with the changes made on the settings page merged in; read it
 * where a preference matters, and again after `settings.updated`, rather than
 * holding on to it. Created at boot by `server/plugins/01.settings.ts`.
 * Server code only. Call it inside a handler or a later plugin, not at import time.
 */
export function useSettings(): SettingsStore {
  const store = getSettings()
  if (!store) {
    throw new Error('useSettings() was called before the settings store started. The 01.settings plugin starts it at boot; call useSettings() inside a handler or a later plugin, not at import time.')
  }
  return store
}
