import type { CalendarStatus } from '../../../shared/settings'
import { calendarStatuses } from '../../settings/status'
import { canSyncCalendar } from '../../sources/sync'

// Each calendar's sync status and the recent events that fell back to its
// default person, for the settings page's Calendars tab. Reading is open, like
// /api/events. Feed addresses and tokens never appear: the shaping copies out
// named fields only.
export default defineEventHandler((): CalendarStatus[] => {
  return calendarStatuses({ db: useDb(), config: useConfig(), now: new Date(), canSync: canSyncCalendar })
})
