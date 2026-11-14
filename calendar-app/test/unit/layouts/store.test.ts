import { describe, expect, it, vi } from 'vitest'
import type { CustomLayout, CustomLayoutInput } from '../../../shared/layouts'
import { customLayouts } from '../../../server/db/schema'
import { LayoutError } from '../../../server/layouts/errors'
import { createLayoutsService } from '../../../server/layouts/service'
import { schedulesUsingLayout } from '../../../server/layouts/checks'
import { createLayout, deleteLayout, duplicateLayout, getLayout, listLayouts, updateLayout } from '../../../server/layouts/store'
import { migratedMemoryDb } from '../db/helpers'
import type { AppConfig, PhotosConfig } from '../../../server/config/schema'
import { configuredFeedIds, photoFeedRefusal } from '../../../server/layouts/feeds'

// The layout store against a migrated in-memory database, the service that
// keeps the list and the check that ties layouts to schedules.

const NOW = new Date('2026-10-28T12:00:00Z')
const LATER = new Date('2026-10-29T08:30:00Z')

function input(overrides: Partial<CustomLayoutInput> = {}): CustomLayoutInput {
  return {
    name: 'Kitchen',
    landscape: { rows: [{ size: 1, panes: [{ component: 'photo', size: 2 }, { component: 'week', size: 3 }] }] },
    portrait: { rows: [{ size: 2, panes: [{ component: 'photo', size: 1 }] }, { size: 3, panes: [{ component: 'week', size: 1 }] }] },
    options: {},
    ...overrides,
  }
}

describe('pane options in the store', () => {
  it('stores them, changes them and copies them', () => {
    const { db } = migratedMemoryDb()
    const options = { week: { show_hours: false }, photo: {} }
    const created = createLayout(db, input({ options }), NOW)
    expect(created.options).toEqual(options)
    expect(getLayout(db, 'kitchen')!.options).toEqual(options)

    const next = { week: { show_title: false } }
    expect(updateLayout(db, 'kitchen', input({ options: next }), LATER)!.options).toEqual(next)
    expect(duplicateLayout(db, 'kitchen', LATER)!.options).toEqual(next)
  })

  it('reads a row saved before the column as having none', () => {
    const { db } = migratedMemoryDb()
    createLayout(db, input(), NOW)
    db.update(customLayouts).set({ options: '{}' }).run()

    expect(getLayout(db, 'kitchen')!.options).toEqual({})
  })
})

describe('createLayout and getLayout', () => {
  it('stores a layout under a slug of its name, as the wire format', () => {
    const { db } = migratedMemoryDb()
    const created = createLayout(db, input(), NOW)

    expect(created).toEqual({ id: 'kitchen', ...input(), photo_feed: null, created_at: NOW.toISOString(), updated_at: NOW.toISOString() })
    expect(getLayout(db, 'kitchen')).toEqual(created)
    expect(getLayout(db, 'nothing')).toBeUndefined()
  })

  it('numbers the id when the slug is taken by another name', () => {
    const { db } = migratedMemoryDb()
    createLayout(db, input({ name: 'Kitchen wall' }), NOW)

    expect(createLayout(db, input({ name: 'Kitchen-wall!' }), NOW).id).toBe('kitchen-wall-2')
  })

  it('refuses a name another layout has, ignoring case', () => {
    const { db } = migratedMemoryDb()
    createLayout(db, input(), NOW)

    expect(() => createLayout(db, input({ name: 'KITCHEN' }), NOW)).toThrow(LayoutError)
    expect(() => createLayout(db, input({ name: 'kitchen' }), NOW)).toThrow('There is already a layout called "kitchen"')
    expect(listLayouts(db)).toHaveLength(1)
  })

  it('backs the check with a unique index on the lower-cased name', () => {
    const { db } = migratedMemoryDb()
    createLayout(db, input(), NOW)

    expect(() => db.insert(customLayouts).values({ id: 'other', name: 'kitchen', landscape: '{}', portrait: '{}', createdAt: NOW, updatedAt: NOW }).run()).toThrow()
  })
})

describe('listLayouts', () => {
  it('lists by name, ignoring case', () => {
    const { db } = migratedMemoryDb()
    createLayout(db, input({ name: 'hall' }), NOW)
    createLayout(db, input({ name: 'Bedroom' }), NOW)
    createLayout(db, input({ name: 'Kitchen' }), NOW)

    expect(listLayouts(db).map(layout => layout.name)).toEqual(['Bedroom', 'hall', 'Kitchen'])
  })

  it('skips a row that no longer parses, with a warning, and keeps the rest', () => {
    const { db } = migratedMemoryDb()
    createLayout(db, input(), NOW)
    db.insert(customLayouts).values({ id: 'broken', name: 'Broken', landscape: '{"rows":[]}', portrait: '{"rows":[]}', createdAt: NOW, updatedAt: NOW }).run()
    db.insert(customLayouts).values({ id: 'garbled', name: 'Garbled', landscape: 'not json', portrait: '{}', createdAt: NOW, updatedAt: NOW }).run()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(listLayouts(db).map(layout => layout.id)).toEqual(['kitchen'])
    expect(warn).toHaveBeenCalledTimes(2)
    expect(getLayout(db, 'broken')).toBeUndefined()
    warn.mockRestore()
  })
})

describe('updateLayout', () => {
  it('replaces what the editor sets, keeping the id and when it was made', () => {
    const { db } = migratedMemoryDb()
    createLayout(db, input(), NOW)
    const edited = input({ name: 'Kitchen wall', landscape: { rows: [{ size: 1, panes: [{ component: 'week', size: 1 }, { component: 'photo', size: 1 }] }] } })

    const updated = updateLayout(db, 'kitchen', edited, LATER)

    expect(updated).toEqual({ id: 'kitchen', ...edited, photo_feed: null, created_at: NOW.toISOString(), updated_at: LATER.toISOString() })
    expect(getLayout(db, 'kitchen')).toEqual(updated)
  })

  it('lets a layout keep its own name, or change its case', () => {
    const { db } = migratedMemoryDb()
    createLayout(db, input(), NOW)

    expect(updateLayout(db, 'kitchen', input(), LATER)).not.toBeNull()
    expect(updateLayout(db, 'kitchen', input({ name: 'KITCHEN' }), LATER)!.name).toBe('KITCHEN')
  })

  it('refuses another layout\'s name', () => {
    const { db } = migratedMemoryDb()
    createLayout(db, input(), NOW)
    createLayout(db, input({ name: 'Hall' }), NOW)

    expect(() => updateLayout(db, 'hall', input({ name: 'kitchen' }), LATER)).toThrow(LayoutError)
    expect(getLayout(db, 'hall')!.name).toBe('Hall')
  })

  it('is null for an unknown layout', () => {
    const { db } = migratedMemoryDb()

    expect(updateLayout(db, 'nothing', input(), LATER)).toBeNull()
  })
})

describe('duplicateLayout', () => {
  it('copies it as "Copy of …" with a new id', () => {
    const { db } = migratedMemoryDb()
    createLayout(db, input(), NOW)

    const copy = duplicateLayout(db, 'kitchen', LATER)!

    expect(copy).toEqual({ id: 'copy-of-kitchen', ...input({ name: 'Copy of Kitchen' }), photo_feed: null, created_at: LATER.toISOString(), updated_at: LATER.toISOString() })
    expect(listLayouts(db)).toHaveLength(2)
  })

  it('numbers a copy of a copy that would clash, and stays within the name limit', () => {
    const { db } = migratedMemoryDb()
    createLayout(db, input(), NOW)
    duplicateLayout(db, 'kitchen', LATER)

    expect(duplicateLayout(db, 'kitchen', LATER)!.name).toBe('Copy of Kitchen 2')

    const long = createLayout(db, input({ name: 'x'.repeat(60) }), NOW)
    const longCopy = duplicateLayout(db, long.id, LATER)!
    expect(longCopy.name).toHaveLength(60)
    expect(duplicateLayout(db, long.id, LATER)!.name).toHaveLength(60)
  })

  it('is null for an unknown layout', () => {
    const { db } = migratedMemoryDb()

    expect(duplicateLayout(db, 'nothing', LATER)).toBeNull()
  })
})

describe('deleteLayout', () => {
  it('removes it, and says whether there was one', () => {
    const { db } = migratedMemoryDb()
    createLayout(db, input(), NOW)

    expect(deleteLayout(db, 'kitchen')).toBe(true)
    expect(listLayouts(db)).toEqual([])
    expect(deleteLayout(db, 'kitchen')).toBe(false)
  })
})

describe('createLayoutsService', () => {
  const layout = (id: string): CustomLayout => ({ id, ...input({ name: id }), photo_feed: null, created_at: NOW.toISOString(), updated_at: NOW.toISOString() })

  it('starts with the stored layouts, silently', () => {
    const onChange = vi.fn()
    const service = createLayoutsService({ load: () => [layout('a')], onChange })

    expect(service.get()).toEqual([])
    service.start()

    expect(service.get()).toEqual([layout('a')])
    expect(service.summaries()).toEqual([{ id: 'a', name: 'a', components: ['week', 'photo'], photo_feed: null }])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('calls onChange with the whole list when a write changes it, and not when it did not', () => {
    let stored = [layout('a')]
    const onChange = vi.fn()
    const service = createLayoutsService({ load: () => stored, onChange })
    service.start()

    service.changed()
    expect(onChange).not.toHaveBeenCalled()

    stored = [layout('a'), layout('b')]
    service.changed()
    expect(onChange).toHaveBeenCalledExactlyOnceWith([layout('a'), layout('b')])
  })

  it('keeps the last good list when reading fails, and never throws', () => {
    let fail = false
    const warn = vi.fn()
    const onChange = vi.fn()
    const service = createLayoutsService({ load: () => { if (fail) throw new Error('disk gone'); return [layout('a')] }, onChange, log: { warn, error: vi.fn() } })
    service.start()

    fail = true
    expect(() => service.changed()).not.toThrow()
    expect(service.get()).toEqual([layout('a')])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('disk gone'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('logs a subscriber that throws, without throwing', () => {
    let stored: CustomLayout[] = []
    const error = vi.fn()
    const service = createLayoutsService({ load: () => stored, onChange: () => { throw new Error('boom') }, log: { warn: vi.fn(), error } })
    service.start()

    stored = [layout('a')]
    expect(() => service.changed()).not.toThrow()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('boom'))
  })
})

describe('a layout\'s photo feed', () => {
  it('stores it, changes it and copies it', () => {
    const { db } = migratedMemoryDb()
    expect(createLayout(db, input({ photo_feed: 'mountains' }), NOW).photo_feed).toBe('mountains')
    expect(getLayout(db, 'kitchen')!.photo_feed).toBe('mountains')

    expect(updateLayout(db, 'kitchen', input({ photo_feed: 'unsplash' }), LATER)!.photo_feed).toBe('unsplash')
    expect(duplicateLayout(db, 'kitchen', LATER)!.photo_feed).toBe('unsplash')
    expect(updateLayout(db, 'kitchen', input({ photo_feed: null }), LATER)!.photo_feed).toBeNull()
  })

  it('is null when none is sent, as from a client from before photo feeds', () => {
    const { db } = migratedMemoryDb()
    expect(createLayout(db, input(), NOW).photo_feed).toBeNull()
  })

  it('is kept as null by a layout without a photo pane, whatever was sent', () => {
    const { db } = migratedMemoryDb()
    const noPhoto = {
      landscape: { rows: [{ size: 1, panes: [{ component: 'week' as const, size: 1 }] }] },
      portrait: { rows: [{ size: 1, panes: [{ component: 'week' as const, size: 1 }] }] },
    }
    expect(createLayout(db, input({ ...noPhoto, photo_feed: 'mountains' }), NOW).photo_feed).toBeNull()
  })
})

describe('configuredFeedIds and photoFeedRefusal', () => {
  const photos = { immich: { url: 'http://immich' }, unsplash: { access_key: 'k' }, feeds: [{ id: 'mountains' }, { id: 'garden' }] } as unknown as PhotosConfig

  it('lists the sources set up, then the feeds in config order', () => {
    expect(configuredFeedIds(photos)).toEqual(['immich', 'unsplash', 'mountains', 'garden'])
  })

  it('is empty with no photos block, and copes with a config that has no feeds', () => {
    expect(configuredFeedIds(undefined)).toEqual([])
    expect(configuredFeedIds({ local: { path: '/p' } } as unknown as PhotosConfig)).toEqual(['local'])
  })

  it('accepts a feed that is set up, and null or nothing', () => {
    expect(photoFeedRefusal('mountains', photos)).toBeNull()
    expect(photoFeedRefusal('immich', photos)).toBeNull()
    expect(photoFeedRefusal(null, photos)).toBeNull()
    expect(photoFeedRefusal(undefined, undefined)).toBeNull()
  })

  it('refuses any other, listing the ones there are', () => {
    expect(photoFeedRefusal('local', photos)).toContain('use immich, unsplash, mountains, garden')
    expect(photoFeedRefusal('local', undefined)).toContain('there is no photos block')
  })
})

describe('schedulesUsingLayout', () => {
  const displays = [
    { id: 'hallway', schedules: [{ id: 'mornings', rules: [{ view: 'custom', layout: 'kitchen' }, { view: 'month' }] }, { id: 'evenings', rules: [{ view: 'night' }] }] },
    { id: 'kitchen', schedules: [{ id: 'dinner', rules: [{ view: 'custom', layout: 'kitchen' }, { view: 'custom', layout: 'kitchen' }] }] },
  ] as unknown as AppConfig['displays']

  it('lists each schedule that names the layout once, with its display', () => {
    expect(schedulesUsingLayout(displays, 'kitchen')).toEqual([{ display: 'hallway', schedule: 'mornings' }, { display: 'kitchen', schedule: 'dinner' }])
  })

  it('is empty for a layout nothing names', () => {
    expect(schedulesUsingLayout(displays, 'hall')).toEqual([])
  })
})
