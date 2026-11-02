import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Command, DisplayState } from '../../../shared/display'
import type { PoliciesConfig } from '../../../server/config/schema'
import { createBrightnessPolicy, curveBrightness, darkAfter, nextBrightness, smoothLux } from '../../../server/control/brightness'
import type { BrightnessPolicy } from '../../../server/control/brightness'
import { defaultDisplayState, reduceCommand } from '../../../server/control/commands'
import { createEventBus } from '../../../server/events/bus'

// The auto brightness maths on its own, then the policy with a fake control
// (which, like the real one, emits `state.updated` before applyCommand
// returns), a real bus and fake timers. The clock is the fake timers' clock.

type Config = PoliciesConfig['auto_brightness']
type Curve = Config['curve']

const SECOND = 1000
const START = new Date('2026-10-28T12:00:00Z')
/** The config's default curve: dim in the dark, full from 200 lx. */
const CURVE: Curve = [{ lux: 0, brightness: 30 }, { lux: 20, brightness: 60 }, { lux: 200, brightness: 100 }]

describe('curveBrightness', () => {
  it('gives the brightness of a point at its lux', () => {
    expect(curveBrightness(0, CURVE)).toBe(30)
    expect(curveBrightness(20, CURVE)).toBe(60)
    expect(curveBrightness(200, CURVE)).toBe(100)
  })

  it('is flat beyond the ends', () => {
    expect(curveBrightness(-5, CURVE)).toBe(30)
    expect(curveBrightness(201, CURVE)).toBe(100)
    expect(curveBrightness(100_000, CURVE)).toBe(100)
    expect(curveBrightness(5, [{ lux: 10, brightness: 40 }, { lux: 100, brightness: 90 }])).toBe(40)
  })

  it('moves in a straight line in log10(1 + lux) between two points, rounded to a whole number', () => {
    // From 0 to 20 lx: 1 lx is a third of the way along the log scale, 4 lx over half way, 9 lx three quarters.
    expect(curveBrightness(1, CURVE)).toBe(37)
    expect(curveBrightness(4, CURVE)).toBe(46)
    expect(curveBrightness(9, CURVE)).toBe(53)
    expect(curveBrightness(19, CURVE)).toBe(60)
    expect(curveBrightness(50, CURVE)).toBe(76)
    expect(curveBrightness(100, CURVE)).toBe(88)
    expect(curveBrightness(199, CURVE)).toBe(100)
  })

  it('puts the halfway brightness at the geometric middle of the points, not the arithmetic one', () => {
    const curve: Curve = [{ lux: 0, brightness: 0 }, { lux: 99, brightness: 100 }]

    // sqrt(100) - 1 = 9 lx is half way along the log scale from 0 to 99 lx.
    expect(curveBrightness(9, curve)).toBe(50)
    expect(curveBrightness(49.5, curve)).toBeGreaterThan(80)
  })

  it('can fall as well as rise, and rounds from either side', () => {
    const falling: Curve = [{ lux: 0, brightness: 100 }, { lux: 99, brightness: 0 }]

    expect(curveBrightness(9, falling)).toBe(50)
    expect(curveBrightness(0.3, falling)).toBe(Math.round(100 - 100 * Math.log10(1.3) / 2))
  })

  it('reads the right pair of points on a curve of many', () => {
    const curve: Curve = [{ lux: 0, brightness: 10 }, { lux: 9, brightness: 20 }, { lux: 99, brightness: 50 }, { lux: 999, brightness: 100 }]

    expect(curveBrightness(9, curve)).toBe(20)
    expect(curveBrightness(99, curve)).toBe(50)
    // Half way along each log segment is half way along its brightness.
    expect(curveBrightness(Math.sqrt(10) - 1, curve)).toBe(15)
    expect(curveBrightness(Math.sqrt(10 * 100) - 1, curve)).toBe(35)
    expect(curveBrightness(Math.sqrt(100 * 1000) - 1, curve)).toBe(75)
  })

  it('gives a whole number from 0 to 100 for any lux', () => {
    for (const lux of [0, 0.01, 0.5, 1, 3.3, 7, 12.5, 60, 150, 199.9, 5000]) {
      const brightness = curveBrightness(lux, CURVE)
      expect(Number.isInteger(brightness), `${lux} lx`).toBe(true)
      expect(brightness, `${lux} lx`).toBeGreaterThanOrEqual(0)
      expect(brightness, `${lux} lx`).toBeLessThanOrEqual(100)
    }
  })

  it('never falls as lux rises, on a rising curve', () => {
    let last = 0
    for (let lux = 0; lux <= 300; lux += 0.5) {
      const brightness = curveBrightness(lux, CURVE)
      expect(brightness).toBeGreaterThanOrEqual(last)
      last = brightness
    }
  })
})

describe('smoothLux', () => {
  it('takes the first reading as it is', () => {
    expect(smoothLux(null, 120, 5000, 30_000)).toEqual({ value: 120, at: 5000 })
  })

  it('follows every reading at once when the smoothing is 0', () => {
    expect(smoothLux({ value: 10, at: 0 }, 400, 1, 0)).toEqual({ value: 400, at: 1 })
    expect(smoothLux({ value: 10, at: 0 }, 400, 0, 0)).toEqual({ value: 400, at: 0 })
  })

  it('moves by 1 - e^(-gap / smoothing) of the way, on the log scale', () => {
    // From 10 lx towards 100 lx. After one time constant, 63 % of the way along the log scale: 10^(1 + 0.632) - 1.
    const after = smoothLux({ value: 10, at: 0 }, 100, 30_000, 30_000)

    expect(after.at).toBe(30_000)
    expect(after.value).toBeCloseTo(43.68, 1)
    // Falling is the same, in the other direction: 100 lx towards 10 lx.
    expect(smoothLux({ value: 100, at: 0 }, 10, 30_000, 30_000).value).toBeCloseTo(23.87, 1)
  })

  it('barely moves for a reading a second after the last, and follows one a long time after almost entirely', () => {
    const quick = smoothLux({ value: 10, at: 0 }, 100, 1000, 30_000)
    const slow = smoothLux({ value: 10, at: 0 }, 100, 300_000, 30_000)

    expect(quick.value).toBeCloseTo(10.83, 1)
    expect(slow.value).toBeCloseTo(100, 0)
  })

  it('moves the same share along the scale however bright the room was, so a lamp counts the same by day or night', () => {
    const dark = smoothLux({ value: 1, at: 0 }, 10, 10_000, 30_000)
    const bright = smoothLux({ value: 100, at: 0 }, 1000, 10_000, 30_000)

    // From 1 lx to 10 lx and from 100 lx to 1000 lx are the same distance on the log scale, so each moves the same share of the way.
    expect((Math.log10(1 + dark.value) - Math.log10(2)) / (Math.log10(11) - Math.log10(2))).toBeCloseTo((Math.log10(1 + bright.value) - Math.log10(101)) / (Math.log10(1001) - Math.log10(101)), 6)
  })

  it('stays where it is for a reading with no time between', () => {
    const after = smoothLux({ value: 10, at: 500 }, 1000, 500, 30_000)

    expect(after.value).toBeCloseTo(10, 9)
    expect(after.at).toBe(500)
  })

  it('counts a clock that steps backwards as no time passed, and goes on from the new time', () => {
    const after = smoothLux({ value: 10, at: 60_000 }, 1000, 30_000, 30_000)

    expect(after.value).toBeCloseTo(10, 6)
    expect(after.at).toBe(30_000)
    // So the next gap is counted from there, not from the old time.
    expect(smoothLux(after, 100, 60_000, 30_000).value).toBeCloseTo(43.68, 0)
  })

  it('keeps a steady light steady, and keeps zero lux at zero', () => {
    expect(smoothLux({ value: 50, at: 0 }, 50, 10_000, 30_000).value).toBeCloseTo(50, 6)
    expect(smoothLux({ value: 0, at: 0 }, 0, 10_000, 30_000).value).toBeCloseTo(0, 9)
  })

  it('stays between the old value and the reading', () => {
    for (const gap of [1, 1000, 10_000, 60_000, 600_000]) {
      const up = smoothLux({ value: 5, at: 0 }, 500, gap, 30_000).value
      const down = smoothLux({ value: 500, at: 0 }, 5, gap, 30_000).value
      expect(up).toBeGreaterThanOrEqual(5)
      expect(up).toBeLessThanOrEqual(500)
      expect(down).toBeGreaterThanOrEqual(5)
      expect(down).toBeLessThanOrEqual(500)
    }
  })
})

describe('nextBrightness', () => {
  it('leaves the brightness when the target is the same, or less than a step away', () => {
    expect(nextBrightness(50, 50, CURVE, 5)).toBeNull()
    expect(nextBrightness(50, 54, CURVE, 5)).toBeNull()
    expect(nextBrightness(50, 46, CURVE, 5)).toBeNull()
  })

  it('applies the target once it is a whole step away, either way', () => {
    expect(nextBrightness(50, 55, CURVE, 5)).toBe(55)
    expect(nextBrightness(50, 45, CURVE, 5)).toBe(45)
    expect(nextBrightness(50, 80, CURVE, 5)).toBe(80)
  })

  it('takes a step of 1 as any change', () => {
    expect(nextBrightness(50, 51, CURVE, 1)).toBe(51)
    expect(nextBrightness(50, 50, CURVE, 1)).toBeNull()
  })

  it('always reaches the lowest and highest brightness of the curve, even for less than a step', () => {
    expect(nextBrightness(98, 100, CURVE, 5)).toBe(100)
    expect(nextBrightness(32, 30, CURVE, 5)).toBe(30)
    expect(nextBrightness(100, 100, CURVE, 5)).toBeNull()
    expect(nextBrightness(30, 30, CURVE, 5)).toBeNull()
  })

  it('takes the ends from the curve, not from 0 and 100', () => {
    const curve: Curve = [{ lux: 0, brightness: 20 }, { lux: 50, brightness: 80 }]

    expect(nextBrightness(22, 20, curve, 5)).toBe(20)
    expect(nextBrightness(78, 80, curve, 5)).toBe(80)
    // 100 is not an end of this curve (it could not give it), so it is not a special case: the ends are the curve's.
    expect(nextBrightness(98, 100, curve, 5)).toBeNull()
    expect(nextBrightness(22, 20, curve, 5)).toBe(20)
  })

  it('takes the ends from the lowest and highest point even when the curve falls', () => {
    const falling: Curve = [{ lux: 0, brightness: 90 }, { lux: 50, brightness: 40 }, { lux: 500, brightness: 10 }]

    expect(nextBrightness(12, 10, falling, 5)).toBe(10)
    expect(nextBrightness(88, 90, falling, 5)).toBe(90)
    expect(nextBrightness(42, 40, falling, 5)).toBeNull()
  })
})

describe('darkAfter', () => {
  it('is dark below the threshold and light at it or above, with nothing known', () => {
    expect(darkAfter(null, 2.9, 3, 6)).toBe(true)
    expect(darkAfter(null, 3, 3, 6)).toBe(false)
    expect(darkAfter(null, 100, 3, 6)).toBe(false)
  })

  it('is dark below the threshold and light at it or above, from light', () => {
    expect(darkAfter(false, 2.9, 3, 6)).toBe(true)
    expect(darkAfter(false, 3, 3, 6)).toBe(false)
    // Between the two, it stays light.
    expect(darkAfter(false, 5, 3, 6)).toBe(false)
  })

  it('stays dark until the upper threshold, and is light again from it', () => {
    expect(darkAfter(true, 0, 3, 6)).toBe(true)
    expect(darkAfter(true, 3, 3, 6)).toBe(true)
    expect(darkAfter(true, 5.9, 3, 6)).toBe(true)
    expect(darkAfter(true, 6, 3, 6)).toBe(false)
    expect(darkAfter(true, 50, 3, 6)).toBe(false)
  })

  it('does not flip for a reading that hovers between the thresholds', () => {
    let dark: boolean | null = null
    const seen: boolean[] = []
    for (const lux of [10, 4, 2, 4, 5, 3.5, 2.9, 5.5, 6, 5, 3, 2]) {
      dark = darkAfter(dark, lux, 3, 6)
      seen.push(dark)
    }

    expect(seen).toEqual([false, false, true, true, true, true, true, true, false, false, false, true])
  })
})

type Overrides = Partial<Config>

function setup(options: { config?: Overrides, state?: Partial<DisplayState>, displays?: string[] } = {}) {
  const displays = options.displays ?? ['hallway']
  const bus = createEventBus()
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const states = new Map(displays.map(id => [id, { ...defaultDisplayState(), ...options.state }]))

  const control = {
    getState: vi.fn((displayId: string): DisplayState => states.get(displayId)!),
    applyCommand: vi.fn((displayId: string, command: Command): DisplayState => {
      const next = reduceCommand(states.get(displayId)!, command, { now: new Date(), timeZone: 'Europe/London', monthReturnMinutes: 15 })
      states.set(displayId, next)
      bus.emit('state.updated', { displayId, state: next })
      return next
    }),
  }
  /** Someone else (HA, the button, the remote) changes the display. */
  const change = (command: Command, displayId = 'hallway') => control.applyCommand(displayId, command)

  const policy = createBrightnessPolicy({
    // Following every reading at once, unless a test is about the smoothing.
    config: { curve: CURVE, min_step: 5, smoothing_seconds: 0, night_action: 'none', ...options.config },
    displays,
    control,
    bus,
    log,
  })
  policies.push(policy)
  const state = (displayId = 'hallway') => states.get(displayId)!
  /** Every command applied to the control, whether the policy or the test sent it. */
  const applied = () => control.applyCommand.mock.calls
  /** The commands that were of this type. */
  const appliedOf = (type: Command['type']) => applied().filter(([, command]) => command.type === type).map(([displayId, command]) => [displayId, command])
  return { policy, bus, control, log, change, state, applied, appliedOf, states }
}

/** Makes the next `times` commands of this type fail, as a database that is locked would. Others go through. */
function failing(control: ReturnType<typeof setup>['control'], type: Command['type'], message: string, times: number): void {
  const real = control.applyCommand.getMockImplementation()!
  let left = times
  control.applyCommand.mockImplementation((displayId, command) => {
    if (command.type === type && left > 0) {
      left--
      throw new Error(message)
    }
    return real(displayId, command)
  })
}

const policies: BrightnessPolicy[] = []

beforeEach(() => {
  vi.useFakeTimers({ now: START })
})

afterEach(() => {
  for (const policy of policies.splice(0)) policy.stop()
  vi.useRealTimers()
})

const brightness = (value: number): Command => ({ type: 'set_brightness', brightness: value })
const view = (name: 'month' | 'week' | 'agenda' | 'photo' | 'night'): Command => ({ type: 'set_view', view: name })
const SCREEN_OFF: Command = { type: 'set_screen', screen: 'off' }
const SCREEN_ON: Command = { type: 'set_screen', screen: 'on' }
const AUTO_OFF: Command = { type: 'set_auto_brightness', auto_brightness: false }
const AUTO_ON: Command = { type: 'set_auto_brightness', auto_brightness: true }

describe('the brightness', () => {
  it('is set from the curve for a reading', () => {
    const { policy, applied, state } = setup()

    policy.report('hallway', 20)

    expect(applied()).toEqual([['hallway', brightness(60)]])
    expect(state().brightness).toBe(60)
  })

  it('does not log it: it would fill the log', () => {
    const { policy, log } = setup()

    policy.report('hallway', 20)
    policy.report('hallway', 200)
    policy.report('hallway', 1)

    expect(log.info).not.toHaveBeenCalled()
    expect(log.warn).not.toHaveBeenCalled()
    expect(log.error).not.toHaveBeenCalled()
  })

  it('leaves it when the curve asks for less than a step, and moves it when it asks for a step', () => {
    const { policy, applied } = setup({ state: { brightness: 60 } })

    policy.report('hallway', 21) // 61, 1 away
    policy.report('hallway', 24) // 63, 3 away
    expect(applied()).toEqual([])

    policy.report('hallway', 35) // 70, 10 away
    expect(applied()).toEqual([['hallway', brightness(70)]])
  })

  it('counts the step from where the brightness is, not from the last reading', () => {
    const { policy, applied } = setup({ state: { brightness: 60 } })

    for (const lux of [21, 22, 23, 24, 25, 26, 28, 30]) policy.report('hallway', lux)

    // 28 lx is 66, the first to be 5 or more from 60. 30 lx (67) is not another step from there.
    expect(applied()).toEqual([['hallway', brightness(66)]])
  })

  it('reaches either end of the curve even from less than a step away', () => {
    const { policy, applied } = setup({ state: { brightness: 97 } })

    policy.report('hallway', 500)
    expect(applied()).toEqual([['hallway', brightness(100)]])

    policy.report('hallway', 0)
    policy.report('hallway', 0)
    expect(applied().map(([, command]) => command)).toEqual([brightness(100), brightness(30)])

    // 33 lx from the bottom is not the end, so it waits for a step.
    applied().length = 0
    policy.report('hallway', 0.2) // 31 -> 1 above the bottom
    expect(applied()).toEqual([])
  })

  it('does not apply what it already is', () => {
    const { policy, applied } = setup({ state: { brightness: 100 } })

    policy.report('hallway', 500)
    policy.report('hallway', 1000)

    expect(applied()).toEqual([])
  })

  it('takes the step from the config', () => {
    const wide = setup({ config: { min_step: 20 }, state: { brightness: 60 } })
    const narrow = setup({ config: { min_step: 1 }, state: { brightness: 60 } })

    wide.policy.report('hallway', 50) // 76
    narrow.policy.report('hallway', 20) // 60, no change
    narrow.policy.report('hallway', 21) // 61, a step of 1

    expect(wide.applied()).toEqual([])
    expect(narrow.applied()).toEqual([['hallway', brightness(61)]])
  })

  it('does nothing, however the light changes, when the display\'s auto brightness setting is off', () => {
    const { policy, applied, state } = setup({ state: { auto_brightness: false, brightness: 80 } })

    policy.report('hallway', 0)
    policy.report('hallway', 1000)

    expect(applied()).toEqual([])
    expect(state().brightness).toBe(80)
  })

  it('follows the settings as they change: off stops it, and on starts it again', () => {
    const { policy, applied, change } = setup({ state: { brightness: 100 } })

    change(AUTO_OFF)
    policy.report('hallway', 0)
    expect(applied().map(([, command]) => command)).toEqual([AUTO_OFF])

    change(AUTO_ON)
    policy.report('hallway', 0)
    expect(applied().map(([, command]) => command)).toEqual([AUTO_OFF, AUTO_ON, brightness(30)])
  })

  it('keeps the displays apart: each has its own light and its own settings', () => {
    const { policy, state, states } = setup({ displays: ['hallway', 'kitchen'] })
    states.set('kitchen', { ...states.get('kitchen')!, auto_brightness: false })

    policy.report('hallway', 0)
    policy.report('kitchen', 0)

    expect(state('hallway').brightness).toBe(30)
    expect(state('kitchen').brightness).toBe(100)
  })

  it('uses a curve from the config', () => {
    const { policy, state } = setup({ config: { curve: [{ lux: 0, brightness: 5 }, { lux: 9, brightness: 50 }] } })

    policy.report('hallway', 9)
    expect(state().brightness).toBe(50)

    policy.report('hallway', 0)
    expect(state().brightness).toBe(5)
  })

  it('logs a brightness it could not set, and carries on', () => {
    const { policy, control, log, state } = setup()
    control.applyCommand.mockImplementationOnce(() => { throw new Error('database is locked') })

    expect(() => policy.report('hallway', 0)).not.toThrow()
    policy.report('hallway', 0)

    expect(log.error).toHaveBeenCalledWith('[brightness] hallway: could not set the brightness: database is locked')
    expect(state().brightness).toBe(30)
  })

  it('logs a state it cannot read, and does not throw', () => {
    const { policy, control, log, applied } = setup()
    control.getState.mockImplementationOnce(() => { throw new Error('no such display') })

    expect(() => policy.report('hallway', 0)).not.toThrow()

    expect(log.error).toHaveBeenCalledWith('[brightness] hallway: could not act on the reading: no such display')
    expect(applied()).toEqual([])
  })

  it('goes on with the next reading after a state it could not read', () => {
    const { policy, control, state } = setup()
    control.getState.mockImplementationOnce(() => { throw new Error('no such display') })

    policy.report('hallway', 0)
    policy.report('hallway', 0)

    expect(state().brightness).toBe(30)
  })

  it('ignores a reading that is not a number of lux, which would poison the smoothing', () => {
    const { policy, applied } = setup({ config: { smoothing_seconds: 30 }, state: { brightness: 50 } })

    policy.report('hallway', Number.NaN)
    policy.report('hallway', Number.POSITIVE_INFINITY)
    policy.report('hallway', -3)
    expect(applied()).toEqual([])

    policy.report('hallway', 200)
    expect(applied()).toEqual([['hallway', brightness(100)]])
  })
})

describe('smoothing in the policy', () => {
  it('takes the first reading as it is', () => {
    const { policy, state } = setup({ config: { smoothing_seconds: 30 } })

    policy.report('hallway', 200)

    expect(state().brightness).toBe(100)
  })

  it('does not follow a flash, a second after the last reading', () => {
    const { policy, state } = setup({ config: { smoothing_seconds: 30 }, state: { brightness: 60 } })
    policy.report('hallway', 20)

    vi.advanceTimersByTime(SECOND)
    policy.report('hallway', 5000)

    // About 20 lx in 1 s: 4 % of the way up the log scale, not to full.
    expect(state().brightness).toBe(60)
  })

  it('follows a change that is still there some time later, mostly after a long gap', () => {
    const { policy, state } = setup({ config: { smoothing_seconds: 30 }, state: { brightness: 100 } })
    policy.report('hallway', 200)

    vi.advanceTimersByTime(30 * SECOND)
    policy.report('hallway', 20)
    // 63 % of the way along the log scale from 200 lx to 20 lx is about 52 lx: 76.
    expect(state().brightness).toBeGreaterThan(70)
    expect(state().brightness).toBeLessThan(85)

    vi.advanceTimersByTime(300 * SECOND)
    policy.report('hallway', 20)
    expect(state().brightness).toBe(60)
  })

  it('follows each reading at once when the smoothing is 0', () => {
    const { policy, state } = setup({ config: { smoothing_seconds: 0 } })

    policy.report('hallway', 200)
    vi.advanceTimersByTime(SECOND)
    policy.report('hallway', 0)

    expect(state().brightness).toBe(30)
  })

  it('smooths the readings of one display apart from another\'s', () => {
    const { policy, state } = setup({ config: { smoothing_seconds: 30 }, displays: ['hallway', 'kitchen'] })

    policy.report('hallway', 200)
    policy.report('kitchen', 0)

    expect(state('hallway').brightness).toBe(100)
    expect(state('kitchen').brightness).toBe(30)
  })

  it('smooths while the setting is off, so switching it on starts from the light as it has been', () => {
    const { policy, change, state } = setup({ config: { smoothing_seconds: 30 }, state: { auto_brightness: false } })
    policy.report('hallway', 200)
    vi.advanceTimersByTime(300 * SECOND)
    policy.report('hallway', 0)
    expect(state().brightness).toBe(100)

    change(AUTO_ON)

    expect(state().brightness).toBe(30)
  })
})

describe('the room getting dark: night_view', () => {
  const config: Overrides = { night_below_lux: 3, night_action: 'night_view' }

  it('shows the night view, and logs it', () => {
    const { policy, appliedOf, state, log } = setup({ config })

    policy.report('hallway', 2.4)

    expect(appliedOf('set_view')).toEqual([['hallway', view('night')]])
    expect(state().view).toBe('night')
    expect(log.info).toHaveBeenCalledWith('[brightness] hallway: the room is dark (2.4 lx), so the night view is shown')
  })

  it('shows the night view at once when the very first reading is dark', () => {
    const { policy, state } = setup({ config })

    policy.report('hallway', 0)

    expect(state().view).toBe('night')
  })

  it('does not show it for a room that is not dark, at the threshold included', () => {
    const { policy, appliedOf, log } = setup({ config })

    policy.report('hallway', 3)
    policy.report('hallway', 150)

    expect(appliedOf('set_view')).toEqual([])
    expect(log.info).not.toHaveBeenCalled()
  })

  it('shows it once, however many dark readings follow', () => {
    const { policy, appliedOf } = setup({ config })

    policy.report('hallway', 2)
    policy.report('hallway', 1)
    policy.report('hallway', 0)

    expect(appliedOf('set_view')).toHaveLength(1)
  })

  it('shows the view it was dark in again once the room is light', () => {
    const { policy, appliedOf, state, log } = setup({ config, state: { view: 'agenda' } })
    policy.report('hallway', 1)

    policy.report('hallway', 6)

    expect(appliedOf('set_view')).toEqual([['hallway', view('night')], ['hallway', view('agenda')]])
    expect(state().view).toBe('agenda')
    expect(log.info).toHaveBeenLastCalledWith('[brightness] hallway: the room is light again (6.0 lx), so the agenda view is shown again')
  })

  it('goes back to any view, the photo frame included', () => {
    const { policy, state } = setup({ config, state: { view: 'photo' } })

    policy.report('hallway', 1)
    expect(state().view).toBe('night')
    policy.report('hallway', 100)

    expect(state().view).toBe('photo')
  })

  it('reads the lux for the log as one decimal under 10 and a whole number above', () => {
    const { policy, log } = setup({ config: { night_below_lux: 3, night_above_lux: 500, night_action: 'night_view' } })

    policy.report('hallway', 0)
    policy.report('hallway', 9.96)
    policy.report('hallway', 9.94)
    policy.report('hallway', 123.4)
    policy.report('hallway', 499)
    policy.report('hallway', 500)

    expect(log.info.mock.calls.map(call => call[0])).toEqual([
      '[brightness] hallway: the room is dark (0.0 lx), so the night view is shown',
      '[brightness] hallway: the room is light again (500 lx), so the month view is shown again',
    ])
  })

  it('stays dark between night_below_lux and night_above_lux, and is light again from night_above_lux', () => {
    const { policy, state } = setup({ config: { night_below_lux: 3, night_above_lux: 8, night_action: 'night_view' } })
    policy.report('hallway', 2)

    policy.report('hallway', 7.9)
    expect(state().view).toBe('night')
    policy.report('hallway', 8)

    expect(state().view).toBe('month')
  })

  it('takes twice night_below_lux for night_above_lux when it is left out', () => {
    const { policy, state } = setup({ config })
    policy.report('hallway', 2)

    policy.report('hallway', 5.9)
    expect(state().view).toBe('night')
    policy.report('hallway', 6)

    expect(state().view).toBe('month')
  })

  it('does not flicker between the views for a room hovering around the threshold', () => {
    const { policy, appliedOf } = setup({ config })

    for (const lux of [2.9, 3.1, 2.8, 4, 2.5, 5, 3.5]) policy.report('hallway', lux)

    expect(appliedOf('set_view')).toEqual([['hallway', view('night')]])
  })

  it('goes dark again after light, and puts the night view up again', () => {
    const { policy, appliedOf, state } = setup({ config, state: { view: 'week' } })

    policy.report('hallway', 1)
    policy.report('hallway', 50)
    expect(state().view).toBe('week')
    policy.report('hallway', 1)

    expect(appliedOf('set_view').map(([, command]) => command)).toEqual([view('night'), view('week'), view('night')])
  })

  it('goes back to the view it was in the last time it got dark, not the first', () => {
    const { policy, change, state } = setup({ config, state: { view: 'week' } })
    policy.report('hallway', 1)
    policy.report('hallway', 50)
    change(view('agenda'))

    policy.report('hallway', 1)
    policy.report('hallway', 50)

    expect(state().view).toBe('agenda')
  })

  it('leaves a night view that someone else put up, and does not take it down when the room is light', () => {
    const { policy, change, appliedOf, state } = setup({ config })
    change(view('night'))

    policy.report('hallway', 1)
    policy.report('hallway', 50)

    expect(appliedOf('set_view')).toEqual([['hallway', view('night')]])
    expect(state().view).toBe('night')
  })

  it('does not take the night view down when someone changed the view while it was dark', () => {
    const { policy, change, appliedOf, state } = setup({ config, state: { view: 'agenda' } })
    policy.report('hallway', 1)

    change(view('week'))
    policy.report('hallway', 50)

    expect(state().view).toBe('week')
    expect(appliedOf('set_view').map(([, command]) => command)).toEqual([view('night'), view('week')])
  })

  it('does not take down a night view that someone put up again after the policy\'s was changed', () => {
    const { policy, change, state } = setup({ config, state: { view: 'agenda' } })
    policy.report('hallway', 1)
    change(view('week'))
    change(view('night'))

    policy.report('hallway', 50)

    expect(state().view).toBe('night')
  })

  it('does nothing about the view when the policy is switched off while it is dark, and when it is light', () => {
    const { policy, change, state, appliedOf } = setup({ config, state: { view: 'agenda' } })
    policy.report('hallway', 1)

    change(AUTO_OFF)
    policy.report('hallway', 50)
    change(AUTO_ON)

    expect(state().view).toBe('night')
    expect(appliedOf('set_view').map(([, command]) => command)).toEqual([view('night')])
  })

  it('sets the brightness too, from the dark end of the curve', () => {
    const { policy, state } = setup({ config })

    policy.report('hallway', 1)

    expect(state().brightness).toBe(37)
  })

  it('does not put the night view up when the policy is off, and does not take the view down later', () => {
    const { policy, appliedOf } = setup({ config, state: { auto_brightness: false } })

    policy.report('hallway', 1)
    policy.report('hallway', 50)

    expect(appliedOf('set_view')).toEqual([])
  })

  it('logs a night view it could not show, and leaves the view alone when the light comes back', () => {
    const { policy, control, log, state, change } = setup({ config, state: { view: 'agenda' } })
    failing(control, 'set_view', 'database is locked', 1)

    expect(() => policy.report('hallway', 1)).not.toThrow()
    change(view('week'))
    policy.report('hallway', 50)

    expect(log.error).toHaveBeenCalledWith('[brightness] hallway: could not show the night view: database is locked')
    expect(state().view).toBe('week')
  })

  it('still sets the brightness when the night view could not be shown', () => {
    const { policy, control, state } = setup({ config })
    failing(control, 'set_view', 'database is locked', 1)

    policy.report('hallway', 1)

    expect(state().brightness).toBe(37)
  })

  it('logs a view it could not put back, and does not throw', () => {
    const { policy, control, log } = setup({ config, state: { view: 'agenda' } })
    policy.report('hallway', 1)
    failing(control, 'set_view', 'database is locked', 1)

    expect(() => policy.report('hallway', 50)).not.toThrow()

    expect(log.error).toHaveBeenCalledWith('[brightness] hallway: could not show the agenda view again: database is locked')
  })

  it('does nothing with night_action none, or with no night_below_lux', () => {
    const none = setup({ config: { night_below_lux: 3, night_action: 'none' } })
    const unset = setup({ config: { night_action: 'none' } })

    none.policy.report('hallway', 0)
    unset.policy.report('hallway', 0)

    expect(none.appliedOf('set_view')).toEqual([])
    expect(none.appliedOf('set_screen')).toEqual([])
    expect(unset.appliedOf('set_view')).toEqual([])
    expect(unset.appliedOf('set_screen')).toEqual([])
  })

  it('smooths the lux the darkness is read from', () => {
    const { policy, state } = setup({ config: { ...config, smoothing_seconds: 30 } })
    policy.report('hallway', 100)

    // One reading of 0 lx a second later is not the room going dark.
    vi.advanceTimersByTime(SECOND)
    policy.report('hallway', 0)
    expect(state().view).toBe('month')

    vi.advanceTimersByTime(300 * SECOND)
    policy.report('hallway', 0)
    expect(state().view).toBe('night')
  })

  it('keeps the displays apart', () => {
    const { policy, state } = setup({ config, displays: ['hallway', 'kitchen'] })

    policy.report('hallway', 1)

    expect(state('hallway').view).toBe('night')
    expect(state('kitchen').view).toBe('month')

    policy.report('kitchen', 100)
    policy.report('hallway', 100)

    expect(state('hallway').view).toBe('month')
  })
})

describe('the room getting dark: screen_off', () => {
  const config: Overrides = { night_below_lux: 3, night_action: 'screen_off' }

  it('turns the screen off, and logs it', () => {
    const { policy, appliedOf, state, log } = setup({ config })

    policy.report('hallway', 2.4)

    expect(appliedOf('set_screen')).toEqual([['hallway', SCREEN_OFF]])
    expect(state().screen).toBe('off')
    expect(log.info).toHaveBeenCalledWith('[brightness] hallway: the room is dark (2.4 lx), so the screen is turned off')
  })

  it('turns it off once, and does not touch the view', () => {
    const { policy, appliedOf } = setup({ config })

    policy.report('hallway', 2)
    policy.report('hallway', 1)

    expect(appliedOf('set_screen')).toHaveLength(1)
    expect(appliedOf('set_view')).toEqual([])
  })

  it('turns the screen on again once the room is light, and logs it', () => {
    const { policy, appliedOf, state, log } = setup({ config })
    policy.report('hallway', 1)

    policy.report('hallway', 6)

    expect(appliedOf('set_screen')).toEqual([['hallway', SCREEN_OFF], ['hallway', SCREEN_ON]])
    expect(state().screen).toBe('on')
    expect(log.info).toHaveBeenLastCalledWith('[brightness] hallway: the room is light again (6.0 lx), so the screen is turned on')
  })

  it('sets the brightness before it turns the screen on, so it does not come on at the old one', () => {
    const { policy, applied } = setup({ config })
    policy.report('hallway', 1)
    applied().length = 0

    policy.report('hallway', 150)

    expect(applied().map(([, command]) => command)).toEqual([brightness(95), SCREEN_ON])
  })

  it('does not turn it off when it is off already, nor on again after', () => {
    const { policy, appliedOf, state } = setup({ config, state: { screen: 'off' } })

    policy.report('hallway', 1)
    policy.report('hallway', 50)

    expect(appliedOf('set_screen')).toEqual([])
    expect(state().screen).toBe('off')
  })

  it('does not turn it on when someone else turned it off while it was dark and the policy had left it on', () => {
    const { policy, change, appliedOf } = setup({ config, state: { screen: 'on' } })
    // Dark with the screen off by hand first: the policy has nothing to undo.
    change(SCREEN_OFF)
    policy.report('hallway', 1)
    policy.report('hallway', 50)

    expect(appliedOf('set_screen')).toEqual([['hallway', SCREEN_OFF]])
  })

  it('does not turn it off again when someone turned it on while it was dark, and not on again when it is light', () => {
    const { policy, change, appliedOf, state } = setup({ config })
    policy.report('hallway', 1)

    change(SCREEN_ON)
    policy.report('hallway', 0.5)
    policy.report('hallway', 50)

    expect(appliedOf('set_screen')).toEqual([['hallway', SCREEN_OFF], ['hallway', SCREEN_ON]])
    expect(state().screen).toBe('on')
  })

  it('turns it off again the next time it gets dark', () => {
    const { policy, change, appliedOf } = setup({ config })
    policy.report('hallway', 1)
    change(SCREEN_ON)
    policy.report('hallway', 50)

    policy.report('hallway', 1)

    expect(appliedOf('set_screen').map(([, command]) => command)).toEqual([SCREEN_OFF, SCREEN_ON, SCREEN_OFF])
  })

  it('leaves the screen off when the policy is switched off while it is dark, and when it is light', () => {
    const { policy, change, state } = setup({ config })
    policy.report('hallway', 1)

    change(AUTO_OFF)
    policy.report('hallway', 50)
    change(AUTO_ON)

    expect(state().screen).toBe('off')
  })

  it('does not turn the screen off when the policy is off', () => {
    const { policy, appliedOf } = setup({ config, state: { auto_brightness: false } })

    policy.report('hallway', 1)

    expect(appliedOf('set_screen')).toEqual([])
  })

  it('logs a screen it could not turn off, and does not turn on one it did not turn off', () => {
    const { policy, control, log, appliedOf, state } = setup({ config })
    failing(control, 'set_screen', 'database is locked', 1)

    expect(() => policy.report('hallway', 1)).not.toThrow()
    policy.report('hallway', 50)

    expect(log.error).toHaveBeenCalledWith('[brightness] hallway: could not turn the screen off: database is locked')
    expect(appliedOf('set_screen')).toEqual([['hallway', SCREEN_OFF]])
    expect(state().screen).toBe('on')
  })

  it('logs a screen it could not turn on, and does not throw', () => {
    const { policy, control, log } = setup({ config })
    policy.report('hallway', 1)
    failing(control, 'set_screen', 'database is locked', 1)

    expect(() => policy.report('hallway', 50)).not.toThrow()

    expect(log.error).toHaveBeenCalledWith('[brightness] hallway: could not turn the screen on: database is locked')
  })
})

describe('someone else changes things', () => {
  it('forgets the view to go back to when the view leaves night, whichever way', () => {
    const { policy, change, state } = setup({ config: { night_below_lux: 3, night_action: 'night_view' }, state: { view: 'agenda' } })
    policy.report('hallway', 1)

    change(view('photo'))
    change(view('night'))
    policy.report('hallway', 50)

    expect(state().view).toBe('night')
  })

  it('forgets that it turned the screen off when the screen comes on, whichever way', () => {
    const { policy, change, state } = setup({ config: { night_below_lux: 3, night_action: 'screen_off' } })
    policy.report('hallway', 1)

    change(SCREEN_ON)
    change(SCREEN_OFF)
    policy.report('hallway', 50)

    expect(state().screen).toBe('off')
  })

  it('is not undone by changes that leave the view and the screen as they are', () => {
    const { policy, change, state } = setup({ config: { night_below_lux: 3, night_action: 'night_view' }, state: { view: 'agenda' } })
    policy.report('hallway', 1)

    change({ type: 'set_photo_source', photo_source: 'local' })
    change(brightness(10))
    policy.report('hallway', 50)

    expect(state().view).toBe('agenda')
  })

  it('does not take its own commands for someone else\'s: the night view it put up is taken down', () => {
    const { policy, state } = setup({ config: { night_below_lux: 3, night_action: 'night_view' }, state: { view: 'week' } })

    policy.report('hallway', 1)
    policy.report('hallway', 50)

    expect(state().view).toBe('week')
  })

  it('ignores a state change for a display that is not in the config', () => {
    const { bus, applied } = setup()

    expect(() => bus.emit('state.updated', { displayId: 'attic', state: defaultDisplayState() })).not.toThrow()

    expect(applied()).toEqual([])
  })
})

describe('switched off and on', () => {
  it('goes to the curve\'s brightness as soon as it is switched on, with a reading known, by any amount', () => {
    const { policy, change, state } = setup({ state: { auto_brightness: false, brightness: 58 } })
    policy.report('hallway', 20) // 60

    change(AUTO_ON)

    expect(state().brightness).toBe(60)
  })

  it('leaves the brightness when it is switched on at the curve\'s brightness already', () => {
    const { policy, change, appliedOf } = setup({ state: { auto_brightness: false, brightness: 60 } })
    policy.report('hallway', 20)

    change(AUTO_ON)

    expect(appliedOf('set_brightness')).toEqual([])
  })

  it('does nothing when it is switched on before any reading', () => {
    const { change, applied } = setup({ state: { auto_brightness: false } })

    change(AUTO_ON)

    expect(applied().map(([, command]) => command)).toEqual([AUTO_ON])
  })

  it('does nothing when it is switched off, and when it is already on', () => {
    const { policy, change, applied } = setup({ state: { brightness: 60 } })
    policy.report('hallway', 20)

    change(AUTO_OFF)
    change(AUTO_ON)
    applied().length = 0
    change(AUTO_ON)

    expect(applied().map(([, command]) => command)).toEqual([AUTO_ON])
  })

  it('does not take any other change for a switch', () => {
    const { policy, change, appliedOf } = setup({ state: { brightness: 60 } })
    policy.report('hallway', 20)

    change(brightness(10))
    change(view('week'))

    expect(appliedOf('set_brightness').map(([, command]) => command)).toEqual([brightness(10)])
  })

  it('acts on the night when it is switched on in the dark, as it would have as the room got dark', () => {
    const { policy, change, state, log } = setup({ config: { night_below_lux: 3, night_action: 'night_view' }, state: { auto_brightness: false, view: 'agenda' } })
    policy.report('hallway', 1)
    expect(state().view).toBe('agenda')

    change(AUTO_ON)

    expect(state().view).toBe('night')
    expect(state().brightness).toBe(37)
    expect(log.info).toHaveBeenCalledWith('[brightness] hallway: the room is dark (1.0 lx), so the night view is shown')

    policy.report('hallway', 100)
    expect(state().view).toBe('agenda')
  })

  it('turns the screen off when it is switched on in the dark with screen_off', () => {
    const { policy, change, state } = setup({ config: { night_below_lux: 3, night_action: 'screen_off' }, state: { auto_brightness: false } })
    policy.report('hallway', 1)

    change(AUTO_ON)

    expect(state().screen).toBe('off')

    policy.report('hallway', 100)
    expect(state().screen).toBe('on')
  })

  it('does not act on the night when it is switched on in the light', () => {
    const { policy, change, appliedOf } = setup({ config: { night_below_lux: 3, night_action: 'night_view' }, state: { auto_brightness: false } })
    policy.report('hallway', 100)

    change(AUTO_ON)

    expect(appliedOf('set_view')).toEqual([])
  })

  it('knows the room has got light while it was off, so it does not act on the night when it is switched on', () => {
    const { policy, change, appliedOf, state } = setup({ config: { night_below_lux: 3, night_action: 'night_view' } })
    policy.report('hallway', 1)
    expect(state().view).toBe('night')

    change(AUTO_OFF)
    policy.report('hallway', 100)
    change(AUTO_ON)

    // It left the night view as it was when it was switched off, and has nothing to go back to.
    expect(state().view).toBe('night')
    expect(appliedOf('set_view').map(([, command]) => command)).toEqual([view('night')])
    expect(state().brightness).toBe(88)
  })

  it('acts again when the room is dark after it is switched on in the dark and off in between', () => {
    const { policy, change, state } = setup({ config: { night_below_lux: 3, night_action: 'night_view' } })
    policy.report('hallway', 1)
    change(view('week'))
    change(AUTO_OFF)
    change(AUTO_ON)

    expect(state().view).toBe('night')
    policy.report('hallway', 100)
    expect(state().view).toBe('week')
  })

  it('leaves a night view that is up already, when switched on in the dark', () => {
    const { policy, change, appliedOf } = setup({ config: { night_below_lux: 3, night_action: 'night_view' }, state: { auto_brightness: false, view: 'night' } })
    policy.report('hallway', 1)

    change(AUTO_ON)
    policy.report('hallway', 100)

    expect(appliedOf('set_view')).toEqual([])
  })

  it('logs a brightness it could not set on being switched on, and goes on to the night action', () => {
    const { policy, change, control, log, state } = setup({ config: { night_below_lux: 3, night_action: 'night_view' }, state: { auto_brightness: false } })
    policy.report('hallway', 1)
    failing(control, 'set_brightness', 'database is locked', 1)

    change(AUTO_ON)

    expect(log.error).toHaveBeenCalledWith('[brightness] hallway: could not set the brightness: database is locked')
    expect(state().view).toBe('night')
  })
})

describe('displays and stopping', () => {
  it('ignores a reading for a display that is not in the config', () => {
    const { policy, applied, log } = setup()

    policy.report('attic', 0)

    expect(applied()).toEqual([])
    expect(log.error).not.toHaveBeenCalled()
  })

  it('stop stops listening, and a later reading does nothing', () => {
    const { policy, change, applied } = setup({ config: { night_below_lux: 3, night_action: 'night_view' }, state: { auto_brightness: false } })
    policy.report('hallway', 1)

    policy.stop()
    policy.report('hallway', 1)
    change(AUTO_ON)

    expect(applied().map(([, command]) => command)).toEqual([AUTO_ON])
  })

  it('reads the state of each display at the start, so the first switch is told from a change', () => {
    const { control } = setup({ displays: ['hallway', 'kitchen'] })

    expect(control.getState.mock.calls.map(call => call[0])).toEqual(['hallway', 'kitchen'])
  })

  it('carries on when the state cannot be read at the start', () => {
    const bus = createEventBus()
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const control = {
      getState: vi.fn((): DisplayState => { throw new Error('no state yet') }),
      applyCommand: vi.fn((): DisplayState => defaultDisplayState()),
    }

    const policy = createBrightnessPolicy({ config: { curve: CURVE, min_step: 5, smoothing_seconds: 0, night_action: 'none' }, displays: ['hallway'], control, bus, log })
    policies.push(policy)

    expect(log.error).toHaveBeenCalledWith('[brightness] hallway: could not read the state: no state yet')
    // A switch can't be told from a change without a state to compare with, but readings still work once there is one.
    control.getState.mockImplementation(() => defaultDisplayState())
    policy.report('hallway', 0)
    expect(control.applyCommand).toHaveBeenCalledWith('hallway', brightness(30))
  })
})
