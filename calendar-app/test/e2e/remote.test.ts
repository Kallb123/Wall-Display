import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import type { DisplayState } from '../../shared/display'
import { PIN_HEADER } from '../../shared/remote'
import type { RemoteInfo } from '../../shared/remote'

// The same server as control.test.ts, with `remote.pin` set. Every request here
// comes from one address, so the wrong PINs are kept well under the lockout
// (a right PIN resets the count, and no run of wrong ones here is over six).
describe('the remote PIN', async () => {
  const appDir = fileURLToPath(new URL('../..', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const configFile = join(dir, 'config.yaml')
  writeFileSync(configFile, `${readFileSync(join(appDir, 'config.dev.yaml'), 'utf8').replaceAll('file:./', `file:${appDir}/`)}\nremote:\n  pin: "2468"\n`)

  await setup({
    browser: false,
    env: {
      WALLCAL_CONFIG_FILE: configFile,
      WALLCAL_DATA_DIR: join(dir, 'data'),
    },
  })

  const reason = (statusCode: number, message: string) => ({ statusCode, data: { message } })
  const right = { [PIN_HEADER]: '2468' }
  const wrong = { [PIN_HEADER]: '1357' }
  const command = (id: string, headers?: Record<string, string>) => $fetch<DisplayState>(`/api/displays/${id}/commands`, { method: 'POST', body: { type: 'set_view', view: 'agenda' }, headers })
  const refresh = (headers?: Record<string, string>) => $fetch<{ calendars: unknown[] }>('/api/refresh', { method: 'POST', headers })

  it('GET /api/remote says a PIN is needed, and never what it is', async () => {
    const info = await $fetch<RemoteInfo>('/api/remote')

    expect(info).toEqual({ pin_required: true })
  })

  it('POST /api/displays/:id/commands answers 401 without the PIN, and with a wrong one', async () => {
    await expect(command('hallway')).rejects.toMatchObject(reason(401, 'PIN required'))
    await expect(command('hallway', wrong)).rejects.toMatchObject(reason(401, 'Wrong PIN'))
    expect((await $fetch<DisplayState>('/api/displays/hallway/state')).view).toBe('month')
  })

  it('POST /api/displays/:id/commands applies the command with the right PIN', async () => {
    const state = await command('hallway', right)

    expect(state.view).toBe('agenda')
    await $fetch('/api/displays/hallway/commands', { method: 'POST', body: { type: 'set_view', view: 'month' }, headers: right })
  })

  it('POST /api/displays/:id/commands asks for the PIN before it says whether the display exists', async () => {
    await expect(command('garage')).rejects.toMatchObject(reason(401, 'PIN required'))
    await expect(command('garage', right)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('POST /api/refresh answers 401 without the PIN and with a wrong one, and syncs with the right one', async () => {
    await expect(refresh()).rejects.toMatchObject(reason(401, 'PIN required'))
    await expect(refresh(wrong)).rejects.toMatchObject(reason(401, 'Wrong PIN'))
    expect((await refresh(right)).calendars.length).toBeGreaterThan(0)
  })

  it('leaves reading the state open', async () => {
    expect(await $fetch<DisplayState>('/api/displays/hallway/state')).toMatchObject({ view: 'month' })
    expect(await $fetch('/api/displays')).toHaveLength(1)
  })

  it('guards every write under /api, whether or not the route exists', async () => {
    const post = (path: string, headers?: Record<string, string>) => $fetch(path, { method: 'POST', headers })

    await expect(post('/api/not-a-route')).rejects.toMatchObject(reason(401, 'PIN required'))
    await expect(post('/api/not-a-route', wrong)).rejects.toMatchObject(reason(401, 'Wrong PIN'))
    await expect($fetch('/api/refresh', { method: 'PUT' })).rejects.toMatchObject(reason(401, 'PIN required'))
    await expect($fetch('/api/displays/hallway/state', { method: 'DELETE' })).rejects.toMatchObject(reason(401, 'PIN required'))
    // With the PIN it gets past the guard, to whatever answers for a path nobody has a route for.
    expect((await fetch('/api/not-a-route', { method: 'POST', headers: right })).status).not.toBe(401)
  })

  it('does not ask for the PIN on a GET of a path that does not exist', async () => {
    expect((await fetch('/api/not-a-route')).status).not.toBe(401)
  })

  it('counts a wrong PIN once, not once for the middleware and again for the route', async () => {
    // The lockout is at ten wrong PINs, and the right one before this reset the count. Six would be twelve if each were counted twice.
    for (let i = 0; i < 6; i++) await expect(command('hallway', wrong)).rejects.toMatchObject(reason(401, 'Wrong PIN'))

    await expect(command('hallway', right)).resolves.toMatchObject({ view: 'agenda' })
    await $fetch('/api/displays/hallway/commands', { method: 'POST', body: { type: 'set_view', view: 'month' }, headers: right })
  })

  it('POST /api/settings/discovery answers 401 without the PIN, and 409 with it when MQTT is not set up', async () => {
    await expect($fetch('/api/settings/discovery', { method: 'POST' })).rejects.toMatchObject(reason(401, 'PIN required'))
    await expect($fetch('/api/settings/discovery', { method: 'POST', headers: right })).rejects.toMatchObject({ statusCode: 409, data: { message: expect.stringContaining('MQTT is not set up') } })
  })

  it('leaves the settings reads open', async () => {
    expect(await $fetch<unknown[]>('/api/settings/calendars')).toHaveLength(2)
    expect(await $fetch<unknown[]>('/api/settings/displays')).toHaveLength(1)
    expect(await $fetch('/api/settings/connections')).toMatchObject({ mqtt: { configured: false } })
  })

  it('POST /api/remote/pin answers 204 for the right PIN and 401 otherwise', async () => {
    const response = await fetch('/api/remote/pin', { method: 'POST', headers: right })
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')

    await expect($fetch('/api/remote/pin', { method: 'POST' })).rejects.toMatchObject(reason(401, 'PIN required'))
    await expect($fetch('/api/remote/pin', { method: 'POST', headers: wrong })).rejects.toMatchObject(reason(401, 'Wrong PIN'))
  })

  it('serves the manifest without a PIN', async () => {
    expect(await $fetch('/remote.webmanifest?id=hallway')).toMatchObject({ short_name: 'Hallway' })
  })
})
