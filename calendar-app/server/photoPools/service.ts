import type { PhotoPool } from '../../shared/photoPools'

// Keeps the photo pools made on the Photos tab in memory, so the photo engine,
// the layout check and the settings routes can ask "what pools are there?"
// without touching the database, and tells the rest of the app when they
// change. What it reads is injected, so this file holds no database code.

export interface PhotoPoolsServiceOptions {
  /** Reads every stored pool, by name. May throw: the last good list is kept. */
  load: () => PhotoPool[]
  /** Called with the whole new list whenever it differs from the last one. */
  onChange: (pools: PhotoPool[]) => void
  /** For tests. Default: the console. */
  log?: Pick<Console, 'warn' | 'error'>
}

export interface PhotoPoolsService {
  /** Loads the pools for the first time, without calling `onChange`: subscribers read `get()` when they start. */
  start: () => void
  /** The pools, by name. Empty before `start()`. */
  get: () => PhotoPool[]
  /** The pools' ids, which a layout's `photo_feed` may name. */
  ids: () => string[]
  /** Reloads after a write, and calls `onChange` if the list changed. Never throws. */
  changed: () => void
}

export function createPhotoPoolsService(options: PhotoPoolsServiceOptions): PhotoPoolsService {
  const { load, onChange, log = console } = options
  let latest: PhotoPool[] = []
  let sent = JSON.stringify(latest)

  function reload(notify: boolean): void {
    try {
      latest = load()
    } catch (error) {
      log.warn(`[photo pools] reading them failed: ${error instanceof Error ? error.message : String(error)}; the last good list is kept`)
      return
    }
    const json = JSON.stringify(latest)
    if (json === sent) return
    sent = json
    if (!notify) return
    try {
      onChange(latest)
    } catch (error) {
      log.error(`[photo pools] telling the app about the change failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    start: () => reload(false),
    get: () => latest,
    ids: () => latest.map(pool => pool.id),
    changed: () => reload(true),
  }
}
