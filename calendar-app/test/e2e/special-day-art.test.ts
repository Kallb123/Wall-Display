import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, fetch, setup, url } from '@nuxt/test-utils/e2e'
import { todayIn } from '../../shared/dates'
import type { ServerMessage } from '../../shared/display'
import { PIN_HEADER } from '../../shared/remote'
import { specialDayArtUrl } from '../../shared/special-days'
import type { SpecialDay, SpecialDayScene, SpecialDaysResponse } from '../../shared/special-days'

// Art uploads for days and scenes, and the route that serves the files, on the
// dev config with `remote.pin` set: the writes need the PIN, and the tests
// send it. The tests build on each other, in order.
describe('special day art', async () => {
  const appDir = fileURLToPath(new URL('../..', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const configFile = join(dir, 'config.yaml')
  writeFileSync(configFile, `${readFileSync(join(appDir, 'config.dev.yaml'), 'utf8').replaceAll('file:./', `file:${appDir}/`)}\nremote:\n  pin: "2468"\n`)
  const artDir = join(dir, 'data', 'special-days')

  await setup({
    browser: false,
    env: {
      WALLCAL_CONFIG_FILE: configFile,
      WALLCAL_DATA_DIR: join(dir, 'data'),
    },
  })

  const right = { [PIN_HEADER]: '2468' }
  const wrong = { [PIN_HEADER]: '1357' }
  const FIXTURES = join(appDir, 'test', 'fixtures', 'svg')

  /** The art files on disk now, sorted. Temporary files (dot-prefixed) would show up here too. */
  const stored = () => existsSync(artDir) ? readdirSync(artDir).sort() : []

  /** A solid picture of the given size, as PNG; `alpha` below 1 makes it transparent. */
  const png = (width: number, height: number, alpha = 1) =>
    sharp({ create: { width, height, channels: 4, background: { r: 200, g: 60, b: 40, alpha } } }).png().toBuffer()
  const jpeg = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: { r: 20, g: 90, b: 200 } } }).jpeg().toBuffer()
  const fixture = (name: string) => readFileSync(join(FIXTURES, name))

  /** Uploads `data` in the `file` field (or `field`), with the PIN unless told otherwise. */
  function upload(path: string, data: Buffer | Uint8Array, { field = 'file', filename = 'art.bin', headers = right }: { field?: string, filename?: string, headers?: Record<string, string> } = {}) {
    const body = new FormData()
    body.append(field, new Blob([new Uint8Array(data)]), filename)
    return fetch(path, { method: 'POST', body, headers })
  }
  const remove = (path: string, headers: Record<string, string> = right) => fetch(path, { method: 'DELETE', headers })
  const send = <T>(method: string, path: string, body?: unknown) =>
    $fetch<T>(path, { method: method as 'POST', body: body as Record<string, unknown>, headers: right })
  const getDay = (id: string) => $fetch<SpecialDay>(`/api/special-days/${id}`)
  const getScene = (id: string) => $fetch<SpecialDayScene>(`/api/special-day-scenes/${id}`)
  const resolved = async () => (await $fetch<SpecialDaysResponse>('/api/special-days/resolved')).special_days!
  const served = (name: string) => fetch(specialDayArtUrl(name))
  const message = async (response: Response) => ((await response.json()) as { message: string }).message

  const today = todayIn(new Date(), 'Europe/London')
  const [, month, dayOfMonth] = today.split('-').map(Number)
  const birthday = { name: 'Birthday', lead: 'week', takeover: true, greeting: 'Happy birthday', palette: 'sage' }
  const party = { name: 'Party', month, day: dayOfMonth, repeat: 'yearly', scene_id: 'birthday' }

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

  it('is set up with a scene and a day on it', async () => {
    await send('POST', '/api/special-day-scenes', birthday)
    await send('POST', '/api/special-days', party)
    expect(stored()).toEqual([])
  })

  it('refuses an upload and a clear with no PIN or the wrong one, and stores nothing', async () => {
    const data = await png(100, 100)
    for (const path of ['/api/special-day-scenes/birthday/art/tile', '/api/special-days/party/art/tile']) {
      expect((await upload(path, data, { headers: {} })).status).toBe(401)
      expect((await upload(path, data, { headers: wrong })).status).toBe(401)
      expect((await remove(path, {})).status).toBe(401)
      expect((await remove(path, wrong)).status).toBe(401)
    }
    // The PIN is asked for before anything else, so an unknown id gives nothing away either.
    expect((await upload('/api/special-days/nothing/art/tile', data, { headers: {} })).status).toBe(401)
    expect(stored()).toEqual([])
  })

  it('stores a PNG tile for a scene as a WebP named by its hash, and serves it with long-lived cache headers', async () => {
    const response = await upload('/api/special-day-scenes/birthday/art/tile', await png(1000, 500, 0.5))
    const scene = await response.json() as SpecialDayScene

    expect(response.status).toBe(200)
    expect(scene.tile_art).toMatch(/^[0-9a-f]{64}\.webp$/)
    expect(scene.full_art).toBeNull()
    expect(await getScene('birthday')).toEqual(scene)
    expect(stored()).toEqual([scene.tile_art])

    const file = await served(scene.tile_art!)
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toBe('image/webp')
    expect(file.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(file.headers.get('x-content-type-options')).toBe('nosniff')
    expect(file.headers.get('content-security-policy')).toBeNull()
    const image = await sharp(Buffer.from(await file.arrayBuffer())).metadata()
    expect(image).toMatchObject({ format: 'webp', width: 512, height: 256, hasAlpha: true })
  })

  it('serves an SVG tile with a locked-down Content-Security-Policy', async () => {
    const response = await upload('/api/special-days/party/art/tile', fixture('clean.svg'), { filename: 'logo.svg' })
    const day = await response.json() as SpecialDay

    expect(response.status).toBe(200)
    expect(day.tile_art).toMatch(/^[0-9a-f]{64}\.svg$/)
    const file = await served(day.tile_art!)
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toBe('image/svg+xml')
    expect(file.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(file.headers.get('x-content-type-options')).toBe('nosniff')
    expect(file.headers.get('content-security-policy')).toBe('default-src \'none\'; style-src \'unsafe-inline\'')
    expect(await file.text()).toContain('<svg')
  })

  it('refuses a hostile SVG with a 400 and stores nothing', async () => {
    const before = stored()
    const response = await upload('/api/special-days/party/art/tile', fixture('hostile.svg'), { filename: 'hostile.svg' })

    expect(response.status).toBe(400)
    expect(await message(response)).toMatch(/event handler/)
    expect(stored()).toEqual(before)
    expect((await getDay('party')).tile_art).toMatch(/\.svg$/)
  })

  it('answers 413 for a file that is too big, with and without the multipart room, and 415 for the wrong type', async () => {
    const before = stored()
    // Over the limit by a little: the body is read, then the file is too big.
    const little = await upload('/api/special-days/party/art/tile', Buffer.alloc(2 * 1024 * 1024 + 10))
    expect(little.status).toBe(413)
    expect(await message(little)).toContain('2 MB')
    // Well over: the Content-Length alone turns it away.
    expect((await upload('/api/special-day-scenes/birthday/art/tile', Buffer.alloc(3 * 1024 * 1024))).status).toBe(413)

    const wrongType = await upload('/api/special-days/party/art/tile', await jpeg(100, 100), { filename: 'photo.jpg' })
    expect(wrongType.status).toBe(415)
    expect(await message(wrongType)).toBe('Tile art must be PNG, WebP or SVG')
    expect((await upload('/api/special-days/party/art/full', Buffer.from('not an image at all'))).status).toBe(415)
    expect(stored()).toEqual(before)
  })

  it('answers 411 with no Content-Length', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('--x--\r\n'))
        controller.close()
      },
    })
    const response = await fetch('/api/special-days/party/art/tile', {
      method: 'POST',
      body,
      duplex: 'half',
      headers: { ...right, 'content-type': 'multipart/form-data; boundary=x' },
    } as RequestInit)

    expect(response.status).toBe(411)
  })

  it('answers 400 when there is no file field, or no file in it', async () => {
    const data = await png(50, 50)
    const wrongField = await upload('/api/special-days/party/art/tile', data, { field: 'picture' })
    expect(wrongField.status).toBe(400)
    expect(await message(wrongField)).toBe('file is required')

    const text = new FormData()
    text.append('file', 'just text')
    expect((await fetch('/api/special-days/party/art/tile', { method: 'POST', body: text, headers: right })).status).toBe(400)

    const damaged = await upload('/api/special-days/party/art/tile', (await png(50, 50)).subarray(0, 40))
    expect([400, 415]).toContain(damaged.status)
  })

  it('answers 404 for an unknown id, and for a slot that does not exist, without reading the body', async () => {
    const data = await png(50, 50)
    expect((await upload('/api/special-days/nothing/art/tile', data)).status).toBe(404)
    expect((await upload('/api/special-day-scenes/nothing/art/tile', data)).status).toBe(404)
    expect((await remove('/api/special-days/nothing/art/tile')).status).toBe(404)
    expect((await remove('/api/special-day-scenes/nothing/art/full')).status).toBe(404)
    expect((await upload('/api/special-days/party/art/banner', data)).status).toBe(404)
    // Scenes have no extra art.
    expect((await upload('/api/special-day-scenes/birthday/art/extra', data)).status).toBe(404)
    expect((await remove('/api/special-day-scenes/birthday/art/extra')).status).toBe(404)
    expect((await remove('/api/special-days/party/art/banner')).status).toBe(404)
  })

  it('crops full art to 2560×1440 WebP, whatever it came as', async () => {
    const response = await upload('/api/special-days/party/art/full', await jpeg(3000, 1000), { filename: 'photo.jpg' })
    const day = await response.json() as SpecialDay

    expect(response.status).toBe(200)
    expect(day.full_art).toMatch(/^[0-9a-f]{64}\.webp$/)
    const file = await served(day.full_art!)
    expect(file.headers.get('content-type')).toBe('image/webp')
    expect(await sharp(Buffer.from(await file.arrayBuffer())).metadata()).toMatchObject({ format: 'webp', width: 2560, height: 1440 })
  })

  it('takes extra art only if it has transparency, and keeps it', async () => {
    const opaque = await upload('/api/special-days/party/art/extra', await png(800, 600))
    expect(opaque.status).toBe(400)
    expect(await message(opaque)).toContain('transparent')
    expect((await getDay('party')).extra_art).toBeNull()

    const response = await upload('/api/special-days/party/art/extra', await png(800, 600, 0.5))
    const day = await response.json() as SpecialDay
    expect(response.status).toBe(200)
    expect(day.extra_art).toMatch(/^[0-9a-f]{64}\.webp$/)
    const file = await served(day.extra_art!)
    expect(await sharp(Buffer.from(await file.arrayBuffer())).metadata()).toMatchObject({ width: 2560, height: 1440, hasAlpha: true })
  })

  it('does not serve a bad name, a path or a file that is not there', async () => {
    const missing = `${'0'.repeat(64)}.webp`
    expect((await served(missing)).status).toBe(404)
    expect((await served(`${'0'.repeat(63)}.webp`)).status).toBe(404)
    expect((await served(`${'0'.repeat(64)}.png`)).status).toBe(404)
    expect((await served('notes.txt')).status).toBe(404)
    expect((await served('..%2Fdata.db')).status).toBe(404)
    expect((await served(`..%2F${missing}`)).status).toBe(404)
    expect((await served('%2e%2e%2fconfig.yaml')).status).toBe(404)
    // A 404 from the route, not the app's index.html that the SPA answers unknown pages with.
    expect((await served('notes.txt')).headers.get('content-type')).toContain('application/json')
  })

  it('clears a day\'s tile so it falls back to its scene\'s, in what the displays draw', async () => {
    const scene = await getScene('birthday')
    const own = (await getDay('party')).tile_art!

    const tileOf = async () => (await resolved()).tiles.find(tile => tile.date === today)?.days.find(entry => entry.id === 'party')?.tile_art
    expect(await tileOf()).toBe(own)

    const response = await remove('/api/special-days/party/art/tile')
    const day = await response.json() as SpecialDay
    expect(response.status).toBe(200)
    expect(day.tile_art).toBeNull()
    expect(await getDay('party')).toEqual(day)
    expect(await tileOf()).toBe(scene.tile_art)
    // Its own SVG was used by nothing else, so it is gone.
    expect((await served(own)).status).toBe(404)
    expect(stored()).not.toContain(own)

    // Clearing what is not set is fine.
    expect((await remove('/api/special-days/party/art/tile')).status).toBe(200)
  })

  it('takes a day\'s takeover art from the full-screen upload, and from its scene when it has none', async () => {
    const own = (await getDay('party')).full_art!
    expect((await resolved()).takeover).toMatchObject({ id: 'party', full_art: own, extra_art: (await getDay('party')).extra_art })

    expect((await remove('/api/special-days/party/art/full')).status).toBe(200)
    expect((await resolved()).takeover).toMatchObject({ id: 'party', full_art: null })

    const sceneFull = await (await upload('/api/special-day-scenes/birthday/art/full', await jpeg(1920, 1080))).json() as SpecialDayScene
    expect((await resolved()).takeover).toMatchObject({ id: 'party', full_art: sceneFull.full_art })
  })

  it('sends special_days.updated after an upload', async () => {
    const { socket, messages, opened, next } = connect('display=hallway&role=display')
    await opened
    await next(message => message.type === 'special_days.updated')

    const seen = messages.length
    const day = await (await upload('/api/special-days/party/art/tile', await png(64, 64, 0.5))).json() as SpecialDay
    const pushed = await next(message => message.type === 'special_days.updated' && message.special_days?.tiles.some(tile => tile.days.some(entry => entry.tile_art === day.tile_art)) === true, seen)

    expect(pushed.type).toBe('special_days.updated')
    socket.close()
  })

  it('keeps a file a scene and a duplicated day share until both have let go of it', async () => {
    const shared = (await getDay('party')).tile_art!
    const copy = await (await fetch('/api/special-days/party/duplicate', { method: 'POST', headers: right })).json() as SpecialDay
    expect(copy.id).toBe('copy-of-party')
    expect(copy.tile_art).toBe(shared)

    // Clearing the original leaves it for the copy.
    expect((await remove('/api/special-days/party/art/tile')).status).toBe(200)
    expect((await served(shared)).status).toBe(200)
    expect(stored()).toContain(shared)

    // Clearing the copy, the last one to refer to it, takes it.
    expect((await remove('/api/special-days/copy-of-party/art/tile')).status).toBe(200)
    expect((await served(shared)).status).toBe(404)
    expect(stored()).not.toContain(shared)
  })

  it('shares one file between a scene and a day that upload the same picture, and a copy of the scene', async () => {
    const data = await png(300, 300, 0.5)
    const onScene = await (await upload('/api/special-day-scenes/birthday/art/tile', data)).json() as SpecialDayScene
    const onDay = await (await upload('/api/special-days/party/art/tile', data)).json() as SpecialDay
    expect(onDay.tile_art).toBe(onScene.tile_art)

    expect((await remove('/api/special-day-scenes/birthday/art/tile')).status).toBe(200)
    expect((await served(onDay.tile_art!)).status).toBe(200)
    expect((await remove('/api/special-days/party/art/tile')).status).toBe(200)
    expect((await served(onDay.tile_art!)).status).toBe(404)
  })

  it('removes the old file when art is replaced, but not when it is replaced by itself', async () => {
    const first = await (await upload('/api/special-day-scenes/birthday/art/tile', await png(200, 200, 0.5))).json() as SpecialDayScene
    const again = await (await upload('/api/special-day-scenes/birthday/art/tile', await png(200, 200, 0.5))).json() as SpecialDayScene
    expect(again.tile_art).toBe(first.tile_art)
    expect((await served(first.tile_art!)).status).toBe(200)

    const second = await (await upload('/api/special-day-scenes/birthday/art/tile', await png(100, 100, 0.5))).json() as SpecialDayScene
    expect(second.tile_art).not.toBe(first.tile_art)
    expect((await served(first.tile_art!)).status).toBe(404)
    expect((await served(second.tile_art!)).status).toBe(200)
    expect(stored()).not.toContain(first.tile_art)
  })

  it('bumps a day\'s updated_at when art is set, and a scene\'s, and leaves its days alone', async () => {
    const day = await getDay('party')
    await new Promise(resolve => setTimeout(resolve, 5))
    const scene = await getScene('birthday')
    const updated = await (await upload('/api/special-day-scenes/birthday/art/tile', await png(120, 120, 0.5))).json() as SpecialDayScene

    expect(Date.parse(updated.updated_at)).toBeGreaterThan(Date.parse(scene.updated_at))
    expect((await getDay('party')).updated_at).toBe(day.updated_at)

    await new Promise(resolve => setTimeout(resolve, 5))
    const withArt = await (await upload('/api/special-days/party/art/extra', await png(120, 120, 0.5))).json() as SpecialDay
    expect(Date.parse(withArt.updated_at)).toBeGreaterThan(Date.parse(day.updated_at))
  })

  it('removes a day\'s art files with the day, but not the ones another day or a scene uses', async () => {
    const day = await (await upload('/api/special-days/copy-of-party/art/full', await png(800, 600))).json() as SpecialDay
    const sceneTile = (await getScene('birthday')).tile_art!
    await upload('/api/special-days/copy-of-party/art/tile', await png(120, 120, 0.5))
    expect((await getDay('copy-of-party')).tile_art).toBe(sceneTile)
    expect(stored()).toContain(day.full_art)

    expect((await fetch('/api/special-days/copy-of-party', { method: 'DELETE', headers: right })).status).toBe(204)
    expect(stored()).not.toContain(day.full_art)
    expect(stored()).toContain(sceneTile)
    expect((await served(sceneTile)).status).toBe(200)
  })

  it('removes a scene\'s art files with the scene, but keeps them for the days it was detached into', async () => {
    const files = await (await upload('/api/special-day-scenes/birthday/art/full', await jpeg(640, 480))).json() as SpecialDayScene
    const day = await getDay('party')
    expect(files.tile_art).not.toBeNull()

    // In use, so refused, and nothing is touched.
    expect((await fetch('/api/special-day-scenes/birthday', { method: 'DELETE', headers: right })).status).toBe(409)
    expect(stored()).toContain(files.full_art)

    // Detached, the day takes the scene's look, art files included, so they stay.
    expect((await fetch('/api/special-day-scenes/birthday?detach=true', { method: 'DELETE', headers: right })).status).toBe(204)
    const detached = await getDay('party')
    expect(detached.full_art).toBe(files.full_art)
    expect(detached.tile_art).toBe(files.tile_art)
    expect(stored()).toEqual(expect.arrayContaining([files.full_art!, files.tile_art!]))
    expect(day.id).toBe('party')

    // A scene nobody uses takes its files with it.
    await send('POST', '/api/special-day-scenes', { ...birthday, name: 'Loose' })
    const loose = await (await upload('/api/special-day-scenes/loose/art/tile', await png(90, 90, 0.5))).json() as SpecialDayScene
    expect(stored()).toContain(loose.tile_art)
    expect((await fetch('/api/special-day-scenes/loose', { method: 'DELETE', headers: right })).status).toBe(204)
    expect(stored()).not.toContain(loose.tile_art)
  })

  it('removes a day\'s last files when it is deleted, leaving the folder with no art', async () => {
    expect((await fetch('/api/special-days/party', { method: 'DELETE', headers: right })).status).toBe(204)
    expect(stored()).toEqual([])
  })
})
