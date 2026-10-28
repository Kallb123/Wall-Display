import { getLoadedConfig } from '../config/state'
import type { AppConfig } from '../config/schema'

/**
 * The validated config, loaded once at boot by `server/plugins/00.config.ts`.
 * It is deep-frozen. Server code only: config holds secrets and must never be
 * sent to the browser.
 */
export function useConfig(): AppConfig {
  const config = getLoadedConfig()
  if (!config) {
    throw new Error('useConfig() was called before the config was loaded. The 00.config plugin loads it at boot; call useConfig() inside a handler or a later plugin, not at import time.')
  }
  return config
}
