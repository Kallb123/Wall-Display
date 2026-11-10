import type { StarChart } from '../../shared/stars'

// Keeps the star chart (PR 5.20) in memory, so the socket can send it to a new
// connection without touching the database, and tells the rest of the app when
// it changes. What it reads is injected, so this file holds no database code.
// Like the layouts service, it compares the new chart with the last one it
// sent, so a write that changes nothing (or a reload at midnight that finds
// the same counts) sends nothing.

export interface StarsServiceOptions {
  /** Builds the whole chart as of now. May throw: the last good one is kept. */
  load: () => StarChart
  /** Called with the whole new chart whenever it differs from the last one. */
  onChange: (stars: StarChart) => void
  /** For tests. Default: the console. */
  log?: Pick<Console, 'warn' | 'error'>
}

export interface StarsService {
  /** Loads the chart for the first time, without calling `onChange`: subscribers read `get()` when they start. */
  start: () => void
  /** The chart. Empty before `start()`. */
  get: () => StarChart
  /** Reloads after a write, and calls `onChange` if the chart changed. Never throws. */
  changed: () => void
}

const EMPTY: StarChart = { people: [], counts: {} }

export function createStarsService(options: StarsServiceOptions): StarsService {
  const { load, onChange, log = console } = options
  let latest: StarChart = EMPTY
  let sent = JSON.stringify(latest)

  function reload(notify: boolean): void {
    try {
      latest = load()
    } catch (error) {
      log.warn(`[stars] reading the chart failed: ${error instanceof Error ? error.message : String(error)}; the last good chart is kept`)
      return
    }
    const json = JSON.stringify(latest)
    if (json === sent) return
    sent = json
    if (!notify) return
    try {
      onChange(latest)
    } catch (error) {
      log.error(`[stars] telling the app about the change failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    start: () => reload(false),
    get: () => latest,
    changed: () => reload(true),
  }
}
