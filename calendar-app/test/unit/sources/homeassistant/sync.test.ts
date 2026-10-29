import { createServer } from 'node:http'
import type { IncomingHttpHeaders, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { events, syncStatus } from '../../../../server/db/schema'
import { syncHomeAssistantCalendar } from '../../../../server/sources/homeassistant/sync'
import { migratedMemoryDb } from '../../db/helpers'
import { calendarConfig, PEOPLE } from '../helpers'

const SYNC = { months_back: 0, months_ahead: 0 }
const OCTOBER = new Date('2026-10-28T12:00:00Z')
const TOKEN = 'ha-long-lived-token-0123456789abcdef'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => {
    server.closeAllConnections()
    server.close(resolve)
  })))
})

interface Seen {
  path: string
  start: string | null
  end: string | null
  headers: IncomingHttpHeaders
}

interface HomeAssistant {
  url: string
  /** One entry per request. */
  requests: Seen[]
  /** What the next requests get. */
  respond: { status: number, body: unknown }
}

/** A Home Assistant that answers every calendar request with `respond`. */
async function serveHomeAssistant(body: unknown): Promise<HomeAssistant> {
  const ha: HomeAssistant = { url: '', requests: [], respond: { status: 200, body } }
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    ha.requests.push({ path: url.pathname, start: url.searchParams.get('start'), end: url.searchParams.get('end'), headers: request.headers })
    response.writeHead(ha.respond.status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(ha.respond.body))
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  ha.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return ha
}

const swimming = { summary: 'Theo: Swimming', start: { dateTime: '2026-10-28T16:30:00+00:00' }, end: { dateTime: '2026-10-28T17:15:00+00:00' }, uid: 'swim' }
const bins = { summary: 'Bins out', description: 'Green and blue', start: { date: '2026-10-29' }, end: { date: '2026-10-30' }, uid: 'bins-1' }

function setup(ha: HomeAssistant) {
  const { db } = migratedMemoryDb()
  const config = calendarConfig({ id: 'bins', source: { type: 'homeassistant', entity_id: 'calendar.bins', poll_seconds: 300 } })
  const run = (args: { now?: Date } = {}) =>
    syncHomeAssistantCalendar({ db, calendar: config, homeassistant: { url: ha.url, token: TOKEN }, people: PEOPLE, timeZone: 'Europe/London', sync: SYNC, now: args.now ?? OCTOBER })
  const stored = () => db.select().from(events).where(eq(events.calendarId, config.id)).orderBy(events.startAt).all()
  const status = () => db.select().from(syncStatus).where(eq(syncStatus.calendarId, config.id)).get()
  return { db, config, run, stored, status }
}

describe('syncHomeAssistantCalendar', () => {
  it('asks Home Assistant for the sync window with the token', async () => {
    const ha = await serveHomeAssistant([])
    const { run } = setup(ha)

    await run()

    // The window is October only (no months either side), in London time.
    expect(ha.requests).toHaveLength(1)
    expect(ha.requests[0]).toMatchObject({
      path: '/api/calendars/calendar.bins',
      start: '2026-09-30T23:00:00.000Z',
      end: '2026-11-01T00:00:00.000Z',
      headers: { authorization: `Bearer ${TOKEN}` },
    })
  })

  it('stores the events with their people, and records how it went', async () => {
    const ha = await serveHomeAssistant([swimming, bins])
    const { run, stored, status } = setup(ha)

    const result = await run()

    expect(result).toEqual({ status: 'updated', inserted: 2, updated: 0, deleted: 0, total: 2, warnings: [] })
    expect(stored()).toMatchObject([
      { uid: 'swim', recurrenceId: '', title: 'Theo: Swimming', displayTitle: 'Theo: Swimming', allDay: false, startDate: null, endDate: null, startAt: new Date('2026-10-28T16:30:00Z'), endAt: new Date('2026-10-28T17:15:00Z'), personIds: ['theo'] },
      { uid: 'bins-1', title: 'Bins out', description: 'Green and blue', allDay: true, startDate: '2026-10-29', endDate: '2026-10-30', startAt: new Date('2026-10-29T00:00:00Z'), endAt: new Date('2026-10-30T00:00:00Z'), personIds: ['home'] },
    ])
    expect(status()).toEqual({
      calendarId: 'bins',
      lastAttemptAt: OCTOBER,
      lastSuccessAt: OCTOBER,
      lastError: null,
      etag: null,
      lastModified: null,
      expansionKey: null,
      eventCount: 2,
    })
  })

  it('fetches the window every time, and writes nothing when it has not changed', async () => {
    const ha = await serveHomeAssistant([swimming, bins])
    const { run, stored, status } = setup(ha)
    await run()
    const before = stored()

    const later = new Date('2026-10-28T12:05:00Z')
    const result = await run({ now: later })

    expect(ha.requests).toHaveLength(2)
    expect(result).toEqual({ status: 'updated', inserted: 0, updated: 0, deleted: 0, total: 2, warnings: [] })
    expect(stored()).toEqual(before)
    expect(status()).toMatchObject({ lastAttemptAt: later, lastSuccessAt: later, lastError: null, eventCount: 2 })
  })

  it('takes a changed response as updates, additions and removals', async () => {
    const ha = await serveHomeAssistant([swimming, bins])
    const { run, stored, status } = setup(ha)
    await run()

    const later = { ...swimming, start: { dateTime: '2026-10-28T17:00:00+00:00' }, end: { dateTime: '2026-10-28T17:45:00+00:00' } }
    const dentist = { summary: 'Dentist', start: { dateTime: '2026-10-30T09:00:00+00:00' }, end: { dateTime: '2026-10-30T10:00:00+00:00' }, uid: 'dentist' }
    ha.respond = { status: 200, body: [later, dentist] }
    const result = await run()

    expect(result).toMatchObject({ status: 'updated', inserted: 1, updated: 1, deleted: 1, total: 2 })
    expect(stored().map(e => [e.uid, e.startAt.toISOString()])).toEqual([['swim', '2026-10-28T17:00:00.000Z'], ['dentist', '2026-10-30T09:00:00.000Z']])
    expect(status()).toMatchObject({ lastError: null, eventCount: 2 })
  })

  it('passes on the warnings from the mapping', async () => {
    const ha = await serveHomeAssistant([bins, { summary: 'Broken', start: { dateTime: 'not a time' }, end: { dateTime: 'not a time' }, uid: 'broken' }])
    const { run, stored } = setup(ha)

    const result = await run()

    expect(result).toMatchObject({ status: 'updated', total: 1, warnings: ['1 event with an unreadable start or end was left out'] })
    expect(stored().map(e => e.uid)).toEqual(['bins-1'])
  })

  it.each([
    [401, 'Home Assistant refused the access token (HTTP 401)'],
    [500, 'HTTP 500 Internal Server Error'],
  ])('keeps the stored events when Home Assistant answers %i, and records why without the token', async (code, message) => {
    const ha = await serveHomeAssistant([swimming, bins])
    const { run, stored, status } = setup(ha)
    await run()
    const before = stored()

    ha.respond = { status: code, body: { message: `${TOKEN} is wrong` } }
    const failed = new Date('2026-10-28T12:05:00Z')
    const error = await run({ now: failed }).then(() => undefined, (caught: unknown) => caught as Error)

    expect(error?.message).toBe(message)
    expect(stored()).toEqual(before)
    expect(status()).toMatchObject({ lastAttemptAt: failed, lastSuccessAt: OCTOBER, lastError: message, eventCount: 2 })
    expect(JSON.stringify(status())).not.toContain(TOKEN)
    expect(JSON.stringify(error)).not.toContain(TOKEN)
  })

  it('records a failure on a calendar that has never synced', async () => {
    const ha = await serveHomeAssistant({})
    ha.respond = { status: 404, body: {} }
    const { run, stored, status } = setup(ha)

    await expect(run()).rejects.toThrow('Home Assistant has no calendar "calendar.bins" (HTTP 404)')

    expect(stored()).toEqual([])
    expect(status()).toMatchObject({ lastAttemptAt: OCTOBER, lastSuccessAt: null, lastError: 'Home Assistant has no calendar "calendar.bins" (HTTP 404)', eventCount: 0 })
  })

  it('does not wipe the calendar when the answer is not a list of events', async () => {
    const ha = await serveHomeAssistant([bins])
    const { run, stored, status } = setup(ha)
    await run()

    ha.respond = { status: 200, body: { message: 'Not what we asked for' } }
    await expect(run()).rejects.toThrow()

    expect(stored()).toHaveLength(1)
    expect(status()!.lastError).not.toBeNull()
  })

  it('refuses a calendar that is not a Home Assistant calendar', async () => {
    const { db } = migratedMemoryDb()

    await expect(syncHomeAssistantCalendar({ db, calendar: calendarConfig(), homeassistant: { url: 'http://127.0.0.1:1', token: TOKEN }, people: PEOPLE, timeZone: 'Europe/London', sync: SYNC })).rejects.toThrow('not a Home Assistant calendar')
  })
})
