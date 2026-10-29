import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, fetch, setup, url } from '@nuxt/test-utils/e2e'
import { PIN_HEADER } from '../../shared/remote'
import type { CalendarStatus, ConnectionsStatus, DiscoveryResult, DisplayStatus } from '../../shared/settings'

const appDir = fileURLToPath(new URL('../..', import.meta.url))

/** The dev config, with its fixtures by absolute path (it is read from another folder here), and a window wide enough that October 2026 stays inside it. */
function devConfig(): string {
  return `${readFileSync(join(appDir, 'config.dev.yaml'), 'utf8').replaceAll('file:./', `file:${appDir}/`)}\nsync:\n  months_back: 60\n  months_ahead: 60\n`
}

const reason = (statusCode: number, message: string) => ({ statusCode, data: { message: expect.stringContaining(message) } })

// The settings pages' read routes, against the dev config: no MQTT, no Home
// Assistant, no PIN.
describe('the settings API, with nothing else set up', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const configFile = join(dir, 'config.yaml')
  writeFileSync(configFile, devConfig())

  await setup({
    browser: false,
    env: {
      WALLCAL_CONFIG_FILE: configFile,
      WALLCAL_DATA_DIR: join(dir, 'data'),
    },
  })

  it('GET /api/settings/calendars lists each calendar, in config order, with its sync status', async () => {
    // So the status is there to read whatever the boot sync got to.
    await $fetch('/api/refresh', { method: 'POST' })

    const calendars = await $fetch<CalendarStatus[]>('/api/settings/calendars')

    expect(calendars.map(calendar => calendar.id)).toEqual(['family', 'dad-work'])
    expect(calendars[0]).toMatchObject({
      id: 'family',
      name: 'Family',
      person: { id: 'home', name: 'Household', initial: 'H', colour: '#D9A93F' },
      detect_people: true,
      detect_in: ['title', 'description'],
      source_type: 'ics',
      poll_seconds: 120,
      syncing: true,
      last_error: null,
    })
    expect(calendars[1]).toMatchObject({ id: 'dad-work', name: 'Dad\'s work', person: { id: 'dad', name: 'Dad' } })
    for (const calendar of calendars) {
      expect(new Date(calendar.last_attempt_at!).toISOString()).toBe(calendar.last_attempt_at)
      expect(new Date(calendar.last_success_at!).toISOString()).toBe(calendar.last_success_at)
      expect(calendar.event_count).toBeGreaterThan(0)
      expect(Array.isArray(calendar.fallbacks)).toBe(true)
      for (const fallback of calendar.fallbacks) {
        expect(fallback).toEqual({ title: expect.any(String), start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), all_day: expect.any(Boolean), start_date: expect.toBeOneOf([null, expect.any(String)]), occurrences: expect.any(Number) })
      }
    }
  })

  it('GET /api/settings/displays gives each display\'s state, sockets and MQTT link', async () => {
    const displays = await $fetch<DisplayStatus[]>('/api/settings/displays')

    expect(displays).toEqual([
      {
        id: 'hallway',
        name: 'Hallway',
        theme: 'light',
        month_style: 'soft',
        state: expect.objectContaining({ view: 'month', screen: 'on' }),
        sockets: { display: 0, remote: 0 },
        mqtt: 'off',
        mqtt_error: null,
      },
    ])
  })

  it('GET /api/settings/displays counts the sockets that are open, by role', async () => {
    const socket = new WebSocket(url('/_ws?display=hallway&role=remote').replace(/^http/, 'ws'))
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve())
      socket.addEventListener('error', () => reject(new Error('the socket did not open')))
    })

    const [open] = await $fetch<DisplayStatus[]>('/api/settings/displays')
    expect(open!.sockets).toEqual({ display: 0, remote: 1 })

    socket.close()
    const deadline = Date.now() + 10_000
    let closed = open!
    while (closed.sockets.remote > 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100))
      closed = (await $fetch<DisplayStatus[]>('/api/settings/displays'))[0]!
    }
    expect(closed.sockets).toEqual({ display: 0, remote: 0 })
  })

  it('GET /api/settings/connections says MQTT and Home Assistant are off', async () => {
    expect(await $fetch<ConnectionsStatus>('/api/settings/connections')).toEqual({
      mqtt: { configured: false, broker: null, discovery: false, connected: 0, total: 0 },
      homeassistant: { configured: false, state: 'off', error: null, checked_at: null },
    })
  })

  it('POST /api/settings/discovery answers 409 and says why when MQTT is not set up', async () => {
    await expect($fetch('/api/settings/discovery', { method: 'POST' })).rejects.toMatchObject(reason(409, 'MQTT is not set up'))
  })

  it('includes no feed address in any response', async () => {
    for (const path of ['/api/settings/calendars', '/api/settings/displays', '/api/settings/connections']) {
      const text = await (await fetch(path)).text()
      expect(text, path).not.toContain('file:')
      expect(text, path).not.toContain('.ics')
      expect(text, path).not.toContain(appDir)
    }
  })
})

// A Home Assistant and an MQTT broker that are in the config but not there, and
// a PIN: the reads still answer, with the failures in words, and nothing secret.
describe('the settings API, with Home Assistant and a broker that are not there, and a PIN', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const TOKEN = 'ha-token-SECRET-0123456789abcdef'
  const USERNAME = 'mqtt-user-SECRET'
  const PASSWORD = 'mqtt-password-SECRET'
  const PIN = '86427531'
  const right = { [PIN_HEADER]: PIN }
  const wrong = { [PIN_HEADER]: '11112222' }

  // A port that was free a moment ago, and has nothing on it now.
  const free = createServer()
  await new Promise<void>(resolve => free.listen(0, '127.0.0.1', resolve))
  const { port } = free.address() as AddressInfo
  await new Promise<void>(resolve => free.close(() => resolve()))

  const configFile = join(dir, 'config.yaml')
  const extra = [
    'homeassistant:',
    `  url: http://127.0.0.1:9`,
    `  token: ${TOKEN}`,
    'mqtt:',
    `  url: mqtt://127.0.0.1:${port}`,
    `  username: ${USERNAME}`,
    `  password: ${PASSWORD}`,
    'remote:',
    `  pin: "${PIN}"`,
  ].join('\n')
  writeFileSync(configFile, `${devConfig()}\n${extra}\n`)

  await setup({
    browser: false,
    env: {
      WALLCAL_CONFIG_FILE: configFile,
      WALLCAL_DATA_DIR: join(dir, 'data'),
    },
  })

  it('GET /api/settings/connections reads Home Assistant as an error and the broker as not connected, without a PIN', async () => {
    const connections = await $fetch<ConnectionsStatus>('/api/settings/connections')

    expect(connections.homeassistant).toEqual({ configured: true, state: 'error', error: 'could not connect', checked_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) })
    expect(connections.mqtt).toEqual({ configured: true, broker: `mqtt://127.0.0.1:${port}`, discovery: true, connected: 0, total: 1 })
  })

  it('GET /api/settings/connections reuses the Home Assistant check instead of asking every time', async () => {
    const first = await $fetch<ConnectionsStatus>('/api/settings/connections')
    const second = await $fetch<ConnectionsStatus>('/api/settings/connections')

    expect(second.homeassistant.checked_at).toBe(first.homeassistant.checked_at)
  })

  it('GET /api/settings/displays reads the display\'s MQTT link as not connected, with an error that holds no secret', async () => {
    const [hallway] = await $fetch<DisplayStatus[]>('/api/settings/displays')

    expect(['connecting', 'disconnected']).toContain(hallway!.mqtt)
    expect(hallway!.mqtt_error === null || typeof hallway!.mqtt_error === 'string').toBe(true)
  })

  it('POST /api/settings/discovery answers 401 without the PIN and with a wrong one', async () => {
    await expect($fetch('/api/settings/discovery', { method: 'POST' })).rejects.toMatchObject(reason(401, 'PIN required'))
    await expect($fetch('/api/settings/discovery', { method: 'POST', headers: wrong })).rejects.toMatchObject(reason(401, 'Wrong PIN'))
  })

  it('POST /api/settings/discovery publishes for no one when no display is connected to the broker', async () => {
    expect(await $fetch<DiscoveryResult>('/api/settings/discovery', { method: 'POST', headers: right })).toEqual({ republished: [] })
  })

  it('includes no token, password, PIN or feed address in any GET response', async () => {
    const paths = ['/api/settings/calendars', '/api/settings/displays', '/api/settings/connections', '/api/displays', '/api/displays/hallway/state', '/api/remote', '/api/health', '/api/events?from=2026-10-01&to=2026-11-30']
    for (const path of paths) {
      const response = await fetch(path)
      expect(response.status, path).toBe(200)
      const text = await response.text()
      for (const secret of [TOKEN, USERNAME, PASSWORD, PIN, 'file:', '.ics', appDir]) expect(text, `${path} holds ${secret}`).not.toContain(secret)
    }
  })

  it('includes none of them in a refusal either', async () => {
    const response = await fetch('/api/settings/discovery', { method: 'POST', headers: wrong })

    expect(response.status).toBe(401)
    const text = await response.text()
    for (const secret of [TOKEN, USERNAME, PASSWORD, PIN]) expect(text).not.toContain(secret)
  })
})
