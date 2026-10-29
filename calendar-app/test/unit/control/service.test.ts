import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Command, DisplayState } from '../../../shared/display'
import { createDisplayControl, UnknownDisplayError } from '../../../server/control/service'
import type { DisplayControl } from '../../../server/control/service'
import { loadDisplayState, saveDisplayState } from '../../../server/control/store'
import { createEventBus } from '../../../server/events/bus'
import { displayState } from '../../../server/db/schema'
import { migratedMemoryDb } from '../db/helpers'

// The display control with an in-memory database, a real bus and fake timers.
// The clock is the fake timers' clock, so a month pinned "now" reverts when
// the test advances time.

const MINUTE = 60_000
const RETURN_MINUTES = 15
const START = new Date('2026-10-28T12:00:00Z')

const DISPLAYS = [
  { id: 'hallway', month_return_minutes: RETURN_MINUTES },
  { id: 'kitchen', month_return_minutes: 5 },
]

const setMonth = (month: string): Command => ({ type: 'set_month', month })

function setup(handle = migratedMemoryDb(), refresh: () => Promise<unknown> = () => Promise.resolve([])) {
  const bus = createEventBus()
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const stateUpdates = vi.fn<(payload: { displayId: string, state: DisplayState }) => void>()
  const photoNext = vi.fn<(payload: { displayId: string }) => void>()
  bus.on('state.updated', stateUpdates)
  bus.on('photo.next', photoNext)
  const refreshSpy = vi.fn(refresh)
  const control = createDisplayControl({ db: handle.db, displays: DISPLAYS, timeZone: 'Europe/London', bus, refresh: refreshSpy, log })
  controls.push(control)
  return { control, handle, bus, log, stateUpdates, photoNext, refresh: refreshSpy }
}

const controls: DisplayControl[] = []

beforeEach(() => {
  vi.useFakeTimers({ now: START })
})

afterEach(() => {
  for (const control of controls.splice(0)) control.stop()
  vi.useRealTimers()
})

describe('the state of a display', () => {
  it('starts as the default for a display with nothing stored', () => {
    const { control } = setup()

    expect(control.getState('hallway')).toEqual({
      view: 'month', month: null, month_set_at: null, screen: 'on', photo_source: 'immich', brightness: 100, auto_presence: true, auto_brightness: true, overlay: null,
    })
  })

  it('knows the configured displays and no others', () => {
    const { control } = setup()

    expect(control.hasDisplay('hallway')).toBe(true)
    expect(control.hasDisplay('garage')).toBe(false)
    expect(() => control.getState('garage')).toThrow(UnknownDisplayError)
    expect(() => control.applyCommand('garage', { type: 'next_view' })).toThrow('Unknown display "garage"')
  })

  it('keeps each display apart', () => {
    const { control } = setup()

    control.applyCommand('hallway', { type: 'set_view', view: 'week' })

    expect(control.getState('hallway').view).toBe('week')
    expect(control.getState('kitchen').view).toBe('month')
  })

  it('is stored, and a new service reads it back', () => {
    const first = setup()
    first.control.applyCommand('hallway', { type: 'set_view', view: 'agenda' })
    first.control.applyCommand('hallway', { type: 'set_brightness', brightness: 40 })
    first.control.stop()

    const second = setup(first.handle)

    expect(second.control.getState('hallway')).toMatchObject({ view: 'agenda', brightness: 40 })
    expect(second.control.getState('kitchen').view).toBe('month')
  })

  it('writes one row per display and updates it in place', () => {
    const { control, handle } = setup()

    control.applyCommand('hallway', { type: 'set_view', view: 'agenda' })
    control.applyCommand('hallway', { type: 'set_view', view: 'week' })

    const rows = handle.db.select().from(displayState).all()
    expect(rows.map(row => row.displayId)).toEqual(['hallway'])
    expect(loadDisplayState(handle.db, 'hallway')?.view).toBe('week')
  })

  it('starts from the defaults, with a warning, when the stored state is corrupt', () => {
    const handle = migratedMemoryDb()
    handle.db.insert(displayState).values({ displayId: 'hallway', state: { view: 'upside-down' } }).run()

    const { control, log } = setup(handle)

    expect(control.getState('hallway').view).toBe('month')
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0]![0]).toContain('hallway')
    expect(log.warn.mock.calls[0]![0]).not.toContain('upside-down')
  })

  it('fills in fields a stored state does not have yet', () => {
    const handle = migratedMemoryDb()
    handle.db.insert(displayState).values({ displayId: 'hallway', state: { view: 'week' } }).run()

    expect(setup(handle).control.getState('hallway')).toMatchObject({ view: 'week', screen: 'on', brightness: 100 })
  })
})

describe('applying commands', () => {
  it('returns the new state', () => {
    const { control } = setup()

    expect(control.applyCommand('hallway', { type: 'set_screen', screen: 'off' })).toMatchObject({ screen: 'off' })
  })

  it('announces a change once, with the whole new state', () => {
    const { control, stateUpdates } = setup()

    control.applyCommand('hallway', { type: 'set_view', view: 'agenda' })

    expect(stateUpdates).toHaveBeenCalledTimes(1)
    expect(stateUpdates).toHaveBeenCalledWith({ displayId: 'hallway', state: expect.objectContaining({ view: 'agenda', screen: 'on' }) })
  })

  it('says nothing about a command that changes nothing', () => {
    const { control, stateUpdates, handle } = setup()

    control.applyCommand('hallway', { type: 'set_view', view: 'month' })
    control.applyCommand('hallway', { type: 'set_brightness', brightness: 100 })
    control.applyCommand('hallway', { type: 'set_month', month: 'current' })

    expect(stateUpdates).not.toHaveBeenCalled()
    expect(handle.db.select().from(displayState).all()).toEqual([])
  })

  it('does not say it again for the same command twice', () => {
    const { control, stateUpdates } = setup()

    control.applyCommand('hallway', { type: 'set_screen', screen: 'off' })
    control.applyCommand('hallway', { type: 'set_screen', screen: 'off' })

    expect(stateUpdates).toHaveBeenCalledTimes(1)
  })

  it('announces photo_next to the bus, without a state change', () => {
    const { control, photoNext, stateUpdates } = setup()

    control.applyCommand('kitchen', { type: 'photo_next' })

    expect(photoNext).toHaveBeenCalledWith({ displayId: 'kitchen' })
    expect(stateUpdates).not.toHaveBeenCalled()
  })

  it('refresh starts a sync of the calendars without waiting for it', () => {
    let finish!: () => void
    const { control, refresh, stateUpdates } = setup(undefined, () => new Promise<void>((resolve) => { finish = resolve }))

    const state = control.applyCommand('hallway', { type: 'refresh' })

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(state.view).toBe('month')
    expect(stateUpdates).not.toHaveBeenCalled()
    finish()
  })

  it('logs a refresh that fails, and carries on', async () => {
    const { control, log } = setup(undefined, () => Promise.reject(new Error('feed down')))

    expect(() => control.applyCommand('hallway', { type: 'refresh' })).not.toThrow()
    await vi.advanceTimersByTimeAsync(0)

    expect(log.error).toHaveBeenCalledTimes(1)
    expect(log.error.mock.calls[0]![0]).toContain('feed down')
  })

  it('does not change the state when it cannot be stored', () => {
    const { control, handle, stateUpdates } = setup()
    handle.sqlite.close()

    expect(() => control.applyCommand('hallway', { type: 'set_view', view: 'agenda' })).toThrow()

    expect(control.getState('hallway').view).toBe('month')
    expect(stateUpdates).not.toHaveBeenCalled()
  })
})

describe('the pinned month timer', () => {
  it('sends the month back after month_return_minutes and announces it', () => {
    const { control, stateUpdates } = setup()
    control.applyCommand('hallway', setMonth('2026-12'))
    stateUpdates.mockClear()

    vi.advanceTimersByTime(RETURN_MINUTES * MINUTE - 1)
    expect(stateUpdates).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)

    expect(stateUpdates).toHaveBeenCalledTimes(1)
    expect(stateUpdates).toHaveBeenCalledWith({ displayId: 'hallway', state: expect.objectContaining({ month: null, month_set_at: null }) })
    expect(control.getState('hallway').month).toBeNull()
  })

  it('stores the reverted state', () => {
    const { control, handle } = setup()
    control.applyCommand('hallway', setMonth('2026-12'))

    vi.advanceTimersByTime(RETURN_MINUTES * MINUTE)

    expect(loadDisplayState(handle.db, 'hallway')?.month).toBeNull()
  })

  it('uses the return time of each display', () => {
    const { control } = setup()
    control.applyCommand('hallway', setMonth('2026-12'))
    control.applyCommand('kitchen', setMonth('2026-12'))

    vi.advanceTimersByTime(5 * MINUTE)

    expect(control.getState('kitchen').month).toBeNull()
    expect(control.getState('hallway').month).toBe('2026-12')
  })

  it('waits longer when the month is picked again', () => {
    const { control } = setup()
    control.applyCommand('hallway', setMonth('2026-12'))
    vi.advanceTimersByTime(10 * MINUTE)
    control.applyCommand('hallway', setMonth('next'))

    vi.advanceTimersByTime(10 * MINUTE)
    expect(control.getState('hallway').month).toBe('2027-01')
    vi.advanceTimersByTime(5 * MINUTE)

    expect(control.getState('hallway').month).toBeNull()
  })

  it('has nothing left to run once the view leaves the month', () => {
    const { control, stateUpdates } = setup()
    control.applyCommand('hallway', setMonth('2026-12'))
    control.applyCommand('hallway', { type: 'set_view', view: 'agenda' })
    stateUpdates.mockClear()

    vi.advanceTimersByTime(RETURN_MINUTES * MINUTE * 2)

    expect(stateUpdates).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reverts a month that was pinned before a restart, on time', () => {
    const first = setup()
    first.control.applyCommand('hallway', setMonth('2026-12'))
    first.control.stop()

    // The app is down for five minutes, then starts again.
    vi.advanceTimersByTime(5 * MINUTE)
    const second = setup(first.handle)
    expect(second.control.getState('hallway').month).toBe('2026-12')
    second.stateUpdates.mockClear()

    vi.advanceTimersByTime(10 * MINUTE)

    expect(second.stateUpdates).toHaveBeenCalledWith({ displayId: 'hallway', state: expect.objectContaining({ month: null }) })
  })

  it('reverts a month whose time ran out while the app was down, straight away', () => {
    const first = setup()
    first.control.applyCommand('hallway', setMonth('2026-12'))
    first.control.stop()
    vi.advanceTimersByTime(60 * MINUTE)

    const second = setup(first.handle)

    expect(second.control.getState('hallway').month).toBeNull()
    expect(loadDisplayState(second.handle.db, 'hallway')?.month).toBeNull()
  })

  it('also reverts on a read, if the timer has not got there yet', () => {
    const { control } = setup()
    control.applyCommand('hallway', setMonth('2026-12'))

    // Move the clock without running the timers.
    vi.setSystemTime(new Date(START.getTime() + RETURN_MINUTES * MINUTE))

    expect(control.getState('hallway').month).toBeNull()
  })
})

describe('the overlay timer', () => {
  it('clears the overlay when its time is up and announces it', () => {
    const { control, stateUpdates } = setup()
    control.applyCommand('hallway', { type: 'set_overlay', overlay: { text: 'Bins out tonight', ttl: 600 } })
    stateUpdates.mockClear()

    vi.advanceTimersByTime(600_000)

    expect(stateUpdates).toHaveBeenCalledTimes(1)
    expect(control.getState('hallway').overlay).toBeNull()
  })

  it('keeps waiting through an overlay longer than a day', () => {
    const { control } = setup()
    control.applyCommand('hallway', { type: 'set_overlay', overlay: { text: 'Away', ttl: 3 * 24 * 3600 } })

    vi.advanceTimersByTime(2 * 24 * 3600 * 1000)
    expect(control.getState('hallway').overlay).not.toBeNull()
    vi.advanceTimersByTime(24 * 3600 * 1000)

    expect(control.getState('hallway').overlay).toBeNull()
  })
})

describe('stopping', () => {
  it('cancels every timer', () => {
    const { control } = setup()
    control.applyCommand('hallway', setMonth('2026-12'))
    control.applyCommand('kitchen', { type: 'set_overlay', overlay: { text: 'Hi', ttl: 60 } })
    expect(vi.getTimerCount()).toBe(2)

    control.stop()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves nothing running after later commands', () => {
    const { control, stateUpdates } = setup()
    control.stop()

    control.applyCommand('hallway', setMonth('2026-12'))
    stateUpdates.mockClear()
    vi.advanceTimersByTime(60 * MINUTE)

    expect(vi.getTimerCount()).toBe(0)
    expect(stateUpdates).not.toHaveBeenCalled()
  })
})

describe('the store', () => {
  it('saves and loads a state', () => {
    const handle = migratedMemoryDb()
    const state = { view: 'week', month: null, month_set_at: null, screen: 'off', photo_source: 'local', brightness: 20, auto_presence: false, auto_brightness: true, overlay: null } as const

    saveDisplayState(handle.db, 'hallway', state)

    expect(loadDisplayState(handle.db, 'hallway')).toEqual(state)
    expect(loadDisplayState(handle.db, 'kitchen')).toBeUndefined()
  })
})
