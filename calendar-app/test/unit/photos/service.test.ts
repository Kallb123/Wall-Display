import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PhotoSource } from '../../../shared/display'
import { photoInfoSchema, photoUrl } from '../../../shared/photos'
import { REFRESH_INTERVAL_MS, createPhotoService } from '../../../server/photos/service'
import type { PhotoService, PhotoServiceOptions } from '../../../server/photos/service'
import { listPool } from '../../../server/photos/store'
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
    landscapeOnly: false,
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
    })
    expect(photo!.url).toMatch(/^\/photos\/[0-9a-f]{64}\.webp$/)
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

    expect(listPool(db, 'local')[0]).toMatchObject({ lastShownAt: now, fetchedAt: now })
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
    const cached = listPool(db, 'local').filter(row => row.cacheFile).map(row => row.id)
    // The photo on the display is always one of them.
    expect(cached).toContain(shown.at(-1))
    expect(service.status().cache_bytes).toBeLessThanOrEqual(350)
  })

  it('never evicts the photo on a display or the one prepared next, even with a cap of one photo', async () => {
    const { service, db } = await listed(await setup({ local: ['a', 'b', 'c', 'd'] }, { maxBytes: 100, bytes: 100 }))

    for (let i = 0; i < 4; i++) {
      const photo = await service.next('hallway', 'local')
      await service.idle()
      const row = listPool(db, 'local').find(item => item.id === photo!.id)!
      expect(row.cacheFile).not.toBeNull()
      expect(photo!.url).toBe(photoUrl(row.cacheFile!))
    }
  })

  it('never evicts a photo that is on another display', async () => {
    const { service, db } = await listed(await setup({ local: ['a', 'b', 'c', 'd'] }, { maxBytes: 100, bytes: 100 }))
    const onKitchen = await service.next('kitchen', 'local')

    for (let i = 0; i < 3; i++) {
      await service.next('hallway', 'local')
      await service.idle()
    }

    const row = listPool(db, 'local').find(item => item.id === onKitchen!.id)!
    expect(row.cacheFile).not.toBeNull()
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

describe('landscape only', () => {
  it('leaves out portrait photos the provider listed with their size', async () => {
    const context = await setup({ local: ['wide1', 'tall', 'wide2'] }, { landscapeOnly: true })
    context.providers.local!.items.set('tall', { width: 900, height: 1600 })
    await context.service.refresh()

    const shown: string[] = []
    for (let i = 0; i < 6; i++) shown.push((await context.service.next('hallway', 'local'))!.id)

    expect(new Set(shown)).toEqual(new Set(['local:wide1', 'local:wide2']))
    expect(context.providers.local!.fetched).not.toContain('tall')
  })

  it('finds out a photo is portrait when it renders it, and passes over it from then on', async () => {
    const context = await setup({ local: ['wide', 'tall'] }, { landscapeOnly: true, sizes: { tall: [900, 1600] } })
    context.providers.local!.items.set('wide', undefined)
    context.providers.local!.items.set('tall', undefined)
    await context.service.refresh()

    const shown: string[] = []
    for (let i = 0; i < 5; i++) shown.push((await context.service.next('hallway', 'local'))!.id)

    expect(new Set(shown)).toEqual(new Set(['local:wide']))
  })

  it('shows portrait photos when it is off', async () => {
    const context = await setup({ local: ['wide', 'tall'] })
    context.providers.local!.items.set('tall', { width: 900, height: 1600 })
    await context.service.refresh()

    const shown = new Set<string>()
    for (let i = 0; i < 4; i++) shown.add((await context.service.next('hallway', 'local'))!.id)

    expect(shown).toEqual(new Set(['local:wide', 'local:tall']))
  })

  it('answers null when every photo is portrait', async () => {
    const context = await setup({ local: ['tall'] }, { landscapeOnly: true })
    context.providers.local!.items.set('tall', { width: 900, height: 1600 })
    await context.service.refresh()

    expect(await context.service.next('hallway', 'local')).toBeNull()
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
    expect(context.service.status()).toEqual({ providers: [{ id: 'local', photos: 0, cached: 0, last_success_at: null, last_error: null }], cache_bytes: 0 })

    await context.service.refresh()
    await context.service.next('hallway', 'local')
    await context.service.idle()

    expect(context.service.status()).toEqual({
      providers: [{ id: 'local', photos: 2, cached: 2, last_success_at: '2026-10-28T12:00:00.000Z', last_error: null }],
      cache_bytes: 200,
    })
  })
})
