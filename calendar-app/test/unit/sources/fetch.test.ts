import { createServer } from 'node:http'
import type { IncomingHttpHeaders, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { IcsSourceError } from '../../../server/sources/ics/errors'
import { fetchIcs } from '../../../server/sources/ics/fetch'

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'
const NONE = { etag: null, lastModified: null }
const SECRET_URL = 'https://calendar.example.com/ical/family%40example.com/private-0123456789abcdef0123456789abcdef/basic.ics'

const servers: Server[] = []
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => {
    server.closeAllConnections()
    server.close(resolve)
  })))
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/private-token-123/basic.ics`
}

/** A stub `fetch` that answers with the given response and records what it was asked. */
function stub(respond: () => Response | Promise<Response> | never) {
  const calls: { url: string, headers: Record<string, string> }[] = []
  const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()) })
    return await respond()
  }) as typeof fetch
  return { fetch: fetchStub, calls }
}

async function failure(promise: Promise<unknown>): Promise<IcsSourceError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(IcsSourceError)
    return error as IcsSourceError
  }
  throw new Error('expected a failure')
}

describe('fetchIcs over http', () => {
  it('returns the body and the validators', async () => {
    const seen: IncomingHttpHeaders[] = []
    const url = await serve((request, response) => {
      seen.push(request.headers)
      response.writeHead(200, { 'Content-Type': 'text/calendar', ETag: '"abc"', 'Last-Modified': 'Wed, 28 Oct 2026 09:00:00 GMT' })
      response.end(ICS)
    })

    const result = await fetchIcs(url, NONE)

    expect(result).toEqual({ status: 'ok', body: ICS, etag: '"abc"', lastModified: 'Wed, 28 Oct 2026 09:00:00 GMT' })
    expect(seen[0]!.accept).toBe('text/calendar, */*;q=0.5')
    expect(seen[0]!['if-none-match']).toBeUndefined()
    expect(seen[0]!['if-modified-since']).toBeUndefined()
  })

  it('sends the validators it has, and takes a 304 as not modified', async () => {
    const seen: IncomingHttpHeaders[] = []
    const url = await serve((request, response) => {
      seen.push(request.headers)
      response.writeHead(304)
      response.end()
    })

    const result = await fetchIcs(url, { etag: '"abc"', lastModified: 'Wed, 28 Oct 2026 09:00:00 GMT' })

    expect(result).toEqual({ status: 'not-modified' })
    expect(seen[0]!['if-none-match']).toBe('"abc"')
    expect(seen[0]!['if-modified-since']).toBe('Wed, 28 Oct 2026 09:00:00 GMT')
  })

  it('has null validators when the server sends none', async () => {
    const url = await serve((_request, response) => { response.end(ICS) })

    expect(await fetchIcs(url, NONE)).toMatchObject({ status: 'ok', etag: null, lastModified: null })
  })

  it('reads UTF-8, with or without a byte order mark', async () => {
    const url = await serve((_request, response) => { response.end(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(ICS.replace('VERSION:2.0', 'X-NAME:Café ☕'))])) })

    const result = await fetchIcs(url, NONE)

    expect(result).toMatchObject({ status: 'ok' })
    expect((result as { body: string }).body).toContain('Café ☕')
  })

  it.each([
    [404, 'Not Found'],
    [500, 'Internal Server Error'],
    [403, 'Forbidden'],
  ])('fails on HTTP %i', async (status, text) => {
    const url = await serve((_request, response) => {
      response.writeHead(status, text)
      response.end('nope')
    })

    const error = await failure(fetchIcs(url, NONE))

    expect(error.kind).toBe('fetch')
    expect(error.message).toBe(`HTTP ${status} ${text}`)
  })

  it('refuses a 200 that is not a calendar, such as a login page', async () => {
    const url = await serve((_request, response) => { response.end('<!doctype html><html><body>Sign in</body></html>') })

    expect((await failure(fetchIcs(url, NONE))).message).toBe('the response is not an iCalendar file')
  })

  it('accepts leading whitespace and any case before BEGIN:VCALENDAR', async () => {
    const url = await serve((_request, response) => { response.end('\n  begin:vcalendar\r\nend:vcalendar\r\n') })

    expect(await fetchIcs(url, NONE)).toMatchObject({ status: 'ok' })
  })

  it('refuses a body larger than the limit when the server says so up front', async () => {
    const url = await serve((_request, response) => {
      response.writeHead(200, { 'Content-Length': String(ICS.length + 5000) })
      response.end(ICS + 'x'.repeat(5000))
    })

    expect((await failure(fetchIcs(url, NONE, { maxBytes: 1000 }))).message).toBe('the calendar is larger than 0 MB')
  })

  it('stops reading a body that grows past the limit without saying so', async () => {
    let sent = 0
    const url = await serve((_request, response) => {
      response.writeHead(200) // chunked: no Content-Length
      const timer = setInterval(() => {
        sent += 1000
        if (!response.write('x'.repeat(1000))) return
        if (sent > 200_000) clearInterval(timer)
      }, 1)
      response.on('close', () => clearInterval(timer))
    })

    const error = await failure(fetchIcs(url, NONE, { maxBytes: 5000 }))

    expect(error.message).toContain('larger than')
    expect(sent).toBeLessThan(200_000)
  })

  it('times out', async () => {
    const url = await serve(() => { /* never answers */ })

    const error = await failure(fetchIcs(url, NONE, { timeoutMs: 50 }))

    expect(error.message).toBe('timed out after 0.05 s')
  })

  it('names the time out in whole seconds', async () => {
    const { fetch } = stub(() => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }) })

    expect((await failure(fetchIcs('https://example.com/a.ics', NONE, { fetch, timeoutMs: 30_000 }))).message).toBe('timed out after 30 s')
  })

  it('reports a refused connection by its code', async () => {
    // A port that was just in use and now is not.
    const server = createServer()
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    await new Promise(resolve => server.close(resolve))

    const error = await failure(fetchIcs(`http://127.0.0.1:${port}/private-token-123/basic.ics`, NONE))

    expect(error.message).toBe('could not connect (ECONNREFUSED)')
  })

  it('refuses a URL that is not http, https or file', async () => {
    expect((await failure(fetchIcs('ftp://example.com/a.ics', NONE))).message).toBe('the calendar URL must be http(s) or file')
    expect((await failure(fetchIcs('not a url', NONE))).message).toBe('the calendar URL must be http(s) or file')
  })
})

describe('fetchIcs and the URL, which is a secret', () => {
  const token = 'private-0123456789abcdef0123456789abcdef'

  it.each([
    ['a refused connection', () => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(`connect ECONNREFUSED ${SECRET_URL}`), { code: 'ECONNREFUSED' }) }) }],
    ['an error that quotes the URL and has no code', () => { throw new TypeError(`Failed to parse URL from ${SECRET_URL}`) }],
    ['a name that is not found', () => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND calendar.example.com'), { code: 'ENOTFOUND' }) }) }],
    ['a timeout', () => { throw Object.assign(new Error(`The operation timed out: ${SECRET_URL}`), { name: 'TimeoutError' }) }],
    ['a failed request', () => new Response('x', { status: 503, statusText: 'Service Unavailable' })],
    ['a login page', () => new Response('<html>Sign in</html>', { status: 200 })],
  ])('keeps it out of the error for %s', async (_name, respond) => {
    const { fetch } = stub(respond)

    const error = await failure(fetchIcs(SECRET_URL, NONE, { fetch }))

    for (const text of [error.message, error.name, String(error), JSON.stringify(error), error.stack ?? '']) {
      expect(text).not.toContain(token)
      expect(text).not.toContain('calendar.example.com')
      expect(text).not.toContain('family')
    }
    expect(error.cause).toBeUndefined()
  })

  it('maps the failures to short, fixed messages', async () => {
    const connect = stub(() => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('x'), { code: 'ECONNRESET' }) }) })
    const unknown = stub(() => { throw new TypeError(`Failed to parse URL from ${SECRET_URL}`) })

    expect((await failure(fetchIcs(SECRET_URL, NONE, { fetch: connect.fetch }))).message).toBe('could not connect (ECONNRESET)')
    expect((await failure(fetchIcs(SECRET_URL, NONE, { fetch: unknown.fetch }))).message).toBe('could not connect')
  })

  it('does ask for the URL it was given', async () => {
    const { fetch, calls } = stub(() => new Response(ICS))

    await fetchIcs(SECRET_URL, { etag: '"x"', lastModified: null }, { fetch })

    expect(calls).toEqual([{ url: SECRET_URL, headers: { accept: 'text/calendar, */*;q=0.5', 'if-none-match': '"x"' } }])
  })
})

describe('fetchIcs with a file: URL', () => {
  async function fixture(contents = ICS) {
    const dir = await mkdtemp(join(tmpdir(), 'wallcal-ics-'))
    dirs.push(dir)
    const path = join(dir, 'private-token-xyz.ics')
    await writeFile(path, contents)
    return { path, url: pathToFileURL(path).href }
  }

  it('reads the file and uses its modified time as the validator', async () => {
    const { path, url } = await fixture()
    await utimes(path, new Date('2026-10-28T09:00:00Z'), new Date('2026-10-28T09:00:00Z'))

    expect(await fetchIcs(url, NONE)).toEqual({ status: 'ok', body: ICS, etag: null, lastModified: 'Wed, 28 Oct 2026 09:00:00 GMT' })
  })

  it('says not modified when the stored modified time matches, and reads again when it does not', async () => {
    const { path, url } = await fixture()
    await utimes(path, new Date('2026-10-28T09:00:00Z'), new Date('2026-10-28T09:00:00Z'))

    expect(await fetchIcs(url, { etag: null, lastModified: 'Wed, 28 Oct 2026 09:00:00 GMT' })).toEqual({ status: 'not-modified' })

    await utimes(path, new Date('2026-10-28T09:00:05Z'), new Date('2026-10-28T09:00:05Z'))
    expect(await fetchIcs(url, { etag: null, lastModified: 'Wed, 28 Oct 2026 09:00:00 GMT' })).toMatchObject({ status: 'ok', lastModified: 'Wed, 28 Oct 2026 09:00:05 GMT' })
  })

  it('does not read a file it has already seen', async () => {
    const { path, url } = await fixture('this is not a calendar')
    await utimes(path, new Date('2026-10-28T09:00:00Z'), new Date('2026-10-28T09:00:00Z'))

    expect(await fetchIcs(url, { etag: null, lastModified: 'Wed, 28 Oct 2026 09:00:00 GMT' })).toEqual({ status: 'not-modified' })
  })

  it('fails safely on a missing file, without the path', async () => {
    const { path, url } = await fixture()
    await rm(path)

    const error = await failure(fetchIcs(url, NONE))

    expect(error.message).toBe('could not read the calendar file (ENOENT)')
    expect(error.message).not.toContain('private-token-xyz')
  })

  it('refuses a file that is not a calendar, or too big', async () => {
    const text = await fixture('hello')
    const big = await fixture(ICS + 'x'.repeat(3000))

    expect((await failure(fetchIcs(text.url, NONE))).message).toBe('the response is not an iCalendar file')
    expect((await failure(fetchIcs(big.url, NONE, { maxBytes: 1000 }))).message).toContain('larger than')
  })
})
