import { checkHomeAssistant } from '../sources/homeassistant/ping'
import { getHaStatusCache, setHaStatusCache } from '../sources/homeassistant/state'
import { createHaStatusCache } from '../sources/homeassistant/status'
import type { HaStatusCache } from '../sources/homeassistant/status'

/**
 * The cached Home Assistant check, or undefined when the config has no
 * `homeassistant` block. Made on first use from the config, so nothing asks
 * Home Assistant until a settings page does. Server code only. Call it inside
 * a handler, not at import time.
 */
export function useHaStatus(): HaStatusCache | undefined {
  const homeassistant = useConfig().homeassistant
  if (!homeassistant) return undefined

  let cache = getHaStatusCache(homeassistant)
  if (!cache) {
    cache = createHaStatusCache({ check: () => checkHomeAssistant(homeassistant) })
    setHaStatusCache(homeassistant, cache)
  }
  return cache
}
