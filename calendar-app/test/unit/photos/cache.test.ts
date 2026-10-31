import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PHOTO_FILE_NAME, createPhotoCache, photoFileName } from '../../../server/photos/cache'
import type { PhotoCache } from '../../../server/photos/cache'
import { getAsset, markShown, syncListing } from '../../../server/photos/store'
import type { RenderedPhoto } from '../../../server/photos/render'
import { migratedMemoryDb } from '../db/helpers'
import { quietLog, tempDir } from './helpers'

// The cache over an in-memory database and a real folder. A "photo" here is
// just some bytes: the cache never decodes them.

const MINUTE = 60_000
const T0 = Date.UTC(2026, 9, 28, 12)
const at = (minutes: number) => new Date(T0 + minutes * MINUTE)

function rendered(content: string, size = 100): RenderedPhoto {
  return { data: Buffer.from(content.padEnd(size, '.')), width: 1600, height: 900, orientation: 'landscape' }
}

async function setup({ maxBytes = 250, protect = [] as string[] } = {}) {
  const { db } = migratedMemoryDb()
  const dir = join(await tempDir(), 'photos')
  const clock = { now: at(0) }
  const kept = new Set(protect)
  const cache: PhotoCache = createPhotoCache({ db, dir, maxBytes, protect: () => kept, now: () => clock.now, log: quietLog() })
  syncListing(db, 'local', ['a', 'b', 'c', 'd'].map(providerAssetId => ({ providerAssetId })), at(0))
  const files = () => existsSync(dir) ? readdirSync(dir).sort() : []
  return { db, dir, cache, clock, kept, files }
}

describe('store', () => {
  it('writes the photo under the hash of its bytes and notes it on the asset', async () => {
    const { db, dir, cache, clock, files } = await setup()
    clock.now = at(5)
    const photo = rendered('a')

    const file = cache.store('local:a', photo)

    expect(file).toBe(photoFileName(photo.data))
    expect(file).toMatch(PHOTO_FILE_NAME)
    expect(readFileSync(join(dir, file))).toEqual(photo.data)
    expect(files()).toEqual([file])
    expect(getAsset(db, 'local:a')).toMatchObject({ cacheFile: file, cacheBytes: 100, width: 1600, height: 900, orientation: 'landscape', fetchedAt: at(5) })
    expect(cache.has(file)).toBe(true)
  })

  it('leaves no temporary file behind', async () => {
    const { cache, files } = await setup()

    cache.store('local:a', rendered('a'))

    expect(files().filter(name => name.startsWith('.'))).toEqual([])
  })

  it('stores identical bytes once, however many photos render to them', async () => {
    const { db, cache, files } = await setup()

    const first = cache.store('local:a', rendered('same'))
    const second = cache.store('local:b', rendered('same'))

    expect(second).toBe(first)
    expect(files()).toEqual([first])
    expect(cache.bytes()).toBe(100)
    expect(getAsset(db, 'local:b')?.cacheFile).toBe(first)
  })

  it('removes the file a photo had before, when it renders to something else and nothing else uses the old one', async () => {
    const { cache, files } = await setup()
    const old = cache.store('local:a', rendered('before'))

    const next = cache.store('local:a', rendered('after'))

    expect(next).not.toBe(old)
    expect(files()).toEqual([next])
  })

  it('keeps the old file when another photo still uses it', async () => {
    const { cache, files } = await setup()
    const shared = cache.store('local:a', rendered('same'))
    cache.store('local:b', rendered('same'))

    cache.store('local:a', rendered('different'))

    expect(files()).toContain(shared)
    expect(files()).toHaveLength(2)
  })

  it('tells a missing file from a name that is not one of ours', async () => {
    const { cache } = await setup()

    expect(cache.has('0'.repeat(64) + '.webp')).toBe(false)
    expect(cache.has('../../etc/passwd')).toBe(false)
  })
})

describe('the size cap', () => {
  it('evicts the photo shown longest ago first, and nulls its row', async () => {
    const { db, cache, clock, files } = await setup({ maxBytes: 250 })
    cache.store('local:a', rendered('a'))
    markShown(db, 'local:a', at(30))
    cache.store('local:b', rendered('b'))
    markShown(db, 'local:b', at(10))

    clock.now = at(50)
    cache.store('local:c', rendered('c')) // 300 bytes: over 250

    expect(getAsset(db, 'local:b')).toMatchObject({ cacheFile: null, cacheBytes: null })
    expect(getAsset(db, 'local:a')?.cacheFile).not.toBeNull()
    expect(files()).toHaveLength(2)

    markShown(db, 'local:c', at(20))
    clock.now = at(60)
    cache.store('local:d', rendered('d')) // over again: c (shown at 20) goes before a (30), and d is new

    expect(getAsset(db, 'local:c')?.cacheFile).toBeNull()
    expect(getAsset(db, 'local:a')?.cacheFile).not.toBeNull()
    expect(getAsset(db, 'local:d')?.cacheFile).not.toBeNull()
    expect(files()).toHaveLength(2)
    expect(cache.bytes()).toBe(200)
  })

  it('counts a photo that was never shown from when it was fetched', async () => {
    const { db, cache, clock } = await setup({ maxBytes: 150 })
    clock.now = at(1)
    cache.store('local:a', rendered('a'))
    markShown(db, 'local:a', at(2))
    clock.now = at(5)
    cache.store('local:b', rendered('b')) // never shown, fetched at 5: newer than a's showing at 2.

    expect(getAsset(db, 'local:a')?.cacheFile).toBeNull()
    expect(getAsset(db, 'local:b')?.cacheFile).not.toBeNull()
  })

  it('never evicts a photo that is on a display', async () => {
    const { db, cache, clock, kept, files } = await setup({ maxBytes: 150 })
    clock.now = at(1)
    const a = cache.store('local:a', rendered('a'))
    markShown(db, 'local:a', at(1)) // the oldest, so first in line
    kept.add(a)

    clock.now = at(2)
    cache.store('local:b', rendered('b'))
    clock.now = at(3)
    cache.store('local:c', rendered('c'))

    // a stays however old it is; each newcomer was the only thing that could go.
    expect(getAsset(db, 'local:a')?.cacheFile).toBe(a)
    expect(files()).toEqual([a])
  })

  it('goes over the cap rather than evict protected photos, and says so', async () => {
    const { db, dir } = await setup()
    const log = { info: () => {}, warn: (message: string) => warnings.push(message), error: () => {} }
    const warnings: string[] = []
    const kept = new Set<string>()
    const cache = createPhotoCache({ db, dir, maxBytes: 150, protect: () => kept, log })
    kept.add(photoFileName(rendered('a').data))
    kept.add(photoFileName(rendered('b').data))

    cache.store('local:a', rendered('a'))
    cache.store('local:b', rendered('b'))

    expect(cache.bytes()).toBe(200)
    expect(warnings.join('\n')).toMatch(/over its \d+ MB cap/)
  })

  it('protects every photo that shares a file with one that is on a display', async () => {
    const { db, cache, clock, kept } = await setup({ maxBytes: 100 })
    clock.now = at(1)
    const file = cache.store('local:a', rendered('same'))
    cache.store('local:b', rendered('same'))
    markShown(db, 'local:b', at(1))
    kept.add(file)

    clock.now = at(2)
    cache.store('local:c', rendered('other'))

    // The shared file is protected, so neither a nor b lost it.
    expect(getAsset(db, 'local:a')?.cacheFile).toBe(file)
    expect(getAsset(db, 'local:b')?.cacheFile).toBe(file)
  })

  it('deletes a shared file only when the last photo using it is evicted', async () => {
    const { db, cache, clock, files } = await setup({ maxBytes: 200 })
    clock.now = at(1)
    const shared = cache.store('local:a', rendered('same'))
    cache.store('local:b', rendered('same'))
    markShown(db, 'local:a', at(1))
    markShown(db, 'local:b', at(2))
    clock.now = at(3)
    cache.store('local:c', rendered('c'))
    expect(files()).toHaveLength(2) // 200 bytes: at the cap, and the shared file counts once.

    clock.now = at(4)
    cache.store('local:d', rendered('d')) // 300: a goes (the file stays, b uses it), then b, and the file with it.

    expect(getAsset(db, 'local:a')?.cacheFile).toBeNull()
    expect(getAsset(db, 'local:b')?.cacheFile).toBeNull()
    expect(cache.has(shared)).toBe(false)
    expect(files()).toHaveLength(2)
  })

  it('evicts nothing under the cap', async () => {
    const { cache } = await setup({ maxBytes: 1000 })
    cache.store('local:a', rendered('a'))
    cache.store('local:b', rendered('b'))

    expect(cache.evict()).toEqual([])
  })
})

describe('release and sweep', () => {
  it('deletes a file nothing refers to, but not one that is in use or protected', async () => {
    const { db, cache, kept, files } = await setup({ maxBytes: 10_000 })
    const used = cache.store('local:a', rendered('used'))
    const orphan = cache.store('local:b', rendered('orphan'))
    const guarded = cache.store('local:c', rendered('guarded'))
    syncListing(db, 'local', [{ providerAssetId: 'a' }], at(0)) // b, c and d leave the pool
    kept.add(guarded)

    cache.release([used, orphan, guarded, '../../etc/passwd', 'x'])

    expect(files().sort()).toEqual([used, guarded].sort())
  })

  it('sweeps files no row refers to, and leftover temporary files, and nothing else', async () => {
    const { dir, cache, files } = await setup({ maxBytes: 10_000 })
    const used = cache.store('local:a', rendered('used'))
    const { writeFileSync } = await import('node:fs')
    const orphan = photoFileName(Buffer.from('orphan'))
    writeFileSync(join(dir, orphan), 'x')
    writeFileSync(join(dir, `.${orphan}.abc.tmp`), 'x')
    writeFileSync(join(dir, 'README.txt'), 'mine')

    cache.sweep()

    expect(files()).toEqual([used, 'README.txt'].sort())
  })

  it('sweeps nothing when the folder does not exist yet', async () => {
    const { cache } = await setup()

    expect(() => cache.sweep()).not.toThrow()
  })
})
