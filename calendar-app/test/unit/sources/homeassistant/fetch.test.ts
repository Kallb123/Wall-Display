import { createServer } from 'node:http'
import type { IncomingHttpHeaders, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { HomeAssistantSourceError } from '../../../../server/sources/homeassistant/errors'
import { fetchHaCalendar } from '../../../../server/sources/homeassistant/fetch'

const TOKEN = 'ha-long-lived-token-0123456789abcdef'
const ENTITY = 'calendar.bin_collection'
const WINDOW = { start: new Date('2025-10-01T11:00:00Z'), end: new Date('2027-11-01T11:00:00Z') }

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => {
    server.closeAllConnections()
    server.close(resolve)
  })))
})

interface Seen {
  url: string | undefined
  headers: IncomingHttpHeaders
}

/** A Home Assistant that answers every request the same way. `base` is its address, `seen` what it was asked. */
async function serve(handler: Parameters<typeof createServer>[1]) {
  const seen: Seen[] = []
  const server = createServer((request, response) => {
    seen.push({ url: request.url, headers: request.headers })
    handler(request, response)
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { base: `http://127.0.0.1:${port}`, port, seen }
}

function json(body: unknown, status = 200): Parameters<typeof createServer>[1] {
  return (_request, response) => {
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  }
}

/** A stub `fetch` that answers with the given response and records the URL it was asked for. */
function stub(respond: () => Response | never) {
  const calls: string[] = []
  const fetchStub = (async (input: string | URL | Request) => {
    calls.push(String(input))
    return respond()
  }) as typeof fetch
  return { fetch: fetchStub, calls }
}

/** The error a fetch fails with, after checking that it says nothing about where it went or what it sent. */
async function failure(promise: Promise<unknown>, secrets: string[] = []): Promise<HomeAssistantSourceError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(HomeAssistantSourceError)
    const failed = error as HomeAssistantSourceError
    for (const text of [failed.message, failed.name, String(failed), JSON.stringify(failed), failed.stack ?? '']) {
      for (const secret of [TOKEN, '127.0.0.1', 'ha.example.com', '/api/calendars', 'start=', ...secrets]) {
        expect(text).not.toContain(secret)
      }
    }
    expect(failed.cause).toBeUndefined()
    return failed
  }
  throw new Error('expected a failure')
}

describe('fetchHaCalendar request', () => {
  it('asks for the calendar over the window, with the token', async () => {
    const { base, seen } = await serve(json([]))

    expect(await fetchHaCalendar({ url: base, token: TOKEN }, ENTITY, WINDOW)).toEqual([])

    expect(seen).toHaveLength(1)
    const url = new URL(seen[0]!.url!, base)
    expect(url.pathname).toBe('/api/calendars/calendar.bin_collection')
    expect([...url.searchParams]).toEqual([['start', '2025-10-01T11:00:00.000Z'], ['end', '2027-11-01T11:00:00.000Z']])
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(seen[0]!.headers.accept).toBe('application/json')
  })

  it.each([
    ['no trailing slash', ''],
    ['a trailing slash', '/'],
    ['two trailing slashes', '//'],
    ['a base path', '/ha'],
    ['a base path and a trailing slash', '/ha/'],
    ['a deeper base path', '/home/assistant/'],
  ])('builds the path from a URL with %s', async (_name, suffix) => {
    const { base, seen } = await serve(json([]))

    await fetchHaCalendar({ url: `${base}${suffix}`, token: TOKEN }, ENTITY, WINDOW)

    const path = suffix.replace(/\/+$/, '')
    expect(new URL(seen[0]!.url!, base).pathname).toBe(`${path}/api/calendars/calendar.bin_collection`)
    expect(new URL(seen[0]!.url!, base).searchParams.get('start')).toBe('2025-10-01T11:00:00.000Z')
  })

  it('encodes the entity id and the query, and drops anything the base URL had after the path', async () => {
    const { fetch, calls } = stub(() => new Response('[]'))

    await fetchHaCalendar({ url: 'https://ha.example.com/ha/?old=1#frag', token: TOKEN }, 'calendar.a b/c', { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-02-01T00:00:00Z') }, { fetch })

    expect(calls).toEqual(['https://ha.example.com/ha/api/calendars/calendar.a%20b%2Fc?start=2026-01-01T00%3A00%3A00.000Z&end=2026-02-01T00%3A00%3A00.000Z'])
  })
})

describe('fetchHaCalendar response', () => {
  it('returns the events as the mapper expects them', async () => {
    const { base } = await serve(json([
      // An all-day event: `date`, the end the day after.
      { summary: 'Black bin', start: { date: '2026-10-29' }, end: { date: '2026-10-30' }, description: null, location: null },
      // Timed, with offsets, and a recurrence rule we do not use.
      {
        summary: 'Swimming',
        description: 'Bring a towel',
        location: 'Leisure centre',
        start: { dateTime: '2026-10-28T16:30:00+01:00' },
        end: { dateTime: '2026-10-28T17:15:00+01:00' },
        uid: 'swim@example.com',
        recurrence_id: '20261028T153000Z',
        rrule: 'FREQ=WEEKLY;BYDAY=WE',
      },
      // Only what is required.
      { start: { dateTime: '2026-11-02T09:00:00+00:00' }, end: { dateTime: '2026-11-02T10:00:00+00:00' } },
      // Explicit nulls everywhere.
      { summary: null, description: null, location: null, uid: null, recurrence_id: null, start: { date: '2026-11-03' }, end: { date: '2026-11-04' } },
    ]))

    expect(await fetchHaCalendar({ url: base, token: TOKEN }, ENTITY, WINDOW)).toEqual([
      { summary: 'Black bin', description: null, location: null, uid: null, recurrence_id: null, start: { date: '2026-10-29' }, end: { date: '2026-10-30' } },
      {
        summary: 'Swimming',
        description: 'Bring a towel',
        location: 'Leisure centre',
        uid: 'swim@example.com',
        recurrence_id: '20261028T153000Z',
        start: { dateTime: '2026-10-28T16:30:00+01:00' },
        end: { dateTime: '2026-10-28T17:15:00+01:00' },
      },
      { summary: null, description: null, location: null, uid: null, recurrence_id: null, start: { dateTime: '2026-11-02T09:00:00+00:00' }, end: { dateTime: '2026-11-02T10:00:00+00:00' } },
      { summary: null, description: null, location: null, uid: null, recurrence_id: null, start: { date: '2026-11-03' }, end: { date: '2026-11-04' } },
    ])
  })

  it('does not pass on keys it does not know', async () => {
    const { base } = await serve(json([{ summary: 'x', rrule: 'FREQ=DAILY', extra: 1, start: { date: '2026-10-29', timeZone: 'x' }, end: { date: '2026-10-30' } }]))

    const [event] = await fetchHaCalendar({ url: base, token: TOKEN }, ENTITY, WINDOW)

    expect(Object.keys(event!).sort()).toEqual(['description', 'end', 'location', 'recurrence_id', 'start', 'summary', 'uid'])
    expect(event!.start).toEqual({ date: '2026-10-29' })
  })

  it('does not check the date and time strings: the mapper does', async () => {
    const { base } = await serve(json([{ start: { date: 'tomorrow' }, end: { dateTime: '' } }]))

    expect(await fetchHaCalendar({ url: base, token: TOKEN }, ENTITY, WINDOW)).toMatchObject([{ start: { date: 'tomorrow' }, end: { dateTime: '' } }])
  })

  it('reads UTF-8', async () => {
    const { base } = await serve(json([{ summary: 'Café ☕', start: { date: '2026-10-29' }, end: { date: '2026-10-30' } }]))

    expect(await fetchHaCalendar({ url: base, token: TOKEN }, ENTITY, WINDOW)).toMatchObject([{ summary: 'Café ☕' }])
  })
})

describe('fetchHaCalendar failures, none of which may say where it went or what it sent', () => {
  it.each([
    [401, 'Unauthorized', 'Home Assistant refused the access token (HTTP 401)'],
    [403, 'Forbidden', 'Home Assistant refused the access token (HTTP 403)'],
    [404, 'Not Found', `Home Assistant has no calendar "${ENTITY}" (HTTP 404)`],
    [500, 'Internal Server Error', 'HTTP 500 Internal Server Error'],
    [502, 'Bad Gateway', 'HTTP 502 Bad Gateway'],
  ])('fails on HTTP %i', async (status, text, message) => {
    const { base } = await serve((_request, response) => {
      response.writeHead(status, text)
      response.end(`{"message":"${TOKEN}"}`)
    })

    const error = await failure(fetchHaCalendar({ url: base, token: TOKEN }, ENTITY, WINDOW))

    expect(error.kind).toBe('fetch')
    expect(error.message).toBe(message)
  })

  it('fails on a status with no text', async () => {
    const { fetch } = stub(() => new Response('', { status: 500 }))

    expect((await failure(fetchHaCalendar({ url: 'https://ha.example.com', token: TOKEN }, ENTITY, WINDOW, { fetch }))).message).toBe('HTTP 500')
  })

  it('reports a refused connection by its code', async () => {
    // A port that was just in use and now is not.
    const server = createServer()
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    await new Promise(resolve => server.close(resolve))

    const error = await failure(fetchHaCalendar({ url: `http://127.0.0.1:${port}`, token: TOKEN }, ENTITY, WINDOW), [String(port)])

    expect(error.kind).toBe('fetch')
    expect(error.message).toBe('could not connect (ECONNREFUSED)')
  })

  it('times out', async () => {
    const { base } = await serve(() => { /* never answers */ })

    const error = await failure(fetchHaCalendar({ url: base, token: TOKEN }, ENTITY, WINDOW, { timeoutMs: 50 }))

    expect(error.kind).toBe('fetch')
    expect(error.message).toBe('timed out after 0.05 s')
  })

  it.each([
    ['a name that is not found', () => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND ha.example.com'), { code: 'ENOTFOUND' }) }) }, 'could not connect (ENOTFOUND)'],
    ['an error that quotes the URL and has no code', () => { throw new TypeError(`Failed to parse URL from https://ha.example.com/api/calendars/${ENTITY}?token=${TOKEN}`) }, 'could not connect'],
    ['a timeout that quotes the URL', () => { throw Object.assign(new Error(`The operation timed out: https://ha.example.com/${TOKEN}`), { name: 'TimeoutError' }) }, 'timed out after 30 s'],
  ])('says nothing of the original error for %s', async (_name, respond, message) => {
    const { fetch } = stub(respond)

    const error = await failure(fetchHaCalendar({ url: 'https://ha.example.com', token: TOKEN }, ENTITY, WINDOW, { fetch }))

    expect(error.message).toBe(message)
  })

  it('refuses a response larger than the limit when the server says so up front', async () => {
    const { base } = await serve((_request, response) => {
      response.writeHead(200, { 'Content-Length': '5000' })
      response.end('x'.repeat(5000))
    })

    const error = await failure(fetchHaCalendar({ url: base, token: TOKEN }, ENTITY, WINDOW, { maxBytes: 1000 }))

    expect(error.kind).toBe('fetch')
    expect(error.message).toBe('the calendar is larger than 0 MB')
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

    const error = await failure(fetchHaCalendar({ url: base, token: TOKEN }, ENTITY, WINDOW, { maxBytes: 5000 }))

    expect(error.message).toContain('larger than')
    expect(sent).toBeLessThan(200_000)
  })

  it('fails on a configured URL that cannot be read, without quoting it', async () => {
    const { fetch, calls } = stub(() => new Response('[]'))

    const error = await failure(fetchHaCalendar({ url: 'not a url with-secret-words', token: TOKEN }, ENTITY, WINDOW, { fetch }), ['secret-words'])

    expect(error.kind).toBe('fetch')
    expect(error.message).toBe('the Home Assistant URL is not valid')
    expect(calls).toEqual([])
  })
})

describe('fetchHaCalendar when the body is not what Home Assistant sends', () => {
  const start = { date: '2026-10-29' }
  const end = { date: '2026-10-30' }

  it.each([
    ['an HTML page', '<!doctype html><html><body>Sign in</body></html>'],
    ['an empty body', ''],
    ['cut-off JSON', '[{"summary":"x"'],
  ])('fails on %s', async (_name, body) => {
    const { base } = await serve((_request, response) => { response.end(body) })

    const error = await failure(fetchHaCalendar({ url: base, token: TOKEN }, ENTITY, WINDOW))

    expect(error.kind).toBe('parse')
    expect(error.message).toBe('the response is not JSON')
  })

  it.each([
    ['an object instead of a list', { message: 'No such calendar' }],
    ['null', null],
    ['a string', 'hello'],
    ['an event that is not an object', ['nope']],
    ['an event with no start', [{ summary: 'x', end }]],
    ['an event with no end', [{ summary: 'x', start }]],
    ['a start with neither date nor dateTime', [{ summary: 'x', start: { time: '2026-10-29' }, end }]],
    ['an empty start', [{ summary: 'x', start: {}, end }]],
    ['a start that is a string', [{ summary: 'x', start: '2026-10-29', end }]],
    ['a date that is not a string', [{ summary: 'x', start: { date: 20261029 }, end }]],
    ['a summary that is not a string', [{ summary: 42, start, end }]],
    ['one good event and one bad', [{ summary: 'x', start, end }, { summary: 'y', end }]],
  ])('fails on %s', async (_name, body) => {
    const { base } = await serve(json(body))

    const error = await failure(fetchHaCalendar({ url: base, token: TOKEN }, ENTITY, WINDOW))

    expect(error.kind).toBe('parse')
    expect(error.message).toBe('the response is not a list of calendar events')
  })
})
