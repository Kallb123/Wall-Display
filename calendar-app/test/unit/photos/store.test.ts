import { describe, expect, it } from 'vitest'
import { cachedRenditions, clearCached, getAsset, getRendition, listPool, loadPlaylist, markShown, recordCached, savePlaylist, syncListing } from '../../../server/photos/store'
import { migratedMemoryDb } from '../db/helpers'

const NOW = new Date('2026-10-28T12:00:00Z')
const LATER = new Date('2026-10-28T13:00:00Z')

const record = (cacheFile: string, bytes = 5) => ({ cacheFile, cacheBytes: bytes, width: 1600, height: 900, orientation: 'landscape' as const })

describe('syncListing', () => {
  it('adds the photos of a listing, with their shape when the provider knows it', () => {
    const { db } = migratedMemoryDb()

    const result = syncListing(db, 'local', [
      { providerAssetId: 'a.jpg', width: 1600, height: 900, takenAt: new Date('2024-01-02T03:04:05Z') },
      { providerAssetId: 'b.jpg', width: 900, height: 1600 },
      { providerAssetId: 'c.jpg' },
    ], NOW)

    expect(result).toEqual({ added: 3, removed: 0, files: [] })
    expect(getAsset(db, 'local:a.jpg')).toMatchObject({ provider: 'local', providerAssetId: 'a.jpg', width: 1600, height: 900, orientation: 'landscape', takenAt: new Date('2024-01-02T03:04:05Z'), lastShownAt: null })
    expect(getRendition(db, 'local:a.jpg', 'landscape')).toBeUndefined()
    expect(getAsset(db, 'local:b.jpg')).toMatchObject({ orientation: 'portrait' })
    // Not known until it is rendered.
    expect(getAsset(db, 'local:c.jpg')).toMatchObject({ width: 0, height: 0, orientation: 'landscape', takenAt: null })
  })

  it('updates a changed photo, and leaves what a listing does not say', () => {
    const { db } = migratedMemoryDb()
    syncListing(db, 'local', [{ providerAssetId: 'a.jpg', width: 1600, height: 900 }], NOW)

    syncListing(db, 'local', [{ providerAssetId: 'a.jpg', width: 900, height: 1600, takenAt: new Date('2020-01-01T00:00:00Z') }], NOW)
    expect(getAsset(db, 'local:a.jpg')).toMatchObject({ width: 900, height: 1600, orientation: 'portrait', takenAt: new Date('2020-01-01T00:00:00Z') })

    syncListing(db, 'local', [{ providerAssetId: 'a.jpg' }], NOW)
    expect(getAsset(db, 'local:a.jpg')).toMatchObject({ width: 900, height: 1600, takenAt: new Date('2020-01-01T00:00:00Z') })
  })

  it('stores a credit, changes it, and leaves it when a listing says nothing of it', () => {
    const { db } = migratedMemoryDb()
    syncListing(db, 'mountains', [{ providerAssetId: 'a', credit: 'Photo by Jane on Unsplash' }, { providerAssetId: 'b' }], NOW)
    expect(getAsset(db, 'mountains:a')).toMatchObject({ provider: 'mountains', credit: 'Photo by Jane on Unsplash' })
    expect(getAsset(db, 'mountains:b')!.credit).toBeNull()

    syncListing(db, 'mountains', [{ providerAssetId: 'a' }, { providerAssetId: 'b', credit: 'Photo by Joe on Unsplash' }], NOW)
    expect(getAsset(db, 'mountains:a')!.credit).toBe('Photo by Jane on Unsplash')
    expect(getAsset(db, 'mountains:b')!.credit).toBe('Photo by Joe on Unsplash')

    syncListing(db, 'mountains', [{ providerAssetId: 'a', credit: null }, { providerAssetId: 'b' }], NOW)
    expect(getAsset(db, 'mountains:a')!.credit).toBeNull()
  })

  it('removes photos that are no longer listed, and returns the cache files of all their renditions', () => {
    const { db } = migratedMemoryDb()
    syncListing(db, 'local', [{ providerAssetId: 'a.jpg' }, { providerAssetId: 'b.jpg' }], NOW)
    recordCached(db, 'local:a.jpg', 'landscape', record('keep'), NOW)
    recordCached(db, 'local:b.jpg', 'landscape', record('f1'), NOW)
    recordCached(db, 'local:b.jpg', 'portrait', record('f2'), NOW)

    const result = syncListing(db, 'local', [{ providerAssetId: 'a.jpg' }], NOW)

    expect(result.added).toBe(0)
    expect(result.removed).toBe(1)
    expect(result.files.sort()).toEqual(['f1', 'f2'])
    expect(listPool(db, 'local').map(row => row.id)).toEqual(['local:a.jpg'])
    expect(cachedRenditions(db).map(row => row.cacheFile)).toEqual(['keep'])
  })

  it('only touches its own provider', () => {
    const { db } = migratedMemoryDb()
    syncListing(db, 'immich', [{ providerAssetId: 'x' }], NOW)

    syncListing(db, 'local', [{ providerAssetId: 'a.jpg' }], NOW)
    syncListing(db, 'local', [], NOW)

    expect(listPool(db, 'immich').map(row => row.id)).toEqual(['immich:x'])
  })

  it('copes with a listing that names a photo twice and with a big one', () => {
    const { db } = migratedMemoryDb()
    const many = Array.from({ length: 1200 }, (_, i) => ({ providerAssetId: `p${i}.jpg` }))

    const result = syncListing(db, 'local', [...many, { providerAssetId: 'p0.jpg' }], NOW)

    expect(result.added).toBe(1200)
    expect(listPool(db, 'local')).toHaveLength(1200)
  })
})

describe('renditions', () => {
  it('are kept per photo and shape, and noting one records what the original turned out to be', () => {
    const { db } = migratedMemoryDb()
    syncListing(db, 'local', [{ providerAssetId: 'a.jpg' }], NOW)

    recordCached(db, 'local:a.jpg', 'landscape', record('l1'), NOW)
    recordCached(db, 'local:a.jpg', 'portrait', { ...record('p1', 9), width: 900, height: 1600, orientation: 'portrait' }, NOW)

    expect(getRendition(db, 'local:a.jpg', 'landscape')).toMatchObject({ cacheFile: 'l1', cacheBytes: 5, fetchedAt: NOW, lastShownAt: null })
    expect(getRendition(db, 'local:a.jpg', 'portrait')).toMatchObject({ cacheFile: 'p1', cacheBytes: 9 })
    expect(getAsset(db, 'local:a.jpg')).toMatchObject({ width: 900, height: 1600, orientation: 'portrait' })
    expect(cachedRenditions(db)).toHaveLength(2)
  })

  it('are replaced when stored again, keeping when they were last shown', () => {
    const { db } = migratedMemoryDb()
    syncListing(db, 'local', [{ providerAssetId: 'a.jpg' }], NOW)
    recordCached(db, 'local:a.jpg', 'landscape', record('l1'), NOW)
    markShown(db, 'local:a.jpg', 'landscape', NOW)

    recordCached(db, 'local:a.jpg', 'landscape', record('l2', 7), LATER)

    expect(getRendition(db, 'local:a.jpg', 'landscape')).toMatchObject({ cacheFile: 'l2', cacheBytes: 7, fetchedAt: LATER, lastShownAt: NOW })
    expect(cachedRenditions(db)).toHaveLength(1)
  })

  it('are cleared one at a time', () => {
    const { db } = migratedMemoryDb()
    syncListing(db, 'local', [{ providerAssetId: 'a.jpg' }], NOW)
    recordCached(db, 'local:a.jpg', 'landscape', record('l1'), NOW)
    recordCached(db, 'local:a.jpg', 'portrait', record('p1'), NOW)

    clearCached(db, 'local:a.jpg', 'portrait')

    expect(getRendition(db, 'local:a.jpg', 'portrait')).toBeUndefined()
    expect(getRendition(db, 'local:a.jpg', 'landscape')).toMatchObject({ cacheFile: 'l1' })
    expect(getAsset(db, 'local:a.jpg')).toBeDefined()
  })

  it('mark the photo and the shape shown, and no other shape', () => {
    const { db } = migratedMemoryDb()
    syncListing(db, 'local', [{ providerAssetId: 'a.jpg' }], NOW)
    recordCached(db, 'local:a.jpg', 'landscape', record('l1'), NOW)
    recordCached(db, 'local:a.jpg', 'portrait', record('p1'), NOW)

    markShown(db, 'local:a.jpg', 'portrait', LATER)

    expect(getAsset(db, 'local:a.jpg')).toMatchObject({ lastShownAt: LATER })
    expect(getRendition(db, 'local:a.jpg', 'portrait')).toMatchObject({ lastShownAt: LATER })
    expect(getRendition(db, 'local:a.jpg', 'landscape')).toMatchObject({ lastShownAt: null })
  })
})

describe('playlists', () => {
  it('start empty', () => {
    const { db } = migratedMemoryDb()

    expect(loadPlaylist(db, 'hallway', 'local')).toEqual({ order: [], position: 0 })
  })

  it('are stored per display and per provider, and replaced on a second save', () => {
    const { db } = migratedMemoryDb()

    savePlaylist(db, 'hallway', 'local', { order: ['local:a', 'local:b'], position: 1 }, NOW)
    savePlaylist(db, 'kitchen', 'local', { order: ['local:c'], position: 0 }, NOW)
    savePlaylist(db, 'hallway', 'immich', { order: ['immich:x'], position: 1 }, NOW)
    savePlaylist(db, 'hallway', 'local', { order: ['local:b', 'local:a'], position: 2 }, NOW)

    expect(loadPlaylist(db, 'hallway', 'local')).toEqual({ order: ['local:b', 'local:a'], position: 2 })
    expect(loadPlaylist(db, 'kitchen', 'local')).toEqual({ order: ['local:c'], position: 0 })
    expect(loadPlaylist(db, 'hallway', 'immich')).toEqual({ order: ['immich:x'], position: 1 })
  })

  it('survive a damaged row', () => {
    const { db } = migratedMemoryDb()
    db.$client.prepare(`insert into photo_playlists (display_id, provider, "order", position, updated_at) values ('hallway', 'local', '{"not":"a list"}', 9, 0)`).run()
    expect(loadPlaylist(db, 'hallway', 'local')).toEqual({ order: [], position: 0 })

    db.$client.prepare(`update photo_playlists set "order" = '["a", 7, "b"]', position = 9`).run()
    expect(loadPlaylist(db, 'hallway', 'local')).toEqual({ order: ['a', 'b'], position: 2 })
  })
})
