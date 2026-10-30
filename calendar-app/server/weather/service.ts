import type { WeatherSnapshot } from '../../shared/weather'
import { safeErrorMessage } from '../sources/errors'
import { MAX_JITTER_MS, retryDelayMs } from '../sources/scheduler'

// Polls the weather and keeps the last good snapshot. Like the calendar
// scheduler it decides when to fetch and what to do with how it went: a first
// poll soon after start, backing off while Home Assistant fails, one fetch at a
// time, and telling the rest of the app when the weather changed. What a fetch
// does is injected, so this file holds no network code and a test drives it
// with fake timers.

export interface WeatherServiceOptions {
  /** Fetches and maps the weather, stamped with the time it was fetched. May throw: the service backs off and tries again. */
  load: () => Promise<WeatherSnapshot>
  /** The time between polls, in milliseconds. */
  intervalMs: number
  /** Called with the new snapshot when the weather changed, or when the displays' copy is due a refresh (see `REEMIT_AFTER_MS`). */
  onChange: (weather: WeatherSnapshot) => void
  /** For tests. Default: `Math.random`. */
  random?: () => number
  /** For tests. Default: the console. */
  log?: Pick<Console, 'info' | 'warn' | 'error'>
}

/** How the last polls went, for anything that wants to say so. Neither holds a URL or a token. */
export interface WeatherStatus {
  /** When the weather was last fetched, as an ISO 8601 instant, or null if it has not been. */
  last_success_at: string | null
  /** The safe message of the last poll if it failed, otherwise null. */
  last_error: string | null
}

export interface WeatherService {
  /** Schedules the first poll, a little after now. */
  start: () => void
  /** Cancels the next poll and ignores whatever is still in flight. */
  stop: () => void
  /** The last good snapshot, which a failing Home Assistant leaves as it was, or null before the first poll succeeds. */
  get: () => WeatherSnapshot | null
  status: () => WeatherStatus
  /** Polls now. Never rejects. If a poll is in flight it waits for that one rather than asking again. */
  refresh: () => Promise<void>
}

/**
 * The displays hear about a snapshot when its content changes. If it never
 * did, the copy on the wall would keep its first `updated_at`, and the wall
 * stops showing the current conditions once that is three hours old. So a
 * snapshot is also sent when the last one sent is this old, even if the
 * weather is the same.
 */
export const REEMIT_AFTER_MS = 60 * 60 * 1000

export function createWeatherService(options: WeatherServiceOptions): WeatherService {
  const { load, intervalMs, onChange, random = Math.random, log = console } = options
  let started = false
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> | undefined

  /** The newest snapshot, with the newest `updated_at`. */
  let latest: WeatherSnapshot | null = null
  /** The last snapshot `onChange` was given, which is what the displays hold. */
  let sent: WeatherSnapshot | undefined
  let lastError: string | null = null
  /** Failures in a row. Zero after a success. */
  let failures = 0
  /** The failure last logged, so the same one is not logged at every poll. */
  let loggedError: string | null = null
  /** Whether a success has been logged yet. The first one always is. */
  let reported = false

  function schedule(delayMs: number): void {
    clearTimeout(timer)
    // A refresh before start() fetches once and leaves the timing to start().
    if (stopped || !started) return
    timer = setTimeout(() => {
      timer = undefined
      void run()
    }, delayMs)
  }

  function run(): Promise<void> {
    const current = poll().finally(() => {
      if (running === current) running = undefined
    })
    running = current
    return current
  }

  /** One fetch, and the next one scheduled. Never rejects: a failing Home Assistant must not take the server down. */
  async function poll(): Promise<void> {
    // A forced poll takes the place of the one that was waiting.
    clearTimeout(timer)
    timer = undefined

    let snapshot: WeatherSnapshot
    try {
      snapshot = await load()
    } catch (error) {
      const message = safeErrorMessage(error)
      if (stopped) return
      failures++
      lastError = message
      const delay = retryDelayMs(intervalMs, failures)
      // The last good weather stays as it was. Only the safe message is logged: the URL is a secret.
      if (message !== loggedError) {
        loggedError = message
        log.warn(`[weather] ${message}; the last good weather is kept, trying again in ${Math.round(delay / 1000)} s`)
      }
      schedule(delay)
      return
    }
    // After stop() the app may be shutting down. Say nothing, do nothing.
    if (stopped) return

    if (loggedError !== null) log.info(`[weather] working again after ${failures} failed ${failures === 1 ? 'attempt' : 'attempts'}`)
    failures = 0
    lastError = null
    loggedError = null
    if (!reported) {
      reported = true
      log.info(`[weather] ${snapshot.current.condition ?? 'no current condition'}, and a forecast for ${snapshot.daily.length} ${snapshot.daily.length === 1 ? 'day' : 'days'}`)
    }
    latest = snapshot
    schedule(intervalMs)

    if (sent === undefined || differs(sent, snapshot) || Date.parse(snapshot.updated_at) - Date.parse(sent.updated_at) >= REEMIT_AFTER_MS) {
      sent = snapshot
      try {
        onChange(snapshot)
      } catch (error) {
        log.error(`[weather] telling the app about the change failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  return {
    start() {
      if (started || stopped) return
      started = true
      schedule(random() * Math.min(MAX_JITTER_MS, intervalMs))
    },

    stop() {
      stopped = true
      clearTimeout(timer)
      timer = undefined
    },

    get: () => latest,

    status: () => ({ last_success_at: latest?.updated_at ?? null, last_error: lastError }),

    refresh() {
      return stopped ? Promise.resolve() : (running ?? run())
    },
  }
}

/** Whether two snapshots say different things about the weather: everything but when it was fetched. */
function differs(a: WeatherSnapshot, b: WeatherSnapshot): boolean {
  return JSON.stringify({ ...a, updated_at: '' }) !== JSON.stringify({ ...b, updated_at: '' })
}
