import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Command, DisplayState } from '../../../shared/display'
import { defaultDisplayState, reduceCommand } from '../../../server/control/commands'
import { createPresencePolicy, inQuietHours, QUIET_RECHECK_MS } from '../../../server/control/presence'
import type { PresencePolicy } from '../../../server/control/presence'
import { MAX_TIMER_MS } from '../../../server/control/service'
import { createEventBus } from '../../../server/events/bus'

// The auto presence policy with a fake control (which, like the real one, emits
// `state.updated` before applyCommand returns), a real bus and fake timers. The
// clock is the fake timers' clock.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const OFF_AFTER = 10
/** 12:00 UTC, which is 12:00 in London once the clocks have gone back (they did on 25 October), so well clear of any quiet hours. */
const START = new Date('2026-10-28T12:00:00Z')

type Quiet = { from: string, to: string } | undefined

function setup(options: { quiet?: Quiet, offAfter?: number, timeZone?: string, state?: Partial<DisplayState>, displays?: string[] } = {}) {
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

  const policy = createPresencePolicy({
    config: { off_after_minutes: options.offAfter ?? OFF_AFTER, ...(options.quiet ? { quiet_hours: options.quiet } : {}) },
    displays,
    timeZone: options.timeZone ?? 'Europe/London',
    control,
    bus,
    log,
  })
  policies.push(policy)
  const screen = (displayId = 'hallway') => states.get(displayId)!.screen
  /** Every command applied to the control, whether the policy or the test sent it. */
  const applied = () => control.applyCommand.mock.calls
  return { policy, bus, control, log, change, screen, applied, states }
}

const policies: PresencePolicy[] = []

beforeEach(() => {
  vi.useFakeTimers({ now: START })
})

afterEach(() => {
  for (const policy of policies.splice(0)) policy.stop()
  vi.useRealTimers()
})

const SCREEN_OFF: Command = { type: 'set_screen', screen: 'off' }
const SCREEN_ON: Command = { type: 'set_screen', screen: 'on' }

describe('inQuietHours', () => {
  const at = (iso: string) => new Date(iso)

  it('is never quiet without a window', () => {
    expect(inQuietHours(at('2026-10-28T03:00:00Z'), 'Europe/London', undefined)).toBe(false)
  })

  it('takes a window within a day as from (included) to to (not included)', () => {
    const quiet = { from: '09:00', to: '17:30' }

    expect(inQuietHours(at('2026-01-14T08:59:00Z'), 'UTC', quiet)).toBe(false)
    expect(inQuietHours(at('2026-01-14T09:00:00Z'), 'UTC', quiet)).toBe(true)
    expect(inQuietHours(at('2026-01-14T17:29:59Z'), 'UTC', quiet)).toBe(true)
    expect(inQuietHours(at('2026-01-14T17:30:00Z'), 'UTC', quiet)).toBe(false)
  })

  it('takes a window with from after to as running through midnight', () => {
    const quiet = { from: '22:00', to: '07:00' }

    expect(inQuietHours(at('2026-01-14T21:59:00Z'), 'UTC', quiet)).toBe(false)
    expect(inQuietHours(at('2026-01-14T22:00:00Z'), 'UTC', quiet)).toBe(true)
    expect(inQuietHours(at('2026-01-14T23:59:00Z'), 'UTC', quiet)).toBe(true)
    expect(inQuietHours(at('2026-01-15T00:00:00Z'), 'UTC', quiet)).toBe(true)
    expect(inQuietHours(at('2026-01-15T06:59:00Z'), 'UTC', quiet)).toBe(true)
    expect(inQuietHours(at('2026-01-15T07:00:00Z'), 'UTC', quiet)).toBe(false)
    expect(inQuietHours(at('2026-01-14T12:00:00Z'), 'UTC', quiet)).toBe(false)
  })

  it('reads the time of day in the display\'s time zone, not the process\'s or UTC', () => {
    const quiet = { from: '22:00', to: '07:00' }

    // 23:30 UTC is 08:30 the next morning in Sydney (UTC+11 in January), and 18:30 in New York.
    expect(inQuietHours(at('2026-01-14T23:30:00Z'), 'UTC', quiet)).toBe(true)
    expect(inQuietHours(at('2026-01-14T23:30:00Z'), 'Australia/Sydney', quiet)).toBe(false)
    expect(inQuietHours(at('2026-01-14T23:30:00Z'), 'America/New_York', quiet)).toBe(false)
    // 03:00 UTC is 14:00 in Sydney, 22:00 the evening before in New York and 19:00 in Los Angeles.
    expect(inQuietHours(at('2026-01-15T03:00:00Z'), 'Australia/Sydney', quiet)).toBe(false)
    expect(inQuietHours(at('2026-01-15T03:00:00Z'), 'America/New_York', quiet)).toBe(true)
    expect(inQuietHours(at('2026-01-15T03:00:00Z'), 'America/Los_Angeles', quiet)).toBe(false)
  })

  it('follows the wall clock through a change of clocks', () => {
    const quiet = { from: '22:00', to: '07:00' }

    // Europe/London: the clocks went back at 02:00 BST on 2026-10-25, so 06:30 local is 06:30 UTC after and 05:30 UTC before.
    expect(inQuietHours(at('2026-10-24T05:30:00Z'), 'Europe/London', quiet)).toBe(true) // 06:30 BST
    expect(inQuietHours(at('2026-10-24T06:30:00Z'), 'Europe/London', quiet)).toBe(false) // 07:30 BST
    expect(inQuietHours(at('2026-10-25T06:30:00Z'), 'Europe/London', quiet)).toBe(true) // 06:30 GMT
    expect(inQuietHours(at('2026-10-25T07:00:00Z'), 'Europe/London', quiet)).toBe(false) // 07:00 GMT
    // 22:00 local is 21:00 UTC in BST and 22:00 UTC in GMT.
    expect(inQuietHours(at('2026-10-24T21:00:00Z'), 'Europe/London', quiet)).toBe(true)
    expect(inQuietHours(at('2026-10-25T21:00:00Z'), 'Europe/London', quiet)).toBe(false)
    expect(inQuietHours(at('2026-10-25T22:00:00Z'), 'Europe/London', quiet)).toBe(true)
  })

  it('is never quiet for a window that starts and ends together, which the config refuses', () => {
    expect(inQuietHours(at('2026-01-14T22:00:00Z'), 'UTC', { from: '22:00', to: '22:00' })).toBe(false)
  })
})

describe('someone comes into view', () => {
  it('turns a screen that is off on, and logs it', () => {
    const { policy, applied, screen, log } = setup({ state: { screen: 'off' } })

    policy.report('hallway', true)

    expect(applied()).toEqual([['hallway', SCREEN_ON]])
    expect(screen()).toBe('on')
    expect(log.info).toHaveBeenCalledWith('[presence] hallway: someone is there, so the screen is turned on')
  })

  it('leaves a screen that is already on alone', () => {
    const { policy, applied, log } = setup()

    policy.report('hallway', true)

    expect(applied()).toEqual([])
    expect(log.info).not.toHaveBeenCalled()
  })

  it('does nothing when the display\'s auto presence setting is off', () => {
    const { policy, applied, screen } = setup({ state: { screen: 'off', auto_presence: false } })

    policy.report('hallway', true)

    expect(applied()).toEqual([])
    expect(screen()).toBe('off')
  })

  it('does nothing in quiet hours, and does not catch up when they end with the person still there', () => {
    // 22:30 in London, in a window from 22:00 to 07:00.
    vi.setSystemTime(new Date('2026-10-28T22:30:00Z'))
    const { policy, applied, screen } = setup({ state: { screen: 'off' }, quiet: { from: '22:00', to: '07:00' } })

    policy.report('hallway', true)
    vi.advanceTimersByTime(9 * HOUR)

    expect(applied()).toEqual([])
    expect(screen()).toBe('off')
  })

  it('turns the screen on in the same state again only when presence has changed: a repeat ON does nothing', () => {
    const { policy, applied, change } = setup({ state: { screen: 'off' } })

    policy.report('hallway', true)
    change(SCREEN_OFF)
    policy.report('hallway', true)

    expect(applied().filter(([, command]) => command.type === 'set_screen' && command.screen === 'on')).toHaveLength(1)
  })

  it('turns the screen on from an unknown state, and from OFF', () => {
    const { policy, change, screen } = setup({ state: { screen: 'off' } })

    policy.report('hallway', true)
    expect(screen()).toBe('on')

    change(SCREEN_OFF)
    policy.report('hallway', false)
    policy.report('hallway', true)
    expect(screen()).toBe('on')
  })

  it('cancels the wait to turn the screen off', () => {
    const { policy, applied } = setup()
    policy.report('hallway', false)
    vi.advanceTimersByTime(9 * MINUTE)

    policy.report('hallway', true)
    vi.advanceTimersByTime(HOUR)

    expect(applied()).toEqual([])
  })

  it('asks the other displays nothing: each has its own presence', () => {
    const { policy, screen } = setup({ displays: ['hallway', 'kitchen'], state: { screen: 'off' } })

    policy.report('kitchen', true)

    expect(screen('kitchen')).toBe('on')
    expect(screen('hallway')).toBe('off')
  })
})

describe('nobody in view', () => {
  it('turns the screen off after the time in the config, and logs it', () => {
    const { policy, applied, screen, log } = setup()

    policy.report('hallway', false)
    vi.advanceTimersByTime(OFF_AFTER * MINUTE - 1)
    expect(screen()).toBe('on')
    vi.advanceTimersByTime(1)

    expect(applied()).toEqual([['hallway', SCREEN_OFF]])
    expect(screen()).toBe('off')
    expect(log.info).toHaveBeenCalledWith('[presence] hallway: nobody for 10 minutes, so the screen is turned off')
  })

  it('says minute, not minutes, for one', () => {
    const { policy, log } = setup({ offAfter: 1 })

    policy.report('hallway', false)
    vi.advanceTimersByTime(MINUTE)

    expect(log.info).toHaveBeenCalledWith('[presence] hallway: nobody for 1 minute, so the screen is turned off')
  })

  it('counts from the first OFF: a repeat OFF does not restart the wait', () => {
    const { policy, applied } = setup()

    policy.report('hallway', false)
    vi.advanceTimersByTime(6 * MINUTE)
    policy.report('hallway', false)
    vi.advanceTimersByTime(4 * MINUTE)

    expect(applied()).toEqual([['hallway', SCREEN_OFF]])
  })

  it('starts again after someone has been there in between', () => {
    const { policy, applied } = setup()

    policy.report('hallway', false)
    vi.advanceTimersByTime(8 * MINUTE)
    policy.report('hallway', true)
    vi.advanceTimersByTime(MINUTE)
    policy.report('hallway', false)
    vi.advanceTimersByTime(9 * MINUTE)
    expect(applied()).toEqual([])
    vi.advanceTimersByTime(MINUTE)

    expect(applied()).toEqual([['hallway', SCREEN_OFF]])
  })

  it('does nothing when the screen is already off, or the policy is off', () => {
    const off = setup({ state: { screen: 'off' } })
    const disabled = setup({ state: { auto_presence: false } })

    off.policy.report('hallway', false)
    disabled.policy.report('hallway', false)
    vi.advanceTimersByTime(HOUR)

    expect(off.applied()).toEqual([])
    expect(disabled.applied()).toEqual([])
    expect(disabled.screen()).toBe('on')
  })

  it('goes off once the policy is turned off and on again, counting from then', () => {
    const { policy, applied, change } = setup()
    policy.report('hallway', false)

    change({ type: 'set_auto_presence', auto_presence: false })
    vi.advanceTimersByTime(HOUR)
    expect(applied().filter(([, command]) => command.type === 'set_screen')).toEqual([])

    change({ type: 'set_auto_presence', auto_presence: true })
    vi.advanceTimersByTime(OFF_AFTER * MINUTE - 1)
    expect(applied().filter(([, command]) => command.type === 'set_screen')).toEqual([])
    vi.advanceTimersByTime(1)

    expect(applied().filter(([, command]) => command.type === 'set_screen')).toEqual([['hallway', SCREEN_OFF]])
  })

  it('stops waiting when the policy is turned off', () => {
    const { policy, applied, change, screen } = setup()
    policy.report('hallway', false)
    vi.advanceTimersByTime(5 * MINUTE)

    change({ type: 'set_auto_presence', auto_presence: false })
    vi.advanceTimersByTime(HOUR)

    expect(applied().filter(([, command]) => command.type === 'set_screen')).toEqual([])
    expect(screen()).toBe('on')
  })

  it('stops waiting when the screen is turned off, and starts again from the moment it is turned on with nobody there', () => {
    const { policy, applied, change, screen } = setup()
    policy.report('hallway', false)
    vi.advanceTimersByTime(5 * MINUTE)

    change(SCREEN_OFF)
    vi.advanceTimersByTime(HOUR)
    change(SCREEN_ON)
    vi.advanceTimersByTime(OFF_AFTER * MINUTE - 1)
    expect(screen()).toBe('on')
    vi.advanceTimersByTime(1)

    expect(screen()).toBe('off')
    expect(applied().filter(([, command]) => command.type === 'set_screen').map(([, command]) => command)).toEqual([SCREEN_OFF, SCREEN_ON, SCREEN_OFF])
  })

  it('goes off after the time when a screen is switched on by hand while nobody is in view, even if OFF was reported long before', () => {
    const { policy, change, screen } = setup({ state: { screen: 'off' } })
    policy.report('hallway', false)
    vi.advanceTimersByTime(3 * HOUR)

    change(SCREEN_ON)
    expect(screen()).toBe('on')
    vi.advanceTimersByTime(OFF_AFTER * MINUTE)

    expect(screen()).toBe('off')
  })

  it('is not restarted by a change that leaves the screen and the policy as they were', () => {
    const { policy, change, screen } = setup()
    policy.report('hallway', false)
    vi.advanceTimersByTime(6 * MINUTE)

    change({ type: 'set_view', view: 'agenda' })
    change({ type: 'set_brightness', brightness: 40 })
    vi.advanceTimersByTime(4 * MINUTE)

    expect(screen()).toBe('off')
  })

  it('does not take its own commands for a switch: turning the screen off leaves nothing armed', () => {
    const { policy, applied } = setup()
    policy.report('hallway', false)
    vi.advanceTimersByTime(OFF_AFTER * MINUTE)
    vi.advanceTimersByTime(HOUR)

    expect(applied()).toEqual([['hallway', SCREEN_OFF]])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('turns the screen on again when someone comes back', () => {
    const { policy, screen } = setup()
    policy.report('hallway', false)
    vi.advanceTimersByTime(OFF_AFTER * MINUTE)
    expect(screen()).toBe('off')

    policy.report('hallway', true)

    expect(screen()).toBe('on')
  })

  it('keeps the displays apart', () => {
    const { policy, screen } = setup({ displays: ['hallway', 'kitchen'] })

    policy.report('hallway', false)
    policy.report('kitchen', false)
    vi.advanceTimersByTime(5 * MINUTE)
    policy.report('kitchen', true)
    vi.advanceTimersByTime(5 * MINUTE)

    expect(screen('hallway')).toBe('off')
    expect(screen('kitchen')).toBe('on')
  })

  it('waits in steps no longer than the control service\'s longest timer, for a long limit', () => {
    const days = 3 * 24 * 60
    const { policy, screen } = setup({ offAfter: days })
    policy.report('hallway', false)

    vi.advanceTimersByTime(MAX_TIMER_MS)
    vi.advanceTimersByTime(MAX_TIMER_MS)
    expect(screen()).toBe('on')
    vi.advanceTimersByTime(MAX_TIMER_MS - 1)
    expect(screen()).toBe('on')
    vi.advanceTimersByTime(1)

    expect(screen()).toBe('off')
  })

  it('logs a screen it could not turn off, and tries again', () => {
    const { policy, control, log, screen } = setup()
    control.applyCommand.mockImplementationOnce(() => { throw new Error('database is locked') })
    policy.report('hallway', false)

    vi.advanceTimersByTime(OFF_AFTER * MINUTE)
    expect(log.error).toHaveBeenCalledWith('[presence] hallway: could not turn the screen off: database is locked')
    expect(screen()).toBe('on')
    vi.advanceTimersByTime(QUIET_RECHECK_MS)

    expect(screen()).toBe('off')
  })

  it('logs a screen it could not turn on, and does not throw', () => {
    const { policy, control, log } = setup({ state: { screen: 'off' } })
    control.applyCommand.mockImplementationOnce(() => { throw new Error('database is locked') })

    expect(() => policy.report('hallway', true)).not.toThrow()

    expect(log.error).toHaveBeenCalledWith('[presence] hallway: could not turn the screen on: database is locked')
  })

  it('logs a state it cannot read when the wait is over, and does not throw out of the timer', () => {
    const { policy, control, log } = setup()
    policy.report('hallway', false)
    control.getState.mockImplementation(() => { throw new Error('no such display') })

    expect(() => vi.advanceTimersByTime(OFF_AFTER * MINUTE)).not.toThrow()

    expect(log.error).toHaveBeenCalledWith('[presence] hallway: could not check the screen: no such display')
  })
})

describe('quiet hours at the end of the wait', () => {
  const quiet = { from: '22:00', to: '07:00' }

  it('leave the screen on, and turn it off once they end if nobody has come back', () => {
    // 21:55 in London (BST would make it 22:55, so use a winter date: GMT is UTC).
    vi.setSystemTime(new Date('2026-12-02T21:55:00Z'))
    const { policy, applied, screen } = setup({ quiet })

    policy.report('hallway', false)
    vi.advanceTimersByTime(OFF_AFTER * MINUTE)
    expect(screen()).toBe('on')
    vi.advanceTimersByTime(8 * HOUR)
    expect(screen()).toBe('on')
    // 06:05 now. The window ends at 07:00, and the first check after that turns it off.
    vi.advanceTimersByTime(54 * MINUTE)
    expect(screen()).toBe('on')
    vi.advanceTimersByTime(QUIET_RECHECK_MS)

    expect(screen()).toBe('off')
    expect(applied()).toEqual([['hallway', SCREEN_OFF]])
  })

  it('leave the screen on for good if someone comes back, without turning anything', () => {
    vi.setSystemTime(new Date('2026-12-02T21:55:00Z'))
    const { policy, applied, screen } = setup({ quiet })
    policy.report('hallway', false)
    vi.advanceTimersByTime(OFF_AFTER * MINUTE)

    policy.report('hallway', true)
    vi.advanceTimersByTime(12 * HOUR)

    expect(screen()).toBe('on')
    expect(applied()).toEqual([])
  })

  it('stop being checked when the screen is turned off by someone else', () => {
    vi.setSystemTime(new Date('2026-12-02T21:55:00Z'))
    const { policy, change } = setup({ quiet })
    policy.report('hallway', false)
    vi.advanceTimersByTime(OFF_AFTER * MINUTE)
    expect(vi.getTimerCount()).toBe(1)

    change(SCREEN_OFF)

    expect(vi.getTimerCount()).toBe(0)
  })

  it('do not hold the screen off before the wait is over: a window that starts mid-wait does not cut it short', () => {
    // Not in quiet hours when the wait ends at 21:50.
    vi.setSystemTime(new Date('2026-12-02T21:40:00Z'))
    const { policy, screen } = setup({ quiet })

    policy.report('hallway', false)
    vi.advanceTimersByTime(OFF_AFTER * MINUTE)

    expect(screen()).toBe('off')
  })

  it('are read in the display\'s time zone, across a change of clocks', () => {
    // 2026-10-25 23:30 UTC is 23:30 GMT in London (after the clocks went back that night).
    vi.setSystemTime(new Date('2026-10-25T23:30:00Z'))
    const { policy, screen } = setup({ quiet })

    policy.report('hallway', false)
    vi.advanceTimersByTime(OFF_AFTER * MINUTE)

    expect(screen()).toBe('on')
  })
})

describe('the sensor is not known', () => {
  it('forgets nobody and cancels the wait, leaving the screen as it is', () => {
    const { policy, applied, screen } = setup()
    policy.report('hallway', false)
    vi.advanceTimersByTime(5 * MINUTE)

    policy.report('hallway', null)
    vi.advanceTimersByTime(HOUR)

    expect(applied()).toEqual([])
    expect(screen()).toBe('on')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does nothing for a screen that is off', () => {
    const { policy, applied } = setup({ state: { screen: 'off' } })

    policy.report('hallway', null)

    expect(applied()).toEqual([])
  })

  it('counts OFF from scratch afterwards, and takes ON as a change', () => {
    const { policy, screen, change } = setup()
    policy.report('hallway', false)
    vi.advanceTimersByTime(8 * MINUTE)
    policy.report('hallway', null)

    policy.report('hallway', false)
    vi.advanceTimersByTime(9 * MINUTE)
    expect(screen()).toBe('on')
    vi.advanceTimersByTime(MINUTE)
    expect(screen()).toBe('off')

    policy.report('hallway', null)
    change(SCREEN_OFF)
    policy.report('hallway', true)
    expect(screen()).toBe('on')
  })

  it('does not start a wait when the screen is switched on while nothing is known', () => {
    const { policy, change } = setup({ state: { screen: 'off' } })
    policy.report('hallway', null)

    change(SCREEN_ON)
    vi.advanceTimersByTime(HOUR)

    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('displays and stopping', () => {
  it('ignores a report for a display that is not in the config', () => {
    const { policy, control } = setup()

    expect(() => policy.report('attic', false)).not.toThrow()
    vi.advanceTimersByTime(HOUR)

    expect(control.applyCommand).not.toHaveBeenCalled()
  })

  it('ignores a state change for a display that is not in the config', () => {
    const { bus, control } = setup()

    bus.emit('state.updated', { displayId: 'attic', state: defaultDisplayState() })

    expect(control.applyCommand).not.toHaveBeenCalled()
  })

  it('stop clears every timer and stops listening, and a later report does nothing', () => {
    const { policy, applied, bus, change, screen } = setup({ displays: ['hallway', 'kitchen'] })
    policy.report('hallway', false)
    policy.report('kitchen', false)
    expect(vi.getTimerCount()).toBe(2)

    policy.stop()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(HOUR)
    policy.report('hallway', false)
    change(SCREEN_OFF)
    change(SCREEN_ON)
    bus.emit('state.updated', { displayId: 'hallway', state: defaultDisplayState() })

    expect(vi.getTimerCount()).toBe(0)
    // Only the test's own two switches reached the control, and the second left the screen on.
    expect(applied()).toEqual([['hallway', SCREEN_OFF], ['hallway', SCREEN_ON]])
    expect(screen()).toBe('on')
  })

  it('reads the state of each display at the start, so the first switch is told from a change', () => {
    const { policy, control } = setup({ displays: ['hallway', 'kitchen'] })

    expect(control.getState.mock.calls.map(call => call[0])).toEqual(['hallway', 'kitchen'])
    policy.stop()
  })

  it('carries on when the state cannot be read at the start', () => {
    const bus = createEventBus()
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const control = { getState: vi.fn(() => { throw new Error('no such display') }), applyCommand: vi.fn() }

    const policy = createPresencePolicy({ config: { off_after_minutes: 10 }, displays: ['hallway'], timeZone: 'Europe/London', control, bus, log })
    policies.push(policy)

    expect(log.error).toHaveBeenCalledWith('[presence] hallway: could not read the state: no such display')
  })
})
