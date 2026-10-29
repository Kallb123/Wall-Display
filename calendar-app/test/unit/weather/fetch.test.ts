import { createServer } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WeatherError } from '../../../server/weather/errors'
import { fetchHaWeather } from '../../../server/weather/fetch'

const TOKEN = 'ha-long-lived-token-0123456789abcdef'
const ENTITY = 'weather.home'

const STATE = {
  entity_id: ENTITY,
  state: 'rainy',
  attributes: { temperature: 12.4, temperature_unit: '°C', humidity: 90, friendly_name: 'Home' },
  last_updated: '2026-10-28T11:00:00+00:00',
}
const FORECAST = {
  changed_states: [],
  service_response: {
    [ENTITY]: {
      forecast: [
        { datetime: '2026-10-28T11:00:00+00:00', condition: 'rainy', temperature: 14, templow: 8, precipitation: 2.1 },
        { datetime: '2026-10-29T11:00:00+00:00', condition: 'cloudy', temperature: 11, templow: 6 },
      ],
    },
  },
}

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => {
    server.closeAllConnections()
    server.close(resolve)
  })))
})

interface Seen {
  method: string | undefined
  url: string | undefined
  headers: IncomingHttpHeaders
  body: string
}

type Handler = (request: IncomingMessage, response: ServerResponse, seen: Seen) => void

/** A Home Assistant that records what it was asked. By default it answers both requests as it should. */
async function serve(handler: Handler = answer()) {
  const seen: Seen[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      const entry = { method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString() }
      seen.push(entry)
      handler(request, response, entry)
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { base: `http://127.0.0.1:${port}`, seen }
}

function send(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(typeof body === 'string' ? body : JSON.stringify(body))
}

/** Answers the state and the forecast, with `state` and `forecast` in place of the usual bodies and `status` for either. */
function answer({ state = STATE, forecast = FORECAST as unknown, stateStatus = 200, forecastStatus = 200 } = {}): Handler {
  return (request, response) => {
    if (request.method === 'GET') send(response, state, stateStatus)
    else send(response, forecast, forecastStatus)
  }
}

/** A stub `fetch` that answers every request with the given response. */
function stub(respond: () => Response | never) {
  const calls: string[] = []
  const fetchStub = (async (input: string | URL | Request) => {
    calls.push(String(input))
    return respond()
  }) as typeof fetch
  return { fetch: fetchStub, calls }
}

/** The error a fetch fails with, after checking that it says nothing about where it went or what it sent. */
async function failure(promise: Promise<unknown>, secrets: string[] = []): Promise<WeatherError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(WeatherError)
    const failed = error as WeatherError
    for (const text of [failed.message, failed.name, String(failed), JSON.stringify(failed), failed.stack ?? '']) {
      for (const secret of [TOKEN, '127.0.0.1', 'ha.example.com', '/api/', 'return_response', ...secrets]) {
        expect(text).not.toContain(secret)
      }
    }
    expect(failed.cause).toBeUndefined()
    return failed
  }
  throw new Error('expected a failure')
}

describe('fetchHaWeather requests', () => {
  it('reads the state, then asks for the daily forecast, with the token both times', async () => {
    const { base, seen } = await serve()

    await fetchHaWeather({ url: base, token: TOKEN }, ENTITY)

    expect(seen).toHaveLength(2)
    const [state, forecast] = seen as [Seen, Seen]
    expect(state.method).toBe('GET')
    expect(state.url).toBe('/api/states/weather.home')
    expect(forecast.method).toBe('POST')
    // The key alone, as Home Assistant's own documentation writes it.
    expect(forecast.url).toBe('/api/services/weather/get_forecasts?return_response')
    expect(JSON.parse(forecast.body)).toEqual({ entity_id: ENTITY, type: 'daily' })
    for (const request of seen) {
      expect(request.headers.authorization).toBe(`Bearer ${TOKEN}`)
      expect(request.headers.accept).toBe('application/json')
    }
    expect(forecast.headers['content-type']).toBe('application/json')
  })

  it.each([
    ['no trailing slash', ''],
    ['a trailing slash', '/'],
    ['two trailing slashes', '//'],
    ['a base path', '/ha'],
    ['a base path and a trailing slash', '/home/assistant/'],
  ])('builds the paths from a URL with %s', async (_name, suffix) => {
    const { base, seen } = await serve()

    await fetchHaWeather({ url: `${base}${suffix}`, token: TOKEN }, ENTITY)

    const path = suffix.replace(/\/+$/, '')
    expect(seen.map(request => request.url)).toEqual([
      `${path}/api/states/weather.home`,
      `${path}/api/services/weather/get_forecasts?return_response`,
    ])
  })

  it('encodes the entity id in the path, and drops anything the base URL had after it', async () => {
    const { fetch, calls } = stub(() => new Response('{}'))

    await failure(fetchHaWeather({ url: 'https://ha.example.com/ha/?old=1#frag', token: TOKEN }, 'weather.a b/c', { fetch }))

    expect(calls).toEqual(['https://ha.example.com/ha/api/states/weather.a%20b%2Fc'])
  })

  it('does not ask for the forecast when the state fails', async () => {
    const { base, seen } = await serve(answer({ stateStatus: 404 }))

    await failure(fetchHaWeather({ url: base, token: TOKEN }, ENTITY))

    expect(seen.map(request => request.method)).toEqual(['GET'])
  })
})

describe('fetchHaWeather response', () => {
  it('returns the state, the attributes it uses and the forecast', async () => {
    const { base } = await serve()

    expect(await fetchHaWeather({ url: base, token: TOKEN }, ENTITY)).toEqual({
      state: 'rainy',
      attributes: { temperature: 12.4, temperature_unit: '°C' },
      forecast: [
        { datetime: '2026-10-28T11:00:00+00:00', condition: 'rainy', temperature: 14, templow: 8 },
        { datetime: '2026-10-29T11:00:00+00:00', condition: 'cloudy', temperature: 11, templow: 6 },
      ],
    })
  })

  it('reads what an integration leaves out as null', async () => {
    const { base } = await serve(answer({
      state: { ...STATE, state: 'unavailable', attributes: {} },
      forecast: { service_response: { [ENTITY]: { forecast: [{ datetime: '2026-10-28T11:00:00+00:00' }, { datetime: '2026-10-29', condition: null, temperature: null, templow: null }] } } },
    }))

    expect(await fetchHaWeather({ url: base, token: TOKEN }, ENTITY)).toEqual({
      state: 'unavailable',
      attributes: { temperature: null, temperature_unit: null },
      forecast: [
        { datetime: '2026-10-28T11:00:00+00:00', condition: null, temperature: null, templow: null },
        { datetime: '2026-10-29', condition: null, temperature: null, templow: null },
      ],
    })
  })

  it('reads a value of the wrong type in a field it only shows as null, rather than failing the poll', async () => {
    const { base } = await serve(answer({
      state: { state: 'sunny', attributes: { temperature: 'warm', temperature_unit: 7 } },
      forecast: { service_response: { [ENTITY]: { forecast: [{ datetime: '2026-10-28', condition: 3, temperature: '14', templow: null }] } } },
    }))

    expect(await fetchHaWeather({ url: base, token: TOKEN }, ENTITY)).toEqual({
      state: 'sunny',
      attributes: { temperature: null, temperature_unit: null },
      forecast: [{ datetime: '2026-10-28', condition: null, temperature: null, templow: null }],
    })
  })

  it('reads a state with no attributes, and an entity with no forecast list, as empty', async () => {
    const { base } = await serve(answer({ state: { state: 'sunny' }, forecast: { service_response: { [ENTITY]: {} } } }))

    expect(await fetchHaWeather({ url: base, token: TOKEN }, ENTITY)).toEqual({
      state: 'sunny',
      attributes: { temperature: null, temperature_unit: null },
      forecast: [],
    })
  })

  it('keeps only the forecast of the entity it asked about', async () => {
    const { base } = await serve(answer({
      forecast: { service_response: { 'weather.other': { forecast: [{ datetime: '2026-10-30' }] }, [ENTITY]: { forecast: [{ datetime: '2026-10-28' }] } } },
    }))

    expect((await fetchHaWeather({ url: base, token: TOKEN }, ENTITY)).forecast).toHaveLength(1)
  })

  it('reads UTF-8', async () => {
    const { base } = await serve(answer({ state: { ...STATE, attributes: { temperature: 53, temperature_unit: '°F' } } }))

    expect((await fetchHaWeather({ url: base, token: TOKEN }, ENTITY)).attributes.temperature_unit).toBe('°F')
  })
})

describe('fetchHaWeather failures, none of which may say where it went or what it sent', () => {
  it.each([
    ['state', { stateStatus: 401 }, 'Home Assistant refused the access token (HTTP 401)'],
    ['state', { stateStatus: 403 }, 'Home Assistant refused the access token (HTTP 403)'],
    ['forecast', { forecastStatus: 401 }, 'Home Assistant refused the access token (HTTP 401)'],
    ['state', { stateStatus: 404 }, `Home Assistant has no entity "${ENTITY}" (HTTP 404)`],
    ['forecast', { forecastStatus: 400 }, `Home Assistant could not give a daily forecast for "${ENTITY}" (HTTP 400)`],
    ['forecast', { forecastStatus: 404 }, 'Home Assistant has no weather forecast service (HTTP 404; it needs version 2023.12 or later)'],
    ['state', { stateStatus: 500 }, 'HTTP 500 Internal Server Error'],
    ['forecast', { forecastStatus: 502 }, 'HTTP 502 Bad Gateway'],
    // A 400 on the state is not the forecast's problem, and a 404 is not an unknown entity on the forecast.
    ['state', { stateStatus: 400 }, 'HTTP 400 Bad Request'],
  ])('fails when the %s request gets %j', async (_request, statuses, message) => {
    const { base } = await serve((request, response) => {
      const status = request.method === 'GET' ? (statuses as { stateStatus?: number }).stateStatus ?? 200 : (statuses as { forecastStatus?: number }).forecastStatus ?? 200
      if (status === 200) send(response, request.method === 'GET' ? STATE : FORECAST)
      else {
        response.writeHead(status)
        response.end(`{"message":"${TOKEN}"}`)
      }
    })

    const error = await failure(fetchHaWeather({ url: base, token: TOKEN }, ENTITY))

    expect(error.kind).toBe('fetch')
    expect(error.message).toBe(message)
  })

  it('fails on a status with no text', async () => {
    const { fetch } = stub(() => new Response('', { status: 500 }))

    expect((await failure(fetchHaWeather({ url: 'https://ha.example.com', token: TOKEN }, ENTITY, { fetch }))).message).toBe('HTTP 500')
  })

  it('reports a refused connection by its code', async () => {
    // A port that was just in use and now is not.
    const server = createServer()
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    await new Promise(resolve => server.close(resolve))

    const error = await failure(fetchHaWeather({ url: `http://127.0.0.1:${port}`, token: TOKEN }, ENTITY), [String(port)])

    expect(error.kind).toBe('fetch')
    expect(error.message).toBe('could not connect (ECONNREFUSED)')
  })

  it('times out', async () => {
    const { base } = await serve(() => { /* never answers */ })

    const error = await failure(fetchHaWeather({ url: base, token: TOKEN }, ENTITY, { timeoutMs: 50 }))

    expect(error.kind).toBe('fetch')
    expect(error.message).toBe('timed out after 0.05 s')
  })

  it('times out on the forecast too', async () => {
    const { base } = await serve((request, response) => {
      if (request.method === 'GET') send(response, STATE)
    })

    const error = await failure(fetchHaWeather({ url: base, token: TOKEN }, ENTITY, { timeoutMs: 50 }))

    expect(error.message).toBe('timed out after 0.05 s')
  })

  it.each([
    ['a name that is not found', () => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND ha.example.com'), { code: 'ENOTFOUND' }) }) }, 'could not connect (ENOTFOUND)'],
    ['an error that quotes the URL and has no code', () => { throw new TypeError(`Failed to parse URL from https://ha.example.com/api/states/${ENTITY}?token=${TOKEN}`) }, 'could not connect'],
    ['a timeout that quotes the URL', () => { throw Object.assign(new Error(`The operation timed out: https://ha.example.com/${TOKEN}`), { name: 'TimeoutError' }) }, 'timed out after 30 s'],
  ])('says nothing of the original error for %s', async (_name, respond, message) => {
    const { fetch } = stub(respond)

    const error = await failure(fetchHaWeather({ url: 'https://ha.example.com', token: TOKEN }, ENTITY, { fetch }))

    expect(error.message).toBe(message)
  })

  it('refuses a response larger than the limit when the server says so up front', async () => {
    const { base } = await serve((_request, response) => {
      response.writeHead(200, { 'Content-Length': '5000' })
      response.end('x'.repeat(5000))
    })

    const error = await failure(fetchHaWeather({ url: base, token: TOKEN }, ENTITY, { maxBytes: 1000 }))

    expect(error.kind).toBe('fetch')
    expect(error.message).toBe('the weather response is larger than 1 KB')
  })

  it('says the limit in megabytes when it is that big', async () => {
    const { base } = await serve((_request, response) => {
      response.writeHead(200, { 'Content-Length': String(3 * 1024 * 1024) })
      response.end('x')
    })

    const error = await failure(fetchHaWeather({ url: base, token: TOKEN }, ENTITY, { maxBytes: 2 * 1024 * 1024 }))

    expect(error.message).toBe('the weather response is larger than 2 MB')
  })

  it('stops reading a body that grows past the limit without saying so', async () => {
    let sent = 0
    const { base } = await serve((_request, response) => {
      response.writeHead(200) // chunked: no Content-Length
      const timer = setInterval(() => {
        sent += 1000
        if (!response.write('x'.repeat(1000))) return
        if (sent > 200_000) clearInterval(timer)
      }, 1)
      response.on('close', () => clearInterval(timer))
    })

    const error = await failure(fetchHaWeather({ url: base, token: TOKEN }, ENTITY, { maxBytes: 5000 }))

    expect(error.message).toContain('larger than')
    expect(sent).toBeLessThan(200_000)
  })

  it('fails on a configured URL that cannot be read, without quoting it', async () => {
    const { fetch, calls } = stub(() => new Response('{}'))

    const error = await failure(fetchHaWeather({ url: 'not a url with-secret-words', token: TOKEN }, ENTITY, { fetch }), ['secret-words'])

    expect(error.kind).toBe('fetch')
    expect(error.message).toBe('the Home Assistant URL is not valid')
    expect(calls).toEqual([])
  })
})

describe('fetchHaWeather when the body is not what Home Assistant sends', () => {
  it.each([
    ['an HTML page', '<!doctype html><html><body>Sign in</body></html>'],
    ['an empty body', ''],
    ['cut-off JSON', '{"state":"rainy"'],
  ])('fails on %s for the state', async (_name, body) => {
    const { base } = await serve((_request, response) => { send(response, body) })

    const error = await failure(fetchHaWeather({ url: base, token: TOKEN }, ENTITY))

    expect(error.kind).toBe('parse')
    expect(error.message).toBe('the response is not JSON')
  })

  it('fails on an HTML page for the forecast', async () => {
    const { base } = await serve((request, response) => { send(response, request.method === 'GET' ? STATE : '<html></html>') })

    const error = await failure(fetchHaWeather({ url: base, token: TOKEN }, ENTITY))

    expect(error.kind).toBe('parse')
    expect(error.message).toBe('the response is not JSON')
  })

  it.each([
    ['a list', []],
    ['null', null],
    ['a message', { message: 'Entity not found.' }],
    ['a state that is not text', { state: 3, attributes: {} }],
  ])('fails on %s for the state', async (_name, state) => {
    const { base } = await serve(answer({ state: state as typeof STATE }))

    const error = await failure(fetchHaWeather({ url: base, token: TOKEN }, ENTITY))

    expect(error.kind).toBe('parse')
    expect(error.message).toBe('the response is not a weather entity')
  })

  it.each([
    ['a list', []],
    ['an empty object', {}],
    ['a response with no entities', { changed_states: [] }],
    ['an entity that is not an object', { service_response: { [ENTITY]: 'rainy' } }],
    ['a forecast that is not a list', { service_response: { [ENTITY]: { forecast: 'rainy' } } }],
    ['an entry with no datetime', { service_response: { [ENTITY]: { forecast: [{ condition: 'rainy' }] } } }],
    ['an entry that is not an object', { service_response: { [ENTITY]: { forecast: ['rainy'] } } }],
  ])('fails on %s for the forecast', async (_name, forecast) => {
    const { base } = await serve(answer({ forecast }))

    const error = await failure(fetchHaWeather({ url: base, token: TOKEN }, ENTITY))

    expect(error.kind).toBe('parse')
    expect(error.message).toBe('the response is not a weather forecast')
  })

  it('fails when the response is for other entities only', async () => {
    const { base } = await serve(answer({ forecast: { service_response: { 'weather.other': { forecast: [] } } } }))

    const error = await failure(fetchHaWeather({ url: base, token: TOKEN }, ENTITY))

    expect(error.kind).toBe('parse')
    expect(error.message).toBe('the response has no forecast for the entity')
  })
})
