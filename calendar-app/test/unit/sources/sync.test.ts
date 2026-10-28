import { createServer } from 'node:http'
import type { IncomingHttpHeaders, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { events, syncStatus } from '../../../server/db/schema'
import { syncIcsCalendar } from '../../../server/sources/ics/sync'
import { migratedMemoryDb } from '../db/helpers'
import { calendar, calendarConfig, PEOPLE, vevent } from './helpers'

const SYNC = { months_back: 0, months_ahead: 0 }
const OCTOBER = new Date('2026-10-28T12:00:00Z')
const NOVEMBER = new Date('2026-11-05T12:00:00Z')

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => {
    server.closeAllConnections()
    server.close(resolve)
  })))
})

interface Feed {
  url: string
  /** The request headers, one entry per request. */
  requests: IncomingHttpHeaders[]
  /** What the next requests get. */
  respond: { status: number, body: string, etag: string | null }
}

/** A feed that answers 304 to a request that carries its current ETag. */
async function serveFeed(body: string, etag: string | null = '"v1"'): Promise<Feed> {
  const feed: Feed = { url: '', requests: [], respond: { status: 200, body, etag } }
  const server = createServer((request, response) => {
    feed.requests.push(request.headers)
    const { status, body: text, etag: tag } = feed.respond
    if (status === 200 && tag && request.headers['if-none-match'] === tag) {
      response.writeHead(304)
      return response.end()
    }
    response.writeHead(status, tag ? { ETag: tag } : {})
    response.end(text)
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  feed.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/secret-token-abc123/basic.ics`
  return feed
}

const october = vevent('swim', 'DTSTART;TZID=Europe/London:20261028T163000', 'DTEND;TZID=Europe/London:20261028T171500', 'SUMMARY:Swimming')
const november = vevent('dentist', 'DTSTART;TZID=Europe/London:20261110T090000', 'DTEND;TZID=Europe/London:20261110T100000', 'SUMMARY:Dentist')

function setup(feed: Feed, overrides = {}) {
  const { db } = migratedMemoryDb()
  const config = calendarConfig({ source: { type: 'ics', url: feed.url, poll_seconds: 120 }, ...overrides })
  const run = (args: { now?: Date, timeZone?: string, sync?: typeof SYNC } = {}) =>
    syncIcsCalendar({ db, calendar: config, people: PEOPLE, timeZone: args.timeZone ?? 'Europe/London', sync: args.sync ?? SYNC, now: args.now ?? OCTOBER })
  const stored = () => db.select().from(events).where(eq(events.calendarId, config.id)).orderBy(events.startAt).all()
  const status = () => db.select().from(syncStatus).where(eq(syncStatus.calendarId, config.id)).get()
  return { db, config, run, stored, status }
}

describe('syncIcsCalendar', () => {
  it('fetches, expands and stores a calendar, and records how it went', async () => {
    const feed = await serveFeed(calendar([october, november]))
    const { run, stored, status } = setup(feed)

    const result = await run()

    // The window is October only (no months either side).
    expect(result).toEqual({ status: 'updated', inserted: 1, updated: 0, deleted: 0, total: 1, warnings: [] })
    expect(stored()).toMatchObject([{ uid: 'swim', title: 'Swimming', startAt: new Date('2026-10-28T16:30:00Z'), personIds: ['home'] }])
    expect(status()).toEqual({
      calendarId: 'family',
      lastAttemptAt: OCTOBER,
      lastSuccessAt: OCTOBER,
      lastError: null,
      etag: '"v1"',
      lastModified: null,
      expansionKey: '2026-09-30T23:00:00.000Z|2026-11-01T00:00:00.000Z|Europe/London|home',
      eventCount: 1,
    })
    expect(feed.requests[0]!['if-none-match']).toBeUndefined()
  })

  it('sends the stored ETag next time and takes a 304 as nothing to do', async () => {
    const feed = await serveFeed(calendar([october]))
    const { run, stored, status } = setup(feed)
    await run()
    const before = stored()

    const later = new Date('2026-10-28T12:02:00Z')
    const result = await run({ now: later })

    expect(result).toEqual({ status: 'not-modified' })
    expect(feed.requests[1]!['if-none-match']).toBe('"v1"')
    expect(stored()).toEqual(before)
    expect(status()).toMatchObject({ lastAttemptAt: later, lastSuccessAt: later, lastError: null, etag: '"v1"', eventCount: 1 })
  })

  it('takes a changed feed as an update', async () => {
    const feed = await serveFeed(calendar([october]))
    const { run, stored, status } = setup(feed)
    await run()

    feed.respond = { status: 200, etag: '"v2"', body: calendar([vevent('swim', 'DTSTART;TZID=Europe/London:20261028T170000', 'DTEND;TZID=Europe/London:20261028T174500', 'SUMMARY:Swimming'), vevent('late', 'DTSTART:20261029T090000Z')]) }
    const result = await run()

    expect(result).toMatchObject({ status: 'updated', inserted: 1, updated: 1, deleted: 0, total: 2 })
    expect(feed.requests[1]!['if-none-match']).toBe('"v1"')
    expect(stored().map(e => e.startAt.toISOString())).toEqual(['2026-10-28T17:00:00.000Z', '2026-10-29T09:00:00.000Z'])
    expect(status()).toMatchObject({ etag: '"v2"', eventCount: 2 })
  })

  it('passes on the warnings from the feed', async () => {
    const feed = await serveFeed(calendar([vevent('a', 'DTSTART;TZID=Mars/Olympus:20261028T090000')]))
    const { run } = setup(feed)

    const result = await run()

    expect(result).toMatchObject({ status: 'updated', total: 1 })
    expect((result as { warnings: string[] }).warnings).toHaveLength(1)
  })

  it('fetches without validators when the month rolls over, and moves the window', async () => {
    const feed = await serveFeed(calendar([october, november]))
    const { run, stored, status } = setup(feed)
    await run()
    expect(stored().map(e => e.uid)).toEqual(['swim'])

    // The feed has not changed (the server would say 304 to the ETag), but the window has.
    const result = await run({ now: NOVEMBER })

    expect(feed.requests[1]!['if-none-match']).toBeUndefined()
    expect(result).toMatchObject({ status: 'updated', inserted: 1, deleted: 1, total: 1 })
    expect(stored().map(e => e.uid)).toEqual(['dentist'])
    expect(status()).toMatchObject({ expansionKey: '2026-11-01T00:00:00.000Z|2026-12-01T00:00:00.000Z|Europe/London|home', etag: '"v1"' })

    // And within the new month it is conditional again.
    expect(await run({ now: NOVEMBER })).toEqual({ status: 'not-modified' })
    expect(feed.requests[2]!['if-none-match']).toBe('"v1"')
  })

  it('fetches without validators when the time zone changes', async () => {
    const feed = await serveFeed(calendar([vevent('floating', 'DTSTART:20261028T090000')]))
    const { run, stored } = setup(feed)
    await run()
    expect(stored()[0]!.startAt.toISOString()).toBe('2026-10-28T09:00:00.000Z')

    await run({ timeZone: 'America/New_York' })

    expect(feed.requests[1]!['if-none-match']).toBeUndefined()
    expect(stored()[0]!.startAt.toISOString()).toBe('2026-10-28T13:00:00.000Z')
  })

  it('fetches without validators when the default person changes', async () => {
    const feed = await serveFeed(calendar([october]))
    const first = setup(feed)
    await first.run()

    await syncIcsCalendar({ db: first.db, calendar: { ...first.config, person: 'mum' }, people: PEOPLE, timeZone: 'Europe/London', sync: SYNC, now: OCTOBER })

    expect(feed.requests[1]!['if-none-match']).toBeUndefined()
    expect(first.stored()[0]!.personIds).toEqual(['mum'])
  })

  it('keeps the stored events and validators when the fetch fails, and records why without the URL', async () => {
    const feed = await serveFeed(calendar([october]))
    const { run, stored, status } = setup(feed)
    await run()
    const before = stored()

    feed.respond = { status: 500, etag: null, body: 'broken' }
    const failed = new Date('2026-10-28T12:05:00Z')
    await expect(run({ now: failed })).rejects.toThrow('HTTP 500 Internal Server Error')

    expect(stored()).toEqual(before)
    expect(status()).toMatchObject({
      lastAttemptAt: failed,
      lastSuccessAt: OCTOBER,
      lastError: 'HTTP 500 Internal Server Error',
      etag: '"v1"',
      eventCount: 1,
    })
    expect(status()!.lastError).not.toContain('secret-token')
  })

  it('clears the error when it works again', async () => {
    const feed = await serveFeed(calendar([october]))
    const { run, status } = setup(feed)
    await run()
    feed.respond = { status: 503, etag: null, body: '' }
    await expect(run()).rejects.toThrow()
    expect(status()!.lastError).not.toBeNull()

    feed.respond = { status: 200, etag: '"v1"', body: calendar([october]) }
    expect(await run()).toEqual({ status: 'not-modified' })

    expect(status()!.lastError).toBeNull()
  })

  it('keeps the stored events and the old validators when the feed will not parse', async () => {
    const feed = await serveFeed(calendar([october]))
    const { run, stored, status } = setup(feed)
    await run()
    const before = stored()

    feed.respond = { status: 200, etag: '"v2"', body: 'BEGIN:VCALENDAR\r\nthis line is nonsense\r\nEND:VCALENDAR\r\n' }
    await expect(run()).rejects.toThrow('the calendar could not be parsed')

    expect(stored()).toEqual(before)
    expect(status()).toMatchObject({ lastError: 'the calendar could not be parsed', etag: '"v1"', eventCount: 1 })
  })

  it('does not wipe the calendar when a login page comes back with a 200', async () => {
    const feed = await serveFeed(calendar([october]))
    const { run, stored, status } = setup(feed)
    await run()

    feed.respond = { status: 200, etag: '"v2"', body: '<html>Sign in</html>' }
    await expect(run()).rejects.toThrow('the response is not an iCalendar file')

    expect(stored()).toHaveLength(1)
    expect(status()!.lastError).toBe('the response is not an iCalendar file')
  })

  it('records a failure on a calendar that has never synced', async () => {
    const feed = await serveFeed('')
    feed.respond = { status: 404, etag: null, body: '' }
    const { run, status, stored } = setup(feed)

    await expect(run()).rejects.toThrow('HTTP 404')

    expect(stored()).toEqual([])
    expect(status()).toMatchObject({ lastAttemptAt: OCTOBER, lastSuccessAt: null, lastError: 'HTTP 404 Not Found', etag: null, eventCount: 0 })
  })

  it('records only a generic message for an error of its own', async () => {
    const { db } = migratedMemoryDb()
    const secret = 'https://calendar.example.com/private-token-9999/basic.ics'
    const config = calendarConfig({ source: { type: 'ics', url: secret, poll_seconds: 120 } })
    const fetchStub = (() => { throw new TypeError(`Failed to parse URL from ${secret}`) }) as typeof fetch

    await expect(syncIcsCalendar({ db, calendar: config, people: PEOPLE, timeZone: 'Europe/London', sync: SYNC, now: OCTOBER, fetch: fetchStub })).rejects.toThrow('could not connect')

    const row = db.select().from(syncStatus).get()!
    expect(row.lastError).toBe('could not connect')
    expect(JSON.stringify(row)).not.toContain('private-token')
  })

  it('leaves another calendar\'s events alone', async () => {
    const feed = await serveFeed(calendar([october]))
    const other = await serveFeed(calendar([vevent('standup', 'DTSTART:20261028T090000Z')]))
    const { db, run } = setup(feed)
    await run()
    await syncIcsCalendar({ db, calendar: calendarConfig({ id: 'work', person: 'dad', source: { type: 'ics', url: other.url, poll_seconds: 120 } }), people: PEOPLE, timeZone: 'Europe/London', sync: SYNC, now: OCTOBER })

    feed.respond = { status: 200, etag: '"v2"', body: calendar([]) }
    await run()

    expect(db.select().from(events).all().map(e => [e.calendarId, e.uid])).toEqual([['work', 'standup']])
  })

  it('refuses a calendar that is not an ICS calendar', async () => {
    const { db } = migratedMemoryDb()
    const config = calendarConfig({ source: { type: 'homeassistant', entity_id: 'calendar.bins', poll_seconds: 300 } })

    await expect(syncIcsCalendar({ db, calendar: config, people: PEOPLE, timeZone: 'Europe/London', sync: SYNC })).rejects.toThrow('not an ICS calendar')
  })
})
