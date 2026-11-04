import type { Command, DisplayState } from '../../shared/display'
import type { PoliciesConfig } from '../config/schema'
import type { EventBus } from '../events/bus'
import { wallTimeOf } from '../sources/time'
import { MAX_TIMER_MS } from './service'
import type { DisplayControl } from './service'

// The auto presence policy (architecture §7.7): the Pi agent's mmWave sensor
// turns the screen on when someone comes into view, and off again once nobody
// has been there for `off_after_minutes`. It applies the same `set_screen`
// commands as a button press or Home Assistant, so the screen state, the
// Pi agent's panel and the HA switch all follow without this knowing about
// them. HA's "Auto presence" switch (the display's `auto_presence` setting)
// turns the whole policy off, and quiet hours leave the screen alone in both
// directions. Everything it touches is injected, so a test uses a fake bus,
// fake timers and a fake control. The limit and the quiet hours can be changed
// while it runs (`setConfig`, from the settings page): a wait already running is
// worked out again from when nobody was last seen, so a lowered limit that has
// already passed turns the screen off promptly (quiet hours permitting).

type AutoPresenceConfig = PoliciesConfig['auto_presence']

/** While quiet hours hold the screen on, the wait is checked again this often, so it goes off soon after the window ends. */
export const QUIET_RECHECK_MS = 60_000

const MINUTE_MS = 60_000

/** Minutes after midnight for a `HH:MM` the config schema has already checked. */
function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours! * 60 + minutes!
}

/**
 * Whether `now` falls in the quiet window, by the clock in `timeZone`. `from`
 * is included and `to` is not; a window with `from` after `to` runs through
 * midnight (`22:00` to `07:00`). No window, or one with `from` equal to `to`
 * (the config refuses that, so it would be a mistake), is never quiet. The
 * time of day is read on the wall, so a clock change moves the window with it.
 */
export function inQuietHours(now: Date, timeZone: string, quiet: { from: string, to: string } | undefined): boolean {
  if (!quiet) return false
  const from = minutesOf(quiet.from)
  const to = minutesOf(quiet.to)
  if (from === to) return false
  const { hour, minute } = wallTimeOf(now, timeZone)
  const at = hour * 60 + minute
  return from < to ? at >= from && at < to : at >= from || at < to
}

export interface PresencePolicyOptions {
  config: AutoPresenceConfig
  /** The ids of the displays in the config. A report for any other id is ignored. */
  displays: readonly string[]
  /** The display time zone, which quiet hours are read in. */
  timeZone: string
  control: Pick<DisplayControl, 'getState' | 'applyCommand'>
  bus: EventBus
  /** For tests. Default: the real time. */
  now?: () => Date
  /** For tests. Default: the console. */
  log?: Pick<Console, 'info' | 'warn' | 'error'>
}

export interface PresencePolicy {
  /** What the sensor says now: someone there, nobody, or `null` when it is not known (the retained value was cleared). A repeat of what it already said does nothing. */
  report: (displayId: string, present: boolean | null) => void
  /** Replaces the config. A wait already running is re-armed against the new `off_after_minutes`, counted from when nobody was last seen (so it can fire at once, unless quiet hours hold it); quiet hours are read live at each check. */
  setConfig: (config: AutoPresenceConfig) => void
  /** Cancels every timer and stops listening to the bus. Later reports do nothing. */
  stop: () => void
}

interface Watch {
  /** The sensor's last word. Null at the start, and again if it is cleared: nothing is assumed about a room nobody has reported on. */
  present: boolean | null
  /** When the sensor last said nobody, in ms. Set while `present` is false. The off timer counts from here, or from the later moment the screen or the policy came on. */
  offSince: number | null
  /** The settings this policy last saw, to tell the screen or the policy coming on from any other change. Undefined until one is read. */
  seen: Pick<DisplayState, 'auto_presence' | 'screen'> | undefined
  timer: ReturnType<typeof setTimeout> | undefined
}

export function createPresencePolicy(options: PresencePolicyOptions): PresencePolicy {
  const { timeZone, control, bus, now = () => new Date(), log = console } = options
  let config = options.config
  let offAfterMs = config.off_after_minutes * MINUTE_MS
  const watches = new Map<string, Watch>(options.displays.map(id => [id, { present: null, offSince: null, seen: undefined, timer: undefined }]))
  let stopped = false

  function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  function remember(watch: Watch, state: DisplayState): void {
    watch.seen = { auto_presence: state.auto_presence, screen: state.screen }
  }

  function cancel(watch: Watch): void {
    clearTimeout(watch.timer)
    watch.timer = undefined
  }

  /** Whether the display is due to go off after a wait: nobody there, the policy on, and the screen on. */
  function counting(watch: Watch, state: DisplayState): boolean {
    return watch.present === false && watch.offSince !== null && state.auto_presence && state.screen === 'on'
  }

  function wait(displayId: string, watch: Watch, ms: number): void {
    cancel(watch)
    watch.timer = setTimeout(() => {
      watch.timer = undefined
      if (!stopped) due(displayId, watch)
    }, ms)
  }

  /** Starts (or restarts) the wait for the time left until `offSince` plus the limit. */
  function arm(displayId: string, watch: Watch, state: DisplayState): void {
    cancel(watch)
    if (stopped || !counting(watch, state)) return
    // One wait is capped like the control service's timers, and checked again when it ends.
    wait(displayId, watch, Math.min(Math.max(watch.offSince! + offAfterMs - now().getTime(), 0), MAX_TIMER_MS))
  }

  /** The wait ended. The state is read again, because the screen or the policy may have been switched since. */
  function due(displayId: string, watch: Watch): void {
    try {
      const state = control.getState(displayId)
      remember(watch, state)
      if (!counting(watch, state)) return

      const remaining = watch.offSince! + offAfterMs - now().getTime()
      if (remaining > 0) {
        wait(displayId, watch, Math.min(remaining, MAX_TIMER_MS))
        return
      }
      // Nobody has been seen for long enough, but quiet hours keep the screen as it is. It goes off once they end, if the room is still empty.
      if (inQuietHours(now(), timeZone, config.quiet_hours)) {
        wait(displayId, watch, QUIET_RECHECK_MS)
        return
      }
      const minutes = config.off_after_minutes
      log.info(`[presence] ${displayId}: nobody for ${minutes} minute${minutes === 1 ? '' : 's'}, so the screen is turned off`)
      const off: Command = { type: 'set_screen', screen: 'off' }
      // Emits `state.updated` before it returns, which `onState` sees and answers by cancelling this watch's timer (already gone).
      try {
        control.applyCommand(displayId, off)
      } catch (error) {
        log.error(`[presence] ${displayId}: could not turn the screen off: ${describe(error)}`)
        // Otherwise a screen that failed to go off would stay on until something else changed.
        wait(displayId, watch, QUIET_RECHECK_MS)
      }
    } catch (error) {
      log.error(`[presence] ${displayId}: could not check the screen: ${describe(error)}`)
    }
  }

  function someoneThere(displayId: string, watch: Watch): void {
    if (watch.present === true) return
    watch.present = true
    watch.offSince = null
    cancel(watch)

    const state = control.getState(displayId)
    remember(watch, state)
    if (!state.auto_presence || state.screen !== 'off') return
    // Quiet hours (a night's sleep, say) leave a dark screen dark.
    if (inQuietHours(now(), timeZone, config.quiet_hours)) return

    log.info(`[presence] ${displayId}: someone is there, so the screen is turned on`)
    try {
      control.applyCommand(displayId, { type: 'set_screen', screen: 'on' })
    } catch (error) {
      log.error(`[presence] ${displayId}: could not turn the screen on: ${describe(error)}`)
    }
  }

  function nobodyThere(displayId: string, watch: Watch): void {
    if (watch.present === false) return
    watch.present = false
    watch.offSince = now().getTime()
    arm(displayId, watch, control.getState(displayId))
  }

  // The policy's own commands emit this too, before `applyCommand` returns, which is why `report` sets the watch up before it applies anything.
  const unsubscribe = bus.on('state.updated', ({ displayId, state }) => {
    const watch = watches.get(displayId)
    if (!watch || stopped) return
    const before = watch.seen
    remember(watch, state)

    // Switched off: nothing to wait for.
    if (!state.auto_presence || state.screen === 'off') {
      cancel(watch)
      return
    }
    if (watch.present !== false) return
    // The screen or the policy has just come on with nobody in view (someone switched it on by hand, say), so the wait starts again from now. Without this it would go off at once, or never.
    const cameOn = before !== undefined && (!before.auto_presence || before.screen === 'off')
    if (cameOn) watch.offSince = now().getTime()
    // Any other change (a new view, say) leaves a wait that is already running alone.
    if (cameOn || watch.timer === undefined) arm(displayId, watch, state)
  })

  // The screen and the policy as they are now, so the first change after start can be told from a switch.
  for (const [displayId, watch] of watches) {
    try {
      remember(watch, control.getState(displayId))
    } catch (error) {
      log.error(`[presence] ${displayId}: could not read the state: ${describe(error)}`)
    }
  }

  return {
    report(displayId, present) {
      const watch = watches.get(displayId)
      if (!watch || stopped) return
      if (present === null) {
        watch.present = null
        watch.offSince = null
        cancel(watch)
      } else if (present) {
        someoneThere(displayId, watch)
      } else {
        nobodyThere(displayId, watch)
      }
    },

    setConfig(next) {
      config = next
      offAfterMs = next.off_after_minutes * MINUTE_MS
      if (stopped) return
      for (const [displayId, watch] of watches) {
        if (watch.present !== false) continue
        try {
          arm(displayId, watch, control.getState(displayId))
        } catch (error) {
          log.error(`[presence] ${displayId}: could not check the screen: ${describe(error)}`)
        }
      }
    },

    stop() {
      stopped = true
      unsubscribe()
      for (const watch of watches.values()) cancel(watch)
    },
  }
}
