import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PhotoSource } from '../../../shared/display'
import { photoInfoSchema, photoUrl } from '../../../shared/photos'
import { REFRESH_INTERVAL_MS, createPhotoService } from '../../../server/photos/service'
import type { PhotoService, PhotoServiceOptions } from '../../../server/photos/service'
import { getAsset, getRendition, listPool } from '../../../server/photos/store'
import { migratedMemoryDb } from '../db/helpers'
import { fakeProvider, fakeRender, quietLog, seeded, tempDir } from './helpers'
import type { FakeProvider } from './helpers'

// The service over fake providers, an in-memory database and a real cache
// folder. Rendering is faked too (see helpers.ts): what is being tested is
// which photo is chosen, when it is fetched and what stays in the cache.

afterEach(() => {
  vi.useRealTimers()
})

interface Setup {
  service: PhotoService
  db: ReturnType<typeof migratedMemoryDb>['db']
  dir: string
  providers: Record<string, FakeProvider>
  files: () => string[]
  log: ReturnType<typeof quietLog> & { warn: ReturnType<typeof vi.fn> }
}

async function setup(
  pools: Partial<Record<PhotoSource, string[]>> = { local: ['a', 'b', 'c'] },
  options: Partial<PhotoServiceOptions> & { sizes?: Record<string, [number, number]>, bytes?: number } = {},
  existing?: { db: Setup['db'], dir: string },
): Promise<Setup> {
  const db = existing?.db ?? migratedMemoryDb().db
  const dir = existing?.dir ?? join(await tempDir(), 'photos')
  const providers = Object.fromEntries(Object.entries(pools).map(([id, ids]) => [id, fakeProvider(id as PhotoSource, ids)]))
  const log = { ...quietLog(), warn: vi.fn() }
  const { sizes, bytes, ...rest } = options
  const service = createPhotoService({
    db,
    dir,
    providers: Object.values(providers).map(fake => fake.provider),
    maxBytes: 1_000_000,
    matchOrientation: false,
    render: fakeRender(sizes, bytes),
    random: seeded(7),
    log,
    ...rest,
  })
  const files = () => existsSync(dir) ? readdirSync(dir).filter(name => !name.startsWith('.')) : []
  return { service, db, dir, providers, files, log }
}

/** Lists the providers, as start() does, and waits for it. */
async function listed(context: Setup) {
  await context.service.refresh()
  return context
}

describe('next', () => {
  it('answers a photo from the pool, with where to load it', async () => {
    const { service, files } = await listed(await setup({ local: ['a'] }))

    const photo = await service.next('hallway', 'local')

    expect(photoInfoSchema.parse(photo)).toEqual({
      id: 'local:a',
      url: photoUrl(files()[0]!),
      width: 1600,
      height: 900,
      orientation: 'landscape',
      taken_at: null,
      provider: 'local',
      credit: null,
    })
    expect(photo!.url).toMatch(/^\/photos\/[0-9a-f]{64}\.webp$/)
  })

  it('keeps a feed of the same source apart by its id, and reports the source on the photo', async () => {
    const db = migratedMemoryDb().db
    const dir = join(await tempDir(), 'photos')
    const mountains = fakeProvider('mountains', ['m1', 'm2'], { source: 'unsplash', name: 'Mountains' })
    const lakes = fakeProvider('lakes', ['l1'], { source: 'unsplash' })
    const service = createPhotoService({
      db, dir, providers: [mountains.provider, lakes.provider], maxBytes: 1_000_000, matchOrientation: false, render: fakeRender(), random: seeded(7), log: quietLog(),
    })
    await service.refresh()

    const photo = await service.next('hallway', ['lakes'])
    expect(photo).toMatchObject({ id: 'lakes:l1', provider: 'unsplash' })
    // A reference that names nothing set up falls through to the next, then to the first source's provider.
    expect((await service.next('hallway', ['nothing', 'mountains']))!.id).toMatch(/^mountains:m/)
    expect((await service.next('hallway', 'nothing'))!.id).toMatch(/^mountains:m/)
    expect(service.configured()).toEqual(['unsplash'])
    expect(service.status().providers.map(({ id, name }) => [id, name])).toEqual([['mountains', 'Mountains'], ['lakes', 'Unsplash']])
  })

  it('shows every photo once before any repeats, and then starts again', async () => {
    const { service } = await listed(await setup({ local: ['a', 'b', 'c', 'd'] }))

    const shown: string[] = []
    for (let i = 0; i < 8; i++) shown.push((await service.next('hallway', 'local'))!.id)

    expect([...shown.slice(0, 4)].sort()).toEqual(['local:a', 'local:b', 'local:c', 'local:d'])
    expect([...shown.slice(4)].sort()).toEqual(['local:a', 'local:b', 'local:c', 'local:d'])
    expect(shown[4]).not.toBe(shown[3])
  })

  it('keeps a playlist for each display', async () => {
    const { service } = await listed(await setup({ local: ['a', 'b', 'c'] }))

    const hallway = [(await service.next('hallway', 'local'))!.id, (await service.next('hallway', 'local'))!.id]
    const kitchen = [(await service.next('kitchen', 'local'))!.id, (await service.next('kitchen', 'local'))!.id]

    expect(new Set(hallway).size).toBe(2)
    expect(new Set(kitchen).size).toBe(2)
  })

  it('gives two requests at once for one display two different photos', async () => {
    const { service } = await listed(await setup({ local: ['a', 'b', 'c'] }))

    const [first, second] = await Promise.all([service.next('hallway', 'local'), service.next('hallway', 'local')])

    expect(first!.id).not.toBe(second!.id)
  })

  it('carries on where it left off after a restart', async () => {
    const first = await listed(await setup({ local: ['a', 'b', 'c', 'd', 'e'] }))
    const seen = [(await first.service.next('hallway', 'local'))!.id, (await first.service.next('hallway', 'local'))!.id]
    first.service.stop()

    // A new service, a different random seed, the same database and cache.
    const second = await listed(await setup({ local: ['a', 'b', 'c', 'd', 'e'] }, { random: seeded(99) }, { db: first.db, dir: first.dir }))
    const rest = []
    for (let i = 0; i < 3; i++) rest.push((await second.service.next('hallway', 'local'))!.id)

    expect([...seen, ...rest].sort()).toEqual(['local:a', 'local:b', 'local:c', 'local:d', 'local:e'])
  })

  it('records when a photo was shown', async () => {
    const now = new Date('2026-10-28T12:00:00Z')
    const { service, db } = await listed(await setup({ local: ['a'] }, { now: () => now }))

    await service.next('hallway', 'local')

    expect(listPool(db, 'local')[0]).toMatchObject({ lastShownAt: now })
    expect(getRendition(db, 'local:a', 'landscape')).toMatchObject({ lastShownAt: now, fetchedAt: now })
  })

  it('answers null when there is nothing in the pool', async () => {
    const { service } = await listed(await setup({ local: [] }))

    expect(await service.next('hallway', 'local')).toBeNull()
  })

  it('answers null when no provider is set up', async () => {
    const { service } = await listed(await setup({}))

    expect(await service.next('hallway', 'immich')).toBeNull()
  })

  it('waits for the first listing when the pool is still empty', async () => {
    const context = await setup({ local: ['a'] })
    context.service.start()

    const photo = await context.service.next('hallway', 'local')

    expect(photo?.id).toBe('local:a')
  })
})

describe('which provider', () => {
  it('uses the one the display asks for, if it is set up', async () => {
    const { service } = await listed(await setup({ local: ['a'], immich: ['x'], google: ['g'] }))

    expect((await service.next('hallway', 'google'))!.provider).toBe('google')
    expect((await service.next('hallway', 'local'))!.provider).toBe('local')
    expect((await service.next('hallway', 'immich'))!.provider).toBe('immich')
  })

  it('otherwise uses the first that is: Immich, then Google, then the folder', async () => {
    expect((await (await listed(await setup({ local: ['a'], google: ['g'] }))).service.next('hallway', 'immich'))!.provider).toBe('google')
    expect((await (await listed(await setup({ local: ['a'] }))).service.next('hallway', 'immich'))!.provider).toBe('local')
    expect((await (await listed(await setup({ local: ['a'], immich: ['x'] }))).service.next('hallway', 'google'))!.provider).toBe('immich')
  })

  it('keeps a separate playlist for each provider', async () => {
    const { service } = await listed(await setup({ local: ['a', 'b'], immich: ['x', 'y'] }))

    const local = (await service.next('hallway', 'local'))!.id
    await service.next('hallway', 'immich')
    const localAgain = (await service.next('hallway', 'local'))!.id

    expect(local).not.toBe(localAgain)
  })

  it('lists which providers are set up', async () => {
    const { service } = await setup({ local: [], immich: [] })

    expect(service.configured().sort()).toEqual(['immich', 'local'])
  })
})

describe('the cache', () => {
  it('fetches a photo when it is first asked for, and the one after it in the background', async () => {
    const { service, providers, files } = await listed(await setup({ local: ['a', 'b', 'c', 'd'] }))
    const local = providers.local!

    expect(local.fetched).toEqual([])
    const first = await service.next('hallway', 'local')
    await service.idle()

    expect(local.fetched).toHaveLength(2)
    expect(local.fetched[0]).toBe(first!.id.slice('local:'.length))
    expect(files()).toHaveLength(2)

    // The one that was prepared is served from the cache.
    const second = await service.next('hallway', 'local')
    expect(local.fetched).toContain(second!.id.slice('local:'.length))
    expect(local.fetched.filter(id => id === second!.id.slice('local:'.length))).toHaveLength(1)
  })

  it('fetches a photo shown twice only once', async () => {
    const { service, providers } = await listed(await setup({ local: ['a'] }))

    await service.next('hallway', 'local')
    await service.next('hallway', 'local')
    await service.next('hallway', 'local')
    await service.idle()

    expect(providers.local!.fetched).toEqual(['a'])
  })

  it('fetches again a photo whose file has gone', async () => {
    const { service, providers, files, dir } = await listed(await setup({ local: ['a'] }))
    await service.next('hallway', 'local')
    const { rmSync } = await import('node:fs')
    rmSync(join(dir, files()[0]!))

    const photo = await service.next('hallway', 'local')

    expect(providers.local!.fetched).toEqual(['a', 'a'])
    expect(existsSync(join(dir, photo!.url.split('/').pop()!))).toBe(true)
  })

  it('stays under its cap by evicting what was shown longest ago', async () => {
    let clock = 0
    const { service, db, files } = await listed(await setup({ local: ['a', 'b', 'c', 'd', 'e', 'f'] }, { maxBytes: 350, bytes: 100, now: () => new Date(Date.UTC(2026, 9, 28) + clock++ * 1000) }))

    const shown: string[] = []
    for (let i = 0; i < 6; i++) {
      shown.push((await service.next('hallway', 'local'))!.id)
      await service.idle()
    }

    expect(files().length).toBeLessThanOrEqual(3)
    const cached = listPool(db, 'local').filter(row => getRendition(db, row.id, 'landscape')).map(row => row.id)
    // The photo on the display is always one of them.
    expect(cached).toContain(shown.at(-1))
    expect(service.status().cache_bytes).toBeLessThanOrEqual(350)
  })

  it('never evicts the photo on a display or the one prepared next, even with a cap of one photo', async () => {
    const { service, db } = await listed(await setup({ local: ['a', 'b', 'c', 'd'] }, { maxBytes: 100, bytes: 100 }))

    for (let i = 0; i < 4; i++) {
      const photo = await service.next('hallway', 'local')
      await service.idle()
      const rendition = getRendition(db, photo!.id, 'landscape')
      expect(rendition).toBeDefined()
      expect(photo!.url).toBe(photoUrl(rendition!.cacheFile))
    }
  })

  it('never evicts a photo that is on another display', async () => {
    const { service, db } = await listed(await setup({ local: ['a', 'b', 'c', 'd'] }, { maxBytes: 100, bytes: 100 }))
    const onKitchen = await service.next('kitchen', 'local')

    for (let i = 0; i < 3; i++) {
      await service.next('hallway', 'local')
      await service.idle()
    }

    expect(getRendition(db, onKitchen!.id, 'landscape')).toBeDefined()
  })

  it('removes a photo from the cache once the provider no longer lists it, except the one on a display', async () => {
    const context = await listed(await setup({ local: ['a', 'b'] }))
    const { service, providers, db } = context
    await service.next('hallway', 'local')
    await service.next('hallway', 'local')
    await service.idle()
    expect(context.files()).toHaveLength(2)

    providers.local!.items.clear()
    await service.refresh()

    // Both were cached and both have gone from the pool. The one on the display stays until it moves on.
    expect(listPool(db, 'local')).toEqual([])
    expect(context.files()).toHaveLength(1)
    expect(await service.next('hallway', 'local')).toBeNull()
  })

  it('removes files nothing refers to when it starts', async () => {
    const { service, dir, files } = await setup({ local: ['a'] })
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${'0'.repeat(64)}.webp`), 'x')
    writeFileSync(join(dir, `.${'1'.repeat(64)}.webp.abc.tmp`), 'x')

    service.start()
    await service.refresh()

    expect(readdirSync(dir)).toEqual([])
    expect(files()).toEqual([])
  })
})

describe('a provider that is down', () => {
  it('keeps the pool it had when it can\'t be listed, and says so once', async () => {
    const { service, providers, log } = await listed(await setup({ local: ['a', 'b'] }))
    providers.local!.listFails = true

    await service.refresh()
    await service.refresh()

    expect((await service.next('hallway', 'local'))).not.toBeNull()
    expect(service.status().providers[0]).toMatchObject({ id: 'local', photos: 2, last_error: 'The server did not answer' })
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0]![0]).toContain('The server did not answer')
  })

  it('has no photos if it was never reachable, and none cached', async () => {
    const { service, providers } = await setup({ local: ['a'] })
    providers.local!.listFails = true
    await service.refresh()

    expect(await service.next('hallway', 'local')).toBeNull()
  })

  it('recovers: the error clears at the next good listing', async () => {
    const { service, providers, log } = await listed(await setup({ local: ['a'] }))
    providers.local!.listFails = true
    await service.refresh()
    providers.local!.listFails = false

    await service.refresh()

    expect(service.status().providers[0]!.last_error).toBeNull()
    expect(log.warn).toHaveBeenCalledTimes(1)
  })

  it('goes on rotating the photos that are cached when fetching fails', async () => {
    const { service, providers } = await listed(await setup({ local: ['a', 'b', 'c', 'd', 'e', 'f'] }))
    // Cache two of them while it is up.
    const cached = new Set<string>()
    for (let i = 0; i < 2; i++) cached.add((await service.next('hallway', 'local'))!.id)
    await service.idle()
    // The photo prepared behind the second is cached too.
    const preparedToo = providers.local!.fetched.map(id => `local:${id}`)
    const allCached = new Set([...cached, ...preparedToo])
    providers.local!.fetchFails = true
    providers.local!.listFails = true

    const shown: string[] = []
    for (let i = 0; i < 8; i++) shown.push((await service.next('hallway', 'local'))!.id)

    expect(new Set(shown)).toEqual(allCached)
    expect(allCached.size).toBeLessThan(6)
  })

  it('answers null when fetching fails and nothing is cached', async () => {
    const { service, providers } = await listed(await setup({ local: ['a', 'b'] }))
    providers.local!.fetchFails = true

    expect(await service.next('hallway', 'local')).toBeNull()
    expect(service.status().providers[0]!.last_error).toBe('The server did not answer')
  })

  it('still shows each cached photo once a round when fetching fails part-way', async () => {
    const { service, providers } = await listed(await setup({ local: ['a', 'b', 'c'] }))
    const first = (await service.next('hallway', 'local'))!.id
    await service.idle()
    providers.local!.fetchFails = true

    const second = (await service.next('hallway', 'local'))!.id
    const third = await service.next('hallway', 'local')

    // The two cached photos are shown in turn (the one prepared behind the first, then back to the first).
    expect(second).not.toBe(first)
    expect(third!.id).toBe(first)
  })
})

describe('photos that can\'t be drawn', () => {
  it('skips a photo that can\'t be rendered, says so, and doesn\'t try it again', async () => {
    const { service, providers, log } = await listed(await setup({ local: ['bad', 'good1', 'good2'] }))

    const shown: string[] = []
    for (let i = 0; i < 6; i++) shown.push((await service.next('hallway', 'local'))!.id)

    expect(shown).not.toContain('local:bad')
    expect(new Set(shown)).toEqual(new Set(['local:good1', 'local:good2']))
    expect(providers.local!.fetched.filter(id => id === 'bad')).toHaveLength(1) // not again, not even in the background
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('local:bad'))
  })

  it('answers null when every photo is bad, without spinning', async () => {
    const { service } = await listed(await setup({ local: ['bad', 'x/bad'] }))

    expect(await service.next('hallway', 'local')).toBeNull()
  })
})

describe('renditions', () => {
  it('renders a portrait request to a file of its own, apart from the landscape one of the same photo', async () => {
    const { service, db, files } = await listed(await setup({ local: ['a'] }))

    const landscape = await service.next('hallway', 'local', 'landscape')
    const portrait = await service.next('hallway', 'local', 'portrait')

    expect(portrait!.id).toBe(landscape!.id)
    expect(portrait!.url).not.toBe(landscape!.url)
    expect(getRendition(db, 'local:a', 'landscape')!.cacheFile).toBe(landscape!.url.split('/').pop())
    expect(getRendition(db, 'local:a', 'portrait')!.cacheFile).toBe(portrait!.url.split('/').pop())
    expect(files()).toHaveLength(2)
  })

  it('is landscape when no rendition is named', async () => {
    const { service, db } = await listed(await setup({ local: ['a'] }))

    await service.next('hallway', 'local')

    expect(getRendition(db, 'local:a', 'landscape')).toBeDefined()
    expect(getRendition(db, 'local:a', 'portrait')).toBeUndefined()
  })

  it('prepares the photo after this one in the same rendition', async () => {
    const { service, db } = await listed(await setup({ local: ['a', 'b', 'c'] }))

    await service.next('hallway', 'local', 'portrait')
    await service.idle()

    expect(listPool(db, 'local').filter(row => getRendition(db, row.id, 'portrait'))).toHaveLength(2)
    expect(listPool(db, 'local').filter(row => getRendition(db, row.id, 'landscape'))).toHaveLength(0)
  })

  it('keeps one playlist for both shapes of a display', async () => {
    const { service } = await listed(await setup({ local: ['a', 'b', 'c'] }))

    const shown = [
      (await service.next('hallway', 'local', 'landscape'))!.id,
      (await service.next('hallway', 'local', 'portrait'))!.id,
      (await service.next('hallway', 'local', 'landscape'))!.id,
    ]

    expect(new Set(shown).size).toBe(3)
  })

  it('protects the photo a display shows in each rendition from eviction', async () => {
    // Room for two files, and a photo in two shapes on one display is two.
    const { service, db } = await listed(await setup({ local: ['a', 'b', 'c', 'd'] }, { maxBytes: 200, bytes: 100 }))
    const landscape = await service.next('hallway', 'local', 'landscape')
    const portrait = await service.next('hallway', 'local', 'portrait')

    for (let i = 0; i < 3; i++) {
      await service.next('kitchen', 'local', 'landscape')
      await service.idle()
    }

    expect(getRendition(db, landscape!.id, 'landscape')?.cacheFile).toBe(landscape!.url.split('/').pop())
    expect(getRendition(db, portrait!.id, 'portrait')?.cacheFile).toBe(portrait!.url.split('/').pop())
  })

  it('counts a photo as cached when any of its renditions is', async () => {
    const context = await listed(await setup({ local: ['a', 'b'] }))

    await context.service.next('hallway', 'local', 'portrait')
    await context.service.idle()

    expect(context.service.status().providers[0]).toMatchObject({ photos: 2, cached: 2 })
  })
})

describe('the box a photo is drawn in', () => {
  const wide = { width: 1920, height: 1080 }
  /** A service whose listing says each photo's size, which is also what rendering finds. */
  async function sized(sizes: Record<string, [number, number]>, options: Parameters<typeof setup>[1] = {}) {
    const context = await setup({ local: Object.keys(sizes) }, { ...options, sizes })
    for (const [id, [width, height]] of Object.entries(sizes)) context.providers.local!.items.set(id, { width, height })
    return listed(context)
  }

  it('serves a photo close to the box\'s shape as its cover file, and others as the composite', async () => {
    const { service, db } = await sized({ phone: [4032, 3024], tall: [3024, 4032], wide: [1600, 900] })
    const seen = new Map<string, string>()
    for (let i = 0; i < 3; i++) {
      const photo = (await service.next('hallway', 'local', 'landscape', wide))!
      seen.set(photo.id, photo.url.split('/').pop()!)
    }

    expect(getRendition(db, 'local:phone', 'cover')!.cacheFile).toBe(seen.get('local:phone'))
    expect(getRendition(db, 'local:wide', 'cover')!.cacheFile).toBe(seen.get('local:wide'))
    expect(getRendition(db, 'local:tall', 'cover')).toBeUndefined()
    expect(getRendition(db, 'local:tall', 'landscape')!.cacheFile).toBe(seen.get('local:tall'))
    expect(getRendition(db, 'local:phone', 'landscape')).toBeUndefined()
  })

  it('judges by the box, not the stage: a portrait box on a landscape display covers a 3:4 photo', async () => {
    const { service, db } = await sized({ a: [3024, 4032] })

    await service.next('hallway', 'local', 'portrait', { width: 900, height: 1200 })

    expect(getRendition(db, 'local:a', 'cover')).toBeDefined()
    expect(getRendition(db, 'local:a', 'portrait')).toBeUndefined()
  })

  it('is as before without a box', async () => {
    const { service, db } = await sized({ a: [4032, 3024] })

    await service.next('hallway', 'local', 'landscape')

    expect(getRendition(db, 'local:a', 'cover')).toBeUndefined()
    expect(getRendition(db, 'local:a', 'landscape')).toBeDefined()
  })

  it('prepares the next photo in the rendition it will be shown in', async () => {
    const { service, db } = await sized({ a: [4032, 3024], b: [4032, 3024] })

    await service.next('hallway', 'local', 'landscape', wide)
    await service.idle()

    expect(listPool(db, 'local').filter(row => getRendition(db, row.id, 'cover'))).toHaveLength(2)
    expect(listPool(db, 'local').filter(row => getRendition(db, row.id, 'landscape'))).toHaveLength(0)
  })

  it('renders a photo of unknown size as the composite first, then as the cover file if it turns out close', async () => {
    const context = await setup({ local: ['a'] }, { sizes: { a: [4032, 3024] } })
    context.providers.local!.items.set('a', { width: 0, height: 0 })
    await listed(context)
    expect(getAsset(context.db, 'local:a')!.width).toBe(0)

    const photo = (await context.service.next('hallway', 'local', 'landscape', wide))!

    expect(photo).toMatchObject({ width: 4032, height: 3024 })
    expect(getRendition(context.db, 'local:a', 'cover')!.cacheFile).toBe(photo.url.split('/').pop())
    expect(getRendition(context.db, 'local:a', 'landscape')).toBeDefined()
  })

  it('serves the composite for an unknown size that turns out not to be close', async () => {
    const context = await setup({ local: ['a'] }, { sizes: { a: [3024, 4032] } })
    context.providers.local!.items.set('a', { width: 0, height: 0 })
    await listed(context)
    expect(getAsset(context.db, 'local:a')!.width).toBe(0)

    const photo = (await context.service.next('hallway', 'local', 'landscape', wide))!

    expect(getRendition(context.db, 'local:a', 'landscape')!.cacheFile).toBe(photo.url.split('/').pop())
    expect(getRendition(context.db, 'local:a', 'cover')).toBeUndefined()
  })

  it('protects the cover file a display shows from eviction', async () => {
    const { service, db } = await sized({ a: [4032, 3024], b: [4032, 3024], c: [4032, 3024], d: [4032, 3024] }, { maxBytes: 200, bytes: 100 })
    const shown = await service.next('hallway', 'local', 'landscape', wide)

    for (let i = 0; i < 3; i++) {
      await service.next('kitchen', 'local', 'landscape', wide)
      await service.idle()
    }

    expect(getRendition(db, shown!.id, 'cover')?.cacheFile).toBe(shown!.url.split('/').pop())
  })

  it('falls back to a cached composite when the cover file can\'t be made because the provider is down', async () => {
    const { service, providers, db } = await sized({ a: [4032, 3024] })
    await service.next('hallway', 'local', 'landscape') // no box: the composite is cached
    providers.local!.fetchFails = true

    const photo = await service.next('hallway', 'local', 'landscape', wide)

    expect(photo!.id).toBe('local:a')
    expect(getRendition(db, 'local:a', 'landscape')!.cacheFile).toBe(photo!.url.split('/').pop())
    expect(getRendition(db, 'local:a', 'cover')).toBeUndefined()
  })

  it('is null when it is down and neither the cover file nor the composite is cached', async () => {
    const { service, providers } = await sized({ a: [4032, 3024] })
    providers.local!.fetchFails = true

    expect(await service.next('hallway', 'local', 'landscape', wide)).toBeNull()
  })

  it('keeps the composite of a photo of unknown size when the cover step fails', async () => {
    const context = await setup({ local: ['a'] }, { sizes: { a: [4032, 3024] } })
    context.providers.local!.items.set('a', { width: 0, height: 0 })
    await listed(context)
    const fetchOnce = context.providers.local!.provider.fetch
    let calls = 0
    context.providers.local!.provider.fetch = async (id) => {
      if (++calls > 1) throw new Error('down')
      return fetchOnce(id)
    }

    const photo = await context.service.next('hallway', 'local', 'landscape', wide)

    expect(photo!.id).toBe('local:a')
    expect(getRendition(context.db, 'local:a', 'landscape')!.cacheFile).toBe(photo!.url.split('/').pop())
  })

  it('still leaves out photos of the other orientation when the shapes are to match', async () => {
    const { service } = await sized({ wide: [4032, 3024], tall: [3024, 4032] }, { matchOrientation: true })

    const shown = new Set<string>()
    for (let i = 0; i < 4; i++) shown.add((await service.next('hallway', 'local', 'landscape', wide))!.id)

    expect(shown).toEqual(new Set(['local:wide']))
  })
})

describe('matching the orientation', () => {
  /** Two wide photos and two tall ones, all sized by the listing. */
  async function mixed(matchOrientation: boolean) {
    const context = await setup({ local: ['wide1', 'tall1', 'wide2', 'tall2'] }, { matchOrientation, sizes: { tall1: [900, 1600], tall2: [900, 1600] } })
    for (const id of ['tall1', 'tall2']) context.providers.local!.items.set(id, { width: 900, height: 1600 })
    await context.service.refresh()
    return context
  }
  const rounds = async (context: Setup, rendition: 'landscape' | 'portrait', count: number, displayId = 'hallway') => {
    const shown: string[] = []
    for (let i = 0; i < count; i++) shown.push((await context.service.next(displayId, 'local', rendition))!.id)
    return shown
  }

  it('leaves out portrait photos on a landscape display, and never fetches them', async () => {
    const context = await mixed(true)

    const shown = await rounds(context, 'landscape', 6)
    await context.service.idle()

    expect(new Set(shown)).toEqual(new Set(['local:wide1', 'local:wide2']))
    expect(context.providers.local!.fetched).not.toContain('tall1')
    expect(context.providers.local!.fetched).not.toContain('tall2')
  })

  it('leaves out landscape photos on a portrait display', async () => {
    const context = await mixed(true)

    const shown = await rounds(context, 'portrait', 6)
    await context.service.idle()

    expect(new Set(shown)).toEqual(new Set(['local:tall1', 'local:tall2']))
    expect(context.providers.local!.fetched).not.toContain('wide1')
  })

  it('serves the photos it passed over to a display of the other shape', async () => {
    const context = await mixed(true)

    // A landscape request goes first and passes over the tall ones, which keep their place.
    const wide = await rounds(context, 'landscape', 2)
    const tall = await rounds(context, 'portrait', 2)

    expect(new Set(wide)).toEqual(new Set(['local:wide1', 'local:wide2']))
    expect(new Set(tall)).toEqual(new Set(['local:tall1', 'local:tall2']))
  })

  it('keeps a round going for each shape without one starving the other', async () => {
    const context = await mixed(true)

    const shown: string[] = []
    for (let i = 0; i < 2; i++) {
      shown.push((await context.service.next('hallway', 'local', 'landscape'))!.id)
      shown.push((await context.service.next('hallway', 'local', 'portrait'))!.id)
    }

    expect(new Set(shown)).toEqual(new Set(['local:wide1', 'local:wide2', 'local:tall1', 'local:tall2']))
  })

  it('shows photos of every shape on either display when it is off', async () => {
    const context = await mixed(false)

    expect(new Set(await rounds(context, 'portrait', 4))).toEqual(new Set(['local:wide1', 'local:wide2', 'local:tall1', 'local:tall2']))
  })

  it('finds out a photo has the other shape when it renders it, and passes over it from then on', async () => {
    const context = await setup({ local: ['wide', 'tall'] }, { matchOrientation: true, sizes: { tall: [900, 1600] } })
    context.providers.local!.items.set('wide', undefined)
    context.providers.local!.items.set('tall', undefined)
    await context.service.refresh()

    const shown = await rounds(context, 'landscape', 5)

    expect(new Set(shown)).toEqual(new Set(['local:wide']))
    expect(getAsset(context.db, 'local:tall')).toMatchObject({ orientation: 'portrait', width: 900, height: 1600 })
    // And it is there for a portrait display.
    expect(new Set(await rounds(context, 'portrait', 3, 'kitchen'))).toEqual(new Set(['local:tall']))
  })

  it('answers null when no photo has the shape asked for', async () => {
    const context = await setup({ local: ['tall'] }, { matchOrientation: true, sizes: { tall: [900, 1600] } })
    context.providers.local!.items.set('tall', { width: 900, height: 1600 })
    await context.service.refresh()

    expect(await context.service.next('hallway', 'local', 'landscape')).toBeNull()
    expect((await context.service.next('hallway', 'local', 'portrait'))!.id).toBe('local:tall')
  })

  it('only offers the cached photos of the right shape when the provider is down', async () => {
    const context = await mixed(true)
    await rounds(context, 'portrait', 2)
    await context.service.idle()
    context.providers.local!.fetchFails = true
    context.providers.local!.listFails = true

    const shown = await rounds(context, 'portrait', 4)

    expect(new Set(shown)).toEqual(new Set(['local:tall1', 'local:tall2']))
    // Nothing of the other shape is cached, and nothing can be fetched.
    expect(await context.service.next('hallway', 'local', 'landscape')).toBeNull()
  })
})

describe('when the pool changes', () => {
  it('shows a new photo before the round ends, and not a removed one', async () => {
    const { service, providers } = await listed(await setup({ local: ['a', 'b', 'c', 'd', 'e', 'f'] }))
    const first = (await service.next('hallway', 'local'))!.id
    await service.idle()

    providers.local!.items.set('new', { width: 1600, height: 900 })
    const gone = [...providers.local!.items.keys()].find(id => `local:${id}` !== first && id !== 'new')!
    providers.local!.items.delete(gone)
    await service.refresh()

    const rest: string[] = []
    for (let i = 0; i < 5; i++) rest.push((await service.next('hallway', 'local'))!.id)

    expect(rest).toContain('local:new')
    expect(rest).not.toContain(`local:${gone}`)
    expect(rest).not.toContain(first)
  })
})

describe('refreshing', () => {
  it('lists every provider at start and every ten minutes after', async () => {
    vi.useFakeTimers()
    const { service, providers } = await setup({ local: ['a'], immich: ['x'] })

    service.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(providers.local!.listCalls).toBe(1)
    expect(providers.immich!.listCalls).toBe(1)

    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS - 1)
    expect(providers.local!.listCalls).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(providers.local!.listCalls).toBe(2)
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS)
    expect(providers.local!.listCalls).toBe(3)
    service.stop()
  })

  it('uses the interval it is given', async () => {
    vi.useFakeTimers()
    const { service, providers } = await setup({ local: ['a'] }, { refreshIntervalMs: 1000 })

    service.start()
    await vi.advanceTimersByTimeAsync(3500)

    expect(providers.local!.listCalls).toBe(4)
    service.stop()
  })

  describe('a provider with an interval of its own', () => {
    const HOUR = 60 * 60 * 1000
    const slow = (fake: FakeProvider) => { (fake.provider as { refreshIntervalMs?: number }).refreshIntervalMs = HOUR }

    it('is listed at start, then skipped by the ticks until its interval has passed', async () => {
      vi.useFakeTimers()
      const { service, providers } = await setup({ local: ['a'], unsplash: ['x'] })
      slow(providers.unsplash!)

      service.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(providers.unsplash!.listCalls).toBe(1)

      // Five ticks at 10 minutes: the other provider keeps going, this one waits.
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 5)
      expect(providers.local!.listCalls).toBe(6)
      expect(providers.unsplash!.listCalls).toBe(1)

      // The sixth tick is exactly an hour on: due.
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS)
      expect(providers.unsplash!.listCalls).toBe(2)
      service.stop()
    })

    it('is tried again at the next tick after a failure, not after its whole interval', async () => {
      vi.useFakeTimers()
      const { service, providers } = await setup({ unsplash: ['x'] })
      slow(providers.unsplash!)
      providers.unsplash!.listFails = true

      service.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(providers.unsplash!.listCalls).toBe(1)
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS)
      expect(providers.unsplash!.listCalls).toBe(2)

      providers.unsplash!.listFails = false
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS)
      expect(providers.unsplash!.listCalls).toBe(3)
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS)
      expect(providers.unsplash!.listCalls).toBe(3)
      service.stop()
    })

    it('is listed again by a forced refresh, and by nothing else in between', async () => {
      vi.useFakeTimers()
      const { service, providers } = await setup({ unsplash: ['x'] })
      slow(providers.unsplash!)

      await service.refresh()
      await service.refresh()
      expect(providers.unsplash!.listCalls).toBe(1)

      await service.refresh({ force: true })
      expect(providers.unsplash!.listCalls).toBe(2)
    })
  })

  it('shares one listing between callers that ask at once', async () => {
    const { service, providers } = await setup({ local: ['a'] })

    await Promise.all([service.refresh(), service.refresh(), service.refresh()])

    expect(providers.local!.listCalls).toBe(1)
  })

  it('stops listing, and answers nothing, once stopped', async () => {
    vi.useFakeTimers()
    const { service, providers } = await setup({ local: ['a'] })
    service.start()
    await vi.advanceTimersByTimeAsync(0)

    service.stop()
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 3)

    expect(providers.local!.listCalls).toBe(1)
    await service.refresh()
    expect(providers.local!.listCalls).toBe(1)
    expect(await service.next('hallway', 'local')).toBeNull()
  })

  it('ignores a listing that finishes after it was stopped', async () => {
    const { service, providers, db } = await setup({ local: ['a'] })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const list = providers.local!.provider.list.bind(providers.local!.provider)
    providers.local!.provider.list = async () => { await gate; return list() }

    service.start()
    service.stop()
    release()
    await service.refresh()
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(listPool(db, 'local')).toEqual([])
  })

  it('reports each provider\'s state', async () => {
    const context = await setup({ local: ['a', 'b'] }, { now: () => new Date('2026-10-28T12:00:00Z') })
    expect(context.service.status()).toEqual({ providers: [{ id: 'local', source: 'local', name: 'Local folder', photos: 0, cached: 0, last_success_at: null, last_error: null }], cache_bytes: 0 })

    await context.service.refresh()
    await context.service.next('hallway', 'local')
    await context.service.idle()

    expect(context.service.status()).toEqual({
      providers: [{ id: 'local', source: 'local', name: 'Local folder', photos: 2, cached: 2, last_success_at: '2026-10-28T12:00:00.000Z', last_error: null }],
      cache_bytes: 200,
    })
  })
})
