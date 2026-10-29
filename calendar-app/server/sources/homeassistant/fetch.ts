import { z } from 'zod'
import type { HomeAssistantConfig } from '../../config/schema'
import { discard, networkErrorMessage, readBody, tooLargeMessage } from '../http'
import type { SyncWindow } from '../types'
import { HomeAssistantSourceError } from './errors'
import type { HaCalendarEvent } from './types'

// Fetches one calendar's events from Home Assistant's REST API and checks their
// shape. Error messages never include the URL or the token (see
// HomeAssistantSourceError), and the errors that carry them are never kept as a
// cause.

export interface FetchHaOptions {
  /** For tests. Default: the global `fetch`. */
  fetch?: typeof fetch
  /** Default 30 000. */
  timeoutMs?: number
  /** The largest response accepted, in bytes. Default 20 MiB. */
  maxBytes?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024

// What Home Assistant leaves out is null. Keys we don't use (such as `rrule`)
// are dropped. The date and time strings are passed on as they are: the mapper
// reads them and skips the events it can't.
const optionalText = z.string().nullable().default(null)
const eventTime = z.union([z.object({ date: z.string() }), z.object({ dateTime: z.string() })])
const calendarEvents = z.array(z.object({
  summary: optionalText,
  description: optionalText,
  location: optionalText,
  start: eventTime,
  end: eventTime,
  uid: optionalText,
  recurrence_id: optionalText,
}))

/** Asks Home Assistant for the events of one calendar entity that overlap the window. */
export async function fetchHaCalendar(homeassistant: Pick<HomeAssistantConfig, 'url' | 'token'>, entityId: string, window: SyncWindow, options: FetchHaOptions = {}): Promise<HaCalendarEvent[]> {
  const fetchFn = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const url = calendarUrl(homeassistant.url, entityId, window)
  const headers = { 'Authorization': `Bearer ${homeassistant.token}`, 'Accept': 'application/json' }

  const signal = AbortSignal.timeout(timeoutMs)
  let response: Response
  try {
    response = await fetchFn(url, { headers, signal })
  } catch (error) {
    throw new HomeAssistantSourceError('fetch', networkErrorMessage(error, timeoutMs))
  }

  if (!response.ok) {
    await discard(response)
    if (response.status === 401 || response.status === 403) {
      throw new HomeAssistantSourceError('fetch', `Home Assistant refused the access token (HTTP ${response.status})`)
    }
    if (response.status === 404) {
      throw new HomeAssistantSourceError('fetch', `Home Assistant has no calendar "${entityId}" (HTTP 404)`)
    }
    throw new HomeAssistantSourceError('fetch', `HTTP ${response.status} ${response.statusText}`.trim())
  }

  const tooLarge = () => new HomeAssistantSourceError('fetch', tooLargeMessage(maxBytes))
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard(response)
    throw tooLarge()
  }

  let body: string
  try {
    body = await readBody(response, maxBytes, tooLarge)
  } catch (error) {
    if (error instanceof HomeAssistantSourceError) throw error
    throw new HomeAssistantSourceError('fetch', networkErrorMessage(error, timeoutMs))
  }
  return parseEvents(body)
}

/** `<url>/api/calendars/<entity>?start&end`, whether or not the base has a trailing slash or a path of its own. */
function calendarUrl(base: string, entityId: string, window: SyncWindow): string {
  let url: URL
  try {
    url = new URL(base)
  } catch {
    // Not `cause`, and not the parser's message: both quote the address.
    throw new HomeAssistantSourceError('fetch', 'the Home Assistant URL is not valid')
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/api/calendars/${encodeURIComponent(entityId)}`
  url.search = new URLSearchParams({ start: window.start.toISOString(), end: window.end.toISOString() }).toString()
  url.hash = ''
  return url.href
}

function parseEvents(body: string): HaCalendarEvent[] {
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    throw new HomeAssistantSourceError('parse', 'the response is not JSON')
  }
  const parsed = calendarEvents.safeParse(json)
  if (!parsed.success) throw new HomeAssistantSourceError('parse', 'the response is not a list of calendar events')
  return parsed.data
}
