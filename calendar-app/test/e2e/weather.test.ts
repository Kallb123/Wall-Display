import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, setup, url } from '@nuxt/test-utils/e2e'
import type { ServerMessage } from '../../shared/display'
import type { WeatherResponse } from '../../shared/weather'

describe('weather from Home Assistant', async () => {
  const appDir = fileURLToPath(new URL('../..', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  // A Home Assistant with one weather entity, `weather.home`, that wants its
  // token and answers the state and the daily forecast as the real one does.
  // `condition` and `fail` are changed by the tests.
  const token = 'ha-e2e-token-0123456789abcdef'
  let condition = 'rainy'
  let fail = false
  const seen: { method: string | undefined, url: string | undefined, headers: IncomingHttpHeaders, body: string }[] = []
  const homeAssistant = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      seen.push({ method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString() })
      if (request.headers.authorization !== `Bearer ${token}`) {
        response.writeHead(401).end()
        return
      }
      if (fail) {
        response.writeHead(500).end()
        return
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      if (request.method === 'GET' && request.url === '/api/states/weather.home') {
        response.end(JSON.stringify({ entity_id: 'weather.home', state: condition, attributes: { temperature: 12.4, temperature_unit: '°C', humidity: 90 }, last_updated: '2026-10-28T11:00:00+00:00' }))
      } else if (request.method === 'POST' && request.url === '/api/services/weather/get_forecasts?return_response') {
        // Home Assistant's daily forecasts are at midnight local time, written in UTC: the 29th in London starts at 00:00 UTC.
        response.end(JSON.stringify({
          changed_states: [],
          service_response: {
            'weather.home': {
              forecast: [
                { datetime: '2026-10-29T00:00:00+00:00', condition: 'rainy', temperature: 14, templow: 8, precipitation: 2.1 },
                { datetime: '2026-10-30T00:00:00+00:00', condition: 'partlycloudy', temperature: 11 },
                { datetime: '2026-10-31T00:00:00+00:00', condition: 'drizzle', temperature: 10, templow: 5 },
              ],
            },
          },
        }))
      } else {
        response.writeHead(404).end()
      }
    })
  })
  await new Promise<void>(resolve => homeAssistant.listen(0, '127.0.0.1', resolve))
  afterAll(async () => {
    homeAssistant.closeAllConnections()
    await new Promise(resolve => homeAssistant.close(resolve))
  })

  const haPort = (homeAssistant.address() as AddressInfo).port
  const devConfig = readFileSync(join(appDir, 'config.dev.yaml'), 'utf8').replaceAll('file:./', `file:${appDir}/`)
  const configFile = join(dir, 'config.yaml')
  writeFileSync(configFile, `${devConfig}\nhomeassistant:\n  url: http://127.0.0.1:${haPort}\n  token: ${token}\n\nweather:\n  entity_id: weather.home\n`)

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
      const deadline = Date.now() + 15_000
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

  /** The first poll comes a few seconds after boot (up to 10), so wait for it. */
  async function weatherOnceFetched(): Promise<NonNullable<WeatherResponse['weather']>> {
    const deadline = Date.now() + 30_000
    for (;;) {
      const { weather } = await $fetch<WeatherResponse>('/api/weather')
      if (weather) return weather
      if (Date.now() > deadline) throw new Error('the weather was never fetched')
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }

  it('GET /api/weather has the current conditions and the forecast, and nothing secret', async () => {
    const response = await weatherOnceFetched()

    expect(response).toEqual({
      current: { condition: 'rainy', temperature: 12.4 },
      daily: [
        { date: '2026-10-29', condition: 'rainy', high: 14, low: 8 },
        { date: '2026-10-30', condition: 'partlycloudy', high: 11, low: null },
        // A condition the wall has no word for is read as none, and the day is kept.
        { date: '2026-10-31', condition: null, high: 10, low: 5 },
      ],
      temperature_unit: '°C',
      updated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
    })
    const text = JSON.stringify(response)
    expect(text).not.toContain(token)
    expect(text).not.toContain(String(haPort))
    expect(text).not.toContain('127.0.0.1')
  })

  it('asked Home Assistant for the state and the daily forecast with the token', async () => {
    await weatherOnceFetched()

    const state = seen.find(request => request.method === 'GET')!
    const forecast = seen.find(request => request.method === 'POST')!
    expect(state.url).toBe('/api/states/weather.home')
    expect(forecast.url).toBe('/api/services/weather/get_forecasts?return_response')
    expect(JSON.parse(forecast.body)).toEqual({ entity_id: 'weather.home', type: 'daily' })
    expect(state.headers.authorization).toBe(`Bearer ${token}`)
    expect(forecast.headers.authorization).toBe(`Bearer ${token}`)
  })

  it('a new socket gets the state, then the weather', async () => {
    const response = await weatherOnceFetched()
    const display = connect('display=hallway&role=display')
    await display.opened

    const weather = await display.next(message => message.type === 'weather.updated')

    expect(display.messages[0]).toMatchObject({ type: 'state.updated' })
    expect(weather).toEqual({ type: 'weather.updated', weather: response })
    display.socket.close()
  })

  it('POST /api/refresh fetches again, and a change reaches every socket and the API', async () => {
    await weatherOnceFetched()
    const display = connect('display=hallway&role=display')
    const remote = connect('display=hallway&role=remote')
    await Promise.all([display.opened, remote.opened])
    await Promise.all([display.next(m => m.type === 'weather.updated'), remote.next(m => m.type === 'weather.updated')])
    const [displaySeen, remoteSeen] = [display.messages.length, remote.messages.length]
    const requests = seen.length

    condition = 'sunny'
    const body = await $fetch<{ calendars: unknown[] }>('/api/refresh', { method: 'POST' })

    // The answer is still just the calendars, and the weather was fetched by the refresh.
    expect(Object.keys(body)).toEqual(['calendars'])
    expect(seen.length).toBeGreaterThan(requests)
    const changed = (message: ServerMessage) => message.type === 'weather.updated' && message.weather?.current.condition === 'sunny'
    await display.next(changed, displaySeen)
    await remote.next(changed, remoteSeen)
    expect((await $fetch<WeatherResponse>('/api/weather')).weather?.current.condition).toBe('sunny')
    display.socket.close()
    remote.socket.close()
  })

  it('keeps the last good weather while Home Assistant fails, and does not leak why', async () => {
    const before = await weatherOnceFetched()
    const requests = seen.length

    fail = true
    await $fetch('/api/refresh', { method: 'POST' })

    expect(seen.length).toBeGreaterThan(requests)
    const after = (await $fetch<WeatherResponse>('/api/weather')).weather
    expect(after).toEqual(before)
    expect(JSON.stringify(after)).not.toContain(token)
    fail = false
  })
})
