import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, setup } from '@nuxt/test-utils/e2e'
import type { DisplayState } from '../../shared/display'

// An mqtt block is in the config but nothing listens at its address: the app
// has to boot, serve and take commands as if MQTT were off.
describe('the app with an MQTT broker that is not there', async () => {
  const appDir = fileURLToPath(new URL('../..', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  // A port that was free a moment ago, and has nothing on it now.
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise<void>(resolve => server.close(() => resolve()))

  // The dev config, with its fixtures by absolute path (it is read from another folder here).
  const configFile = join(dir, 'config.yaml')
  const config = readFileSync(join(appDir, 'config.dev.yaml'), 'utf8').replaceAll('file:./', `file:${appDir}/`)
  writeFileSync(configFile, `${config}\nmqtt:\n  url: mqtt://127.0.0.1:${port}\n`)

  await setup({
    browser: false,
    env: {
      WALLCAL_CONFIG_FILE: configFile,
      WALLCAL_DATA_DIR: join(dir, 'data'),
    },
  })

  it('serves /api/health', async () => {
    expect(await $fetch<{ status: string }>('/api/health')).toMatchObject({ status: 'ok' })
  })

  it('accepts a command and answers with the new state', async () => {
    const state = await $fetch<DisplayState>('/api/displays/hallway/commands', { method: 'POST', body: { type: 'set_view', view: 'agenda' } })

    expect(state.view).toBe('agenda')
  })
})
