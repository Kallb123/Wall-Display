import { getStars } from '../stars/state'
import type { StarsService } from '../stars/service'

/**
 * The star chart (PR 5.20): `get()` for the current chart, and `changed()`
 * after a write, which reloads it and emits `stars.updated` on the bus.
 * Started at boot by `server/plugins/02.stars.ts`. Server code only. Call it
 * inside a handler or a later plugin, not at import time.
 */
export function useStars(): StarsService {
  const service = getStars()
  if (!service) {
    throw new Error('useStars() was called before the stars service started. The 02.stars plugin starts it at boot; call useStars() inside a handler or a later plugin, not at import time.')
  }
  return service
}
