import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import type { DisplayState } from '../../shared/display'
import { builtApp } from '../helpers/builtApp'
import { startFakeHomeAssistant } from '../helpers/fakeHaWebSocket'

// The doorbell: a trigger in the config listens to Home Assistant over its
// WebSocket API, and when the doorbell rings the wall shows the front door's
// camera, waking the screen to do it.

describe('Home Assistant triggers', async () => {
  const appDir = fileURLToPath(new URL('../..', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const token = 'ha-e2e-token-0123456789abcdef'
  const homeAssistant = await startFakeHomeAssistant(token)
  afterAll(() => homeAssistant.close())

  const devConfig = readFileSync(join(appDir, 'config.dev.yaml'), 'utf8').replaceAll('file:./', `file:${appDir}/`)
  const configFile = join(dir, 'config.yaml')
  writeFileSync(configFile, `${devConfig}
homeassistant:
  url: http://127.0.0.1:${homeAssistant.port}
  token: ${token}

cameras:
  - id: front-door
    name: Front door
    url: http://go2rtc.local:1984/stream.html?src=front_door

triggers:
  - id: doorbell
    when:
      entity_id: binary_sensor.front_doorbell
      to: "on"
    actions:
      - type: set_camera
        camera: front-door
        seconds: 45
      - type: set_overlay
        overlay: { text: Someone is at the door, icon: bell, ttl: 45 }
`)

  await setup({
    ...builtApp,
    env: {
      WALLCAL_CONFIG_FILE: configFile,
      WALLCAL_DATA_DIR: join(dir, 'data'),
    },
  })

  const stateOf = () => $fetch<DisplayState>('/api/displays/hallway/state')

  async function waitFor(check: (state: DisplayState) => boolean): Promise<DisplayState> {
    const deadline = Date.now() + 30_000
    for (;;) {
      const state = await stateOf()
      if (check(state)) return state
      if (Date.now() > deadline) throw new Error(`the state never matched: ${JSON.stringify(state)}`)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  it('logs in with the token and subscribes to the trigger', async () => {
    await homeAssistant.subscribed(1)

    expect(homeAssistant.received[0]).toEqual({ type: 'auth', access_token: token })
    expect([...homeAssistant.subscriptions.values()]).toEqual([{ platform: 'state', entity_id: ['binary_sensor.front_doorbell'], to: ['on'] }])
  })

  it('shows the camera and the message when the doorbell rings, waking the screen', async () => {
    await homeAssistant.subscribed(1)
    await $fetch('/api/displays/hallway/commands', { method: 'POST', body: { type: 'set_screen', screen: 'off' } })

    homeAssistant.fireState('binary_sensor.front_doorbell', 'on')

    const state = await waitFor(next => next.camera !== null)
    expect(state.screen).toBe('on')
    expect(state.camera).toMatchObject({ id: 'front-door', name: 'Front door', url: 'http://go2rtc.local:1984/stream.html?src=front_door', kind: 'page', restore_screen: true })
    expect(Date.parse(state.camera!.until) - Date.now()).toBeGreaterThan(30_000)
    expect(state.overlay).toMatchObject({ text: 'Someone is at the door', icon: 'bell' })
  })

  it('takes the camera down on request, and puts the screen back to sleep', async () => {
    await waitFor(next => next.camera !== null)

    const state = await $fetch<DisplayState>('/api/displays/hallway/commands', { method: 'POST', body: { type: 'set_camera', camera: null } })

    expect(state).toMatchObject({ camera: null, screen: 'off' })
  })

  it('refuses a camera that is not in the config', async () => {
    const response = await fetch('/api/displays/hallway/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'set_camera', camera: 'attic' }) })

    expect(response.status).toBe(404)
  })
})
