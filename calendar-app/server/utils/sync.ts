import { getSyncScheduler } from '../sources/state'
import type { SyncScheduler } from '../sources/scheduler'

/**
 * The calendar sync scheduler, started at boot by `server/plugins/02.sync.ts`.
 * Server code only. Call it inside a handler, not at import time.
 */
export function useSyncScheduler(): SyncScheduler {
  const scheduler = getSyncScheduler()
  if (!scheduler) {
    throw new Error('useSyncScheduler() was called before the scheduler started. The 02.sync plugin starts it at boot; call useSyncScheduler() inside a handler, not at import time.')
  }
  return scheduler
}
