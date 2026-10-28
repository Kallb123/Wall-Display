import { getDisplayControl } from '../control/state'
import type { DisplayControl } from '../control/service'

/**
 * The display control: read a display's state and apply commands to it. Started
 * at boot by `server/plugins/03.control.ts`.
 * Server code only. Call it inside a handler, not at import time.
 */
export function useDisplayControl(): DisplayControl {
  const control = getDisplayControl()
  if (!control) {
    throw new Error('useDisplayControl() was called before the display control started. The 03.control plugin starts it at boot; call useDisplayControl() inside a handler, not at import time.')
  }
  return control
}
