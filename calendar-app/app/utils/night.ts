import { todayIn } from '../../shared/dates'
import { formatTime } from '../../shared/format'
import type { NextAlarm } from '../../shared/display'
import type { CalendarEvent } from '../../shared/types/events'

// What the night view says under its clock (architecture §4.1), and where the
// clock sits. The view is almost black and almost nothing, so this is small:
// the first timed event of the next 24 hours, or the next alarm, each with a
// word for the day, and a position that drifts further than the rest of the
// wall does, because a static glyph on black is the worst case for burn-in.
// Days are compared as wall dates in the display's time zone, never the
// process's. Pure: no Nuxt or Vue imports.

const DAY_MS = 24 * 60 * 60_000

/** `Today` or `Tomorrow` for the moment `at`, which is within a day of `now`. */
function dayWord(at: number, now: Date, timeZone: string): 'Today' | 'Tomorrow' {
  return todayIn(new Date(at), timeZone) === todayIn(now, timeZone) ? 'Today' : 'Tomorrow'
}

export interface NightEvent {
  event: CalendarEvent
  day: 'Today' | 'Tomorrow'
  /** The start, such as `08:30`. */
  time: string
}

/**
 * The first timed event that starts after `now` and within the next 24 hours,
 * or null. Like the photo frame's chip (nextEvent), all-day events are left
 * out: a birthday would sit on the clock all night. An event that is already on
 * is not "next" either, and one that starts at exactly `now + 24 h` is out.
 * `events` need not be sorted.
 */
export function nightFirstEvent(events: readonly CalendarEvent[], now: Date, timeZone: string): NightEvent | null {
  const nowMs = now.getTime()
  let best: { event: CalendarEvent, start: number } | null = null
  for (const event of events) {
    if (event.all_day) continue
    const start = Date.parse(event.start)
    if (!(start > nowMs && start < nowMs + DAY_MS)) continue
    if (!best || start < best.start || (start === best.start && event.id < best.event.id)) best = { event, start }
  }
  if (!best) return null
  return { event: best.event, day: dayWord(best.start, now, timeZone), time: formatTime(new Date(best.start), timeZone) }
}

export interface NightAlarm {
  day: 'Today' | 'Tomorrow'
  /** The time it goes off, such as `06:45`. */
  time: string
}

/** The next alarm, if it is still to come and within the next 24 hours: further off than that is not one to wake for yet, and one in the past has gone. */
export function nightAlarm(alarm: NextAlarm | undefined, now: Date, timeZone: string): NightAlarm | null {
  if (!alarm) return null
  const at = Date.parse(alarm)
  if (!(at > now.getTime() && at < now.getTime() + DAY_MS)) return null
  return { day: dayWord(at, now, timeZone), time: formatTime(new Date(at), timeZone) }
}

/**
 * The places the clock block rests at, as offsets from the centre of the stage
 * in pixels, within 240 px either way across and 160 up or down. Fixed, and
 * ordered so that each step is a real jump across the screen rather than a
 * shuffle on the spot.
 */
export const NIGHT_SPOTS: readonly { x: number, y: number }[] = [
  { x: 0, y: 0 },
  { x: -200, y: -120 },
  { x: 220, y: 100 },
  { x: -120, y: 150 },
  { x: 240, y: -140 },
  { x: -240, y: 30 },
  { x: 90, y: -160 },
  { x: 160, y: 160 },
  { x: -220, y: -50 },
  { x: 40, y: 110 },
  { x: -60, y: -140 },
  { x: 200, y: -10 },
]

/** How long the clock rests at each spot. */
const NIGHT_STEP_MS = 5 * 60_000

/** Where the night clock sits at `now`, as an offset from the centre. Changes every five minutes and goes round all the spots in an hour. */
export function nightPosition(now: Date): { x: number, y: number } {
  return NIGHT_SPOTS[Math.floor(now.getTime() / NIGHT_STEP_MS) % NIGHT_SPOTS.length]!
}
