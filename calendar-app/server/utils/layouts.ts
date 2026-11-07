import { getLayouts } from '../layouts/state'
import type { LayoutsService } from '../layouts/service'

/**
 * The custom layouts (PR 5.17): `get()` and `summaries()` for the current
 * list, and `changed()` after a write, which reloads it and emits
 * `layouts.updated` on the bus. Started at boot by `server/plugins/02.layouts.ts`.
 * Server code only. Call it inside a handler or a later plugin, not at import time.
 */
export function useLayouts(): LayoutsService {
  const service = getLayouts()
  if (!service) {
    throw new Error('useLayouts() was called before the layouts service started. The 02.layouts plugin starts it at boot; call useLayouts() inside a handler or a later plugin, not at import time.')
  }
  return service
}
