import { z } from 'zod'
import type { HomeAssistantConfig } from '../config/schema'
import { discard, networkErrorMessage, readBody } from '../sources/http'
import { WeatherError } from './errors'
import type { HaWeather } from './types'

// Fetches one weather entity's state and daily forecast from Home Assistant's
// REST API and checks their shape. Home Assistant no longer puts the forecast
// in the entity's attributes: it is a service call that returns a response.
// Error messages never include the URL or the token (see WeatherError), and
// the errors that carry them are never kept as a cause.

export interface FetchHaWeatherOptions {
  /** For tests. Default: the global `fetch`. */
  fetch?: typeof fetch
  /** For each of the two requests. Default 30 000. */
  timeoutMs?: number
  /** The largest response accepted, in bytes. Default 1 MiB. */
  maxBytes?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_BYTES = 1024 * 1024

// What an integration leaves out is null, and so is anything of the wrong type
// in a field we only show: a forecast with a missing low is still a forecast.
// Keys we don't use are dropped.
const optionalNumber = z.number().finite().nullable().catch(null)
const optionalText = z.string().nullable().catch(null)

const entityState = z.object({
  state: z.string(),
  attributes: z.object({
    temperature: optionalNumber,
    temperature_unit: optionalText,
  }).catch({ temperature: null, temperature_unit: null }),
})

const forecastEntry = z.object({
  datetime: z.string(),
  condition: optionalText,
  temperature: optionalNumber,
  templow: optionalNumber,
})
const forecastResponse = z.object({
  service_response: z.record(z.string(), z.object({ forecast: z.array(forecastEntry).default([]) })),
})

/** Asks Home Assistant for a weather entity's current conditions and its daily forecast. */
export async function fetchHaWeather(homeassistant: Pick<HomeAssistantConfig, 'url' | 'token'>, entityId: string, options: FetchHaWeatherOptions = {}): Promise<HaWeather> {
  const send = (request: Call) => exchange(homeassistant, request, options)

  const stateBody = await send({
    path: `/api/states/${encodeURIComponent(entityId)}`,
    notFound: `Home Assistant has no entity "${entityId}" (HTTP 404)`,
  })
  const state = parse(stateBody, entityState, 'the response is not a weather entity')

  const forecastBody = await send({
    path: '/api/services/weather/get_forecasts',
    // Home Assistant tests for the key, not a value, so no `=` is sent.
    search: '?return_response',
    body: { entity_id: entityId, type: 'daily' },
    badRequest: `Home Assistant could not give a daily forecast for "${entityId}" (HTTP 400)`,
    notFound: 'Home Assistant has no weather forecast service (HTTP 404; it needs version 2023.12 or later)',
  })
  const answer = parse(forecastBody, forecastResponse, 'the response is not a weather forecast')
  const forecast = answer.service_response[entityId]
  if (!forecast) throw new WeatherError('parse', 'the response has no forecast for the entity')

  return { state: state.state, attributes: state.attributes, forecast: forecast.forecast }
}

interface Call {
  /** After the base URL's own path. */
  path: string
  search?: string
  /** Sent as JSON with a POST. Without it, a GET. */
  body?: unknown
  /** What a 400 and a 404 mean for this request, when something more helpful than the status can be said. */
  badRequest?: string
  notFound?: string
}

/** One request to Home Assistant, and the body of its answer. Throws a WeatherError for anything else. */
async function exchange(homeassistant: Pick<HomeAssistantConfig, 'url' | 'token'>, request: Call, options: FetchHaWeatherOptions): Promise<string> {
  const fetchFn = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const url = endpoint(homeassistant.url, request)
  const headers: Record<string, string> = { 'Authorization': `Bearer ${homeassistant.token}`, 'Accept': 'application/json' }
  const init: RequestInit = { headers, signal: AbortSignal.timeout(timeoutMs) }
  if (request.body !== undefined) {
    init.method = 'POST'
    init.body = JSON.stringify(request.body)
    headers['Content-Type'] = 'application/json'
  }

  let response: Response
  try {
    response = await fetchFn(url, init)
  } catch (error) {
    throw new WeatherError('fetch', networkErrorMessage(error, timeoutMs))
  }

  if (!response.ok) {
    await discard(response)
    if (response.status === 401 || response.status === 403) {
      throw new WeatherError('fetch', `Home Assistant refused the access token (HTTP ${response.status})`)
    }
    if (response.status === 400 && request.badRequest) throw new WeatherError('fetch', request.badRequest)
    if (response.status === 404 && request.notFound) throw new WeatherError('fetch', request.notFound)
    throw new WeatherError('fetch', `HTTP ${response.status} ${response.statusText}`.trim())
  }

  const tooLarge = () => new WeatherError('fetch', `the weather response is larger than ${sizeText(maxBytes)}`)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard(response)
    throw tooLarge()
  }

  try {
    return await readBody(response, maxBytes, tooLarge)
  } catch (error) {
    if (error instanceof WeatherError) throw error
    throw new WeatherError('fetch', networkErrorMessage(error, timeoutMs))
  }
}

function sizeText(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** `<url><path><search>`, whether or not the base has a trailing slash or a path of its own. */
function endpoint(base: string, { path, search = '' }: Call): string {
  let url: URL
  try {
    url = new URL(base)
  } catch {
    // Not `cause`, and not the parser's message: both quote the address.
    throw new WeatherError('fetch', 'the Home Assistant URL is not valid')
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${path}`
  url.search = search
  url.hash = ''
  return url.href
}

function parse<Schema extends z.ZodType>(body: string, schema: Schema, notShaped: string): z.output<Schema> {
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    throw new WeatherError('parse', 'the response is not JSON')
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) throw new WeatherError('parse', notShaped)
  return parsed.data
}
