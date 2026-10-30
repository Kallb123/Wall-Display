import { addDays, todayIn } from '../../shared/dates'
import { resolutionRange, resolveSpecialDays } from '../../shared/special-days'
import type { SpecialDay, SpecialDaysResolution } from '../../shared/special-days'
import { zonedWallTimeToUtc } from '../sources/time'

// Keeps the special days resolved for today, and resolves them again at local
// midnight (correct on DST change days) and whenever they are edited, telling
// the rest of the app when the answer changed (architecture §6.5). What it
// reads is injected, so this file holds no database code and a test drives it
// with fake timers and a frozen clock.

export interface SpecialDaysServiceOptions {
  /** Reads every stored special day. May throw: the last good resolution is kept. */
  load: () => SpecialDay[]
  /** The display time zone, which decides when midnight is. */
  timeZone: string
  /** Called with the new resolution whenever it differs from the last one given. */
  onChange: (resolution: SpecialDaysResolution) => void
  /** For tests. Default: the real time. */
  now?: () => Date
  /** For tests. Default: the console. */
  log?: Pick<Console, 'info' | 'warn' | 'error'>
}

export interface SpecialDaysService {
  /** Resolves now (calling `onChange`) and schedules the next midnight. */
  start: () => void
  /** Cancels the timer. Nothing is resolved or emitted after this. */
  stop: () => void
  /** The current resolution, or null before `start()`. */
  get: () => SpecialDaysResolution | null
  /** Resolves again now, after an edit. Calls `onChange` if the answer changed. Never throws. */
  refresh: () => void
}

/** The longest it waits before looking at the date again. A clock that jumps, or a timer that runs late, is put right within this. */
export const MAX_WAIT_MS = 60 * 60 * 1000
/** The shortest wait, so a timer that fires just before midnight does not spin until the clock catches up. */
export const MIN_WAIT_MS = 1000

export function createSpecialDaysService(options: SpecialDaysServiceOptions): SpecialDaysService {
  const { load, timeZone, onChange, now = () => new Date(), log = console } = options
  let started = false
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  let latest: SpecialDaysResolution | null = null
  /** The last resolution `onChange` was given, as JSON, which is what the displays hold. */
  let sent: string | undefined
  /** The failure last logged, so the same one is not logged at every tick. */
  let loggedError: string | null = null

  /** Waits for the next local midnight, or an hour if that is further off. */
  function schedule(today: string): void {
    clearTimeout(timer)
    // A refresh before start() resolves once and leaves the timing to start().
    if (stopped || !started) return
    const [year, month, day] = addDays(today, 1).split('-').map(Number)
    // Asked of the zone, not worked out as 24 hours on: a DST day is 23 or 25 hours long.
    const midnight = zonedWallTimeToUtc({ year: year!, month: month!, day: day! }, timeZone)
    const delay = Math.min(Math.max(midnight.getTime() - now().getTime(), MIN_WAIT_MS), MAX_WAIT_MS)
    timer = setTimeout(() => {
      timer = undefined
      resolve()
    }, delay)
  }

  /** Resolves for today and schedules the next look. Never throws: a broken read must not take the server down. */
  function resolve(): void {
    if (stopped) return
    const today = todayIn(now(), timeZone)
    try {
      const days = load()
      const resolution = resolveSpecialDays(days, { ...resolutionRange(today), today })
      if (loggedError !== null) log.info('[special-days] working again')
      loggedError = null
      if (latest === null) log.info(`[special-days] ${days.length} special ${days.length === 1 ? 'day' : 'days'}`)
      latest = resolution
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // The last good resolution stays as it was.
      if (message !== loggedError) {
        loggedError = message
        log.warn(`[special-days] ${message}; the last good resolution is kept`)
      }
      schedule(today)
      return
    }
    schedule(today)

    const json = JSON.stringify(latest)
    if (json !== sent) {
      sent = json
      try {
        onChange(latest)
      } catch (error) {
        log.error(`[special-days] telling the app about the change failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  return {
    start() {
      if (started || stopped) return
      started = true
      resolve()
    },

    stop() {
      stopped = true
      clearTimeout(timer)
      timer = undefined
    },

    get: () => latest,

    refresh: resolve,
  }
}
