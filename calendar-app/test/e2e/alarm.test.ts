import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, setup, url } from '@nuxt/test-utils/e2e'
import type { DisplaySettings, ServerMessage } from '../../shared/display'

describe('the next alarm from Home Assistant', async () => {
  const appDir = fileURLToPath(new URL('../..', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  // A Home Assistant with one timestamp sensor, `sensor.phone_next_alarm`, that
  // wants its token. `state` is changed by the tests.
  const token = 'ha-e2e-token-0123456789abcdef'
  let state = '2026-10-31T06:45:00+00:00'
  const homeAssistant = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end()
    } else if (request.method === 'GET' && request.url === '/api/states/sensor.phone_next_alarm') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ entity_id: 'sensor.phone_next_alarm', state, attributes: { device_class: 'timestamp' } }))
    } else {
      response.writeHead(404).end()
    }
    request.resume()
  })
  await new Promise<void>(resolve => homeAssistant.listen(0, '127.0.0.1', resolve))
  afterAll(async () => {
    homeAssistant.closeAllConnections()
    await new Promise(resolve => homeAssistant.close(resolve))
  })

  const haPort = (homeAssistant.address() as AddressInfo).port
  // The dev config's display, with a night view that shows the alarm.
  const devConfig = readFileSync(join(appDir, 'config.dev.yaml'), 'utf8')
    .replaceAll('file:./', `file:${appDir}/`)
    .replace(/(displays:\n\s+- id: hallway\n)/, '$1    night_text: next_alarm\n    burn_in: false\n')
  const configFile = join(dir, 'config.yaml')
  writeFileSync(configFile, `${devConfig}\nhomeassistant:\n  url: http://127.0.0.1:${haPort}\n  token: ${token}\n\nalarm:\n  entity_id: sensor.phone_next_alarm\n`)

  await setup({
    browser: false,
    env: {
      WALLCAL_CONFIG_FILE: configFile,
      WALLCAL_DATA_DIR: join(dir, 'data'),
    },
  })

  /** A socket that collects what the server sends. */
  function connect(query: string) {
    const socket = new WebSocket(url(`/_ws?${query}`).replace(/^http/, 'ws'))
    const messages: ServerMessage[] = []
    const waiting: (() => void)[] = []
    socket.addEventListener('message', (event) => {
      messages.push(JSON.parse(String(event.data)) as ServerMessage)
      for (const wake of waiting.splice(0)) wake()
    })
    const opened = new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve())
      socket.addEventListener('error', () => reject(new Error('the socket did not open')))
    })
    /** Resolves with the first message from index `from` on that passes `match`. */
    async function next(match: (message: ServerMessage) => boolean, from = 0): Promise<ServerMessage> {
      const deadline = Date.now() + 30_000
      for (;;) {
        const found = messages.slice(from).find(match)
        if (found) return found
        if (Date.now() > deadline) throw new Error(`no matching message, got ${JSON.stringify(messages)}`)
        await new Promise<void>((resolve) => {
          waiting.push(resolve)
          setTimeout(resolve, 200)
        })
      }
    }
    return { socket, messages, opened, next }
  }

  const isAlarm = (alarm: string | null) => (message: ServerMessage) => message.type === 'alarm.updated' && message.alarm === alarm

  it('GET /api/displays has the night view settings', async () => {
    const displays = await $fetch<DisplaySettings[]>('/api/displays')

    expect(displays[0]).toMatchObject({ id: 'hallway', night_text: 'next_alarm', burn_in: false })
  })

  it('a new socket gets the state, the weather, the special days, then the alarm, and hears it once fetched', async () => {
    const display = connect('display=hallway&role=display')
    await display.opened

    // Whether or not the first poll has finished (it comes a few seconds after boot), the alarm arrives.
    await display.next(m => m.type === 'alarm.updated')
    expect(display.messages.map(m => m.type).slice(0, 4)).toEqual(['state.updated', 'weather.updated', 'special_days.updated', 'alarm.updated'])
    await display.next(isAlarm('2026-10-31T06:45:00.000Z'))
    display.socket.close()
  })

  it('a socket that connects later is sent the alarm straight away', async () => {
    const early = connect('display=hallway&role=display')
    await early.opened
    await early.next(isAlarm('2026-10-31T06:45:00.000Z'))

    const late = connect('display=hallway&role=remote')
    await late.opened

    expect(await late.next(m => m.type === 'alarm.updated')).toEqual({ type: 'alarm.updated', alarm: '2026-10-31T06:45:00.000Z' })
    early.socket.close()
    late.socket.close()
  })

  it('POST /api/refresh fetches again, and a change reaches every socket', async () => {
    const display = connect('display=hallway&role=display')
    const remote = connect('display=hallway&role=remote')
    await Promise.all([display.opened, remote.opened])
    await Promise.all([display.next(isAlarm('2026-10-31T06:45:00.000Z')), remote.next(isAlarm('2026-10-31T06:45:00.000Z'))])
    const [displaySeen, remoteSeen] = [display.messages.length, remote.messages.length]

    state = '2026-10-31T07:30:00+00:00'
    await $fetch('/api/refresh', { method: 'POST' })

    await display.next(isAlarm('2026-10-31T07:30:00.000Z'), displaySeen)
    await remote.next(isAlarm('2026-10-31T07:30:00.000Z'), remoteSeen)
    display.socket.close()
    remote.socket.close()
  })

  it('an alarm that is cleared is sent as null, and nothing secret is in what is sent', async () => {
    const display = connect('display=hallway&role=display')
    await display.opened
    await display.next(m => m.type === 'alarm.updated')
    const seen = display.messages.length

    state = 'unknown'
    await $fetch('/api/refresh', { method: 'POST' })

    await display.next(isAlarm(null), seen)
    const text = JSON.stringify(display.messages)
    expect(text).not.toContain(token)
    expect(text).not.toContain(String(haPort))
    display.socket.close()
  })
})
