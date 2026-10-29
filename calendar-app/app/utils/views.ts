import type { MonthKey, View } from '../../shared/display'
import type { CalendarEvent } from '../../shared/types/events'

// What every view component is given by pages/display.vue. They all declare
// `defineProps<ViewProps>()`, even when they ignore some of it, so a prop a
// view doesn't use is still a prop and never falls through to its root element
// as an HTML attribute. Pure: no Nuxt or Vue imports.

export interface ViewProps {
  /** The view being shown. */
  view: View
  /** The events fetched for the shown month and the next few days, sorted by start. */
  events: CalendarEvent[]
  /** The current moment, ticking. Views work out "today" from it in `timezone`. */
  now: Date
  /** The display's IANA time zone. */
  timezone: string
  /** The month the month view shows: the one the server pinned in `state.month`, or else the current month. Not necessarily the month `now` is in. */
  month: MonthKey
  /** The day a week starts on, for the month grid. */
  weekStart: 'monday' | 'sunday'
}
