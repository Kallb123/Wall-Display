import { layoutSummary } from '../../shared/layouts'
import type { CustomLayout, LayoutSummary } from '../../shared/layouts'

// Keeps the custom layouts in memory, so the control service, the photo
// rotation, MQTT and the sockets can all ask "what layouts are there?" without
// touching the database, and tells the rest of the app when they change. What
// it reads is injected, so this file holds no database code.

export interface LayoutsServiceOptions {
  /** Reads every stored layout, by name. May throw: the last good list is kept. */
  load: () => CustomLayout[]
  /** Called with the whole new list whenever it differs from the last one. */
  onChange: (layouts: CustomLayout[]) => void
  /** For tests. Default: the console. */
  log?: Pick<Console, 'warn' | 'error'>
}

export interface LayoutsService {
  /** Loads the layouts for the first time, without calling `onChange`: subscribers read `get()` when they start. */
  start: () => void
  /** The layouts, by name. Empty before `start()`. */
  get: () => CustomLayout[]
  /** The layouts as the control service wants them. */
  summaries: () => LayoutSummary[]
  /** Reloads after a write, and calls `onChange` if the list changed. Never throws. */
  changed: () => void
}

export function createLayoutsService(options: LayoutsServiceOptions): LayoutsService {
  const { load, onChange, log = console } = options
  let latest: CustomLayout[] = []
  let sent = JSON.stringify(latest)

  function reload(notify: boolean): void {
    try {
      latest = load()
    } catch (error) {
      log.warn(`[layouts] reading them failed: ${error instanceof Error ? error.message : String(error)}; the last good list is kept`)
      return
    }
    const json = JSON.stringify(latest)
    if (json === sent) return
    sent = json
    if (!notify) return
    try {
      onChange(latest)
    } catch (error) {
      log.error(`[layouts] telling the app about the change failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    start: () => reload(false),
    get: () => latest,
    summaries: () => latest.map(layoutSummary),
    changed: () => reload(true),
  }
}
