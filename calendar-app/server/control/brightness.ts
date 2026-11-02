import type { Command, DisplayState, View } from '../../shared/display'
import type { PoliciesConfig } from '../config/schema'
import type { EventBus } from '../events/bus'
import type { DisplayControl } from './service'

// The auto brightness policy (architecture §7.7): the Pi agent's light sensor
// sets the display's brightness from the room's light, and below a darkness
// threshold it shows the night view or turns the screen off, as the config
// says. It applies the same `set_brightness`, `set_view` and `set_screen`
// commands as the remote or Home Assistant, so the screen state, the Pi agent's
// panel and the HA entities all follow without this knowing about them. HA's
// "Auto brightness" switch (the display's `auto_brightness` setting) turns the
// whole policy off. The maths is in pure functions, tested on their own. The
// policy has no timers: it reacts to a reading from the sensor and to a change
// of the display's state, and everything it touches is injected, so a test uses
// a fake bus and a fake control.

type AutoBrightnessConfig = PoliciesConfig['auto_brightness']
type Curve = AutoBrightnessConfig['curve']

/**
 * The brightness the curve gives for `lux`. Lux is read on a log scale, as the
 * eye does: between two points the brightness moves in a straight line in
 * `log10(1 + lux)`, so 0 lx is a point on the scale (the `1 +` is why) and the
 * steps from 1 to 10 lx and from 100 to 1000 lx count the same. Below the first
 * point and above the last it stays flat. The points go up in lux (the config
 * refuses any others). The result is a whole number from 0 to 100.
 */
export function curveBrightness(lux: number, curve: Curve): number {
  const first = curve[0]!
  const last = curve[curve.length - 1]!
  if (lux <= first.lux) return first.brightness
  if (lux >= last.lux) return last.brightness

  const upper = curve.findIndex(point => point.lux > lux)
  const from = curve[upper - 1]!
  const to = curve[upper]!
  const x = Math.log10(1 + lux)
  const x0 = Math.log10(1 + from.lux)
  const x1 = Math.log10(1 + to.lux)
  return Math.round(from.brightness + (to.brightness - from.brightness) * (x - x0) / (x1 - x0))
}

/** A smoothed reading: the lux, and the time in ms it was last updated at. */
export interface SmoothedLux {
  value: number
  at: number
}

/**
 * Follows the sensor without chasing every flicker. It is an exponential
 * smoothing with a time constant of `smoothingMs`, done on the log scale (so a
 * lamp coming on moves it by the same share however bright the room was) and
 * for readings that are not evenly spaced: the weight of a new reading is
 * `1 - e^(-gap / smoothingMs)`. A reading a long time after the last one is
 * therefore followed almost entirely, and one that follows another within a
 * second barely moves it, so a shadow or a flash is mostly ignored. The first
 * reading (`previous` is null) is taken as it is, and so is every reading when
 * `smoothingMs` is 0. A clock that steps back counts as no time passed, not a
 * negative one. Returns the new lux, in lux (not on the log scale), and `at`.
 */
export function smoothLux(previous: SmoothedLux | null, lux: number, at: number, smoothingMs: number): SmoothedLux {
  if (previous === null || smoothingMs === 0) return { value: lux, at }
  const weight = 1 - Math.exp(-Math.max(at - previous.at, 0) / smoothingMs)
  const from = Math.log10(1 + previous.value)
  const to = Math.log10(1 + lux)
  return { value: 10 ** (from + (to - from) * weight) - 1, at }
}

/**
 * The brightness to apply, or null to leave it as it is. The brightness only
 * moves once the curve asks for at least `minStep` more or less, so a reading
 * that hovers between two brightnesses doesn't make the screen flicker. Either
 * end of the curve (its lowest and highest brightness) is always reached, or a
 * step that does not divide the range would stop the screen short of full.
 */
export function nextBrightness(current: number, target: number, curve: Curve, minStep: number): number | null {
  if (target === current) return null
  if (Math.abs(target - current) >= minStep) return target
  const brightnesses = curve.map(point => point.brightness)
  return target === Math.min(...brightnesses) || target === Math.max(...brightnesses) ? target : null
}

/**
 * Whether the room is dark, with hysteresis so a reading hovering around the
 * threshold doesn't flip it. It is dark once `lux` is below `below`, and light
 * again only once it is `above` or more. In between, it stays as it was
 * (`wasDark`). With nothing known yet (`null`) or after light, only `below`
 * decides.
 */
export function darkAfter(wasDark: boolean | null, lux: number, below: number, above: number): boolean {
  return wasDark === true ? lux < above : lux < below
}

export interface BrightnessPolicyOptions {
  config: AutoBrightnessConfig
  /** The ids of the displays in the config. A report for any other id is ignored. */
  displays: readonly string[]
  control: Pick<DisplayControl, 'getState' | 'applyCommand'>
  bus: EventBus
  /** For tests. Default: the real time. */
  now?: () => Date
  /** For tests. Default: the console. */
  log?: Pick<Console, 'info' | 'warn' | 'error'>
}

export interface BrightnessPolicy {
  /** What the sensor reads now, in lux (not negative). Every reading is followed, whether or not the display's auto brightness setting is on. */
  report: (displayId: string, lux: number) => void
  /** Stops listening to the bus. Later reports do nothing. */
  stop: () => void
}

interface Watch {
  /** The readings so far, smoothed. Null until the first. */
  smoothed: SmoothedLux | null
  /** Whether the room is dark. Null until there is a reading, and always while the config has no `night_below_lux`. */
  dark: boolean | null
  /** The settings this policy last saw, to tell a change by someone else from its own and the policy coming on from any other change. Undefined until one is read. */
  seen: Pick<DisplayState, 'auto_brightness' | 'screen' | 'view'> | undefined
  /** The view to go back to when the room is light again: set while the policy has put the night view up over another. Null otherwise, and when someone else put the night view up, which is not the policy's to take down. */
  returnView: View | null
  /** Whether the policy turned the screen off for the dark, and so turns it on again for the light. */
  turnedOff: boolean
}

/** Lux for a log line: one decimal place under 10, as a whole number above, so `0.4 lx` and `120 lx` both read well. */
function formatLux(lux: number): string {
  return lux < 10 ? lux.toFixed(1) : String(Math.round(lux))
}

export function createBrightnessPolicy(options: BrightnessPolicyOptions): BrightnessPolicy {
  const { config, control, bus, now = () => new Date(), log = console } = options
  const smoothingMs = config.smoothing_seconds * 1000
  const below = config.night_below_lux
  // Left out, the room counts as light again at twice the dark threshold.
  const above = config.night_above_lux ?? (below === undefined ? undefined : below * 2)
  const watches = new Map<string, Watch>(options.displays.map(id => [id, { smoothed: null, dark: null, seen: undefined, returnView: null, turnedOff: false }]))
  let stopped = false

  function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  function remember(watch: Watch, state: DisplayState): void {
    watch.seen = { auto_brightness: state.auto_brightness, screen: state.screen, view: state.view }
  }

  /** Applies a command and logs a failure, which does not stop what the caller goes on to do. `what` finishes "could not ...". Returns whether it was applied. */
  function apply(displayId: string, command: Command, what: string): boolean {
    try {
      control.applyCommand(displayId, command)
      return true
    } catch (error) {
      log.error(`[brightness] ${displayId}: could not ${what}: ${describe(error)}`)
      return false
    }
  }

  /** Moves the brightness to where the curve puts the smoothed lux, if that is a step (`minStep`, or any at all when `any`) from where it is. */
  function follow(displayId: string, watch: Watch, state: DisplayState, any: boolean): void {
    const target = curveBrightness(watch.smoothed!.value, config.curve)
    const brightness = any ? (target === state.brightness ? null : target) : nextBrightness(state.brightness, target, config.curve, config.min_step)
    // Not logged: with the light changing all day it would fill the log.
    if (brightness !== null) apply(displayId, { type: 'set_brightness', brightness }, 'set the brightness')
  }

  /** The room has just got dark, with the policy on: puts the night view up or turns the screen off, as the config says. */
  function gotDark(displayId: string, watch: Watch, state: DisplayState): void {
    const lux = formatLux(watch.smoothed!.value)
    if (config.night_action === 'night_view') {
      // Someone else's night view is theirs to take down.
      if (state.view === 'night') return
      // Before it is applied: applying emits `state.updated` first, which `onState` reads.
      watch.returnView = state.view
      log.info(`[brightness] ${displayId}: the room is dark (${lux} lx), so the night view is shown`)
      if (!apply(displayId, { type: 'set_view', view: 'night' }, 'show the night view')) watch.returnView = null
    } else if (config.night_action === 'screen_off') {
      if (state.screen !== 'on') return
      watch.turnedOff = true
      log.info(`[brightness] ${displayId}: the room is dark (${lux} lx), so the screen is turned off`)
      if (!apply(displayId, { type: 'set_screen', screen: 'off' }, 'turn the screen off')) watch.turnedOff = false
    }
  }

  /** The room is light again, with the policy on: undoes what it did for the dark, unless someone has changed it since. */
  function gotLight(displayId: string, watch: Watch, state: DisplayState): void {
    const lux = formatLux(watch.smoothed!.value)
    const returnView = watch.returnView
    const turnedOff = watch.turnedOff
    // Cleared first, as applying the command emits `state.updated` before it returns.
    watch.returnView = null
    watch.turnedOff = false
    if (returnView !== null && state.view === 'night') {
      log.info(`[brightness] ${displayId}: the room is light again (${lux} lx), so the ${returnView} view is shown again`)
      apply(displayId, { type: 'set_view', view: returnView }, `show the ${returnView} view again`)
    }
    if (turnedOff && state.screen === 'off') {
      log.info(`[brightness] ${displayId}: the room is light again (${lux} lx), so the screen is turned on`)
      apply(displayId, { type: 'set_screen', screen: 'on' }, 'turn the screen on')
    }
  }

  // Someone else changing things, or the policy's own commands (which emit this before `applyCommand` returns, so `gotDark` sets what it remembers first and `gotLight` clears it first).
  const unsubscribe = bus.on('state.updated', ({ displayId, state }) => {
    const watch = watches.get(displayId)
    if (!watch || stopped) return
    const before = watch.seen
    remember(watch, state)

    // Whatever the policy did stays as it is when it is switched off, and when the view or the screen is changed away from it.
    if (!state.auto_brightness || state.view !== 'night') watch.returnView = null
    if (!state.auto_brightness || state.screen === 'on') watch.turnedOff = false

    // Switched on: catches up with the room as it is now, rather than waiting for the next reading.
    if (before === undefined || before.auto_brightness || !state.auto_brightness || watch.smoothed === null) return
    follow(displayId, watch, state, true)
    if (watch.dark === true) gotDark(displayId, watch, state)
  })

  // The settings as they are now, so the first change after start can be told from a switch.
  for (const [displayId, watch] of watches) {
    try {
      remember(watch, control.getState(displayId))
    } catch (error) {
      log.error(`[brightness] ${displayId}: could not read the state: ${describe(error)}`)
    }
  }

  return {
    report(displayId, lux) {
      const watch = watches.get(displayId)
      // A reading that is not a number would poison the smoothing for good.
      if (!watch || stopped || !Number.isFinite(lux) || lux < 0) return
      try {
        watch.smoothed = smoothLux(watch.smoothed, lux, now().getTime(), smoothingMs)
        const wasDark = watch.dark
        if (below !== undefined && above !== undefined) watch.dark = darkAfter(wasDark, watch.smoothed.value, below, above)

        const state = control.getState(displayId)
        remember(watch, state)
        if (!state.auto_brightness) return
        follow(displayId, watch, state, false)
        if (watch.dark === true && wasDark !== true) gotDark(displayId, watch, state)
        else if (watch.dark === false && wasDark === true) gotLight(displayId, watch, state)
      } catch (error) {
        log.error(`[brightness] ${displayId}: could not act on the reading: ${describe(error)}`)
      }
    },

    stop() {
      stopped = true
      unsubscribe()
    },
  }
}
