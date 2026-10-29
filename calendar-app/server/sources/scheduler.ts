import type { CalendarConfig } from '../config/schema'
import { safeErrorMessage } from './ics/errors'

// Polls each calendar on its own interval, so a slow or broken feed never holds
// up the others. It decides when to sync and what to do with how it went:
// start-up jitter, exponential backoff, one sync per calendar at a time, and
// telling the rest of the app when events changed. What a sync does is
// injected, so this file holds no network or database code and a test drives
// it with fake timers.

/** How one sync went. `changed` means events were inserted, updated or deleted. */
export interface SyncOutcome {
  /** `not-modified` when the source said nothing had changed since the last poll. */
  status: 'updated' | 'not-modified'
  changed: boolean
  /** A line for the log, such as "2 added, 1 changed, 0 removed (240 events)". */
  summary: string
  /** Things worth knowing that did not stop the sync. Never contain a URL. */
  warnings?: string[]
}

/** The result of a forced poll, for `POST /api/refresh`. */
export interface RefreshResult {
  calendarId: string
  status: 'updated' | 'not-modified' | 'error'
  /** The safe message (never a URL), when `status` is `error`. */
  error?: string
}

export interface SchedulerOptions {
  calendars: readonly CalendarConfig[]
  /** Whether a calendar's source can be synced yet. The others are left out, and logged once. */
  canSync: (calendar: CalendarConfig) => boolean
  /** Syncs one calendar. May throw: the scheduler backs off and tries again. */
  sync: (calendar: CalendarConfig) => Promise<SyncOutcome>
  /** Called after a sync that inserted, updated or deleted events. */
  onChange: (calendarIds: string[]) => void
  /** Called after every successful sync, whether or not anything changed, so "when did we last hear from the calendar" can be shown. */
  onSuccess?: (calendarId: string) => void
  /** For tests. Default: `Math.random`. */
  random?: () => number
  /** For tests. Default: the console. */
  log?: Pick<Console, 'info' | 'warn' | 'error'>
}

export interface SyncScheduler {
  /** Schedules the first poll of each calendar, a little apart. */
  start: () => void
  /** Polls every calendar now. Resolves when all of them have finished. */
  refreshAll: () => Promise<RefreshResult[]>
  /** Cancels everything that is waiting and ignores whatever is still in flight. */
  stop: () => void
}

/** The first polls are spread over at most this long, so calendars don't all fetch at the same instant. */
export const MAX_JITTER_MS = 10_000
/** A failing calendar is tried again at least this often. */
export const MAX_BACKOFF_MS = 60 * 60 * 1000

interface Poller {
  calendar: CalendarConfig
  intervalMs: number
  /** Failures in a row. Zero after a success. */
  failures: number
  /** Whether a success has been logged yet. The first one always is. */
  reported: boolean
  timer: ReturnType<typeof setTimeout> | undefined
  /** The sync in flight, if any. */
  running: Promise<RefreshResult> | undefined
}

/** How long to wait after `failures` failures in a row: the interval doubled for each, up to an hour. */
export function retryDelayMs(intervalMs: number, failures: number): number {
  return failures === 0 ? intervalMs : Math.max(intervalMs, Math.min(intervalMs * 2 ** failures, MAX_BACKOFF_MS))
}

export function createSyncScheduler(options: SchedulerOptions): SyncScheduler {
  const { sync, onChange, onSuccess, random = Math.random, log = console } = options
  const pollers: Poller[] = options.calendars.filter(options.canSync).map(calendar => ({
    calendar,
    intervalMs: calendar.source.poll_seconds * 1000,
    failures: 0,
    reported: false,
    timer: undefined,
    running: undefined,
  }))
  let started = false
  let stopped = false
  let refreshing: Promise<RefreshResult[]> | undefined

  function schedule(poller: Poller, delayMs: number): void {
    clearTimeout(poller.timer)
    if (stopped) return
    poller.timer = setTimeout(() => {
      poller.timer = undefined
      void run(poller)
    }, delayMs)
  }

  /** Starts a sync for the calendar. Callers make sure none is in flight. */
  function run(poller: Poller): Promise<RefreshResult> {
    const running = poll(poller).finally(() => {
      if (poller.running === running) poller.running = undefined
    })
    poller.running = running
    return running
  }

  /** One sync, and the next one scheduled. Never rejects: a failing feed must not take the server down. */
  async function poll(poller: Poller): Promise<RefreshResult> {
    const { calendar } = poller
    // A forced poll takes the place of the one that was waiting.
    clearTimeout(poller.timer)
    poller.timer = undefined

    let result: RefreshResult
    let changed = false
    let succeeded = false
    try {
      const outcome = await sync(calendar)
      // After stop() the database may already be closed. Say nothing, do nothing.
      if (stopped) return { calendarId: calendar.id, status: outcome.status }

      if (poller.failures > 0) log.info(`[sync] ${calendar.id}: working again after ${poller.failures} failed attempt(s)`)
      poller.failures = 0
      if (outcome.changed || !poller.reported) {
        log.info(`[sync] ${calendar.id}: ${outcome.summary}`)
        for (const warning of outcome.warnings ?? []) log.warn(`[sync] ${calendar.id}: ${warning}`)
      }
      poller.reported = true
      changed = outcome.changed
      succeeded = true
      result = { calendarId: calendar.id, status: outcome.status }
    } catch (error) {
      const message = safeErrorMessage(error)
      if (stopped) return { calendarId: calendar.id, status: 'error', error: message }

      poller.failures++
      const delay = retryDelayMs(poller.intervalMs, poller.failures)
      // The stored events stay as they were. Only the safe message is logged: the URL is a secret.
      log.warn(`[sync] ${calendar.id}: ${message}; the last good events are kept, trying again in ${Math.round(delay / 1000)} s (${poller.failures} in a row)`)
      result = { calendarId: calendar.id, status: 'error', error: message }
    }

    schedule(poller, retryDelayMs(poller.intervalMs, poller.failures))
    if (changed) {
      try {
        onChange([calendar.id])
      } catch (error) {
        log.error(`[sync] ${calendar.id}: telling the app about the change failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (succeeded && onSuccess) {
      try {
        onSuccess(calendar.id)
      } catch (error) {
        log.error(`[sync] ${calendar.id}: telling the app about the sync failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return result
  }

  /** Polls now. If a sync is in flight, waits for it first, then syncs once more: never two at a time. */
  async function force(poller: Poller): Promise<RefreshResult> {
    if (poller.running) await poller.running
    return stopped ? { calendarId: poller.calendar.id, status: 'error', error: 'the server is shutting down' } : run(poller)
  }

  return {
    start() {
      if (started || stopped) return
      started = true
      const skipped = options.calendars.filter(calendar => !options.canSync(calendar))
      if (skipped.length > 0) {
        log.info(`[sync] not syncing ${skipped.map(calendar => `${calendar.id} (${calendar.source.type})`).join(', ')} yet: that source type has no sync`)
      }
      for (const poller of pollers) {
        schedule(poller, random() * Math.min(MAX_JITTER_MS, poller.intervalMs))
      }
    },

    refreshAll() {
      // Callers that arrive while a refresh is running share it.
      refreshing ??= Promise.all(pollers.map(force)).finally(() => { refreshing = undefined })
      return refreshing
    },

    stop() {
      stopped = true
      for (const poller of pollers) {
        clearTimeout(poller.timer)
        poller.timer = undefined
      }
    },
  }
}
