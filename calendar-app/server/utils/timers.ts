import { getTimers } from '../timers/state'
import type { TimersService } from '../timers/service'

/**
 * The kitchen timers service, or undefined when the config has no `timers`
 * block. Started at boot by `server/plugins/10.timers.ts`. Server code only.
 * Call it inside a handler, not at import time.
 */
export function useTimers(): TimersService | undefined {
  return getTimers()
}
