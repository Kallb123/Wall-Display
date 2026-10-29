import { createSyncScheduler } from '../sources/scheduler'
import { getSyncScheduler, setSyncScheduler } from '../sources/state'
import { syncCalendarRows } from '../sources/store'
import { canSyncCalendar, syncCalendar } from '../sources/sync'

// Runs after the config and database plugins (the 02 prefix). First, still
// synchronously, it brings the stored calendars in line with the config:
// events are re-resolved if the people or rules changed, and calendars that
// were removed from the config are deleted. Then it starts the scheduler, which
// polls each calendar in the background, so a slow feed never delays boot.
export default defineNitroPlugin((nitroApp) => {
  // A hot reload runs this again in the same process, so stop the old scheduler first.
  getSyncScheduler()?.stop()
  setSyncScheduler(undefined)

  const config = useConfig()

  try {
    const { reresolved, removed } = syncCalendarRows(useDb(), config.calendars, config.people)
    for (const { calendarId, checked, changed } of reresolved) {
      console.info(`[sync] ${calendarId}: people or rules changed, so ${changed} of ${checked} stored events were re-resolved`)
    }
    if (removed.length > 0) console.info(`[sync] removed ${removed.join(', ')}: no longer in the config, so their events were deleted`)
  } catch (error) {
    console.error(`[sync] could not bring the stored calendars in line with the config: ${error instanceof Error ? error.message : String(error)}`)
    throw error
  }

  const scheduler = createSyncScheduler({
    calendars: config.calendars,
    canSync: canSyncCalendar,
    // The database is looked up per sync, so a poll after the close hook has cleared it fails (and is ignored) instead of using a closed handle.
    sync: calendar => syncCalendar({ db: useDb(), calendar, config }),
    onChange: calendarIds => useEventBus().emit('events.updated', { calendarIds }),
    onSuccess: calendarId => useEventBus().emit('sync.succeeded', { calendarId }),
  })
  setSyncScheduler(scheduler)
  scheduler.start()

  // Nitro runs close hooks in the order they were registered, so the database
  // plugin has already closed the database by now. A sync still in flight may
  // fail on it; the stopped scheduler ignores that without logging or retrying.
  nitroApp.hooks.hook('close', () => {
    scheduler.stop()
    if (getSyncScheduler() === scheduler) setSyncScheduler(undefined)
  })
})
