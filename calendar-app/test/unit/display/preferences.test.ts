import { describe, expect, it } from 'vitest'
import type { DisplayPreferences } from '../../../shared/settings'
import { DISPLAY_PREFERENCE_KEYS } from '../../../shared/settings'
import {
  draftOf,
  editedKeys,
  hourLabel,
  numberOrNull,
  preferenceFailure,
  preferenceText,
  refreshedDraft,
  resetUpdate,
  sameValue,
  saveUpdate,
} from '../../../app/utils/preferences'

const values: DisplayPreferences = {
  theme: 'light',
  month_style: 'soft',
  week_start: 'monday',
  month_return_minutes: 5,
  week_hours: { from: 7, to: 21 },
  day_parts: { afternoon: 12, evening: 17 },
  weather_on_dates: { month: true, week: true, week_parts: true, agenda: true },
  show_locations: true,
  burn_in: true,
  motion: 'off',
  takeover_art: 'behind',
  night_text: 'none',
  orientation: 'auto',
}

describe('sameValue', () => {
  it('compares objects by what is in them', () => {
    expect(sameValue({ from: 7, to: 21 }, { from: 7, to: 21 })).toBe(true)
    expect(sameValue({ from: 7, to: 21 }, { from: 7, to: 22 })).toBe(false)
    expect(sameValue(null, { from: 1, to: 2 })).toBe(false)
    expect(sameValue(null, null)).toBe(true)
  })
})

describe('saveUpdate', () => {
  it('is null when nothing was edited', () => {
    expect(saveUpdate(draftOf(values), values, DISPLAY_PREFERENCE_KEYS)).toBeNull()
  })

  it('sends only the keys that were edited', () => {
    const draft = draftOf(values)
    draft.theme = 'dark'
    draft.week_hours.to = 22
    draft.day_parts.evening = 18
    expect(editedKeys(draft, values, DISPLAY_PREFERENCE_KEYS)).toEqual(['theme', 'week_hours', 'day_parts'])
    expect(saveUpdate(draft, values, DISPLAY_PREFERENCE_KEYS)).toEqual({ set: { theme: 'dark', week_hours: { from: 7, to: 22 }, day_parts: { afternoon: 12, evening: 18 } } })
  })

  it('sends the whole weather_on_dates when one view is switched', () => {
    const draft = draftOf(values)
    draft.weather_on_dates.week_parts = false
    expect(saveUpdate(draft, values, DISPLAY_PREFERENCE_KEYS)).toEqual({ set: { weather_on_dates: { month: true, week: true, week_parts: false, agenda: true } } })
  })

  it('sends show_locations when it is switched off', () => {
    const draft = draftOf(values)
    draft.show_locations = false
    expect(saveUpdate(draft, values, DISPLAY_PREFERENCE_KEYS)).toEqual({ set: { show_locations: false } })
  })

  it('does not send a key that was edited and put back', () => {
    const draft = draftOf(values)
    draft.burn_in = false
    draft.burn_in = true
    expect(saveUpdate(draft, values, DISPLAY_PREFERENCE_KEYS)).toBeNull()
  })

  it('keeps a null the person typed, for the server to turn away', () => {
    const draft = draftOf(values)
    draft.month_return_minutes = null as unknown as number
    expect(saveUpdate(draft, values, DISPLAY_PREFERENCE_KEYS)).toEqual({ set: { month_return_minutes: null } })
  })
})

describe('resetUpdate', () => {
  it('names the key to reset and sets nothing', () => {
    expect(resetUpdate<DisplayPreferences>('theme')).toEqual({ reset: ['theme'] })
  })
})

describe('refreshedDraft', () => {
  const after = { ...values, theme: 'dark' as const }

  it('takes the answer for a key that was sent', () => {
    const draft = { ...draftOf(values), theme: 'dark' as const }
    expect(refreshedDraft(draft, values, after, DISPLAY_PREFERENCE_KEYS, ['theme']).theme).toBe('dark')
  })

  it('keeps an edit that was not sent, as when Reset is pressed beside another key', () => {
    const draft = { ...draftOf(values), burn_in: false }
    const next = refreshedDraft(draft, values, { ...values, theme: 'light' }, DISPLAY_PREFERENCE_KEYS, ['theme'])
    expect(next.burn_in).toBe(false)
    expect(next.theme).toBe('light')
  })

  it('takes new values for keys nobody edited', () => {
    expect(refreshedDraft(draftOf(values), values, after, DISPLAY_PREFERENCE_KEYS, []).theme).toBe('dark')
  })
})

describe('labels', () => {
  it('writes hours as times', () => {
    expect(hourLabel(7)).toBe('07:00')
    expect(hourLabel(24)).toBe('24:00')
  })

  it.each([
    ['theme', 'dark', 'Dark'],
    ['orientation', 'portrait', 'Portrait'],
    ['burn_in', true, 'on'],
    ['show_locations', true, 'on'],
    ['show_locations', false, 'off'],
    ['motion', 'off', 'Off'],
    ['motion', 'subtle', 'Subtle'],
    ['takeover_art', 'behind', 'Behind'],
    ['takeover_art', 'over_in_portrait', 'Over in portrait'],
    ['takeover_art', 'over', 'Over'],
    ['month_return_minutes', 5, '5 min'],
    ['week_hours', { from: 7, to: 21 }, '07:00 to 21:00'],
    ['day_parts', { afternoon: 12, evening: 17 }, 'afternoon from 12:00, evening from 17:00'],
    ['weather_on_dates', { month: true, week: true, week_parts: true, agenda: true }, 'All views'],
    ['weather_on_dates', { month: true, week: true, week_parts: false, agenda: true }, 'Month, week and agenda'],
    ['weather_on_dates', { month: false, week: false, week_parts: true, agenda: false }, 'Day parts'],
    ['weather_on_dates', { month: false, week: false, week_parts: false, agenda: false }, 'None'],
    ['quiet_hours', { from: '22:00', to: '07:00' }, '22:00 to 07:00'],
    ['quiet_hours', null, 'none'],
    ['night_above_lux', null, 'twice the dark level'],
    ['night_below_lux', 3, '3 lux'],
    ['night_action', 'screen_off', 'Screen off'],
    ['photo_interval_seconds', 60, '60 s'],
  ])('describes %s %j as %s', (key, value, text) => {
    expect(preferenceText(key, value)).toBe(text)
  })
})

describe('numberOrNull', () => {
  it('is null for a blank or a non-number', () => {
    expect(numberOrNull('')).toBeNull()
    expect(numberOrNull('  ')).toBeNull()
    expect(numberOrNull('abc')).toBeNull()
    expect(numberOrNull('12')).toBe(12)
    expect(numberOrNull('2.5')).toBe(2.5)
  })
})

describe('preferenceFailure', () => {
  const failure = (statusCode: number, body: unknown) => Object.assign(new Error('x'), { statusCode, data: body })

  it('reads the fields of a 400, with the message', () => {
    const error = failure(400, { statusCode: 400, message: 'night_below_lux is needed', data: { fields: { night_below_lux: 'is needed when night_action is night_view' } } })
    expect(preferenceFailure(error)).toEqual({ status: 400, message: 'night_below_lux is needed', fields: { night_below_lux: 'is needed when night_action is night_view' } })
  })

  it('has no fields for another status, or a body without them', () => {
    expect(preferenceFailure(failure(500, { message: 'Boom', data: { fields: { a: 'b' } } })).fields).toEqual({})
    expect(preferenceFailure(failure(400, { message: 'Bad' })).fields).toEqual({})
  })

  it('ignores field messages that are not text', () => {
    expect(preferenceFailure(failure(400, { data: { fields: { a: 1, b: 'ok' } } })).fields).toEqual({ b: 'ok' })
  })

  it('has no status when the server never answered', () => {
    expect(preferenceFailure(new TypeError('Failed to fetch'))).toEqual({ status: null, message: null, fields: {} })
  })
})
