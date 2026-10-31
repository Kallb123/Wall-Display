import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import type { DisplaySettings } from '../../shared/display'
import { PIN_HEADER } from '../../shared/remote'
import type { PhotosSettingsStatus } from '../../shared/settings'

const appDir = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '')

const reason = (statusCode: number, message: string) => ({ statusCode, data: { message: expect.stringContaining(message) } })

/** The dev config up to its photos block, which each test writes for itself. */
function configWithout(): string {
  const dev = readFileSync(join(appDir, 'config.dev.yaml'), 'utf8').replaceAll('file:./', `file:${appDir}/`)
  const at = dev.indexOf('\n# Photo frame mode')
  expect(at).toBeGreaterThan(0)
  return dev.slice(0, at)
}

// The Photos tab's routes with an Immich that is not there and a folder that
// is, a Google block (accepted, ignored) and a PIN: nothing secret in any read,
// and "Refresh now" is a write.
describe('the settings Photos routes, with two sources, a PIN and secrets', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const API_KEY = 'immich-api-key-SECRET-0123456789'
  const GOOGLE_SECRET = 'google-client-SECRET-0123456789'
  const URL_PATH = 'proxy-path-SECRET'
  const PIN = '86427531'
  const right = { [PIN_HEADER]: PIN }
  const wrong = { [PIN_HEADER]: '11112222' }

  // A port that was free a moment ago, and has nothing on it now.
  const free = createServer()
  await new Promise<void>(resolve => free.listen(0, '127.0.0.1', resolve))
  const { port } = free.address() as AddressInfo
  await new Promise<void>(resolve => free.close(() => resolve()))

  const configFile = join(dir, 'config.yaml')
  writeFileSync(configFile, `${configWithout()}
remote:
  pin: "${PIN}"
photos:
  interval_seconds: 30
  landscape_only: true
  cache_max_mb: 64
  immich:
    url: http://127.0.0.1:${port}/${URL_PATH}
    api_key: ${API_KEY}
    mode: albums
    album_ids: ["0b6a1c52-7a3e-4a47-9c1d-1d8d4a8f1a01"]
  google:
    client_id: example.apps.googleusercontent.com
    client_secret: ${GOOGLE_SECRET}
  local:
    path: ${appDir}/test/fixtures/photos
`)

  await setup({
    browser: false,
    env: {
      WALLCAL_CONFIG_FILE: configFile,
      WALLCAL_DATA_DIR: join(dir, 'data'),
    },
  })

  it('POST /api/settings/photos/refresh answers 401 without the PIN and with a wrong one', async () => {
    await expect($fetch('/api/settings/photos/refresh', { method: 'POST' })).rejects.toMatchObject(reason(401, 'PIN required'))
    await expect($fetch('/api/settings/photos/refresh', { method: 'POST', headers: wrong })).rejects.toMatchObject(reason(401, 'Wrong PIN'))
  })

  it('POST /api/settings/photos/refresh lists the sources again and answers with the result', async () => {
    const status = await $fetch<PhotosSettingsStatus>('/api/settings/photos/refresh', { method: 'POST', headers: right })

    expect(status).toMatchObject({ configured: true })
    if (!status.configured) return
    expect(status.providers.map(provider => provider.id)).toEqual(['immich', 'local'])
    const [immich, local] = status.providers
    // The fixtures are four pictures, none of them rendered yet; Immich is not there.
    expect(local).toMatchObject({ id: 'local', mode: null, where: `${appDir}/test/fixtures/photos`, photos: 4, cached: 0, last_error: null })
    expect(new Date(local!.last_success_at!).toISOString()).toBe(local!.last_success_at)
    expect(immich).toMatchObject({ id: 'immich', mode: 'albums', where: `127.0.0.1:${port}`, photos: 0, cached: 0, last_success_at: null })
    expect(immich!.last_error).toMatch(/Immich could not be reached/)
  })

  it('GET /api/settings/photos is open and gives the sources, the rotation settings and the cache against its cap', async () => {
    const status = await $fetch<PhotosSettingsStatus>('/api/settings/photos')

    expect(status).toMatchObject({
      configured: true,
      interval_seconds: 30,
      landscape_only: true,
      cache_bytes: 0,
      cache_max_bytes: 64 * 1024 * 1024,
      google_ignored: true,
    })
  })

  it('counts what is cached once photos have been shown', async () => {
    // Immich is the default and is not there, so the display is put on the folder.
    await $fetch('/api/displays/hallway/commands', { method: 'POST', headers: right, body: { type: 'set_photo_source', photo_source: 'local' } })
    const shown = await $fetch<{ photo: { provider: string } | null }>('/api/photos/next?display=hallway')
    expect(shown.photo?.provider).toBe('local')

    const status = await $fetch<PhotosSettingsStatus>('/api/settings/photos')
    if (!status.configured) throw new Error('should be configured')
    expect(status.cache_bytes).toBeGreaterThan(0)
    const local = status.providers.find(provider => provider.id === 'local')!
    expect(local.cached).toBeGreaterThanOrEqual(1)
  })

  it('GET /api/displays lists the photo sources that are set up, in order, and not the ignored google', async () => {
    const displays = await $fetch<DisplaySettings[]>('/api/displays')

    expect(displays[0]!.photo_sources).toEqual(['immich', 'local'])
  })

  it('includes no API key, secret, Immich address or PIN in any GET response', async () => {
    for (const path of ['/api/settings/photos', '/api/displays', '/api/remote', '/api/settings/connections']) {
      const text = await (await fetch(path)).text()
      for (const secret of [API_KEY, GOOGLE_SECRET, URL_PATH, PIN, 'googleusercontent', 'http://127.0.0.1']) {
        expect(text, `${path} holds ${secret}`).not.toContain(secret)
      }
    }
    const refreshed = await (await fetch('/api/settings/photos/refresh', { method: 'POST', headers: right })).text()
    for (const secret of [API_KEY, GOOGLE_SECRET, URL_PATH, PIN]) expect(refreshed).not.toContain(secret)
  })
})

// With no photos block the tab has nothing to list, and "Refresh now" says so.
describe('the settings Photos routes, with no photos block', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const configFile = join(dir, 'config.yaml')
  writeFileSync(configFile, configWithout())

  await setup({
    browser: false,
    env: {
      WALLCAL_CONFIG_FILE: configFile,
      WALLCAL_DATA_DIR: join(dir, 'data'),
    },
  })

  it('GET /api/settings/photos says it is not set up', async () => {
    expect(await $fetch('/api/settings/photos')).toEqual({ configured: false })
  })

  it('POST /api/settings/photos/refresh answers 409 and says why', async () => {
    await expect($fetch('/api/settings/photos/refresh', { method: 'POST' })).rejects.toMatchObject(reason(409, 'Photos are not set up'))
  })

  it('GET /api/displays lists no photo source, so the remote leaves the Photo frame out', async () => {
    const displays = await $fetch<DisplaySettings[]>('/api/displays')

    expect(displays[0]!.photo_sources).toEqual([])
  })
})
