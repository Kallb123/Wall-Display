// A small typed bus for events inside the server. The sync scheduler emits on
// it, and the WebSocket (PR 1.3) subscribes to push the change to the displays.
// Plain module state, so a unit test can import it; handlers get it through
// `useEventBus()` in server/utils/.

/** The events on the bus, by name, with their payloads. */
export interface BusEvents {
  /** Stored events changed (or may have): `calendarIds` are the calendars to reload. */
  'events.updated': { calendarIds: string[] }
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
