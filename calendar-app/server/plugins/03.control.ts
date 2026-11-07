import { createDisplayControl } from '../control/service'
import { getDisplayControl, setDisplayControl } from '../control/state'
import { createSchedulePolicy } from '../control/schedule'
import { getSchedulePolicy, setSchedulePolicy } from '../control/schedule-state'
import { photoSourcesOf } from '../settings/displaySettings'
import { getSocketHub } from '../ws/hub'

// Runs after the sync plugin (the 03 prefix). It starts the display control,
// which holds each display's state and runs its timers, then the built-in
// schedules policy that changes views at set times, and connects the event bus
// to the WebSocket hub: a state change goes to that display's sockets, changed
// calendar events go to every socket. It also follows the settings page: when
// a display's month return timeout or week start is saved, the control takes it up at once.
export default defineNitroPlugin((nitroApp) => {
  // A hot reload runs this again in the same process, so stop the old control first.
  getSchedulePolicy()?.stop()
  setSchedulePolicy(undefined)
  getDisplayControl()?.stop()
  setDisplayControl(undefined)

  // The effective config: the YAML with the preferences saved on the settings page on top.
  const settings = useSettings()
  const config = settings.config()
  const bus = useEventBus()
  const hub = getSocketHub()

  const control = createDisplayControl({
    db: useDb(),
    displays: config.displays,
    timeZone: config.timezone,
    bus,
    // The photo service starts after this plugin, so it is looked up when the command arrives.
    photosConfigured: () => photoSourcesOf(usePhotos()?.configured() ?? []).length > 0,
    // The weather and alarm services start after this plugin, so they are looked up when the command arrives.
    refresh: () => Promise.all([useSyncScheduler().refreshAll(), useWeather()?.refresh(), useAlarm()?.refresh()]),
  })
  setDisplayControl(control)

  // Built-in schedules (§7.8) work without MQTT: they only need the control.
  const schedulePolicy = createSchedulePolicy({ displays: config.displays, timeZone: config.timezone, control })
  setSchedulePolicy(schedulePolicy)

  const unsubscribe = [
    bus.on('settings.updated', ({ displayIds }) => {
      for (const displayId of displayIds) {
        const display = settings.config().displays.find(candidate => candidate.id === displayId)
        if (!display) continue
        try {
          control.updateDisplay(displayId, { month_return_minutes: display.month_return_minutes, week_start: display.week_start })
        } catch (error) {
          console.error(`[control] ${displayId}: could not apply the saved settings: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }),
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
    schedulePolicy.stop()
    if (getSchedulePolicy() === schedulePolicy) setSchedulePolicy(undefined)
    control.stop()
    if (getDisplayControl() === control) setDisplayControl(undefined)
  })
})
