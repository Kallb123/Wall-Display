import { createDisplayControl } from '../control/service'
import { getDisplayControl, setDisplayControl } from '../control/state'
import { getSocketHub } from '../ws/hub'

// Runs after the sync plugin (the 03 prefix). It starts the display control,
// which holds each display's state and runs its timers, and connects the
// event bus to the WebSocket hub: a state change goes to that display's
// sockets, changed calendar events go to every socket.
export default defineNitroPlugin((nitroApp) => {
  // A hot reload runs this again in the same process, so stop the old control first.
  getDisplayControl()?.stop()
  setDisplayControl(undefined)

  const config = useConfig()
  const bus = useEventBus()
  const hub = getSocketHub()

  const control = createDisplayControl({
    db: useDb(),
    displays: config.displays,
    timeZone: config.timezone,
    bus,
    // The weather service starts after this plugin, so it is looked up when the command arrives.
    refresh: () => Promise.all([useSyncScheduler().refreshAll(), useWeather()?.refresh()]),
  })
  setDisplayControl(control)

  const unsubscribe = [
    bus.on('state.updated', ({ displayId, state }) => {
      hub.sendToDisplay(displayId, { type: 'state.updated', display_id: displayId, state })
    }),
    bus.on('events.updated', ({ calendarIds }) => {
      hub.sendToAll({ type: 'events.updated', calendar_ids: calendarIds })
    }),
    // Only the display itself shows photos; a remote has nothing to skip.
    bus.on('photo.next', ({ displayId }) => {
      hub.sendToDisplay(displayId, { type: 'photo.next', display_id: displayId }, ['display'])
    }),
  ]

  // Nitro runs close hooks in the order they were registered, so the database
  // plugin has already closed the database by now. Stopping only clears timers,
  // which never touch it.
  nitroApp.hooks.hook('close', () => {
    for (const off of unsubscribe) off()
    control.stop()
    if (getDisplayControl() === control) setDisplayControl(undefined)
  })
})
