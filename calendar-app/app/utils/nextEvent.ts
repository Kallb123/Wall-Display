import { addDays, todayIn } from '../../shared/dates'
import { formatTime } from '../../shared/format'
import type { CalendarEvent } from '../../shared/types/events'

// The "next event" chip on the photo frame's pill (architecture §4.2): the one
// event worth a glance from across the room. It is the first timed event that
// is on now or still to come and starts today or tomorrow, in the display's time
// zone. All-day events are left out on purpose: a birthday or a bank holiday
// would sit on the chip from midnight to midnight and hide the appointment that
// matters, and the calendar views show them anyway. Days are `YYYY-MM-DD`
// strings and the arithmetic is on UTC dates, never the process's local time.
// Pure: no Nuxt or Vue imports.

export interface NextEvent {
  event: CalendarEvent
  /** `Today`, `Tomorrow`, or null for one that is already on (it began today or earlier). */
  day: 'Today' | 'Tomorrow' | null
  /** True when it has started and not yet ended. */
  ongoing: boolean
  /** What the chip shows for the time: `09:00` today, `Tomorrow 09:00`, or `Until 11:30` for one that is on now. */
  time: string
}

/** The next event, or null when there is none to show. `events` need not be sorted. */
export function nextEvent(events: readonly CalendarEvent[], now: Date, timeZone: string): NextEvent | null {
  const nowMs = now.getTime()
  const today = todayIn(now, timeZone)
  const tomorrow = addDays(today, 1)

  let best: { event: CalendarEvent, start: number, end: number } | null = null
  for (const event of events) {
    if (event.all_day) continue
    const start = Date.parse(event.start)
    const end = Date.parse(event.end)
    // Over already. An event with no length counts until the moment it starts.
    if (!(Math.max(start, end) > nowMs)) continue
    // Starts after tomorrow.
    if (todayIn(new Date(start), timeZone) > tomorrow) continue

    if (!best || start < best.start || (start === best.start && (end < best.end || (end === best.end && event.id < best.event.id)))) {
      best = { event, start, end }
    }
  }
  if (!best) return null

  const ongoing = best.start <= nowMs
  const startDay = todayIn(new Date(best.start), timeZone)
  const day = ongoing ? null : startDay === today ? 'Today' : 'Tomorrow'
  const time = ongoing
    ? `Until ${formatTime(new Date(best.end), timeZone)}`
    : `${day === 'Tomorrow' ? 'Tomorrow ' : ''}${formatTime(new Date(best.start), timeZone)}`
  return { event: best.event, day, ongoing, time }
}
