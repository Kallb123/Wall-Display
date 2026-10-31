import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImmichProvider } from '../../../server/photos/immich'
import { renderPhoto } from '../../../server/photos/render'
import { createPhotoService } from '../../../server/photos/service'
import { migratedMemoryDb } from '../db/helpers'
import { ALBUM_A, KEY, immich, json, jsonResponse, server } from './immichServer'
import type { Handler } from './immichServer'
import { quietLog, seeded, tempDir } from './helpers'

// The photo service over a real Immich provider (its `fetch` stubbed) and the
// real renderer: what happens to the cache and the playlist when Immich is down,
// refuses the key, or hands out a new random batch while a photo is being shown.

afterEach(() => {
  vi.useRealTimers()
})

/** A different small JPEG for every photo, so each renders to its own file. */
const pictures = new Map<string, Buffer>()
async function pictureFor(path: string): Promise<Response> {
  const id = path.split('/')[3]!
  if (!pictures.has(id)) {
    const [r, g, b] = [...Buffer.from(id.replaceAll('-', '').slice(0, 6), 'hex')] as [number, number, number]
    pictures.set(id, await sharp({ create: { width: 320, height: 180, channels: 3, background: { r, g, b } } }).jpeg().toBuffer())
  }
  return new Response(new Uint8Array(pictures.get(id)!), { headers: { 'Content-Type': 'image/jpeg' } })
}

type Mode = 'albums' | 'random'

async function setup(mode: Mode, handler: Handler) {
  const stub = immich(handler)
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const dir = join(await tempDir(), 'photos')
  const { db } = migratedMemoryDb()
  const provider = createImmichProvider(
    { url: 'http://immich.example.test:2283', api_key: KEY, mode, album_ids: mode === 'albums' ? [ALBUM_A] : [], random: { count: 200, person_ids: [] } },
    { fetch: stub.fetch, log },
  )
  const service = createPhotoService({
    db,
    dir,
    providers: [provider],
    maxBytes: 50_000_000,
    landscapeOnly: false,
    render: renderPhoto,
    random: seeded(3),
    log: { ...quietLog(), ...log },
  })
  const files = () => existsSync(dir) ? readdirSync(dir).filter(name => !name.startsWith('.')) : []
  return { ...stub, service, log, files, dir }
}

/** `handler` for everything but the thumbnails, which are a picture of the photo's own colour. */
const thumbnails = (handler: Handler): Handler => call => /\/thumbnail$/.test(call.url.pathname) ? pictureFor(call.url.pathname) : handler(call)
const unless = (broken: () => boolean, status: number, handler: Handler): Handler => call => broken() ? new Response(null, { status }) : handler(call)

describe('if Immich is down, the cache keeps rotating', () => {
  it('shows only photos from the cache while the listing and the downloads fail, and says why on the status', async () => {
    let down = false
    const { service, files, log } = await setup('albums', unless(() => down, 503, thumbnails(server())))
    await service.refresh()
    const shown = new Set<string>()
    for (let i = 0; i < 3; i++) shown.add((await service.next('hallway', 'immich'))!.id)
    await service.idle()
    const cached = files().length
    expect(cached).toBeGreaterThanOrEqual(3)
    // Immich goes down; the pool is listed again and cannot be.
    down = true
    await service.refresh()

    const status = service.status().providers[0]!
    expect(status.photos).toBe(5)
    expect(status.last_error).toBe('Immich could not be reached: it answered with an error (HTTP 503)')

    const after: string[] = []
    for (let i = 0; i < 8; i++) after.push((await service.next('hallway', 'immich'))!.id)
    await service.idle()
    // The frame never went blank, and nothing new came into the cache.
    expect(after).toHaveLength(8)
    expect(files().length).toBe(cached)
    const cachedIds = new Set(after)
    expect(cachedIds.size).toBeGreaterThanOrEqual(3)
    expect(cachedIds.size).toBeLessThanOrEqual(cached)
    expect(log.warn.mock.calls.flat().join('\n')).not.toContain(KEY)
  })

  it('starts rotating again, with the whole pool, when Immich is back', async () => {
    let down = false
    const { service } = await setup('albums', unless(() => down, 503, thumbnails(server())))
    await service.refresh()
    await service.next('hallway', 'immich')
    await service.idle()
    down = true
    await service.refresh()
    expect(service.status().providers[0]!.last_error).not.toBeNull()
    down = false
    await service.refresh()

    expect(service.status().providers[0]!.last_error).toBeNull()
    const seen = new Set<string>()
    for (let i = 0; i < 5; i++) seen.add((await service.next('hallway', 'immich'))!.id)
    expect(seen.size).toBe(5)
  })

  it('has nothing to show if Immich was never reachable, rather than failing', async () => {
    const { service } = await setup('albums', () => new Response(null, { status: 502 }))
    await service.refresh()

    expect(await service.next('hallway', 'immich')).toBeNull()
    expect(service.status().providers[0]!.last_error).toContain('HTTP 502')
  })

  it('reports a refused key clearly on the status and in the log, without the key', async () => {
    const { service, log } = await setup('random', () => new Response(JSON.stringify({ message: `Invalid API key ${KEY}` }), { status: 401 }))

    await service.refresh()

    expect(service.status().providers[0]!.last_error).toBe('Immich refused the API key (HTTP 401)')
    const logged = JSON.stringify([...log.warn.mock.calls, ...log.info.mock.calls, ...log.error.mock.calls])
    expect(logged).toContain('Immich refused the API key')
    expect(logged).not.toContain(KEY)
    expect(JSON.stringify(service.status())).not.toContain(KEY)
  })

  it('keeps rotating when only the downloads fail (a photo taken out of Immich, then a 5xx)', async () => {
    let failing = false
    const { service, files } = await setup('albums', call => failing && /\/thumbnail$/.test(call.url.pathname) ? new Response(null, { status: 500 }) : thumbnails(server())(call))
    await service.refresh()
    const first = (await service.next('hallway', 'immich'))!
    await service.idle()
    failing = true

    const photo = await service.next('hallway', 'immich')

    // Only photos already in the cache are candidates: the one on the wall, or the one prepared after it.
    expect(files()).toHaveLength(2)
    expect(files()).toContain(photo!.url.split('/').pop())
    expect(photo!.id).not.toBe(first.id)
  })
})

describe('a random pick is a new pool at every listing', () => {
  const batch = (names: string[]) => (json('search-random.json') as { id: string, originalFileName: string }[]).filter(asset => names.includes(asset.originalFileName.replace(/\.\w+$/, '')))
  const relabel = (assets: object[], prefix: string) => assets.map((asset, index) => ({ ...asset, id: `${prefix}0000000-0000-4000-8000-00000000000${index}` }))

  it('goes on with the next batch, and the photo still on the wall from the last one is not broken', async () => {
    let random: object[] = batch(['garden', 'harbour', 'snow'])
    const { service, files } = await setup('random', thumbnails(call => call.url.pathname === '/api/search/random' ? jsonResponse(random) : server()(call)))
    await service.refresh()
    const onWall = (await service.next('hallway', 'immich'))!
    const wallFile = onWall.url.split('/').pop()!
    await service.idle()

    // A new batch with none of the old photos. The two that were downloaded stay in the pool
    // (so they stay in the cache), with the three new ones.
    random = relabel(batch(['no-exif', 'no-date', 'old-bike']), 'b')
    await service.refresh()

    expect(files()).toContain(wallFile)
    expect(service.status().providers[0]!.photos).toBe(5)
    const seen = [onWall.id]
    for (let i = 0; i < 4; i++) seen.push((await service.next('hallway', 'immich'))!.id)
    // Every photo of the new pool once before any repeats: the old photo on the wall is not shown again at once.
    expect(new Set(seen).size).toBe(5)
    expect(seen.filter(id => id.startsWith('immich:b'))).toHaveLength(3)
  })

  it('keeps going when a photo is taken out of the pool while it is being downloaded, and stores nothing for it', async () => {
    let random: object[] = relabel(batch(['garden']), 'a')
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    let hold = true
    const { service, files, calls } = await setup('random', async (call) => {
      if (call.url.pathname === '/api/search/random') return jsonResponse(random)
      if (hold && /\/thumbnail$/.test(call.url.pathname)) await gate
      return pictureFor(call.url.pathname)
    })
    await service.refresh()

    const pending = service.next('hallway', 'immich')
    // The download has started when the next batch replaces the pool.
    await vi.waitFor(() => expect(calls.some(call => /\/thumbnail$/.test(call.url.pathname))).toBe(true))
    random = relabel(batch(['harbour']), 'b')
    await service.refresh()
    hold = false
    release()

    const photo = await pending

    expect(photo!.id).toBe('immich:b0000000-0000-4000-8000-000000000000')
    await service.idle()
    await service.refresh()
    expect(files()).toHaveLength(1)
    expect(files()[0]).toBe(photo!.url.split('/').pop())
  })
})
