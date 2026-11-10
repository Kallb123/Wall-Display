import type { CalendarEvent } from '../../shared/types/events'

/**
 * The title as drawn: the calendar's emoji icon, if it has one, then the
 * title. `icon` may be missing from events in the display's offline cache
 * from before the field existed.
 */
export function eventLabel(event: Pick<CalendarEvent, 'display_title'> & { icon?: string | null }): string {
  return event.icon ? `${event.icon} ${event.display_title}` : event.display_title
}
