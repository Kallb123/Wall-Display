import { describe, expect, it } from 'vitest'
import { defaultDisplayState } from '../../../server/control/commands'
import type { MqttBridgeStatus } from '../../../server/mqtt/client'
import { calendarStatuses, connectionsStatus, discoveryProblem, displayStatuses } from '../../../server/settings/status'
import { ensureCalendarRow, recordSyncStatus, replaceCalendarEvents } from '../../../server/sources/store'
import type { NormalisedEvent } from '../../../server/sources/types'
import { migratedMemoryDb } from '../db/helpers'
import { calendarConfig, PEOPLE, resolverFor } from '../sources/helpers'

const NOW = new Date('2026-10-28T12:00:00Z')
const ICS_URL = 'https://calendar.example.com/private/abcdef-secret-token/basic.ics'

function event(title: string, startAt: Date): NormalisedEvent {
  return { uid: `${title}@example.com`, recurrenceId: '', title, description: null, location: null, startAt, endAt: new Date(startAt.getTime() + 3_600_000), allDay: false, startDate: null, endDate: null }
}

describe('calendarStatuses', () => {
  function setup() {
    const { db } = migratedMemoryDb()
    const family = calendarConfig({ source: { type: 'ics', url: ICS_URL, poll_seconds: 120 } })
    const work = calendarConfig({ id: 'work', name: undefined, person: 'dad', detect_people: false, detect_in: ['title'], source: { type: 'ics', url: ICS_URL, poll_seconds: 300 } })
    const calendars = [family, work]
    for (const calendar of calendars) ensureCalendarRow(db, calendar, PEOPLE)
    return { db, calendars, family, work }
  }
  const statuses = (args: ReturnType<typeof setup>, canSync: (calendar: { id: string }) => boolean = () => true) =>
    calendarStatuses({ db: args.db, config: { calendars: args.calendars, people: PEOPLE }, now: NOW, canSync })

  it('shows a calendar that has not been tried yet with nulls and a count of 0', () => {
    const [family] = statuses(setup())

    expect(family).toEqual({
      id: 'family',
      name: 'Family',
      person: { id: 'home', name: 'Household', initial: 'H', colour: '#D9A93F' },
      detect_people: true,
      detect_in: ['title', 'description'],
      source_type: 'ics',
      poll_seconds: 120,
      syncing: true,
      last_attempt_at: null,
      last_success_at: null,
      last_error: null,
      event_count: 0,
      fallbacks: [],
    })
  })

  it('reports each calendar in config order, naming one after its id when it has no name', () => {
    const result = statuses(setup())

    expect(result.map(({ id, name, detect_people, detect_in, poll_seconds }) => ({ id, name, detect_people, detect_in, poll_seconds }))).toEqual([
      { id: 'family', name: 'Family', detect_people: true, detect_in: ['title', 'description'], poll_seconds: 120 },
      { id: 'work', name: 'work', detect_people: false, detect_in: ['title'], poll_seconds: 300 },
    ])
    expect(result[1]!.person.id).toBe('dad')
  })

  it('carries the sync status as ISO times, the last error and the event count', () => {
    const args = setup()
    recordSyncStatus(args.db, 'family', { lastAttemptAt: new Date('2026-10-28T11:58:00Z'), lastSuccessAt: new Date('2026-10-28T11:56:00Z'), lastError: 'HTTP 503 Service Unavailable', eventCount: 42 })
    recordSyncStatus(args.db, 'work', { lastAttemptAt: new Date('2026-10-28T11:58:00Z'), lastSuccessAt: new Date('2026-10-28T11:58:00Z'), eventCount: 7 })

    const [family, work] = statuses(args)

    expect(family).toMatchObject({ last_attempt_at: '2026-10-28T11:58:00.000Z', last_success_at: '2026-10-28T11:56:00.000Z', last_error: 'HTTP 503 Service Unavailable', event_count: 42 })
    expect(work).toMatchObject({ last_error: null, event_count: 7 })
  })

  it('says whether the source type can be synced', () => {
    const [family, work] = statuses(setup(), calendar => calendar.id === 'family')

    expect([family!.syncing, work!.syncing]).toEqual([true, false])
  })

  it('lists the events that fell back to the default person, only for a calendar that detects people', () => {
    const args = setup()
    const soon = new Date('2026-10-30T10:00:00Z')
    replaceCalendarEvents(args.db, 'family', [event('Dentist', soon), event('Isla: ballet', soon)], resolverFor())
    replaceCalendarEvents(args.db, 'work', [event('Standup', soon)], resolverFor({ id: 'work', person: 'dad', detect_people: false }))

    const [family, work] = statuses(args)

    expect(family!.fallbacks).toEqual([{ title: 'Dentist', start: '2026-10-30T10:00:00.000Z', all_day: false, start_date: null, occurrences: 1 }])
    expect(work!.fallbacks).toEqual([])
  })

  it('includes no feed address, whatever the source', () => {
    const args = setup()
    recordSyncStatus(args.db, 'family', { lastSuccessAt: NOW, eventCount: 1, etag: '"abc"', lastModified: 'Wed, 28 Oct 2026 11:00:00 GMT' })

    const text = JSON.stringify(statuses(args))

    expect(text).not.toContain('example.com')
    expect(text).not.toContain('secret-token')
    expect(text).not.toContain('abc')
  })
})

describe('displayStatuses', () => {
  const displays = [
    { id: 'hallway', name: 'Hallway', theme: 'light' as const, month_style: 'soft' as const },
    { id: 'kitchen', name: 'Kitchen', theme: 'dark' as const, month_style: 'classic' as const },
  ]
  const getState = (id: string) => ({ ...defaultDisplayState(), brightness: id === 'hallway' ? 80 : 20 })
  const counts = (id: string) => ({ display: id === 'hallway' ? 1 : 0, remote: id === 'hallway' ? 2 : 0 })

  it('combines each display\'s config, state, sockets and MQTT link, in config order', () => {
    const mqtt: MqttBridgeStatus[] = [
      { displayId: 'kitchen', state: 'connecting', lastError: 'connect ECONNREFUSED 10.0.0.2:1883' },
      { displayId: 'hallway', state: 'connected', lastError: null },
    ]

    expect(displayStatuses({ displays, getState, counts, mqtt })).toEqual([
      { id: 'hallway', name: 'Hallway', theme: 'light', month_style: 'soft', state: getState('hallway'), sockets: { display: 1, remote: 2 }, mqtt: 'connected', mqtt_error: null },
      { id: 'kitchen', name: 'Kitchen', theme: 'dark', month_style: 'classic', state: getState('kitchen'), sockets: { display: 0, remote: 0 }, mqtt: 'connecting', mqtt_error: 'connect ECONNREFUSED 10.0.0.2:1883' },
    ])
  })

  it('says off, with no error, when there is no MQTT bridge', () => {
    const result = displayStatuses({ displays, getState, counts, mqtt: undefined })

    expect(result.map(display => [display.mqtt, display.mqtt_error])).toEqual([['off', null], ['off', null]])
  })

  it('says off for a display the bridge has no connection for', () => {
    const result = displayStatuses({ displays, getState, counts, mqtt: [{ displayId: 'hallway', state: 'disconnected', lastError: 'Connection refused: Not authorized' }] })

    expect(result.map(display => display.mqtt)).toEqual(['disconnected', 'off'])
  })
})

describe('connectionsStatus', () => {
  const CHECKED = new Date('2026-10-28T11:59:30Z')
  const links = (...states: MqttBridgeStatus['state'][]): MqttBridgeStatus[] => states.map((state, i) => ({ displayId: `display-${i}`, state, lastError: null }))

  it('reports both as off when neither is set up', () => {
    expect(connectionsStatus({ mqtt: undefined, bridge: undefined, displayCount: 2, homeassistant: undefined })).toEqual({
      mqtt: { configured: false, broker: null, discovery: false, connected: 0, total: 0 },
      homeassistant: { configured: false, state: 'off', error: null, checked_at: null },
    })
  })

  it('names the broker by scheme, host and port, and counts the connected displays', () => {
    const { mqtt } = connectionsStatus({ mqtt: { url: 'mqtt://mosquitto:1883', discovery: true }, bridge: links('connected', 'connecting', 'connected'), displayCount: 3, homeassistant: undefined })

    expect(mqtt).toEqual({ configured: true, broker: 'mqtt://mosquitto:1883', discovery: true, connected: 2, total: 3 })
  })

  it('leaves the port off when the URL has none, and keeps the scheme', () => {
    const { mqtt } = connectionsStatus({ mqtt: { url: 'mqtts://broker.example.com', discovery: false }, bridge: links('disconnected'), displayCount: 1, homeassistant: undefined })

    expect(mqtt).toMatchObject({ broker: 'mqtts://broker.example.com', discovery: false, connected: 0, total: 1 })
  })

  it('falls back to the number of displays when configured but the bridge is not there', () => {
    const { mqtt } = connectionsStatus({ mqtt: { url: 'mqtt://mosquitto:1883', discovery: true }, bridge: undefined, displayCount: 2, homeassistant: undefined })

    expect(mqtt).toMatchObject({ connected: 0, total: 2 })
  })

  it('reports Home Assistant as ok with when it was checked', () => {
    const { homeassistant } = connectionsStatus({ mqtt: undefined, bridge: undefined, displayCount: 1, homeassistant: { ok: true, checkedAt: CHECKED } })

    expect(homeassistant).toEqual({ configured: true, state: 'ok', error: null, checked_at: '2026-10-28T11:59:30.000Z' })
  })

  it('reports Home Assistant as error with why', () => {
    const { homeassistant } = connectionsStatus({ mqtt: undefined, bridge: undefined, displayCount: 1, homeassistant: { ok: false, error: 'Home Assistant refused the access token (HTTP 401)', checkedAt: CHECKED } })

    expect(homeassistant).toEqual({ configured: true, state: 'error', error: 'Home Assistant refused the access token (HTTP 401)', checked_at: '2026-10-28T11:59:30.000Z' })
  })
})

describe('discoveryProblem', () => {
  it('is null when MQTT is set up with discovery on', () => {
    expect(discoveryProblem({ discovery: true })).toBeNull()
  })

  it('says MQTT is not set up when there is no mqtt block', () => {
    expect(discoveryProblem(undefined)).toMatch(/^MQTT is not set up/)
  })

  it('says discovery is turned off when it is', () => {
    expect(discoveryProblem({ discovery: false })).toMatch(/discovery is turned off/)
  })
})
