import type { SyncScheduler } from './scheduler'

// Holds the running scheduler between the sync plugin and useSyncScheduler(). Not auto-imported.
let current: SyncScheduler | undefined

export function setSyncScheduler(scheduler: SyncScheduler | undefined): void {
  current = scheduler
}

export function getSyncScheduler(): SyncScheduler | undefined {
  return current
}
