import { z } from 'zod'
import type { NextAlarm } from '../../shared/display'
import type { HomeAssistantConfig } from '../config/schema'
import { discard, networkErrorMessage, readBody } from '../sources/http'
import { AlarmError } from './errors'

// Reads the entity that holds the next alarm from Home Assistant's REST API and
// turns its state into an instant. Two kinds of entity are understood: a
// timestamp sensor (the companion app's `sensor.<phone>_next_alarm`), whose
// state is the time itself, and an `input_datetime` that has a date, whose
// `timestamp` attribute is the time in epoch seconds. Anything that is not a
// time (no alarm set, the phone unreachable) is no alarm, not an error.
// Error messages never include the URL or the token (see AlarmError), and the
// errors that carry them are never kept as a cause.

export interface FetchHaAlarmOptions {
  /** For tests. Default: the global `fetch`. */
  fetch?: typeof fetch
  /** Default 30 000. */
  timeoutMs?: number
  /** The largest response accepted, in bytes. Default 256 KiB: one entity's state is small. */
  maxBytes?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_BYTES = 256 * 1024

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
  const body = await exchange(homeassistant, entityId, options)
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

/** One request to Home Assistant, and the body of its answer. Throws an AlarmError for anything else. */
async function exchange(homeassistant: Pick<HomeAssistantConfig, 'url' | 'token'>, entityId: string, options: FetchHaAlarmOptions): Promise<string> {
  const fetchFn = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const url = endpoint(homeassistant.url, `/api/states/${encodeURIComponent(entityId)}`)
  const init: RequestInit = {
    headers: { 'Authorization': `Bearer ${homeassistant.token}`, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  }

  let response: Response
  try {
    response = await fetchFn(url, init)
  } catch (error) {
    throw new AlarmError('fetch', networkErrorMessage(error, timeoutMs))
  }

  if (!response.ok) {
    await discard(response)
    if (response.status === 401 || response.status === 403) {
      throw new AlarmError('fetch', `Home Assistant refused the access token (HTTP ${response.status})`)
    }
    if (response.status === 404) throw new AlarmError('fetch', `Home Assistant has no entity "${entityId}" (HTTP 404)`)
    throw new AlarmError('fetch', `HTTP ${response.status} ${response.statusText}`.trim())
  }

  const tooLarge = () => new AlarmError('fetch', `the alarm response is larger than ${Math.max(1, Math.round(maxBytes / 1024))} KB`)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard(response)
    throw tooLarge()
  }

  try {
    return await readBody(response, maxBytes, tooLarge)
  } catch (error) {
    if (error instanceof AlarmError) throw error
    throw new AlarmError('fetch', networkErrorMessage(error, timeoutMs))
  }
}

/** `<url><path>`, whether or not the base has a trailing slash or a path of its own. */
function endpoint(base: string, path: string): string {
  let url: URL
  try {
    url = new URL(base)
  } catch {
    // Not `cause`, and not the parser's message: both quote the address.
    throw new AlarmError('fetch', 'the Home Assistant URL is not valid')
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${path}`
  url.search = ''
  url.hash = ''
  return url.href
}
