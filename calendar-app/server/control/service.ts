import type { Command, DisplayState } from '../../shared/display'
import type { DisplayConfig } from '../config/schema'
import type { Db } from '../db/client'
import type { EventBus } from '../events/bus'
import { defaultDisplayState, expireState, nextExpiry, reduceCommand } from './commands'
import type { ControlContext } from './commands'
import { loadDisplayState, saveDisplayState } from './store'

// Holds each display's state: applies commands, stores the result, tells the
// rest of the app, and runs the timer that reverts a pinned month or clears
// an overlay. The rules themselves are in commands.ts. Everything the service
// touches comes in through the options, so a test uses fake timers and an
// in-memory database.

export interface DisplayControlOptions {
  db: Db
  /** The displays in the config: the only ids that have state. */
  displays: readonly Pick<DisplayConfig, 'id' | 'month_return_minutes'>[]
  /** The display time zone, which decides what the current month is. */
  timeZone: string
  bus: EventBus
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
  /** Applies `command`, stores the new state, broadcasts it, and returns it. Throws `UnknownDisplayError`. */
  applyCommand: (displayId: string, command: Command) => DisplayState
  /** Cancels every timer. Later commands still work, but nothing reverts on its own. */
  stop: () => void
}

export class UnknownDisplayError extends Error {
  constructor(readonly displayId: string) {
    super(`Unknown display "${displayId}"`)
    this.name = 'UnknownDisplayError'
  }
}

/** The longest one timer waits. A timer can't be longer than about 24.8 days, and re-arming daily costs nothing. */
export const MAX_TIMER_MS = 24 * 60 * 60 * 1000

export function createDisplayControl(options: DisplayControlOptions): DisplayControl {
  const { db, timeZone, bus, refresh, now = () => new Date(), log = console } = options
  const monthReturnMinutes = new Map(options.displays.map(display => [display.id, display.month_return_minutes]))
  const states = new Map<string, DisplayState>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let stopped = false

  function contextFor(displayId: string): ControlContext {
    return { now: now(), timeZone, monthReturnMinutes: monthReturnMinutes.get(displayId)! }
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
    getState(displayId) {
      assertKnown(displayId)
      return settle(displayId)
    },
    applyCommand(displayId, command) {
      assertKnown(displayId)
      commit(displayId, reduceCommand(settle(displayId), command, contextFor(displayId)))

      if (command.type === 'photo_next') bus.emit('photo.next', { displayId })
      if (command.type === 'refresh') {
        refresh().catch((error: unknown) => {
          log.error(`[control] ${displayId}: refreshing the calendars failed: ${error instanceof Error ? error.message : String(error)}`)
        })
      }
      return states.get(displayId)!
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
