import type { CameraSummary, DisplayState } from '../../shared/display'
import type { LayoutSummary } from '../../shared/layouts'
import type { DisplayConfig } from '../config/schema'
import type { Db } from '../db/client'
import type { EventBus } from '../events/bus'
import { defaultDisplayState, expireState, nextExpiry, reduceCommand } from './commands'
import type { ControlCommand, ControlContext } from './commands'
import { loadDisplayState, saveDisplayState } from './store'

// Holds each display's state: applies commands, stores the result, tells the
// rest of the app, and runs the timer that reverts a pinned month or week or clears
// an overlay. The rules themselves are in commands.ts. The month return timeout
// and the week start can be changed while it runs (`updateDisplay`, from the settings page): a month
// pinned for longer than the new limit reverts at once, and any other timer is
// re-armed for the new limit, with no restart. Everything the service
// touches comes in through the options, so a test uses fake timers and an
// in-memory database.

export interface DisplayControlOptions {
  db: Db
  /** The displays in the config: the only ids that have state. `schedules` are the only ids `set_schedule` accepts (none if left out). */
  displays: readonly (Pick<DisplayConfig, 'id' | 'month_return_minutes' | 'week_start'> & { schedules?: readonly { id: string }[] })[]
  /** The display time zone, which decides what the current month is. */
  timeZone: string
  bus: EventBus
  /** The custom layouts at start, by name (PR 5.17). They change while it runs through `setLayouts`. Default: none. */
  layouts?: readonly LayoutSummary[]
  /** The cameras in the config: the only ids `set_camera` accepts. Default: none. */
  cameras?: readonly CameraSummary[]
  /** Whether a photo source is set up, asked when a command arrives because the photo service starts after this one. Default: yes. */
  photosConfigured?: () => boolean
  /** Forces a sync of every calendar. Called, not awaited, for `refresh`; a rejection is logged. */
  refresh: () => Promise<unknown>
  /** For tests. Default: the real time. */
  now?: () => Date
  /** For tests. Default: the console. */
  log?: Pick<Console, 'info' | 'warn' | 'error'>
}

export interface DisplayControl {
  hasDisplay: (displayId: string) => boolean
  /** The current state. Throws `UnknownDisplayError` for an id that isn't in the config. */
  getState: (displayId: string) => DisplayState
  /** Whether the display has a built-in schedule with this id. False for an unknown display. */
  hasSchedule: (displayId: string, scheduleId: string) => boolean
  /** Applies `command`, stores the new state, broadcasts it, and returns it. Throws `UnknownDisplayError`, `UnknownScheduleError` for a `set_schedule` the display has no schedule for, `UnknownLayoutError` for a `set_layout` that names a layout that isn't in the library, and `UnknownCameraError` for a `set_camera` that names a camera that isn't in the config. */
  applyCommand: (displayId: string, command: ControlCommand) => DisplayState
  /** The display's current `week_start`, as the settings page last set it. Throws `UnknownDisplayError`. */
  weekStartOf: (displayId: string) => 'monday' | 'sunday'
  /**
   * Changes the display's month return timeout and week start, which takes effect at once: the state is settled (a month or week pinned longer ago than the new limit reverts now, a pinned week moves to the first day of its week, and the change is stored and broadcast like any other) and the timer is re-armed for the new limit. Throws `UnknownDisplayError`.
   */
  updateDisplay: (displayId: string, update: { month_return_minutes: number, week_start: 'monday' | 'sunday' }) => void
  /**
   * Replaces the custom layouts (by name), which takes effect at once: every display is settled, so one showing a layout that was deleted falls back to the month view, and the change is stored and broadcast like any other.
   */
  setLayouts: (layouts: readonly LayoutSummary[]) => void
  /** Cancels every timer. Later commands still work, but nothing reverts on its own. */
  stop: () => void
}

export class UnknownDisplayError extends Error {
  constructor(readonly displayId: string) {
    super(`Unknown display "${displayId}"`)
    this.name = 'UnknownDisplayError'
  }
}

export class UnknownScheduleError extends Error {
  constructor(readonly displayId: string, readonly scheduleId: string) {
    super(`Display "${displayId}" has no schedule "${scheduleId}"`)
    this.name = 'UnknownScheduleError'
  }
}

export class UnknownLayoutError extends Error {
  constructor(readonly layoutId: string) {
    super(`Unknown layout "${layoutId}"`)
    this.name = 'UnknownLayoutError'
  }
}

export class UnknownCameraError extends Error {
  constructor(readonly cameraId: string) {
    super(`Unknown camera "${cameraId}"`)
    this.name = 'UnknownCameraError'
  }
}

/** The longest one timer waits. A timer can't be longer than about 24.8 days, and re-arming daily costs nothing. */
export const MAX_TIMER_MS = 24 * 60 * 60 * 1000

export function createDisplayControl(options: DisplayControlOptions): DisplayControl {
  const { db, timeZone, bus, photosConfigured = () => true, refresh, now = () => new Date(), log = console } = options
  const monthReturnMinutes = new Map(options.displays.map(display => [display.id, display.month_return_minutes]))
  const weekStarts = new Map(options.displays.map(display => [display.id, display.week_start]))
  const scheduleIds = new Map(options.displays.map(display => [display.id, new Set((display.schedules ?? []).map(schedule => schedule.id))]))
  let layouts: readonly LayoutSummary[] = options.layouts ?? []
  const cameras: readonly CameraSummary[] = options.cameras ?? []
  const states = new Map<string, DisplayState>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let stopped = false

  function contextFor(displayId: string): ControlContext {
    return { now: now(), timeZone, monthReturnMinutes: monthReturnMinutes.get(displayId)!, weekStart: weekStarts.get(displayId)!, photosConfigured: photosConfigured(), layouts, cameras }
  }

  function assertKnown(displayId: string): void {
    if (!monthReturnMinutes.has(displayId)) throw new UnknownDisplayError(displayId)
  }

  /** Stores, remembers and announces `next`, unless it is what the display already has. */
  function commit(displayId: string, next: DisplayState): void {
    const before = states.get(displayId)
    if (before && isEqual(before, next)) return

    saveDisplayState(db, displayId, next)
    states.set(displayId, next)
    bus.emit('state.updated', { displayId, state: next })
    schedule(displayId)
  }

  /** The display's state with anything that has run out dropped, loading it from the database on first use. */
  function settle(displayId: string): DisplayState {
    let state = states.get(displayId)
    if (!state) {
      state = loadDisplayState(db, displayId, log) ?? defaultDisplayState()
      states.set(displayId, state)
    }
    const expired = expireState(state, contextFor(displayId))
    if (expired !== state) commit(displayId, expired)
    return states.get(displayId)!
  }

  /** (Re)starts the display's timer for the next time something runs out. */
  function schedule(displayId: string): void {
    clearTimeout(timers.get(displayId))
    timers.delete(displayId)
    if (stopped) return

    const ctx = contextFor(displayId)
    const at = nextExpiry(states.get(displayId)!, ctx)
    if (at === null) return
    const delay = Math.min(Math.max(at.getTime() - ctx.now.getTime(), 0), MAX_TIMER_MS)
    timers.set(displayId, setTimeout(() => {
      timers.delete(displayId)
      if (stopped) return
      try {
        settle(displayId)
      } catch (error) {
        log.error(`[control] ${displayId}: could not update the state: ${error instanceof Error ? error.message : String(error)}`)
      }
      // Whether it changed or the wait was cut short, there may be a next time.
      schedule(displayId)
    }, delay))
  }

  // Load every display now, so a month pinned before a restart still reverts on time.
  for (const { id } of options.displays) {
    try {
      settle(id)
    } catch (error) {
      log.error(`[control] ${id}: could not store the state: ${error instanceof Error ? error.message : String(error)}`)
    }
    schedule(id)
  }

  return {
    hasDisplay: displayId => monthReturnMinutes.has(displayId),
    weekStartOf(displayId) {
      assertKnown(displayId)
      return weekStarts.get(displayId)!
    },
    hasSchedule: (displayId, scheduleId) => scheduleIds.get(displayId)?.has(scheduleId) ?? false,
    getState(displayId) {
      assertKnown(displayId)
      return settle(displayId)
    },
    applyCommand(displayId, command) {
      assertKnown(displayId)
      if (command.type === 'set_schedule' && !scheduleIds.get(displayId)!.has(command.schedule)) throw new UnknownScheduleError(displayId, command.schedule)
      if (command.type === 'set_layout' && !layouts.some(layout => layout.id === command.layout)) throw new UnknownLayoutError(command.layout)
      if (command.type === 'set_camera' && command.camera !== null && !cameras.some(camera => camera.id === command.camera)) throw new UnknownCameraError(command.camera)
      commit(displayId, reduceCommand(settle(displayId), command, contextFor(displayId)))

      if (command.type === 'photo_next') bus.emit('photo.next', { displayId })
      if (command.type === 'refresh') {
        refresh().catch((error: unknown) => {
          log.error(`[control] ${displayId}: refreshing the calendars failed: ${error instanceof Error ? error.message : String(error)}`)
        })
      }
      return states.get(displayId)!
    },
    updateDisplay(displayId, update) {
      assertKnown(displayId)
      monthReturnMinutes.set(displayId, update.month_return_minutes)
      weekStarts.set(displayId, update.week_start)
      settle(displayId)
      // A commit has re-armed it already; otherwise the timer still counts for the old limit.
      schedule(displayId)
    },
    setLayouts(next) {
      layouts = next
      for (const { id } of options.displays) {
        try {
          settle(id)
        } catch (error) {
          log.error(`[control] ${id}: could not apply the changed layouts: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    },
    stop() {
      stopped = true
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    },
  }
}

function isEqual(a: DisplayState, b: DisplayState): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
