import { getPhotoPools } from '../photoPools/state'
import type { PhotoPoolsService } from '../photoPools/service'

/**
 * The photo pools made on the Photos tab: `get()` for the current list, and
 * `changed()` after a write, which reloads it and emits `photo_pools.updated`
 * on the bus. Started at boot by `server/plugins/02.photo-pools.ts`. Server
 * code only. Call it inside a handler or a later plugin, not at import time.
 */
export function usePhotoPools(): PhotoPoolsService {
  const service = getPhotoPools()
  if (!service) {
    throw new Error('usePhotoPools() was called before the photo pools service started. The 02.photo-pools plugin starts it at boot; call usePhotoPools() inside a handler or a later plugin, not at import time.')
  }
  return service
}
