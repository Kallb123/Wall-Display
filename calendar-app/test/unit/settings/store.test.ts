import { describe, expect, it, vi } from 'vitest'
import { createEventBus } from '../../../server/events/bus'
import type { BusEvents } from '../../../server/events/bus'
import { preferenceOverrides } from '../../../server/db/schema'
import { createSettingsStore, PreferencesRefusedError, UnknownDisplayError } from '../../../server/settings/store'
import { migratedMemoryDb } from '../db/helpers'
import { ALARM, parsedConfig, PHOTOS } from './helpers'

function setup(config = parsedConfig(PHOTOS)) {
  const handle = migratedMemoryDb()
  const bus = createEventBus()
  const events: BusEvents['settings.updated'][] = []
  bus.on('settings.updated', payload => events.push(payload))
  const log = { warn: vi.fn() }
  const open = () => createSettingsStore({ db: handle.db, config, bus, log })
  return { ...handle, bus, events, log, config, open, store: open() }
}

const refused = (run: () => unknown): Record<string, string> => {
  try {
    run()
  } catch (error) {
    if (error instanceof PreferencesRefusedError) return error.fields as Record<string, string>
    throw error
  }
  throw new Error('expected the save to be refused')
}

describe('the settings store', () => {
  it('starts with the YAML config in force and nothing changed', () => {
    const { store, config } = setup()

    expect(store.config()).toEqual(config)
    expect(store.yamlConfig()).toBe(config)
    const status = store.status()
    expect(status.displays.map(entry => [entry.id, entry.name, entry.changed])).toEqual([['hallway', 'Hallway', []], ['kitchen', 'Kitchen', []]])
    expect(status.displays[0]!.values).toEqual(status.displays[0]!.config)
    expect(status.shared.changed).toEqual([])
    expect(status).toMatchObject({ photos_configured: true, alarm_configured: false, mqtt_configured: false })
  })

  it('saves a display\'s preferences, puts them in force and reports what changed', () => {
    const { store, events, config } = setup()

    const status = store.updateDisplay('hallway', { set: { theme: 'dark', month_return_minutes: 5 } })

    expect(status.displays[0]).toMatchObject({ values: { theme: 'dark', month_return_minutes: 5 }, config: { theme: 'light', month_return_minutes: 15 }, changed: ['theme', 'month_return_minutes'] })
    expect(store.config().displays[0]).toMatchObject({ theme: 'dark', month_return_minutes: 5 })
    expect(store.config().displays[1]).toBe(config.displays[1])
    expect(store.yamlConfig().displays[0]!.theme).toBe('light')
    expect(events).toEqual([{ displayIds: ['hallway'], shared: false }])
  })

  it('lists changed keys in key order, whatever order they were saved in', () => {
    const { store } = setup()
    store.updateDisplay('hallway', { set: { burn_in: false } })

    const status = store.updateDisplay('hallway', { set: { theme: 'dark' } })

    expect(status.displays[0]!.changed).toEqual(['theme', 'burn_in'])
  })

  it('resets a key back to the config\'s and drops the row when nothing is left', () => {
    const { store, db, events } = setup()
    store.updateDisplay('hallway', { set: { theme: 'dark' } })
    expect(db.select().from(preferenceOverrides).all().map(row => row.scope)).toEqual(['display:hallway'])

    const status = store.updateDisplay('hallway', { reset: ['theme'] })

    expect(status.displays[0]).toMatchObject({ values: { theme: 'light' }, changed: [] })
    expect(db.select().from(preferenceOverrides).all()).toEqual([])
    expect(events).toHaveLength(2)
  })

  it('saves the shared preferences, including nulls', () => {
    const { store, events } = setup(parsedConfig({ ...PHOTOS, policies: { auto_presence: { quiet_hours: { from: '22:00', to: '06:00' } } } }))

    const status = store.updateShared({ set: { photo_interval_seconds: 20, quiet_hours: null, night_action: 'night_view', night_below_lux: 4 } })

    expect(status.shared.values).toMatchObject({ photo_interval_seconds: 20, quiet_hours: null, night_action: 'night_view', night_below_lux: 4 })
    expect(status.shared.config).toMatchObject({ photo_interval_seconds: 30, quiet_hours: { from: '22:00', to: '06:00' }, night_action: 'none' })
    expect(status.shared.changed).toEqual(['photo_interval_seconds', 'quiet_hours', 'night_action', 'night_below_lux'])
    expect(store.config().photos!.interval_seconds).toBe(20)
    expect(store.config().policies.auto_presence.quiet_hours).toBeUndefined()
    expect(events).toEqual([{ displayIds: [], shared: true }])
  })

  it('keeps what it saved when a new store is made on the same database', () => {
    const { store, open, config } = setup()
    store.updateDisplay('kitchen', { set: { week_start: 'sunday', week_hours: { from: 8, to: 20 } } })
    store.updateShared({ set: { min_step: 12, quiet_hours: { from: '21:00', to: '07:00' } } })

    const again = open()

    expect(again.status()).toEqual(store.status())
    expect(again.config().displays[1]).toMatchObject({ week_start: 'sunday', week_hours: { from: 8, to: 20 } })
    expect(again.config().policies.auto_brightness.min_step).toBe(12)
    expect(again.yamlConfig()).toBe(config)
  })

  it('does not emit when the values in force are the same, but still saves the key', () => {
    const { store, events, db } = setup()

    const status = store.updateDisplay('hallway', { set: { theme: 'light' } })

    expect(events).toEqual([])
    expect(status.displays[0]!.changed).toEqual(['theme'])
    expect(db.select().from(preferenceOverrides).all()).toHaveLength(1)

    store.updateDisplay('hallway', { set: { theme: 'light' } })
    store.updateShared({})
    store.updateShared({ reset: ['min_step'] })
    expect(events).toEqual([])
  })

  it('emits once for a save that changes several keys', () => {
    const { store, events } = setup()

    store.updateDisplay('hallway', { set: { theme: 'dark', burn_in: false, week_start: 'sunday' } })
    store.updateShared({ set: { min_step: 9, smoothing_seconds: 5 } })

    expect(events).toEqual([{ displayIds: ['hallway'], shared: false }, { displayIds: [], shared: true }])
  })

  it('does not emit when a save is refused, and saves nothing', () => {
    const { store, events, db } = setup()

    const fields = refused(() => store.updateDisplay('hallway', { set: { theme: 'dark', month_return_minutes: 0 } }))

    expect(Object.keys(fields)).toEqual(['month_return_minutes'])
    expect(events).toEqual([])
    expect(db.select().from(preferenceOverrides).all()).toEqual([])
    expect(store.config().displays[0]!.theme).toBe('light')
  })

  it('refuses a cross-field problem under the key the page shows it on', () => {
    const { store } = setup()

    expect(refused(() => store.updateShared({ set: { night_action: 'screen_off' } }))).toEqual({ night_below_lux: expect.stringContaining('night_action is screen_off') })
    expect(refused(() => store.updateDisplay('hallway', { set: { night_text: 'next_alarm' } }))).toEqual({ night_text: expect.stringContaining('alarm') })
  })

  it('refuses the photo interval without a photos block, and next_alarm with no alarm, but takes it with one', () => {
    const without = setup(parsedConfig())
    expect(refused(() => without.store.updateShared({ set: { photo_interval_seconds: 10 } }))).toEqual({ photo_interval_seconds: expect.any(String) })
    expect(without.store.status()).toMatchObject({ photos_configured: false })
    expect(without.store.status().shared.values.photo_interval_seconds).toBe(60)

    const withAlarm = setup(parsedConfig({ ...ALARM, ...PHOTOS }))
    expect(withAlarm.store.updateDisplay('hallway', { set: { night_text: 'next_alarm' } }).displays[0]!.values.night_text).toBe('next_alarm')
    expect(withAlarm.store.status().alarm_configured).toBe(true)
  })

  it('refuses a reset that would break a rule against what the config says', () => {
    const { store } = setup(parsedConfig({ ...PHOTOS, policies: { auto_brightness: { night_action: 'night_view', night_below_lux: 5 } } }))
    store.updateShared({ set: { night_below_lux: 8 } })

    // Going back to the config's 5 is fine; saving null for it is not.
    expect(refused(() => store.updateShared({ set: { night_below_lux: null } }))).toHaveProperty('night_below_lux')
    expect(store.updateShared({ reset: ['night_below_lux'] }).shared.values.night_below_lux).toBe(5)
  })

  it('throws UnknownDisplayError for a display that is not in the config', () => {
    const { store } = setup()

    expect(() => store.updateDisplay('garage', { set: { theme: 'dark' } })).toThrow(UnknownDisplayError)
  })

  it('ignores a stored key that no longer fits, with a warning naming it, and keeps the rest', () => {
    const { db, config, open, log } = setup()
    db.insert(preferenceOverrides).values({ scope: 'display:hallway', values: { night_text: 'next_alarm', theme: 'dark', month_return_minutes: 0, colour: 'red' } }).run()
    db.insert(preferenceOverrides).values({ scope: 'shared', values: { photo_interval_seconds: 3, min_step: 11 } }).run()

    const store = open()

    expect(store.config().displays[0]).toMatchObject({ theme: 'dark', night_text: 'none', month_return_minutes: 15 })
    expect(store.config().policies.auto_brightness.min_step).toBe(11)
    expect(store.config().photos!.interval_seconds).toBe(config.photos!.interval_seconds)
    expect(store.status().displays[0]!.changed).toEqual(['theme'])
    const warnings = log.warn.mock.calls.map(call => String(call[0]))
    expect(warnings).toHaveLength(4)
    for (const key of ['night_text', 'month_return_minutes', 'colour', 'photo_interval_seconds']) {
      expect(warnings.some(warning => warning.includes('[settings]') && warning.includes(key)), key).toBe(true)
    }
  })

  it('ignores a row that is not an object, and leaves rows for displays that are gone alone', () => {
    const { db, open, log } = setup()
    db.insert(preferenceOverrides).values({ scope: 'display:hallway', values: [1] as unknown as Record<string, unknown> }).run()
    db.insert(preferenceOverrides).values({ scope: 'display:garage', values: { theme: 'dark' } }).run()
    db.insert(preferenceOverrides).values({ scope: 'bogus', values: { theme: 'dark' } }).run()

    const store = open()

    expect(store.status().displays.every(entry => entry.changed.length === 0)).toBe(true)
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(db.select().from(preferenceOverrides).all().map(row => row.scope).sort()).toEqual(['bogus', 'display:garage', 'display:hallway'])
  })

  it('never writes to the YAML config (it stays frozen and unchanged)', () => {
    const config = parsedConfig(PHOTOS)
    const before = JSON.stringify(config)
    const { store } = setup(config)

    store.updateDisplay('hallway', { set: { theme: 'dark' } })
    store.updateShared({ set: { photo_interval_seconds: 99 } })

    expect(JSON.stringify(config)).toBe(before)
  })
})
