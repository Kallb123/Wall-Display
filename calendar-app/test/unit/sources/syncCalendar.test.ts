import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canSyncCalendar, syncCalendar } from '../../../server/sources/sync'
import { migratedMemoryDb } from '../db/helpers'
import { calendarConfig, PEOPLE } from './helpers'

// The dispatch from a calendar's source type to the function that syncs it.

const FAMILY_ICS = pathToFileURL(join(import.meta.dirname, '../../fixtures/ics/family.ics')).href
const CONFIG = { people: PEOPLE, timezone: 'Europe/London', sync: { months_back: 12, months_ahead: 12 } }
const NOW = new Date('2026-10-28T12:00:00Z')

const ics = () => calendarConfig({ source: { type: 'ics', url: FAMILY_ICS, poll_seconds: 120 } })
const homeAssistant = () => calendarConfig({ id: 'bins', source: { type: 'homeassistant', entity_id: 'calendar.bins', poll_seconds: 300 } })

describe('canSyncCalendar', () => {
  it('is true for the sources that have a sync function', () => {
    expect(canSyncCalendar(ics())).toBe(true)
    expect(canSyncCalendar(homeAssistant())).toBe(false)
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

  it('refuses a source type that has no sync function', async () => {
    const { db } = migratedMemoryDb()

    await expect(syncCalendar({ db, calendar: homeAssistant(), config: CONFIG, now: NOW })).rejects.toThrow('cannot be synced yet')
  })
})
