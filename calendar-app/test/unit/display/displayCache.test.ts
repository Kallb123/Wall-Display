import { describe, expect, it } from 'vitest'
import { displayStateSchema } from '../../../shared/display'
import type { DisplaySettings } from '../../../shared/display'
import { loadCache, loadLastDisplayId, saveCache, saveLastDisplayId } from '../../../app/utils/displayCache'
import type { DisplayCache } from '../../../app/utils/displayCache'
import type { SpecialDaysResolution } from '../../../shared/special-days'
import type { WeatherSnapshot } from '../../../shared/weather'

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

const settings: DisplaySettings = { id: 'hallway', name: 'Hallway', theme: 'light', month_style: 'soft', week_start: 'monday', timezone: 'Europe/London', photo_sources: [] }
const weather: WeatherSnapshot = {
  current: { condition: 'rainy', temperature: 12 },
  daily: [{ date: '2026-10-28', condition: 'rainy', high: 14, low: 8 }],
  temperature_unit: '°C',
  updated_at: '2026-10-28T09:00:00.000Z',
}
const specialDays: SpecialDaysResolution = {
  today: '2026-10-31',
  from: '2026-09-17',
  to: '2026-11-14',
  tiles: [{ date: '2026-10-31', days: [{ id: 'halloween', name: 'Halloween', palette: 'night', tile_art: 'pumpkin.svg' }] }],
  current: { id: 'halloween', name: 'Halloween' },
  takeover: { id: 'halloween', name: 'Halloween', date: '2026-10-31', greeting: 'Happy Halloween', palette: 'night', full_art: 'wall.webp', extra_art: null },
  tomorrow_art: ['bonfire.webp'],
}
const entry: DisplayCache = {
  settings,
  state: displayStateSchema.parse({ view: 'agenda', brightness: 40 }),
  events: [],
  weather: null,
  special_days: null,
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

  it('keeps the weather that was saved', () => {
    const storage = new FakeStorage()
    saveCache(asStorage(storage), 'hallway', { ...entry, weather })

    expect(loadCache(asStorage(storage), 'hallway')?.weather).toEqual(weather)
  })

  it('loads an entry saved before there was weather, with none', () => {
    const storage = new FakeStorage()
    const { weather: _none, ...older } = entry
    storage.setItem('wallcal:display:hallway', JSON.stringify(older))

    expect(loadCache(asStorage(storage), 'hallway')).toEqual(entry)
  })

  it('drops weather that is the wrong shape and keeps the rest', () => {
    const storage = new FakeStorage()
    storage.setItem('wallcal:display:hallway', JSON.stringify({ ...entry, weather: { current: 'sunny' } }))

    expect(loadCache(asStorage(storage), 'hallway')).toEqual(entry)
  })

  it('keeps the special days that were saved', () => {
    const storage = new FakeStorage()
    saveCache(asStorage(storage), 'hallway', { ...entry, special_days: specialDays })

    expect(loadCache(asStorage(storage), 'hallway')?.special_days).toEqual(specialDays)
  })

  it('loads an entry saved before special days, with none', () => {
    const storage = new FakeStorage()
    const { special_days: _none, ...older } = entry
    storage.setItem('wallcal:display:hallway', JSON.stringify(older))

    expect(loadCache(asStorage(storage), 'hallway')).toEqual(entry)
  })

  it('drops special days that are the wrong shape and keeps the rest', () => {
    const storage = new FakeStorage()
    for (const bad of [{ today: 'tomorrow' }, 'halloween', { ...specialDays, takeover: { ...specialDays.takeover, palette: 'neon' } }]) {
      storage.setItem('wallcal:display:hallway', JSON.stringify({ ...entry, special_days: bad }))

      expect(loadCache(asStorage(storage), 'hallway')).toEqual(entry)
    }
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
