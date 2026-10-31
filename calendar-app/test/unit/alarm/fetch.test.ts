import { createServer } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { AlarmError } from '../../../server/alarm/errors'
import { fetchHaAlarm } from '../../../server/alarm/fetch'

const TOKEN = 'ha-long-lived-token-0123456789abcdef'
const ENTITY = 'sensor.phone_next_alarm'

/** What the companion app's next alarm sensor looks like. */
const SENSOR = {
  entity_id: ENTITY,
  state: '2026-10-31T06:45:00+00:00',
  attributes: { device_class: 'timestamp', friendly_name: 'Phone next alarm', package: 'com.google.android.deskclock' },
  last_updated: '2026-10-30T22:00:00+00:00',
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
}

type Handler = (request: IncomingMessage, response: ServerResponse) => void

/** A Home Assistant that records what it was asked. By default it answers with the sensor. */
async function serve(handler: Handler = (_request, response) => send(response, SENSOR)) {
  const seen: Seen[] = []
  const server = createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, headers: request.headers })
    handler(request, response)
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

/** A Home Assistant that answers with an entity in the given state. */
async function serveState(state: string, attributes: Record<string, unknown> = {}) {
  return serve((_request, response) => send(response, { ...SENSOR, state, attributes }))
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
async function failure(promise: Promise<unknown>, secrets: string[] = []): Promise<AlarmError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(AlarmError)
    const failed = error as AlarmError
    for (const text of [failed.message, failed.name, String(failed), JSON.stringify(failed), failed.stack ?? '']) {
      for (const secret of [TOKEN, '127.0.0.1', 'ha.example.com', '/api/', ...secrets]) {
        expect(text).not.toContain(secret)
      }
    }
    expect(failed.cause).toBeUndefined()
    return failed
  }
  throw new Error('expected a failure')
}

describe('fetchHaAlarm request', () => {
  it('reads the entity\'s state with a GET and the token', async () => {
    const { base, seen } = await serve()

    await fetchHaAlarm({ url: base, token: TOKEN }, ENTITY)

    expect(seen).toHaveLength(1)
    expect(seen[0]!.method).toBe('GET')
    expect(seen[0]!.url).toBe('/api/states/sensor.phone_next_alarm')
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(seen[0]!.headers.accept).toBe('application/json')
  })

  it.each([
    ['no trailing slash', ''],
    ['a trailing slash', '/'],
    ['two trailing slashes', '//'],
    ['a base path', '/ha'],
    ['a base path and a trailing slash', '/home/assistant/'],
  ])('builds the path from a URL with %s', async (_name, suffix) => {
    const { base, seen } = await serve()

    await fetchHaAlarm({ url: `${base}${suffix}`, token: TOKEN }, ENTITY)

    expect(seen.map(request => request.url)).toEqual([`${suffix.replace(/\/+$/, '')}/api/states/sensor.phone_next_alarm`])
  })

  it('encodes the entity id in the path, and drops anything the base URL had after it', async () => {
    const { fetch, calls } = stub(() => new Response('{}'))

    await failure(fetchHaAlarm({ url: 'https://ha.example.com/ha/?old=1#frag', token: TOKEN }, 'sensor.a b/c', { fetch }))

    expect(calls).toEqual(['https://ha.example.com/ha/api/states/sensor.a%20b%2Fc'])
  })

  it('fails on a URL that is not one, without quoting it', async () => {
    const error = await failure(fetchHaAlarm({ url: 'not a url', token: TOKEN }, ENTITY), ['not a url'])

    expect(error.message).toBe('the Home Assistant URL is not valid')
  })
})

describe('fetchHaAlarm mapping', () => {
  it.each([
    ['a timestamp with a zero offset', '2026-10-31T06:45:00+00:00', {}, '2026-10-31T06:45:00.000Z'],
    ['a timestamp in Z', '2026-10-31T06:45:00Z', {}, '2026-10-31T06:45:00.000Z'],
    ['a timestamp with another offset', '2026-10-31T06:45:00+01:00', {}, '2026-10-31T05:45:00.000Z'],
    ['a timestamp with fractions of a second', '2026-10-31T06:45:00.123456+00:00', {}, '2026-10-31T06:45:00.123Z'],
    ['a timestamp without seconds', '2026-10-31T06:45+00:00', {}, '2026-10-31T06:45:00.000Z'],
    ['a timestamp with a space for the T', '2026-10-31 06:45:00+00:00', {}, '2026-10-31T06:45:00.000Z'],
    ['a timestamp with spaces around it', ' 2026-10-31T06:45:00+00:00 ', {}, '2026-10-31T06:45:00.000Z'],
    ['an input_datetime with a date', '2026-11-01 07:30:00', { has_date: true, has_time: true, timestamp: Date.UTC(2026, 10, 1, 7, 30) / 1000 }, '2026-11-01T07:30:00.000Z'],
    ['an input_datetime with a date, preferring its timestamp', '2026-11-01 07:30:00', { has_date: true, timestamp: 1_793_000_000 }, new Date(1_793_000_000_000).toISOString()],
  ])('reads %s as an instant', async (_name, state, attributes, expected) => {
    const { base } = await serveState(state, attributes)

    expect(await fetchHaAlarm({ url: base, token: TOKEN }, ENTITY)).toBe(expected)
  })

  it.each([
    ['unknown', 'unknown', {}],
    ['unavailable', 'unavailable', {}],
    ['an empty state', '', {}],
    ['text', 'not a time', {}],
    ['a time of day with no date', '06:45:00', {}],
    ['a date with no time', '2026-10-31', {}],
    ['a time with no offset', '2026-10-31T06:45:00', {}],
    ['a time that does not exist', '2026-13-45T25:61:00+00:00', {}],
    ['a time-only input_datetime', '06:45:00', { has_date: false, has_time: true, timestamp: 24_300 }],
    ['a date-less input_datetime that still has a timestamp', '07:30:00', { has_date: false, timestamp: 1_793_000_000 }],
    ['an input_datetime with a timestamp that cannot be a date', '2026-11-01 07:30:00', { has_date: true, timestamp: 1e300 }],
  ])('reads %s as no alarm, not as a failure', async (_name, state, attributes) => {
    const { base } = await serveState(state, attributes)

    expect(await fetchHaAlarm({ url: base, token: TOKEN }, ENTITY)).toBeNull()
  })

  it('reads attributes of the wrong type as missing, and falls back to the state', async () => {
    const { base } = await serveState('2026-10-31T06:45:00+00:00', { has_date: 'yes', timestamp: 'soon' })

    expect(await fetchHaAlarm({ url: base, token: TOKEN }, ENTITY)).toBe('2026-10-31T06:45:00.000Z')
  })

  it('reads attributes that are not an object as missing', async () => {
    const { base } = await serve((_request, response) => send(response, { state: '2026-10-31T06:45:00+00:00', attributes: 'none' }))

    expect(await fetchHaAlarm({ url: base, token: TOKEN }, ENTITY)).toBe('2026-10-31T06:45:00.000Z')
  })

  it('reads a state with no attributes', async () => {
    const { base } = await serve((_request, response) => send(response, { state: '2026-10-31T06:45:00+00:00' }))

    expect(await fetchHaAlarm({ url: base, token: TOKEN }, ENTITY)).toBe('2026-10-31T06:45:00.000Z')
  })
})

describe('fetchHaAlarm failures, none of which may say where it went or what it sent', () => {
  it.each([
    [401, 'Home Assistant refused the access token (HTTP 401)'],
    [403, 'Home Assistant refused the access token (HTTP 403)'],
    [404, `Home Assistant has no entity "${ENTITY}" (HTTP 404)`],
    [400, 'HTTP 400 Bad Request'],
    [500, 'HTTP 500 Internal Server Error'],
    [502, 'HTTP 502 Bad Gateway'],
  ])('fails when the request gets HTTP %j', async (status, message) => {
    const { base } = await serve((_request, response) => {
      response.writeHead(status)
      response.end(`{"message":"${TOKEN}"}`)
    })

    const error = await failure(fetchHaAlarm({ url: base, token: TOKEN }, ENTITY))

    expect(error.kind).toBe('fetch')
    expect(error.message).toBe(message)
  })

  it('fails on a status with no text', async () => {
    const { fetch } = stub(() => new Response('', { status: 500 }))

    expect((await failure(fetchHaAlarm({ url: 'https://ha.example.com', token: TOKEN }, ENTITY, { fetch }))).message).toBe('HTTP 500')
  })

  it('reports a refused connection by its code', async () => {
    // A port that was just in use and now is not.
    const server = createServer()
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    await new Promise(resolve => server.close(resolve))

    const error = await failure(fetchHaAlarm({ url: `http://127.0.0.1:${port}`, token: TOKEN }, ENTITY), [String(port)])

    expect(error.kind).toBe('fetch')
    expect(error.message).toBe('could not connect (ECONNREFUSED)')
  })

  it('times out', async () => {
    const { base } = await serve(() => { /* never answers */ })

    const error = await failure(fetchHaAlarm({ url: base, token: TOKEN }, ENTITY, { timeoutMs: 50 }))

    expect(error.kind).toBe('fetch')
    expect(error.message).toBe('timed out after 0.05 s')
  })

  it.each([
    ['a name that is not found', () => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND ha.example.com'), { code: 'ENOTFOUND' }) }) }, 'could not connect (ENOTFOUND)'],
    ['an error that quotes the URL and has no code', () => { throw new TypeError(`Failed to parse URL from https://ha.example.com/api/states/${ENTITY}?token=${TOKEN}`) }, 'could not connect'],
    ['a timeout that quotes the URL', () => { throw Object.assign(new Error(`The operation timed out: https://ha.example.com/${TOKEN}`), { name: 'TimeoutError' }) }, 'timed out after 30 s'],
  ])('says nothing of the original error for %s', async (_name, respond, message) => {
    const { fetch } = stub(respond)

    const error = await failure(fetchHaAlarm({ url: 'https://ha.example.com', token: TOKEN }, ENTITY, { fetch }))

    expect(error.message).toBe(message)
  })

  it('refuses a response larger than the limit when the server says so up front', async () => {
    const { base } = await serve((_request, response) => {
      response.writeHead(200, { 'Content-Length': '5000' })
      response.end('x'.repeat(5000))
    })

    const error = await failure(fetchHaAlarm({ url: base, token: TOKEN }, ENTITY, { maxBytes: 1000 }))

    expect(error.kind).toBe('fetch')
    expect(error.message).toBe('the alarm response is larger than 1 KB')
  })

  it('refuses a response that turns out larger than the limit while it is read', async () => {
    const { base } = await serve((_request, response) => {
      response.writeHead(200, { 'Transfer-Encoding': 'chunked' })
      response.end('x'.repeat(5000))
    })

    const error = await failure(fetchHaAlarm({ url: base, token: TOKEN }, ENTITY, { maxBytes: 1000 }))

    expect(error.message).toBe('the alarm response is larger than 1 KB')
  })

  it('fails on a body that is not JSON', async () => {
    const { base } = await serve((_request, response) => send(response, `<html>${TOKEN}</html>`))

    const error = await failure(fetchHaAlarm({ url: base, token: TOKEN }, ENTITY))

    expect(error.kind).toBe('parse')
    expect(error.message).toBe('the response is not JSON')
  })

  it.each([
    ['an array', []],
    ['no state', { attributes: {} }],
    ['a state that is not text', { state: 5 }],
    ['null', null],
  ])('fails on %s instead of an entity state', async (_name, body) => {
    const { base } = await serve((_request, response) => send(response, body))

    const error = await failure(fetchHaAlarm({ url: base, token: TOKEN }, ENTITY))

    expect(error.kind).toBe('parse')
    expect(error.message).toBe('the response is not an entity state')
  })
})
