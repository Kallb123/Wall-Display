import type { NextAlarm } from '../../shared/display'
import { safeErrorMessage } from '../sources/errors'
import { MAX_JITTER_MS, retryDelayMs } from '../sources/scheduler'

// Polls the next alarm and keeps the last good answer. The same shape as the
// weather service, with less to it: a first poll soon after start, backing off
// while Home Assistant fails, one fetch at a time, and telling the rest of the
// app when the alarm changed. An alarm is an instant, so a copy on a display
// never goes stale and nothing needs sending again. What a fetch does is
// injected, so this file holds no network code and a test drives it with fake
// timers.

export interface AlarmServiceOptions {
  /** Fetches the next alarm: an ISO 8601 instant, or null for none. May throw: the service backs off and tries again. */
  load: () => Promise<NextAlarm>
  /** The time between polls, in milliseconds. */
  intervalMs: number
  /** Called with the new alarm when it changed, and after the first successful poll even if it is none. */
  onChange: (alarm: NextAlarm) => void
  /** For tests. Default: `Math.random`. */
  random?: () => number
  /** For tests. Default: the console. */
  log?: Pick<Console, 'info' | 'warn' | 'error'>
}

/** How the last polls went, for anything that wants to say so. Neither holds a URL or a token. */
export interface AlarmStatus {
  /** When the alarm was last fetched, as an ISO 8601 instant, or null if it has not been. */
  last_success_at: string | null
  /** The safe message of the last poll if it failed, otherwise null. */
  last_error: string | null
}

export interface AlarmService {
  /** Schedules the first poll, a little after now. */
  start: () => void
  /** Cancels the next poll and ignores whatever is still in flight. */
  stop: () => void
  /** The last good answer, which a failing Home Assistant leaves as it was, or null before the first poll succeeds and when there is no alarm. */
  get: () => NextAlarm
  status: () => AlarmStatus
  /** Polls now. Never rejects. If a poll is in flight it waits for that one rather than asking again. */
  refresh: () => Promise<void>
}

export function createAlarmService(options: AlarmServiceOptions): AlarmService {
  const { load, intervalMs, onChange, random = Math.random, log = console } = options
  let started = false
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> | undefined

  /** The newest answer: null for no alarm, and before the first success. */
  let latest: NextAlarm = null
  /** Whether `onChange` has been called yet. The first success always calls it. */
  let sent = false
  let lastSuccessAt: string | null = null
  let lastError: string | null = null
  /** Failures in a row. Zero after a success. */
  let failures = 0
  /** The failure last logged, so the same one is not logged at every poll. */
  let loggedError: string | null = null

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

    let alarm: NextAlarm
    try {
      alarm = await load()
    } catch (error) {
      const message = safeErrorMessage(error)
      if (stopped) return
      failures++
      lastError = message
      const delay = retryDelayMs(intervalMs, failures)
      // The last good alarm stays as it was. Only the safe message is logged: the URL is a secret.
      if (message !== loggedError) {
        loggedError = message
        log.warn(`[alarm] ${message}; the last good alarm is kept, trying again in ${Math.round(delay / 1000)} s`)
      }
      schedule(delay)
      return
    }
    // After stop() the app may be shutting down. Say nothing, do nothing.
    if (stopped) return

    if (loggedError !== null) log.info(`[alarm] working again after ${failures} failed ${failures === 1 ? 'attempt' : 'attempts'}`)
    failures = 0
    lastError = null
    loggedError = null
    lastSuccessAt = new Date().toISOString()
    schedule(intervalMs)

    const changed = alarm !== latest
    latest = alarm
    if (changed || !sent) {
      sent = true
      try {
        onChange(alarm)
      } catch (error) {
        log.error(`[alarm] telling the app about the change failed: ${error instanceof Error ? error.message : String(error)}`)
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

    status: () => ({ last_success_at: lastSuccessAt, last_error: lastError }),

    refresh() {
      return stopped ? Promise.resolve() : (running ?? run())
    },
  }
}
