import { z } from 'zod'
import type { WallTimer } from '../../shared/display'

// Turns the state of a Home Assistant entity into the timers on it. Pure. Two
// kinds of entity are understood:
//
// - A `timer.*` helper: one timer. `active` is running, with `finishes_at` as
//   its end, `paused` is paused, with `remaining` as the time left, and `idle`
//   is no timer.
// - Any entity whose `timers` attribute is a list, which is how the
//   ha-google-home integration's `sensor.<speaker>_timers` holds a Nest
//   speaker's timers. Each item has a `timer_id`, a `status` (`set`, `paused`,
//   `ringing`, or `none` and `unknown`, which are not timers), a `fire_time`
//   in epoch seconds, a `duration` and, for a paused timer, a `remaining`, both
//   as Python timedelta strings, and a `label`.
//
// What is read is read defensively: a field of the wrong type counts as missing
// and an item that can't be a timer is skipped on its own, so a fork of the
// integration with slightly different fields still shows what it can.

/** What an entity turned out to be. `unavailable` is an entity that is there but has nothing to say (a speaker that is off); `unknown` is one that is neither shape, which is worth telling the user once. */
export type TimerEntityShape = 'helper' | 'speaker' | 'unavailable' | 'unknown'

export interface ParsedTimers {
  timers: WallTimer[]
  shape: TimerEntityShape
}

/** An ISO 8601 date and time with an offset, such as `2026-11-14T12:10:00+00:00`. Without an offset it would be read in the server's zone, which means nothing here. */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i

/** A Python timedelta as Home Assistant writes it: `0:10:00`, `1:02:03` or `1 day, 2:00:00` (`2 days, ...` too), with microseconds in the seconds if there are any. */
const TIMEDELTA = /^(?:(\d+) days?, )?(\d+):([0-5]\d):([0-5]\d)(?:\.\d+)?$/

/** The whole seconds a timedelta string stands for, or null for anything else (a negative one included). */
export function parseTimedelta(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = TIMEDELTA.exec(value.trim())
  if (!match) return null
  const [, days, hours, minutes, seconds] = match
  return Number(days ?? 0) * 86_400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
}

function isoInstant(value: unknown): string | null {
  if (typeof value !== 'string' || !ISO_WITH_OFFSET.test(value.trim())) return null
  return toInstant(Date.parse(value.trim()))
}

function toInstant(ms: number): string | null {
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** A label with nothing in it is no label. */
function labelOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const label = value.trim()
  return label === '' ? null : label
}

/** A length in seconds for a progress bar: positive, or null. */
function durationOf(value: unknown): number | null {
  const seconds = parseTimedelta(value)
  return seconds !== null && seconds > 0 ? seconds : null
}

const entityState = z.object({
  state: z.string().catch(''),
  attributes: z.record(z.string(), z.unknown()).catch({}),
})

const speakerItem = z.object({
  // Written as a string by the integration; a number is read as its digits.
  timer_id: z.union([z.string().min(1), z.number().finite().transform(String)]),
  fire_time: z.number().finite().nullable().catch(null),
  duration: z.string().nullable().catch(null),
  remaining: z.string().nullable().catch(null),
  status: z.string().catch('unknown'),
  label: z.string().nullable().catch(null),
})

/**
 * The timers on an entity, from the state object Home Assistant gives for it
 * (from the REST API or the WebSocket). `entityId` is the one we asked about,
 * which names every timer's `id`.
 */
export function parseTimerEntity(entityId: string, raw: unknown): ParsedTimers {
  const parsed = entityState.safeParse(raw)
  if (!parsed.success) return { timers: [], shape: 'unknown' }
  const { state, attributes } = parsed.data

  if (Array.isArray(attributes.timers)) {
    return { timers: attributes.timers.flatMap(item => speakerTimer(entityId, item)), shape: 'speaker' }
  }
  if (entityId.startsWith('timer.')) return { timers: helperTimer(entityId, state.trim(), attributes), shape: 'helper' }
  const unavailable = state === 'unavailable' || state === 'unknown'
  return { timers: [], shape: unavailable ? 'unavailable' : 'unknown' }
}

function helperTimer(entityId: string, state: string, attributes: Record<string, unknown>): WallTimer[] {
  const base = { id: entityId, label: labelOf(attributes.friendly_name), duration_seconds: durationOf(attributes.duration) }
  if (state === 'active') {
    const endsAt = isoInstant(attributes.finishes_at)
    return endsAt === null ? [] : [{ ...base, status: 'running', ends_at: endsAt, remaining_seconds: null }]
  }
  if (state === 'paused') {
    const remaining = parseTimedelta(attributes.remaining)
    return remaining === null ? [] : [{ ...base, status: 'paused', ends_at: null, remaining_seconds: remaining }]
  }
  return []
}

/** The timer an item of a speaker's list stands for, as a list of none or one. */
function speakerTimer(entityId: string, item: unknown): WallTimer[] {
  const parsed = speakerItem.safeParse(item)
  if (!parsed.success) return []
  const { timer_id, fire_time, duration, remaining, status, label } = parsed.data
  const base = { id: `${entityId}/${timer_id}`, label: labelOf(label), duration_seconds: durationOf(duration) }
  const endsAt = fire_time === null ? null : toInstant(fire_time * 1000)
  if (status === 'set') return endsAt === null ? [] : [{ ...base, status: 'running', ends_at: endsAt, remaining_seconds: null }]
  if (status === 'ringing') return [{ ...base, status: 'ringing', ends_at: endsAt, remaining_seconds: null }]
  if (status === 'paused') {
    const left = parseTimedelta(remaining)
    return left === null ? [] : [{ ...base, status: 'paused', ends_at: null, remaining_seconds: left }]
  }
  return []
}
