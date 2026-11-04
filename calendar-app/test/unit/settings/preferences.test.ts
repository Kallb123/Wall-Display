import { describe, expect, it } from 'vitest'
import {
  checkDisplayValues,
  checkSharedValues,
  keepDisplayOverridesThatFit,
  keepSharedOverridesThatFit,
  mergeOverrides,
  parseDisplayUpdate,
  parseSharedUpdate,
  readDisplayPreferences,
  readSharedPreferences,
  validateDisplayOverrides,
  validateSharedOverrides,
} from '../../../server/settings/preferences'
import { ALARM, parsedConfig, PHOTOS } from './helpers'

describe('reading preferences from the config', () => {
  it('gives a display\'s values, with the schema defaults filled in', () => {
    const config = parsedConfig()

    expect(readDisplayPreferences(config.displays[0]!)).toEqual({
      theme: 'light',
      month_style: 'soft',
      week_start: 'monday',
      month_return_minutes: 15,
      week_hours: { from: 7, to: 21 },
      burn_in: true,
      night_text: 'none',
    })
    expect(readDisplayPreferences(config.displays[1]!).theme).toBe('dark')
  })

  it('gives the shared values, with nulls for what the config leaves out and 60 for the photo interval without a photos block', () => {
    expect(readSharedPreferences(parsedConfig())).toEqual({
      photo_interval_seconds: 60,
      off_after_minutes: 10,
      quiet_hours: null,
      night_action: 'none',
      night_below_lux: null,
      night_above_lux: null,
      min_step: 5,
      smoothing_seconds: 30,
    })
  })

  it('reads the values the config sets', () => {
    const config = parsedConfig({
      ...PHOTOS,
      policies: {
        auto_presence: { off_after_minutes: 20, quiet_hours: { from: '22:00', to: '06:00' } },
        auto_brightness: { night_action: 'night_view', night_below_lux: 3, night_above_lux: 8, min_step: 10, smoothing_seconds: 0 },
      },
    })

    expect(readSharedPreferences(config)).toEqual({
      photo_interval_seconds: 30,
      off_after_minutes: 20,
      quiet_hours: { from: '22:00', to: '06:00' },
      night_action: 'night_view',
      night_below_lux: 3,
      night_above_lux: 8,
      min_step: 10,
      smoothing_seconds: 0,
    })
  })
})

describe('reading an update', () => {
  it('takes set and reset, and keeps the values the schema gives back', () => {
    expect(parseDisplayUpdate({ set: { theme: 'dark', week_hours: { from: 6, to: 22 } }, reset: ['burn_in'] })).toEqual({
      ok: true,
      set: { theme: 'dark', week_hours: { from: 6, to: 22 } },
      reset: ['burn_in'],
    })
    expect(parseDisplayUpdate({})).toEqual({ ok: true, set: {}, reset: [] })
  })

  it('accepts null for the shared values the config can leave out', () => {
    expect(parseSharedUpdate({ set: { quiet_hours: null, night_below_lux: null, night_above_lux: null } })).toMatchObject({ ok: true })
  })

  it.each([
    ['not an object', 'theme', { _: expect.stringContaining('object') }],
    ['an array', [], { _: expect.stringContaining('object') }],
    ['null', null, { _: expect.stringContaining('object') }],
    ['an unknown top-level key', { set: {}, extra: 1 }, { extra: expect.any(String) }],
    ['set that is not an object', { set: 'x' }, { _: expect.stringContaining('"set"') }],
    ['reset that is not a list', { reset: 'theme' }, { _: expect.stringContaining('"reset"') }],
    ['an unknown key in set', { set: { colour: 'red' } }, { colour: expect.stringContaining('not a preference') }],
    ['an unknown key in reset', { reset: ['colour'] }, { colour: expect.stringContaining('not a preference') }],
    ['a key that is not editable here (default_view)', { set: { default_view: 'week' } }, { default_view: expect.any(String) }],
    ['a wrong type', { set: { burn_in: 'yes' } }, { burn_in: 'must be a boolean' }],
    ['a wrong enum value', { set: { theme: 'blue' } }, { theme: 'must be one of light, dark' }],
    ['a number out of range', { set: { month_return_minutes: 0 } }, { month_return_minutes: expect.any(String) }],
    ['a fraction', { set: { month_return_minutes: 1.5 } }, { month_return_minutes: expect.any(String) }],
    ['a week_hours with from at or after to', { set: { week_hours: { from: 10, to: 10 } } }, { week_hours: expect.stringContaining('before') }],
    ['a week_hours out of range', { set: { week_hours: { from: 0, to: 25 } } }, { week_hours: expect.stringContaining('to must be from 1 to 24') }],
    ['a week_hours with an extra key', { set: { week_hours: { from: 1, to: 2, x: 3 } } }, { week_hours: expect.stringContaining('"x"') }],
    ['a key in both set and reset', { set: { theme: 'dark' }, reset: ['theme'] }, { theme: expect.stringContaining('both') }],
  ])('refuses %s', (_name, body, fields) => {
    expect(parseDisplayUpdate(body)).toEqual({ ok: false, fields })
  })

  it('refuses shared values that are wrong, naming each key', () => {
    const result = parseSharedUpdate({ set: { photo_interval_seconds: 4, quiet_hours: { from: '25:00', to: '06:00' }, min_step: 51, smoothing_seconds: -1, night_below_lux: 0, night_action: 'sleep', off_after_minutes: 0 } })

    expect(result.ok).toBe(false)
    expect(Object.keys((result as { fields: object }).fields).sort()).toEqual(['min_step', 'night_action', 'night_below_lux', 'off_after_minutes', 'photo_interval_seconds', 'quiet_hours', 'smoothing_seconds'])
    expect((result as { fields: Record<string, string> }).fields.quiet_hours).toContain('24-hour time')
  })

  it('refuses quiet hours that start and end at the same time', () => {
    const result = parseSharedUpdate({ set: { quiet_hours: { from: '22:00', to: '22:00' } } })

    expect(result).toMatchObject({ ok: false, fields: { quiet_hours: expect.stringContaining('must differ') } })
  })
})

describe('the rules across keys', () => {
  const base = readSharedPreferences(parsedConfig(PHOTOS))
  const shared = (changes: Partial<typeof base>) => ({ ...base, ...changes })

  it('needs night_below_lux for a night action', () => {
    expect(checkSharedValues(shared({ night_action: 'night_view' }), { photos: true }, [])).toEqual({ night_below_lux: expect.stringContaining('night_action is night_view') })
    expect(checkSharedValues(shared({ night_action: 'screen_off', night_below_lux: 5 }), { photos: true }, [])).toEqual({})
    expect(checkSharedValues(shared({ night_below_lux: 5 }), { photos: true }, [])).toEqual({})
  })

  it('needs night_below_lux for night_above_lux, and more than it', () => {
    expect(checkSharedValues(shared({ night_above_lux: 9 }), { photos: true }, [])).toEqual({ night_above_lux: expect.stringContaining('needs night_below_lux') })
    expect(checkSharedValues(shared({ night_below_lux: 9, night_above_lux: 9 }), { photos: true }, [])).toEqual({ night_above_lux: expect.stringContaining('more than night_below_lux') })
    expect(checkSharedValues(shared({ night_below_lux: 9, night_above_lux: 4 }), { photos: true }, [])).toEqual({ night_above_lux: expect.stringContaining('more than night_below_lux') })
    expect(checkSharedValues(shared({ night_below_lux: 4, night_above_lux: 9 }), { photos: true }, [])).toEqual({})
  })

  it('refuses quiet hours from and to the same time', () => {
    expect(checkSharedValues(shared({ quiet_hours: { from: '07:00', to: '07:00' } }), { photos: true }, [])).toEqual({ quiet_hours: expect.stringContaining('must differ') })
    expect(checkSharedValues(shared({ quiet_hours: { from: '22:00', to: '07:00' } }), { photos: true }, [])).toEqual({})
  })

  it('refuses a photo interval without a photos block, and says nothing when it is not saved', () => {
    expect(checkSharedValues(base, { photos: false }, ['photo_interval_seconds'])).toEqual({ photo_interval_seconds: expect.stringContaining('no "photos" block') })
    expect(checkSharedValues(base, { photos: false }, [])).toEqual({})
  })

  it('refuses night_text next_alarm without an alarm block', () => {
    const values = readDisplayPreferences(parsedConfig().displays[0]!)

    expect(checkDisplayValues({ ...values, night_text: 'next_alarm' }, { alarm: false })).toEqual({ night_text: expect.stringContaining('no "alarm" block') })
    expect(checkDisplayValues({ ...values, night_text: 'next_alarm' }, { alarm: true })).toEqual({})
    expect(checkDisplayValues({ ...values, night_text: 'first_event' }, { alarm: false })).toEqual({})
  })

  it('checks the merged result, so a reset can break a rule too', () => {
    const config = parsedConfig({ policies: { auto_brightness: { night_action: 'night_view', night_below_lux: 5 } } })

    // The saved night_below_lux null would leave the config's night_action with nothing to go on.
    expect(validateSharedOverrides(config, { night_below_lux: null })).toEqual({ night_below_lux: expect.any(String) })
    expect(validateSharedOverrides(config, { night_action: 'none', night_below_lux: null })).toEqual({})
  })

  it('validates a display\'s overrides against its alarm block', () => {
    const withAlarm = parsedConfig(ALARM)

    expect(validateDisplayOverrides(withAlarm.displays[0]!, { night_text: 'next_alarm' }, { alarm: true })).toEqual({})
    expect(validateDisplayOverrides(parsedConfig().displays[0]!, { night_text: 'next_alarm' }, { alarm: false })).toEqual({ night_text: expect.any(String) })
  })
})

describe('keeping the stored keys that still fit', () => {
  it('ignores an unknown key and a bad value, and says why', () => {
    const config = parsedConfig(ALARM)

    const { kept, ignored } = keepDisplayOverridesThatFit({ theme: 'dark', month_return_minutes: 0, default_view: 'week', week_hours: { from: 9, to: 9 } }, config.displays[0]!, { alarm: true })

    expect(kept).toEqual({ theme: 'dark' })
    expect(ignored.map(item => item.key).sort()).toEqual(['default_view', 'month_return_minutes', 'week_hours'])
  })

  it('ignores night_text next_alarm once the alarm block is gone', () => {
    const { kept, ignored } = keepDisplayOverridesThatFit({ night_text: 'next_alarm', burn_in: false }, parsedConfig().displays[0]!, { alarm: false })

    expect(kept).toEqual({ burn_in: false })
    expect(ignored).toEqual([{ key: 'night_text', reason: expect.stringContaining('no "alarm" block') }])
  })

  it('lets a night action in with the threshold it needs, whatever order they were stored in', () => {
    const { kept, ignored } = keepSharedOverridesThatFit({ night_below_lux: 4, night_action: 'screen_off' }, parsedConfig())

    expect(kept).toEqual({ night_action: 'screen_off', night_below_lux: 4 })
    expect(ignored).toEqual([])
  })

  it('ignores a night action whose threshold is not there, and the photo interval without a photos block', () => {
    const { kept, ignored } = keepSharedOverridesThatFit({ night_action: 'screen_off', photo_interval_seconds: 20, min_step: 7 }, parsedConfig())

    expect(kept).toEqual({ min_step: 7 })
    expect(ignored.map(item => item.key).sort()).toEqual(['night_action', 'photo_interval_seconds'])
  })
})

describe('merging overrides into the config', () => {
  it('gives a new frozen config and leaves the YAML one as it was', () => {
    const config = parsedConfig(PHOTOS)
    const before = JSON.stringify(config)

    const merged = mergeOverrides(config, {
      displays: { hallway: { theme: 'dark', week_hours: { from: 6, to: 22 }, burn_in: false } },
      shared: { photo_interval_seconds: 20, off_after_minutes: 3 },
    })

    expect(merged).not.toBe(config)
    expect(JSON.stringify(config)).toBe(before)
    expect(Object.isFrozen(merged)).toBe(true)
    expect(Object.isFrozen(merged.displays)).toBe(true)
    expect(Object.isFrozen(merged.displays[0])).toBe(true)
    expect(Object.isFrozen(merged.policies.auto_presence)).toBe(true)
    expect(merged.displays[0]).toMatchObject({ id: 'hallway', theme: 'dark', burn_in: false, week_hours: { from: 6, to: 22 }, week_start: 'monday' })
    expect(merged.displays[1]).toBe(config.displays[1])
    expect(merged.photos).toMatchObject({ interval_seconds: 20 })
    expect(merged.policies.auto_presence.off_after_minutes).toBe(3)
  })

  it('sets and clears the optional policy values, null meaning not set', () => {
    const config = parsedConfig({ policies: { auto_presence: { quiet_hours: { from: '22:00', to: '06:00' } }, auto_brightness: { night_action: 'night_view', night_below_lux: 5, night_above_lux: 12 } } })

    const cleared = mergeOverrides(config, { displays: {}, shared: { quiet_hours: null, night_action: 'none', night_below_lux: null, night_above_lux: null } })
    expect(cleared.policies.auto_presence.quiet_hours).toBeUndefined()
    expect(cleared.policies.auto_brightness.night_below_lux).toBeUndefined()
    expect(cleared.policies.auto_brightness.night_above_lux).toBeUndefined()
    expect(cleared.policies.auto_brightness.night_action).toBe('none')

    const set = mergeOverrides(parsedConfig(), { displays: {}, shared: { quiet_hours: { from: '23:00', to: '05:00' }, night_below_lux: 2, min_step: 9, smoothing_seconds: 12, night_action: 'screen_off' } })
    expect(set.policies.auto_presence.quiet_hours).toEqual({ from: '23:00', to: '05:00' })
    expect(set.policies.auto_brightness).toMatchObject({ night_below_lux: 2, min_step: 9, smoothing_seconds: 12, night_action: 'screen_off' })
    expect(set.policies.auto_brightness.curve).toHaveLength(3)
  })

  it('does not invent a photos block for a photo interval', () => {
    const merged = mergeOverrides(parsedConfig(), { displays: {}, shared: { photo_interval_seconds: 20 } })

    expect(merged.photos).toBeUndefined()
  })

  it('with nothing to merge, still gives a config with the same values', () => {
    const config = parsedConfig(PHOTOS)

    expect(mergeOverrides(config, { displays: {}, shared: {} })).toEqual(config)
  })
})
