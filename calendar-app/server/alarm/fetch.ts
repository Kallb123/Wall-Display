import { z } from 'zod'
import type { NextAlarm } from '../../shared/display'
import type { HomeAssistantConfig } from '../config/schema'
import { fetchHaStateBody } from '../sources/haState'
import type { FetchHaStateOptions } from '../sources/haState'
import { AlarmError } from './errors'

// Reads the entity that holds the next alarm from Home Assistant's REST API and
// turns its state into an instant. Two kinds of entity are understood: a
// timestamp sensor (the companion app's `sensor.<phone>_next_alarm`), whose
// state is the time itself, and an `input_datetime` that has a date, whose
// `timestamp` attribute is the time in epoch seconds. Anything that is not a
// time (no alarm set, the phone unreachable) is no alarm, not an error.
// The request itself is in sources/haState.ts. Error messages never include the
// URL or the token (see AlarmError).

export type FetchHaAlarmOptions = FetchHaStateOptions

// Attributes of the wrong type are read as missing: only the ones we use are named.
const entityState = z.object({
  state: z.string(),
  attributes: z.object({
    has_date: z.boolean().nullable().catch(null),
    timestamp: z.number().finite().nullable().catch(null),
  }).catch({ has_date: null, timestamp: null }),
})

/** An ISO 8601 date and time with an offset, such as `2026-10-31T06:45:00+00:00`. Without an offset it would be read in the server's zone, which means nothing here. */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i

/** Asks Home Assistant for the next alarm: an ISO 8601 instant, or null when the entity says there is none. */
export async function fetchHaAlarm(homeassistant: Pick<HomeAssistantConfig, 'url' | 'token'>, entityId: string, options: FetchHaAlarmOptions = {}): Promise<NextAlarm> {
  const body = await fetchHaStateBody(homeassistant, entityId, options, (kind, message) => new AlarmError(kind, message), 'alarm')
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    throw new AlarmError('parse', 'the response is not JSON')
  }
  const parsed = entityState.safeParse(json)
  if (!parsed.success) throw new AlarmError('parse', 'the response is not an entity state')
  return alarmFromState(parsed.data)
}

/** The instant a state stands for, or null for `unknown`, `unavailable`, an empty state and anything that is not a time with a day and an offset. */
function alarmFromState({ state, attributes }: z.output<typeof entityState>): NextAlarm {
  // An `input_datetime` with a date has a timestamp. One that is only a time of day has no day to ring on.
  if (attributes.has_date === true && attributes.timestamp !== null) return toInstant(attributes.timestamp * 1000)
  if (!ISO_WITH_OFFSET.test(state.trim())) return null
  return toInstant(Date.parse(state.trim()))
}

function toInstant(ms: number): NextAlarm {
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
