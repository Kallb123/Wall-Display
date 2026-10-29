import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { canSyncCalendar, syncCalendar } from '../../../server/sources/sync'
import { migratedMemoryDb } from '../db/helpers'
import { calendarConfig, PEOPLE } from './helpers'

// The dispatch from a calendar's source type to the function that syncs it.

const FAMILY_ICS = pathToFileURL(join(import.meta.dirname, '../../fixtures/ics/family.ics')).href
const CONFIG = { people: PEOPLE, timezone: 'Europe/London', sync: { months_back: 12, months_ahead: 12 } }
const NOW = new Date('2026-10-28T12:00:00Z')
const TOKEN = 'ha-long-lived-token-0123456789abcdef'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => {
    server.closeAllConnections()
    server.close(resolve)
  })))
})

/** A Home Assistant that answers every request with these events, and returns its address. */
async function serveHomeAssistant(body: unknown[]): Promise<string> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

const ics = () => calendarConfig({ source: { type: 'ics', url: FAMILY_ICS, poll_seconds: 120 } })
const homeAssistant = () => calendarConfig({ id: 'bins', source: { type: 'homeassistant', entity_id: 'calendar.bins', poll_seconds: 300 } })

describe('canSyncCalendar', () => {
  it('is true for the sources that have a sync function', () => {
    expect(canSyncCalendar(ics())).toBe(true)
    expect(canSyncCalendar(homeAssistant())).toBe(true)
  })
})

describe('syncCalendar', () => {
  it('syncs an ICS calendar and says whether events changed', async () => {
    const { db } = migratedMemoryDb()

    const first = await syncCalendar({ db, calendar: ics(), config: CONFIG, now: NOW })
    const second = await syncCalendar({ db, calendar: ics(), config: CONFIG, now: NOW })

    expect(first).toMatchObject({ status: 'updated', changed: true, warnings: [] })
    expect(first.summary).toMatch(/^\d+ added, 0 changed, 0 removed \(\d+ events\)$/)
    expect(second).toEqual({ status: 'not-modified', changed: false, summary: 'not modified' })
  })

  it('syncs a Home Assistant calendar with the address and token from the config', async () => {
    const { db } = migratedMemoryDb()
    const url = await serveHomeAssistant([{ summary: 'Bins out', start: { date: '2026-10-29' }, end: { date: '2026-10-30' }, uid: 'bins-1' }])
    const config = { ...CONFIG, homeassistant: { url, token: TOKEN } }

    const first = await syncCalendar({ db, calendar: homeAssistant(), config, now: NOW })
    const second = await syncCalendar({ db, calendar: homeAssistant(), config, now: NOW })

    expect(first).toEqual({ status: 'updated', changed: true, summary: '1 added, 0 changed, 0 removed (1 events)', warnings: [] })
    expect(second).toEqual({ status: 'updated', changed: false, summary: '0 added, 0 changed, 0 removed (1 events)', warnings: [] })
  })

  it('refuses a Home Assistant calendar when the config has no homeassistant block', async () => {
    const { db } = migratedMemoryDb()

    await expect(syncCalendar({ db, calendar: homeAssistant(), config: CONFIG, now: NOW })).rejects.toThrow('has no "homeassistant" block')
  })
})
