import type { AppConfig } from './schema'

// Holds the config between the boot plugin and useConfig(). Not auto-imported.
let current: AppConfig | undefined

export function setLoadedConfig(config: AppConfig | undefined): void {
  current = config
}

export function getLoadedConfig(): AppConfig | undefined {
  return current
}
