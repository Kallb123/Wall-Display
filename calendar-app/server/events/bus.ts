// A small typed bus for events inside the server. The sync scheduler, the
// display control and the weather service emit on it, and the WebSocket hub
// subscribes to push the change to the displays and remotes (MQTT will
// subscribe too).
// Plain module state, so a unit test can import it; handlers get it through
// `useEventBus()` in server/utils/.

import type { DisplayState } from '../../shared/display'
import type { SpecialDaysResolution } from '../../shared/special-days'
import type { WeatherSnapshot } from '../../shared/weather'

/** The events on the bus, by name, with their payloads. */
export interface BusEvents {
  /** Stored events changed (or may have): `calendarIds` are the calendars to reload. */
  'events.updated': { calendarIds: string[] }
  /** A display's state changed. `state` is the whole new state. */
  'state.updated': { displayId: string, state: DisplayState }
  /** Someone asked the display to show the next photo. */
  'photo.next': { displayId: string }
  /** A calendar synced successfully, whether or not its events changed. */
  'sync.succeeded': { calendarId: string }
  /** The weather changed, or the displays' copy is due a refresh. `weather` is the whole new snapshot. */
  'weather.updated': { weather: WeatherSnapshot }
  /** The special days service re-resolved and the answer changed (an edit, or a new day at midnight). `specialDays` is the whole new resolution. */
  'special_days.updated': { specialDays: SpecialDaysResolution }
}

export type BusHandler<Name extends keyof BusEvents> = (payload: BusEvents[Name]) => void

export interface EventBus {
  /** Subscribes `handler`. Returns the function that unsubscribes it. */
  on: <Name extends keyof BusEvents>(name: Name, handler: BusHandler<Name>) => () => void
  /** Calls every handler for `name`, in the order they subscribed. A handler that throws is logged and does not stop the others or reach the caller. */
  emit: <Name extends keyof BusEvents>(name: Name, payload: BusEvents[Name]) => void
}

// What the bus stores: a handler for any event. `on` and `emit` keep the names and payloads matched.
type AnyHandler = (payload: BusEvents[keyof BusEvents]) => void

export function createEventBus(log: Pick<Console, 'error'> = console): EventBus {
  const handlers = new Map<keyof BusEvents, Set<AnyHandler>>()

  return {
    on(name, handler) {
      const stored = handler as AnyHandler
      handlers.set(name, (handlers.get(name) ?? new Set()).add(stored))
      return () => { handlers.get(name)?.delete(stored) }
    },
    emit(name, payload) {
      // Copy, so a handler that unsubscribes (or subscribes) mid-emit doesn't change who is called.
      for (const handler of [...handlers.get(name) ?? []]) {
        try {
          handler(payload)
        } catch (error) {
          log.error(`[events] a handler for ${name} failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    },
  }
}

const shared = createEventBus()

/** The server's one bus. */
export function getEventBus(): EventBus {
  return shared
}
