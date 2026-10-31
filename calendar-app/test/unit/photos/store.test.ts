import { describe, expect, it } from 'vitest'
import { getAsset, listPool, loadPlaylist, savePlaylist, syncListing } from '../../../server/photos/store'
import { migratedMemoryDb } from '../db/helpers'

const NOW = new Date('2026-10-28T12:00:00Z')

describe('syncListing', () => {
  it('adds the photos of a listing, with their shape when the provider knows it', () => {
    const { db } = migratedMemoryDb()

    const result = syncListing(db, 'local', [
      { providerAssetId: 'a.jpg', width: 1600, height: 900, takenAt: new Date('2024-01-02T03:04:05Z') },
      { providerAssetId: 'b.jpg', width: 900, height: 1600 },
      { providerAssetId: 'c.jpg' },
    ], NOW)

    expect(result).toEqual({ added: 3, removed: 0, files: [] })
    expect(getAsset(db, 'local:a.jpg')).toMatchObject({ provider: 'local', providerAssetId: 'a.jpg', width: 1600, height: 900, orientation: 'landscape', takenAt: new Date('2024-01-02T03:04:05Z'), cacheFile: null })
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

  it('removes photos that are no longer listed, and returns their cache files', () => {
    const { db } = migratedMemoryDb()
    syncListing(db, 'local', [{ providerAssetId: 'a.jpg' }, { providerAssetId: 'b.jpg' }], NOW)
    db.$client.prepare(`update photo_assets set cache_file = 'f1', cache_bytes = 5 where id = 'local:b.jpg'`).run()

    const result = syncListing(db, 'local', [{ providerAssetId: 'a.jpg' }], NOW)

    expect(result).toEqual({ added: 0, removed: 1, files: ['f1'] })
    expect(listPool(db, 'local').map(row => row.id)).toEqual(['local:a.jpg'])
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
