import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, setup, url } from '@nuxt/test-utils/e2e'
import type { DisplayState, ServerMessage } from '../../shared/display'

// The photo frame's rotation on the real server: while the display is on the
// photo view the server tells it to move on every `photos.interval_seconds`
// (5 here, the least the config allows), a `photo_next` command does so at once
// and starts the wait again, and leaving the view stops it. The tests build on
// each other and take a few real seconds.
describe('the photo rotation', async () => {
  const INTERVAL_MS = 5000
  const appDir = fileURLToPath(new URL('../..', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const configFile = join(dir, 'config.yaml')
  const devConfig = readFileSync(join(appDir, 'config.dev.yaml'), 'utf8')
  expect(devConfig).toContain('interval_seconds: 15')
  writeFileSync(configFile, devConfig
    .replaceAll('file:./', `file:${appDir}/`)
    .replace('interval_seconds: 15', 'interval_seconds: 5')
    .replace('path: ./test/fixtures/photos', `path: ${appDir}/test/fixtures/photos`))

  await setup({
    browser: false,
    env: {
      WALLCAL_CONFIG_FILE: configFile,
      WALLCAL_DATA_DIR: join(dir, 'data'),
    },
  })

  const command = (body: unknown) => $fetch<DisplayState>('/api/displays/hallway/commands', { method: 'POST', body: body as Record<string, unknown> })
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  /** A display socket that notes when each photo.next arrived. */
  function connect() {
    const socket = new WebSocket(url('/_ws?display=hallway&role=display').replace(/^http/, 'ws'))
    const nexts: number[] = []
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage
      if (message.type === 'photo.next') nexts.push(Date.now())
    })
    const opened = new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve())
      socket.addEventListener('error', () => reject(new Error('the socket did not open')))
    })
    return { socket, nexts, opened }
  }

  /** Resolves when `count` photo.next messages have arrived, or fails after `ms`. */
  async function until(display: ReturnType<typeof connect>, count: number, ms: number) {
    const deadline = Date.now() + ms
    while (display.nexts.length < count) {
      if (Date.now() > deadline) throw new Error(`expected ${count} photo.next, got ${display.nexts.length}`)
      await sleep(50)
    }
  }

  // Opened in the first test: the server is not running until the tests start.
  let display: ReturnType<typeof connect>

  it('sends nothing while the display is not on the photo view', async () => {
    display = connect()
    await display.opened
    await sleep(INTERVAL_MS + 1500)

    expect(display.nexts).toEqual([])
  })

  it('sends photo.next every interval once the display is on the photo view', async () => {
    const start = Date.now()
    expect((await command({ type: 'set_view', view: 'photo' })).view).toBe('photo')

    await until(display, 1, INTERVAL_MS + 3000)
    expect(display.nexts[0]! - start).toBeGreaterThanOrEqual(INTERVAL_MS - 500)

    await until(display, 2, INTERVAL_MS + 3000)
    expect(display.nexts[1]! - display.nexts[0]!).toBeGreaterThanOrEqual(INTERVAL_MS - 500)
  })

  it('sends one at once for a photo_next command, and waits a whole interval after it', async () => {
    const before = display.nexts.length
    // Half way through an interval, so a timer that was not restarted would fire in about 2.5 s.
    await sleep(INTERVAL_MS / 2)
    const sent = Date.now()

    await command({ type: 'photo_next' })
    await until(display, before + 1, 2000)
    expect(display.nexts[before]! - sent).toBeLessThan(2000)

    await sleep(INTERVAL_MS - 1500)
    expect(display.nexts).toHaveLength(before + 1)
    await until(display, before + 2, 3000)
    expect(display.nexts[before + 1]! - display.nexts[before]!).toBeGreaterThanOrEqual(INTERVAL_MS - 500)
  })

  it('stops when the display leaves the photo view', async () => {
    await command({ type: 'set_view', view: 'agenda' })
    await sleep(100)
    const count = display.nexts.length

    await sleep(INTERVAL_MS + 1500)

    expect(display.nexts).toHaveLength(count)
    display.socket.close()
  })
})
