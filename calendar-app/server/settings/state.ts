import type { SettingsStore } from './store'

// Holds the running settings store between the settings plugin and useSettings(). Not auto-imported.
let current: SettingsStore | undefined

export function setSettings(store: SettingsStore | undefined): void {
  current = store
}

export function getSettings(): SettingsStore | undefined {
  return current
}
