import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import type { PhotoPool, PhotoPoolInput } from '../../../shared/photoPools'
import { photoFeedIdSchema } from '../../../shared/display'
import { photoPools } from '../../../server/db/schema'
import { PhotoPoolError } from '../../../server/photoPools/errors'
import { createPhotoPoolsService } from '../../../server/photoPools/service'
import { createPhotoPool, deletePhotoPool, getPhotoPool, listPhotoPools, updatePhotoPool } from '../../../server/photoPools/store'
import { migratedMemoryDb } from '../db/helpers'

// The photo pool store against a migrated in-memory database, and the service
// that keeps the list.

const NOW = new Date('2026-11-01T12:00:00Z')
const LATER = new Date('2026-11-02T08:30:00Z')

function input(overrides: Partial<PhotoPoolInput> = {}): PhotoPoolInput {
  return { name: 'Mountains', sources: [{ kind: 'unsplash_search', query: 'mountain lake' }, { kind: 'feed', feed: 'local' }], ...overrides }
}

describe('createPhotoPool and getPhotoPool', () => {
  it('stores a pool under a slug of its name', () => {
    const { db } = migratedMemoryDb()
    const created = createPhotoPool(db, input(), NOW)
    expect(created).toEqual({ id: 'mountains', name: 'Mountains', sources: input().sources, created_at: NOW.toISOString(), updated_at: NOW.toISOString() })
    expect(getPhotoPool(db, 'mountains')).toEqual(created)
    expect(getPhotoPool(db, 'nope')).toBeUndefined()
  })

  it('gives an id a layout may hold, even for a name with no letters', () => {
    const { db } = migratedMemoryDb()
    const id = createPhotoPool(db, input({ name: '日本' }), NOW).id
    expect(id).toBe('pool')
    expect(photoFeedIdSchema.safeParse(id).success).toBe(true)
  })

  it('numbers an id that is taken, and avoids reserved ones', () => {
    const { db } = migratedMemoryDb()
    expect(createPhotoPool(db, input({ name: 'Local' }), NOW, ['local', 'immich']).id).toBe('local-2')
    expect(createPhotoPool(db, input({ name: 'Mountains!' }), NOW).id).toBe('mountains')
    expect(createPhotoPool(db, input({ name: 'mountains?' }), NOW).id).toBe('mountains-2')
  })

  it('refuses a name another pool has, ignoring case', () => {
    const { db } = migratedMemoryDb()
    createPhotoPool(db, input(), NOW)
    expect(() => createPhotoPool(db, input({ name: 'MOUNTAINS' }), NOW)).toThrow(PhotoPoolError)
    expect(listPhotoPools(db)).toHaveLength(1)
  })
})

describe('listPhotoPools', () => {
  it('lists by name, ignoring case', () => {
    const { db } = migratedMemoryDb()
    createPhotoPool(db, input({ name: 'beach' }), NOW)
    createPhotoPool(db, input({ name: 'Autumn' }), NOW)
    createPhotoPool(db, input({ name: 'Zoo' }), NOW)
    expect(listPhotoPools(db).map(pool => pool.name)).toEqual(['Autumn', 'beach', 'Zoo'])
  })

  it('skips a row that no longer parses, with a warning', () => {
    const { db } = migratedMemoryDb()
    createPhotoPool(db, input(), NOW)
    createPhotoPool(db, input({ name: 'Broken' }), NOW)
    createPhotoPool(db, input({ name: 'Garbled' }), NOW)
    db.update(photoPools).set({ sources: '[{"kind":"mystery"}]' }).where(eq(photoPools.id, 'broken')).run()
    db.update(photoPools).set({ sources: 'not json' }).where(eq(photoPools.id, 'garbled')).run()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(listPhotoPools(db).map(pool => pool.id)).toEqual(['mountains'])
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})

describe('updatePhotoPool', () => {
  it('replaces the name and sources and keeps the id', () => {
    const { db } = migratedMemoryDb()
    createPhotoPool(db, input(), NOW)
    const sources: PhotoPoolInput['sources'] = [{ kind: 'immich_album', album_id: 'abc-123' }]
    const updated = updatePhotoPool(db, 'mountains', { name: 'Hills', sources }, LATER)!
    expect(updated).toMatchObject({ id: 'mountains', name: 'Hills', sources, created_at: NOW.toISOString(), updated_at: LATER.toISOString() })
  })

  it('may keep its own name, but not take another pool\'s', () => {
    const { db } = migratedMemoryDb()
    createPhotoPool(db, input(), NOW)
    createPhotoPool(db, input({ name: 'Beach' }), NOW)
    expect(updatePhotoPool(db, 'mountains', input({ name: 'MOUNTAINS' }), LATER)!.name).toBe('MOUNTAINS')
    expect(() => updatePhotoPool(db, 'mountains', input({ name: 'beach' }), LATER)).toThrow(PhotoPoolError)
  })

  it('is null for an unknown pool', () => {
    const { db } = migratedMemoryDb()
    expect(updatePhotoPool(db, 'nope', input(), LATER)).toBeNull()
  })
})

describe('deletePhotoPool', () => {
  it('deletes, and says whether there was one', () => {
    const { db } = migratedMemoryDb()
    createPhotoPool(db, input(), NOW)
    expect(deletePhotoPool(db, 'mountains')).toBe(true)
    expect(deletePhotoPool(db, 'mountains')).toBe(false)
    expect(listPhotoPools(db)).toEqual([])
  })
})

describe('createPhotoPoolsService', () => {
  const pool = (id: string): PhotoPool => ({ id, name: id, sources: [{ kind: 'feed', feed: 'local' }], created_at: NOW.toISOString(), updated_at: NOW.toISOString() })

  it('loads at start without announcing, then announces only a change', () => {
    let pools = [pool('a')]
    const onChange = vi.fn()
    const service = createPhotoPoolsService({ load: () => pools, onChange })
    expect(service.get()).toEqual([])
    service.start()
    expect(service.ids()).toEqual(['a'])
    expect(onChange).not.toHaveBeenCalled()

    service.changed()
    expect(onChange).not.toHaveBeenCalled()
    pools = [pool('a'), pool('b')]
    service.changed()
    expect(onChange).toHaveBeenCalledWith(pools)
    expect(service.ids()).toEqual(['a', 'b'])
  })

  it('keeps the last good list when reading fails', () => {
    let fail = false
    const log = { warn: vi.fn(), error: vi.fn() }
    const service = createPhotoPoolsService({ load: () => { if (fail) throw new Error('locked'); return [pool('a')] }, onChange: vi.fn(), log })
    service.start()
    fail = true
    service.changed()
    expect(service.ids()).toEqual(['a'])
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('locked'))
  })
})
