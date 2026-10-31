import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, fetch, setup, url } from '@nuxt/test-utils/e2e'
import type { DisplaySettings, DisplayState, ServerMessage } from '../../shared/display'
import type { RemoteInfo } from '../../shared/remote'

describe('display state, commands and the WebSocket', async () => {
  const appDir = fileURLToPath(new URL('../..', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  // The dev config, with its fixtures by absolute path (it is read from another folder here).
  const configFile = join(dir, 'config.yaml')
  writeFileSync(configFile, readFileSync(join(appDir, 'config.dev.yaml'), 'utf8').replaceAll('file:./', `file:${appDir}/`))

  await setup({
    browser: false,
    env: {
      WALLCAL_CONFIG_FILE: configFile,
      WALLCAL_DATA_DIR: join(dir, 'data'),
    },
  })

  const reason = (statusCode: number, message: string) => ({ statusCode, data: { message: expect.stringContaining(message) } })
  const command = (id: string, body: unknown) => $fetch<DisplayState>(`/api/displays/${id}/commands`, { method: 'POST', body: body as Record<string, unknown> })

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
      const deadline = Date.now() + 10_000
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

  /** What happens on a socket that is refused: it never opens, and errors or closes. */
  function refused(query: string) {
    const socket = new WebSocket(url(`/_ws?${query}`).replace(/^http/, 'ws'))
    return new Promise<'refused' | 'opened'>((resolve) => {
      socket.addEventListener('open', () => {
        resolve('opened')
        socket.close()
      })
      socket.addEventListener('error', () => resolve('refused'))
      socket.addEventListener('close', () => resolve('refused'))
    })
  }

  it('GET /api/displays lists each display\'s settings and the time zone, and nothing else', async () => {
    const displays = await $fetch<DisplaySettings[]>('/api/displays')

    expect(displays).toEqual([
      // The dev config has a local photo folder (not there from this temporary config, but set up), and no other source.
      { id: 'hallway', name: 'Hallway', theme: 'light', month_style: 'soft', week_start: 'monday', timezone: 'Europe/London', burn_in: true, night_text: 'none', photo_sources: ['local'] },
    ])
  })

  it('GET /api/displays/:id/state is the default state for a new display', async () => {
    const state = await $fetch<DisplayState>('/api/displays/hallway/state')

    expect(state).toEqual({ view: 'month', month: null, month_set_at: null, screen: 'on', photo_source: 'immich', last_calendar_view: 'month', brightness: 100, auto_presence: true, auto_brightness: true, overlay: null, preview: null })
  })

  it('GET /api/displays/:id/state answers 404 for an unknown display', async () => {
    await expect($fetch('/api/displays/garage/state')).rejects.toMatchObject(reason(404, 'Unknown display "garage"'))
  })

  it('POST /api/displays/:id/commands applies a command and answers with the new state', async () => {
    const state = await command('hallway', { type: 'set_view', view: 'agenda' })

    expect(state.view).toBe('agenda')
    expect((await $fetch<DisplayState>('/api/displays/hallway/state')).view).toBe('agenda')
    await command('hallway', { type: 'set_view', view: 'month' })
  })

  it('POST /api/displays/:id/commands toggle_photo goes to the photo frame and back to the view it replaced', async () => {
    await command('hallway', { type: 'set_view', view: 'week' })

    expect(await command('hallway', { type: 'toggle_photo' })).toMatchObject({ view: 'photo', last_calendar_view: 'week' })
    expect(await command('hallway', { type: 'toggle_photo' })).toMatchObject({ view: 'week', last_calendar_view: 'week' })
    await expect(command('hallway', { type: 'toggle_photo', extra: true })).rejects.toMatchObject(reason(400, 'command'))
    await command('hallway', { type: 'set_view', view: 'month' })
  })

  it('POST /api/displays/:id/commands answers a bad command with a 400 and a short reason', async () => {
    await expect(command('hallway', { type: 'explode' })).rejects.toMatchObject(reason(400, 'type must be'))
    await expect(command('hallway', { type: 'set_brightness', brightness: 101 })).rejects.toMatchObject(reason(400, 'brightness must be from 0 to 100'))
    await expect(command('hallway', { type: 'set_month', month: '2026-13' })).rejects.toMatchObject(reason(400, 'month must be'))
    await expect(command('hallway', { type: 'next_view', extra: true })).rejects.toMatchObject(reason(400, 'command'))
  })

  it('POST /api/displays/:id/commands answers 404 for an unknown display', async () => {
    await expect(command('garage', { type: 'next_view' })).rejects.toMatchObject(reason(404, 'Unknown display "garage"'))
  })

  it('GET /api/remote says no PIN is needed, and POST /api/remote/pin accepts anything', async () => {
    expect(await $fetch<RemoteInfo>('/api/remote')).toEqual({ pin_required: false })

    const response = await fetch('/api/remote/pin', { method: 'POST' })
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
  })

  it('GET /remote.webmanifest names the display and points at its remote, with the icons', async () => {
    const response = await fetch('/remote.webmanifest?id=hallway')

    expect(response.headers.get('content-type')).toContain('application/manifest+json')
    expect(await response.json()).toEqual({
      name: 'Hallway remote',
      short_name: 'Hallway',
      id: '/remote?id=hallway',
      start_url: '/remote?id=hallway',
      scope: '/remote',
      display: 'standalone',
      background_color: '#f5ead8',
      theme_color: '#f5ead8',
      icons: [
        { src: '/icons/remote-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/remote-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/remote-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    })
  })

  it('GET /remote.webmanifest uses the first display when no id is given, and answers 404 for an unknown one', async () => {
    expect(await $fetch<{ short_name: string }>('/remote.webmanifest')).toMatchObject({ short_name: 'Hallway' })
    await expect($fetch('/remote.webmanifest?id=garage')).rejects.toMatchObject(reason(404, 'Unknown display "garage"'))
  })

  it('serves the icons the manifest lists', async () => {
    for (const icon of ['remote-192.png', 'remote-512.png', 'remote-maskable-512.png', 'apple-touch-icon.png']) {
      const response = await fetch(`/icons/${icon}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('image/png')
    }
  })

  it('tells a new socket there is no weather when the config has no weather block, and GET /api/weather says so', async () => {
    const display = connect('display=hallway&role=display')
    await display.opened

    expect(await display.next(message => message.type === 'weather.updated')).toEqual({ type: 'weather.updated', weather: null })
    // The state comes first, as it always did.
    expect(display.messages[0]).toMatchObject({ type: 'state.updated' })
    expect(await $fetch('/api/weather')).toEqual({ weather: null })
    display.socket.close()
  })

  it('/_ws sends the whole state on connect, then every change to that display', async () => {
    const remote = connect('display=hallway&role=remote')
    await remote.opened

    const first = await remote.next(message => message.type === 'state.updated')
    expect(first).toMatchObject({ type: 'state.updated', display_id: 'hallway', state: { view: 'month', screen: 'on' } })

    const seen = remote.messages.length
    await command('hallway', { type: 'set_screen', screen: 'off' })
    const update = await remote.next(message => message.type === 'state.updated' && message.state.screen === 'off', seen)
    expect(update).toMatchObject({ display_id: 'hallway', state: { screen: 'off' } })

    await command('hallway', { type: 'set_screen', screen: 'on' })
    remote.socket.close()
  })

  it('/_ws sends photo.next to the display and not to the remote', async () => {
    const display = connect('display=hallway&role=display')
    const remote = connect('display=hallway&role=remote')
    await Promise.all([display.opened, remote.opened])
    await Promise.all([display.next(m => m.type === 'state.updated'), remote.next(m => m.type === 'state.updated')])

    await command('hallway', { type: 'photo_next' })
    await display.next(message => message.type === 'photo.next')
    // A state change sent afterwards reaches the remote, so anything sent before it has had its chance.
    await command('hallway', { type: 'set_brightness', brightness: 50 })
    await remote.next(message => message.type === 'state.updated' && message.state.brightness === 50)

    expect(remote.messages.some(message => message.type === 'photo.next')).toBe(false)
    await command('hallway', { type: 'set_brightness', brightness: 100 })
    display.socket.close()
    remote.socket.close()
  })

  it('/_ws refuses a missing display, a bad role and an unknown display', async () => {
    expect(await refused('role=remote')).toBe('refused')
    expect(await refused('display=hallway&role=admin')).toBe('refused')
    expect(await refused('display=garage&role=remote')).toBe('refused')
  })
})
