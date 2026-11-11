import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, fetch, setup, url } from '@nuxt/test-utils/e2e'
import type { DisplaySettings, ServerMessage } from '../../shared/display'
import { PIN_HEADER } from '../../shared/remote'
import type { PhotosSettingsStatus, PreferencesStatus } from '../../shared/settings'
import { builtApp } from '../helpers/builtApp'

const appDir = fileURLToPath(new URL('../..', import.meta.url))
const PIN = '2468'
const right = { [PIN_HEADER]: PIN }
const wrong = { [PIN_HEADER]: '1111' }

const reason = (statusCode: number, message: string) => ({ statusCode, data: { message: expect.stringContaining(message) } })

/** The messages a socket gets, collected as they come, and a way to wait for one. */
function listen(path: string) {
  const messages: ServerMessage[] = []
  const socket = new WebSocket(url(path).replace(/^http/, 'ws'))
  socket.addEventListener('message', event => messages.push(JSON.parse(String(event.data)) as ServerMessage))
  const opened = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', () => reject(new Error('the socket did not open')))
  })
  const settingsMessages = () => messages.filter((message): message is Extract<ServerMessage, { type: 'settings.updated' }> => message.type === 'settings.updated')
  async function waitForSettings(count: number): Promise<void> {
    const deadline = Date.now() + 10_000
    while (settingsMessages().length < count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50))
    expect(settingsMessages().length).toBeGreaterThanOrEqual(count)
  }
  return { socket, opened, settingsMessages, waitForSettings }
}

// The dev config (one display, a photos block, no alarm, no MQTT) with a PIN.
// One server for the whole file, so the saved preferences carry from test to
// test, in order.
describe('the preferences API', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const configFile = join(dir, 'config.yaml')
  writeFileSync(configFile, `${readFileSync(join(appDir, 'config.dev.yaml'), 'utf8').replaceAll('file:./', `file:${appDir}/`).replaceAll('path: ./test', `path: ${appDir}/test`)}\nremote:\n  pin: "${PIN}"\n`)

  await setup({
    ...builtApp,
    env: {
      WALLCAL_CONFIG_FILE: configFile,
      WALLCAL_DATA_DIR: join(dir, 'data'),
    },
  })

  it('GET /api/settings/preferences gives what is in force, the config\'s values and nothing changed, without a PIN', async () => {
    const status = await $fetch<PreferencesStatus>('/api/settings/preferences')

    expect(status.displays).toEqual([
      {
        id: 'hallway',
        name: 'Hallway',
        values: { theme: 'light', month_style: 'soft', week_start: 'monday', month_return_minutes: 15, week_hours: { from: 7, to: 21 }, day_parts: { afternoon: 12, evening: 17 }, weather_on_dates: { month: true, week: true, week_parts: true, agenda: true }, burn_in: true, motion: 'off', night_text: 'none', orientation: 'auto' },
        config: { theme: 'light', month_style: 'soft', week_start: 'monday', month_return_minutes: 15, week_hours: { from: 7, to: 21 }, day_parts: { afternoon: 12, evening: 17 }, weather_on_dates: { month: true, week: true, week_parts: true, agenda: true }, burn_in: true, motion: 'off', night_text: 'none', orientation: 'auto' },
        changed: [],
      },
    ])
    expect(status.shared.values).toEqual({
      photo_interval_seconds: 15,
      off_after_minutes: 10,
      quiet_hours: null,
      night_action: 'none',
      night_below_lux: null,
      night_above_lux: null,
      min_step: 5,
      smoothing_seconds: 30,
    })
    expect(status.shared.config).toEqual(status.shared.values)
    expect(status.shared.changed).toEqual([])
    expect(status).toMatchObject({ photos_configured: true, alarm_configured: false, mqtt_configured: false })
  })

  it('PUT /api/settings/preferences/displays/:id answers 401 without the PIN and with a wrong one, and saves nothing', async () => {
    const options = { method: 'PUT', body: { set: { theme: 'dark' } } } as const

    await expect($fetch('/api/settings/preferences/displays/hallway', options)).rejects.toMatchObject(reason(401, 'PIN required'))
    await expect($fetch('/api/settings/preferences/displays/hallway', { ...options, headers: wrong })).rejects.toMatchObject(reason(401, 'Wrong PIN'))
    await expect($fetch('/api/settings/preferences/shared', { method: 'PUT', body: { set: { min_step: 9 } } })).rejects.toMatchObject(reason(401, 'PIN required'))

    expect((await $fetch<PreferencesStatus>('/api/settings/preferences')).displays[0]!.changed).toEqual([])
  })

  it('PUT .../displays/:id saves a theme, and GET /api/displays and /api/settings/displays show it at once', async () => {
    const status = await $fetch<PreferencesStatus>('/api/settings/preferences/displays/hallway', {
      method: 'PUT',
      headers: right,
      body: { set: { theme: 'dark', week_hours: { from: 6, to: 22 }, month_return_minutes: 5 } },
    })

    expect(status.displays[0]).toMatchObject({
      values: { theme: 'dark', week_hours: { from: 6, to: 22 }, month_return_minutes: 5, week_start: 'monday' },
      config: { theme: 'light', week_hours: { from: 7, to: 21 }, month_return_minutes: 15 },
      changed: ['theme', 'month_return_minutes', 'week_hours'],
    })
    expect(await $fetch<PreferencesStatus>('/api/settings/preferences')).toEqual(status)

    const [display] = await $fetch<DisplaySettings[]>('/api/displays')
    expect(display).toMatchObject({ id: 'hallway', theme: 'dark', week_hours: { from: 6, to: 22 }, photo_sources: ['local'] })
    const [overview] = await $fetch<{ theme: string }[]>('/api/settings/displays')
    expect(overview!.theme).toBe('dark')
  })

  it('PUT .../displays/:id saves an orientation, and GET /api/displays shows it', async () => {
    const status = await $fetch<PreferencesStatus>('/api/settings/preferences/displays/hallway', { method: 'PUT', headers: right, body: { set: { orientation: 'portrait' } } })

    expect(status.displays[0]).toMatchObject({ values: { orientation: 'portrait' }, config: { orientation: 'auto' } })
    expect((await $fetch<DisplaySettings[]>('/api/displays'))[0]).toMatchObject({ orientation: 'portrait' })

    await $fetch('/api/settings/preferences/displays/hallway', { method: 'PUT', headers: right, body: { reset: ['orientation'] } })
    expect((await $fetch<DisplaySettings[]>('/api/displays'))[0]).toMatchObject({ orientation: 'auto' })
  })

  it('PUT .../displays/:id with reset goes back to the config\'s value', async () => {
    const status = await $fetch<PreferencesStatus>('/api/settings/preferences/displays/hallway', { method: 'PUT', headers: right, body: { reset: ['theme', 'week_hours'] } })

    expect(status.displays[0]).toMatchObject({ values: { theme: 'light', week_hours: { from: 7, to: 21 }, month_return_minutes: 5 }, changed: ['month_return_minutes'] })
    expect((await $fetch<DisplaySettings[]>('/api/displays'))[0]!.theme).toBe('light')
  })

  it('PUT .../displays/:id saves day_parts, and GET /api/displays shows them', async () => {
    const status = await $fetch<PreferencesStatus>('/api/settings/preferences/displays/hallway', { method: 'PUT', headers: right, body: { set: { day_parts: { afternoon: 11, evening: 18 } } } })

    expect(status.displays[0]).toMatchObject({ values: { day_parts: { afternoon: 11, evening: 18 } }, config: { day_parts: { afternoon: 12, evening: 17 } }, changed: expect.arrayContaining(['day_parts']) })
    expect((await $fetch<DisplaySettings[]>('/api/displays'))[0]).toMatchObject({ day_parts: { afternoon: 11, evening: 18 } })

    await $fetch('/api/settings/preferences/displays/hallway', { method: 'PUT', headers: right, body: { reset: ['day_parts'] } })
    expect((await $fetch<DisplaySettings[]>('/api/displays'))[0]).toMatchObject({ day_parts: { afternoon: 12, evening: 17 } })
  })

  it('PUT .../displays/:id saves weather_on_dates, and GET /api/displays shows it', async () => {
    const off = { month: true, week: false, week_parts: true, agenda: true }
    const status = await $fetch<PreferencesStatus>('/api/settings/preferences/displays/hallway', { method: 'PUT', headers: right, body: { set: { weather_on_dates: off } } })

    expect(status.displays[0]).toMatchObject({ values: { weather_on_dates: off }, config: { weather_on_dates: { month: true, week: true, week_parts: true, agenda: true } }, changed: expect.arrayContaining(['weather_on_dates']) })
    expect((await $fetch<DisplaySettings[]>('/api/displays'))[0]).toMatchObject({ weather_on_dates: off })

    await $fetch('/api/settings/preferences/displays/hallway', { method: 'PUT', headers: right, body: { reset: ['weather_on_dates'] } })
    expect((await $fetch<DisplaySettings[]>('/api/displays'))[0]).toMatchObject({ weather_on_dates: { month: true, week: true, week_parts: true, agenda: true } })
  })

  it('PUT .../displays/:id answers 404 for an unknown display, and 400 with data.fields for a bad body, saving nothing', async () => {
    await expect($fetch('/api/settings/preferences/displays/garage', { method: 'PUT', headers: right, body: { set: { theme: 'dark' } } })).rejects.toMatchObject(reason(404, 'Unknown display'))

    const cases: [unknown, Record<string, unknown>][] = [
      [{ set: { theme: 'blue' } }, { theme: expect.any(String) }],
      [{ set: { orientation: 'sideways' } }, { orientation: expect.stringContaining('auto, landscape, portrait') }],
      [{ set: { colour: 'red' } }, { colour: expect.any(String) }],
      [{ set: { month_return_minutes: 5000 } }, { month_return_minutes: expect.any(String) }],
      [{ set: { week_hours: { from: 12, to: 8 } } }, { week_hours: expect.stringContaining('before') }],
      [{ set: { day_parts: { afternoon: 17, evening: 12 } } }, { day_parts: expect.stringContaining('before') }],
      [{ set: { weather_on_dates: { month: 'yes' } } }, { weather_on_dates: 'month must be a boolean' }],
      [{ set: { theme: 'dark' }, reset: ['theme'] }, { theme: expect.stringContaining('both') }],
      [{ set: { night_text: 'next_alarm' } }, { night_text: expect.stringContaining('alarm') }],
      [[1], { _: expect.any(String) }],
    ]
    for (const [body, fields] of cases) {
      await expect($fetch('/api/settings/preferences/displays/hallway', { method: 'PUT', headers: right, body: body as object }), JSON.stringify(body)).rejects.toMatchObject({ statusCode: 400, data: { data: { fields } } })
    }

    const status = await $fetch<PreferencesStatus>('/api/settings/preferences')
    expect(status.displays[0]!.changed).toEqual(['month_return_minutes'])
    expect(status.displays[0]!.values.theme).toBe('light')
  })

  it('PUT .../shared saves the policies and the photo interval, and /api/settings/photos shows the interval', async () => {
    const status = await $fetch<PreferencesStatus>('/api/settings/preferences/shared', {
      method: 'PUT',
      headers: right,
      body: { set: { photo_interval_seconds: 25, off_after_minutes: 4, quiet_hours: { from: '22:00', to: '06:30' }, night_action: 'night_view', night_below_lux: 3, night_above_lux: null } },
    })

    expect(status.shared.values).toMatchObject({ photo_interval_seconds: 25, off_after_minutes: 4, quiet_hours: { from: '22:00', to: '06:30' }, night_action: 'night_view', night_below_lux: 3, night_above_lux: null })
    expect(status.shared.config.photo_interval_seconds).toBe(15)
    expect(status.shared.changed).toEqual(['photo_interval_seconds', 'off_after_minutes', 'quiet_hours', 'night_action', 'night_below_lux', 'night_above_lux'])

    const photos = await $fetch<PhotosSettingsStatus>('/api/settings/photos')
    expect(photos.interval_seconds).toBe(25)
  })

  it('PUT .../shared answers 400 with data.fields for a bad body or a broken cross-field rule', async () => {
    const cases: [unknown, Record<string, unknown>][] = [
      [{ set: { photo_interval_seconds: 1 } }, { photo_interval_seconds: expect.any(String) }],
      [{ set: { quiet_hours: { from: '08:00', to: '08:00' } } }, { quiet_hours: expect.stringContaining('must differ') }],
      [{ set: { night_above_lux: 2 } }, { night_above_lux: expect.stringContaining('more than night_below_lux') }],
      [{ set: { night_below_lux: null } }, { night_below_lux: expect.stringContaining('night_action is night_view') }],
      [{ set: { curve: [] } }, { curve: expect.any(String) }],
      [{ set: { min_step: 9 }, reset: ['min_step'] }, { min_step: expect.stringContaining('both') }],
    ]
    for (const [body, fields] of cases) {
      const error = await $fetch('/api/settings/preferences/shared', { method: 'PUT', headers: right, body: body as object }).catch((caught: unknown) => caught)
      expect(error, JSON.stringify(body)).toMatchObject({ statusCode: 400, data: { data: { fields }, message: expect.stringContaining('not saved') } })
    }

    expect((await $fetch<PreferencesStatus>('/api/settings/preferences')).shared.values.min_step).toBe(5)
  })

  it('keeps no secret and no PIN in any preferences response', async () => {
    for (const path of ['/api/settings/preferences', '/api/displays']) {
      const text = await (await fetch(path)).text()
      for (const secret of [PIN, 'file:', '.ics', appDir]) expect(text, `${path} holds ${secret}`).not.toContain(secret)
    }
  })

  it('sends a socket the display\'s settings on connect, and again when they are saved, to display and remote alike', async () => {
    const wall = listen('/_ws?display=hallway&role=display')
    const remote = listen('/_ws?display=hallway&role=remote')
    await Promise.all([wall.opened, remote.opened])
    await Promise.all([wall.waitForSettings(1), remote.waitForSettings(1)])
    expect(wall.settingsMessages()[0]).toMatchObject({ display_id: 'hallway', settings: { id: 'hallway', theme: 'light', timezone: 'Europe/London' } })

    await $fetch('/api/settings/preferences/displays/hallway', { method: 'PUT', headers: right, body: { set: { theme: 'dark', burn_in: false } } })
    await Promise.all([wall.waitForSettings(2), remote.waitForSettings(2)])
    for (const peer of [wall, remote]) {
      expect(peer.settingsMessages()[1]).toMatchObject({ display_id: 'hallway', settings: { theme: 'dark', burn_in: false } })
    }

    // A save that changes nothing in force sends nothing.
    await $fetch('/api/settings/preferences/displays/hallway', { method: 'PUT', headers: right, body: { set: { theme: 'dark' } } })
    // And a shared change only reaches the sockets through the services, not as a display message.
    await $fetch('/api/settings/preferences/shared', { method: 'PUT', headers: right, body: { set: { min_step: 7 } } })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(wall.settingsMessages()).toHaveLength(2)

    // A new connection starts from what is saved.
    const late = listen('/_ws?display=hallway&role=display')
    await late.opened
    await late.waitForSettings(1)
    expect(late.settingsMessages()[0]).toMatchObject({ settings: { theme: 'dark', burn_in: false } })

    for (const peer of [wall, remote, late]) peer.socket.close()
  })

  it('GET /display.webmanifest follows the theme saved on the settings page', async () => {
    await $fetch('/api/settings/preferences/displays/hallway', { method: 'PUT', headers: right, body: { set: { theme: 'dark' } } })
    expect(await $fetch('/display.webmanifest?id=hallway')).toMatchObject({ background_color: '#2e2b25', theme_color: '#2e2b25' })

    await $fetch('/api/settings/preferences/displays/hallway', { method: 'PUT', headers: right, body: { reset: ['theme'] } })
    expect(await $fetch('/display.webmanifest?id=hallway')).toMatchObject({ background_color: '#f5ead8', theme_color: '#f5ead8' })
  })
})
