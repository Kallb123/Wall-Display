import type { HomeAssistantConfig } from '../../config/schema'
import type { HaStatusCache } from './status'

// Holds the Home Assistant status cache between the requests that use it. It
// is made on first use (there is no plugin: nothing runs until the settings
// page asks), and it remembers which config it was made for, so a reload with
// a new URL or token starts again. Not auto-imported.
let current: { config: HomeAssistantConfig, cache: HaStatusCache } | undefined

export function getHaStatusCache(config: HomeAssistantConfig): HaStatusCache | undefined {
  return current?.config === config ? current.cache : undefined
}

export function setHaStatusCache(config: HomeAssistantConfig, cache: HaStatusCache): void {
  current = { config, cache }
}
