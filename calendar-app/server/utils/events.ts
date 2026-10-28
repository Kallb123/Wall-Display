import { getEventBus } from '../events/bus'
import type { EventBus } from '../events/bus'

/**
 * The server's event bus: emit `events.updated` when stored events change, or
 * subscribe to hear about it. Server code only.
 */
export function useEventBus(): EventBus {
  return getEventBus()
}
