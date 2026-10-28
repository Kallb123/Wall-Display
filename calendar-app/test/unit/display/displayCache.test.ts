import { describe, expect, it } from 'vitest'
import { displayStateSchema } from '../../../shared/display'
import type { DisplaySettings } from '../../../shared/display'
import { loadCache, loadLastDisplayId, saveCache, saveLastDisplayId } from '../../../app/utils/displayCache'
import type { DisplayCache } from '../../../app/utils/displayCache'

/** The parts of Storage the cache uses, backed by a map. */
class FakeStorage {
  items = new Map<string, string>()
  getItem(key: string) {
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.items.set(key, value)
  }
}

const asStorage = (storage: object) => storage as Storage

/** A storage that throws on every use, as a blocked or full one does. */
const broken = asStorage({
  getItem() {
    throw new Error('blocked')
  },
  setItem() {
    throw new Error('full')
  },
})

const settings: DisplaySettings = { id: 'hallway', name: 'Hallway', theme: 'light', month_style: 'soft', week_start: 'monday', timezone: 'Europe/London' }
const entry: DisplayCache = {
  settings,
  state: displayStateSchema.parse({ view: 'agenda', brightness: 40 }),
  events: [],
  saved_at: '2026-10-28T09:41:00.000Z',
}

describe('the display cache', () => {
  it('gives back what was saved, under wallcal:display:<id>', () => {
    const storage = new FakeStorage()

    expect(saveCache(asStorage(storage), 'hallway', entry)).toBe(true)

    expect([...storage.items.keys()]).toEqual(['wallcal:display:hallway'])
    expect(loadCache(asStorage(storage), 'hallway')).toEqual(entry)
  })

  it('keeps each display apart', () => {
    const storage = new FakeStorage()
    saveCache(asStorage(storage), 'hallway', entry)

    expect(loadCache(asStorage(storage), 'kitchen')).toBeNull()
  })

  it('returns null for a missing, corrupt or wrongly shaped entry', () => {
    const storage = new FakeStorage()
    expect(loadCache(asStorage(storage), 'hallway')).toBeNull()

    for (const bad of ['{not json', 'null', '[]', '"text"', '{}', JSON.stringify({ ...entry, state: { view: 'sideways' } }), JSON.stringify({ ...entry, events: 'none' })]) {
      storage.setItem('wallcal:display:hallway', bad)
      expect(loadCache(asStorage(storage), 'hallway')).toBeNull()
    }
  })

  it('fills in state fields an older entry lacks', () => {
    const storage = new FakeStorage()
    storage.setItem('wallcal:display:hallway', JSON.stringify({ ...entry, state: { view: 'week' } }))

    expect(loadCache(asStorage(storage), 'hallway')?.state).toEqual(displayStateSchema.parse({ view: 'week' }))
  })

  it('survives storage that is missing or throws', () => {
    expect(loadCache(null, 'hallway')).toBeNull()
    expect(saveCache(null, 'hallway', entry)).toBe(false)
    expect(loadCache(broken, 'hallway')).toBeNull()
    expect(saveCache(broken, 'hallway', entry)).toBe(false)
  })
})

describe('the last display id', () => {
  it('is remembered under wallcal:last-display', () => {
    const storage = new FakeStorage()
    expect(loadLastDisplayId(asStorage(storage))).toBeNull()

    saveLastDisplayId(asStorage(storage), 'kitchen')

    expect(storage.items.get('wallcal:last-display')).toBe('kitchen')
    expect(loadLastDisplayId(asStorage(storage))).toBe('kitchen')
  })

  it('survives storage that is missing or throws', () => {
    expect(loadLastDisplayId(null)).toBeNull()
    expect(loadLastDisplayId(broken)).toBeNull()
    expect(() => saveLastDisplayId(broken, 'kitchen')).not.toThrow()
    expect(() => saveLastDisplayId(null, 'kitchen')).not.toThrow()
  })
})
