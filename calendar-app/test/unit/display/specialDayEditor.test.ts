import { describe, expect, it } from 'vitest'
import { specialDayInputSchema, specialDaySceneInputSchema } from '../../../shared/special-days'
import type { SpecialDay, SpecialDayScene } from '../../../shared/special-days'
import {
  LEAD_OPTIONS,
  MONTH_OPTIONS,
  PALETTE_OPTIONS,
  REPEAT_OPTIONS,
  dateChip,
  dayBody,
  dayDraftFrom,
  dayIsDirty,
  dayOptions,
  daySummary,
  daysUsing,
  draftLook,
  fieldOrigin,
  greetingPreview,
  leadLabel,
  newDayDraft,
  newSceneDraft,
  nextOccurrence,
  resetField,
  sceneBody,
  sceneDraftFrom,
  sceneGreetingPreview,
  sceneIsDirty,
  sceneSavedMessage,
  usedByLabel,
  validateDay,
  validateScene,
  withScene,
  writeFailure,
} from '../../../app/utils/specialDayEditor'

// Sat 31 Oct 2026, the day the wall is on in these tests.
const TODAY = '2026-10-31'

const scene = (changes: Partial<SpecialDayScene> = {}): SpecialDayScene => ({
  id: 'birthday',
  name: 'Birthday',
  lead: 'week',
  lead_days: null,
  tile_art: 'birthday-tile.webp',
  takeover: true,
  full_art: 'birthday-full.webp',
  greeting: 'Happy {nth} birthday, {who}!',
  palette: 'frost',
  updated_at: '2026-10-01T09:00:00.000Z',
  ...changes,
})

const day = (changes: Partial<SpecialDay> = {}): SpecialDay => ({
  id: 'isla',
  name: 'Isla\'s birthday',
  month: 3,
  day: 14,
  year: null,
  repeat: 'yearly',
  scene_id: null,
  who: null,
  since_year: null,
  lead: null,
  lead_days: null,
  tile_art: null,
  takeover: null,
  full_art: null,
  greeting: null,
  palette: null,
  extra_art: null,
  updated_at: '2026-10-02T09:00:00.000Z',
  ...changes,
})

/** A day on a scene that only borrows its look, for the marks. */
const islaOnBirthday = day({ scene_id: 'birthday', who: 'Isla', since_year: 2020 })

describe('drafts', () => {
  it('starts a new day as a yearly one on today, with nothing set', () => {
    expect(newDayDraft(TODAY)).toEqual({
      name: '',
      month: 10,
      day: 31,
      year: '',
      repeat: 'yearly',
      scene_id: null,
      who: '',
      since_year: '',
      lead: null,
      lead_days: '',
      takeover: null,
      greeting: null,
      palette: null,
    })
  })

  it('starts a new scene on the day, with no takeover, the warm palette and no greeting', () => {
    expect(newSceneDraft()).toEqual({ name: '', lead: 'day', lead_days: '', takeover: false, greeting: '', palette: 'warm' })
  })

  it('keeps numbers as the text a form edits', () => {
    const draft = dayDraftFrom(day({ repeat: 'once', year: 2027, who: 'Isla', lead: 'days', lead_days: 10 }))
    expect(draft).toMatchObject({ year: '2027', who: 'Isla', lead: 'days', lead_days: '10', since_year: '' })
  })

  it('makes the body a day was stored from, whatever it sets', () => {
    const stored = [
      day(),
      day({ repeat: 'once', year: 2027, month: 2, day: 28 }),
      day({ scene_id: 'birthday', who: 'Isla', since_year: 2020 }),
      day({ lead: 'days', lead_days: 10, takeover: true, greeting: 'Hello {who}', palette: 'night', who: 'Isla' }),
      day({ lead: 'month', takeover: false, palette: 'sage' }),
    ]
    for (const original of stored) {
      const { id: _id, tile_art: _tile, full_art: _full, extra_art: _extra, updated_at: _updated, ...fields } = original
      expect(dayBody(dayDraftFrom(original))).toEqual(fields)
    }
  })

  it('makes the body a scene was stored from', () => {
    for (const original of [scene(), scene({ lead: 'days', lead_days: 3, greeting: null, takeover: false, palette: 'sage' })]) {
      const { id: _id, tile_art: _tile, full_art: _full, updated_at: _updated, ...fields } = original
      expect(sceneBody(sceneDraftFrom(original))).toEqual(fields)
    }
  })
})

describe('dayBody', () => {
  const filled = () => ({ ...newDayDraft(TODAY), name: '  Isla\'s birthday ', month: 3, day: 14 })

  it('trims, parses the numbers and turns blanks into null', () => {
    const body = dayBody({ ...filled(), who: ' Isla ', since_year: ' 2020 ', greeting: '  ', lead: 'days', lead_days: '10' })
    expect(body).toMatchObject({ name: 'Isla\'s birthday', who: 'Isla', since_year: 2020, greeting: null, lead: 'days', lead_days: 10, year: null })
  })

  it('sends a year only for a day that happens once, and a since year only for a yearly one', () => {
    expect(dayBody({ ...filled(), repeat: 'yearly', year: '2027', since_year: '2020' })).toMatchObject({ year: null, since_year: 2020 })
    expect(dayBody({ ...filled(), repeat: 'once', year: '2027', since_year: '2020' })).toMatchObject({ year: 2027, since_year: null })
  })

  it('sends lead days only when the lead is days', () => {
    expect(dayBody({ ...filled(), lead: 'week', lead_days: '10' })).toMatchObject({ lead: 'week', lead_days: null })
    expect(dayBody({ ...filled(), lead: null, lead_days: '10' })).toMatchObject({ lead: null, lead_days: null })
  })

  it('keeps null for a look that is the scene\'s, and what is set for one that is not', () => {
    expect(dayBody(filled())).toMatchObject({ lead: null, takeover: null, greeting: null, palette: null })
    expect(dayBody({ ...filled(), takeover: false, palette: 'night', greeting: ' Hi ' })).toMatchObject({ takeover: false, palette: 'night', greeting: 'Hi' })
  })

  it('passes on text that is not a number as typed, for the check to refuse', () => {
    expect(dayBody({ ...filled(), since_year: 'abc' })).toMatchObject({ since_year: 'abc' })
  })
})

describe('sceneBody', () => {
  it('trims, parses lead days only for a days lead, and turns a blank greeting into null', () => {
    const draft = { ...newSceneDraft(), name: ' Birthday ', greeting: '   ' }
    expect(sceneBody(draft)).toEqual({ name: 'Birthday', lead: 'day', lead_days: null, takeover: false, greeting: null, palette: 'warm' })
    expect(sceneBody({ ...draft, lead: 'days', lead_days: ' 12 ' })).toMatchObject({ lead: 'days', lead_days: 12 })
    expect(sceneBody({ ...draft, lead: 'week', lead_days: '12' })).toMatchObject({ lead: 'week', lead_days: null })
  })
})

describe('validateDay', () => {
  const valid = () => ({ ...newDayDraft(TODAY), name: 'Isla\'s birthday', month: 3, day: 14 })

  it('is empty for a good day, and for a bare new one with a name', () => {
    expect(validateDay(valid())).toEqual({})
    expect(validateDay(dayDraftFrom(islaOnBirthday))).toEqual({})
  })

  it('wants a name', () => {
    expect(validateDay({ ...valid(), name: '' })).toEqual({ name: 'Name must not be empty' })
    expect(validateDay({ ...valid(), name: '   ' })).toEqual({ name: 'Name must not be empty' })
    expect(validateDay({ ...valid(), name: 'x'.repeat(61) })).toEqual({ name: 'Name must be at most 60 characters' })
  })

  it('allows 29 February in a yearly day, and not 30 February', () => {
    expect(validateDay({ ...valid(), month: 2, day: 29 })).toEqual({})
    expect(validateDay({ ...valid(), month: 2, day: 30 })).toEqual({ day: 'Day must be a day that exists in that month' })
    expect(validateDay({ ...valid(), month: 4, day: 31 })).toEqual({ day: 'Day must be a day that exists in that month' })
  })

  it('checks the day against the year for a day that happens once', () => {
    const once = { ...valid(), repeat: 'once' as const, month: 2, day: 29 }
    expect(validateDay({ ...once, year: '2028' })).toEqual({})
    expect(validateDay({ ...once, year: '2027' })).toEqual({ day: 'Day must be a day that exists in that month of 2027' })
  })

  it('accepts a year that has already gone for a day that happens once', () => {
    expect(validateDay({ ...valid(), repeat: 'once', year: '2020' })).toEqual({})
  })

  it('wants a year for a day that happens once, within the years allowed', () => {
    expect(validateDay({ ...valid(), repeat: 'once', year: '' })).toEqual({ year: 'Year is required for a day that happens once' })
    expect(validateDay({ ...valid(), repeat: 'once', year: '1999' })).toEqual({ year: 'Year must be from 2000 to 2100' })
    expect(validateDay({ ...valid(), repeat: 'once', year: '2101' })).toEqual({ year: 'Year must be from 2000 to 2100' })
  })

  it('ignores a year typed before the day was switched back to yearly', () => {
    expect(validateDay({ ...valid(), repeat: 'yearly', year: 'abc' })).toEqual({})
  })

  it('says a number field typed as something else must be a whole number', () => {
    expect(validateDay({ ...valid(), since_year: 'abc' })).toEqual({ since_year: 'Since must be a whole number' })
    expect(validateDay({ ...valid(), repeat: 'once', year: 'soon' })).toEqual({ year: 'Year must be a whole number' })
    expect(validateDay({ ...valid(), since_year: '2020.5' })).toEqual({ since_year: 'Since must be a whole number' })
    expect(validateDay({ ...valid(), lead: 'days', lead_days: 'a few' })).toEqual({ lead_days: 'Days before must be a whole number' })
  })

  it('checks the since year', () => {
    expect(validateDay({ ...valid(), since_year: '' })).toEqual({})
    expect(validateDay({ ...valid(), since_year: '2020' })).toEqual({})
    expect(validateDay({ ...valid(), since_year: '1850' })).toEqual({ since_year: 'Since must be from 1900 to 2100' })
    expect(validateDay({ ...valid(), since_year: '2200' })).toEqual({ since_year: 'Since must be from 1900 to 2100' })
  })

  it('wants lead days when the lead is days, from 1 to 365', () => {
    expect(validateDay({ ...valid(), lead: 'days', lead_days: '' })).toEqual({ lead_days: 'Days before is required' })
    expect(validateDay({ ...valid(), lead: 'days', lead_days: '0' })).toEqual({ lead_days: 'Days before must be from 1 to 365' })
    expect(validateDay({ ...valid(), lead: 'days', lead_days: '366' })).toEqual({ lead_days: 'Days before must be from 1 to 365' })
    expect(validateDay({ ...valid(), lead: 'days', lead_days: '10' })).toEqual({})
  })

  it('does not look at lead days typed for another lead', () => {
    expect(validateDay({ ...valid(), lead: 'week', lead_days: '9999' })).toEqual({})
  })

  it('refuses a placeholder that is not one, and allows each that is', () => {
    expect(validateDay({ ...valid(), greeting: 'Hello {name}' })).toEqual({ greeting: 'Greeting has an unknown placeholder {name}; use {who}, {years} or {nth}' })
    expect(validateDay({ ...valid(), greeting: '{who} is {years}, the {nth}' })).toEqual({})
    expect(validateDay({ ...valid(), greeting: 'x'.repeat(81) })).toEqual({ greeting: 'Greeting must be at most 80 characters' })
  })

  it('limits who', () => {
    expect(validateDay({ ...valid(), who: 'x'.repeat(41) })).toEqual({ who: 'Who must be at most 40 characters' })
  })

  it('reports every field that is wrong, the first problem of each', () => {
    expect(validateDay({ ...valid(), name: '', since_year: '1850', greeting: '{oops}' })).toEqual({
      name: 'Name must not be empty',
      since_year: 'Since must be from 1900 to 2100',
      greeting: 'Greeting has an unknown placeholder {oops}; use {who}, {years} or {nth}',
    })
  })

  it('refuses a month that is not one, such as an empty select', () => {
    expect(validateDay({ ...valid(), month: 13 })).toMatchObject({ month: 'Month must be from 1 to 12' })
    expect(validateDay({ ...valid(), month: Number.NaN })).toMatchObject({ month: 'Month must be a whole number' })
  })
})

describe('validateScene', () => {
  const valid = () => ({ ...newSceneDraft(), name: 'Birthday' })

  it('is empty for a good scene', () => {
    expect(validateScene(valid())).toEqual({})
    expect(validateScene(sceneDraftFrom(scene()))).toEqual({})
  })

  it('wants a name, lead days for a days lead and a greeting with known placeholders', () => {
    expect(validateScene({ ...valid(), name: ' ' })).toEqual({ name: 'Name must not be empty' })
    expect(validateScene({ ...valid(), lead: 'days' })).toEqual({ lead_days: 'Days before is required' })
    expect(validateScene({ ...valid(), lead: 'days', lead_days: 'x' })).toEqual({ lead_days: 'Days before must be a whole number' })
    expect(validateScene({ ...valid(), greeting: 'Hi {friend}' })).toEqual({ greeting: 'Greeting has an unknown placeholder {friend}; use {who}, {years} or {nth}' })
    expect(validateScene({ ...valid(), greeting: 'Hi {who}' })).toEqual({})
  })
})

describe('the bodies the drafts make', () => {
  it('are what the server\'s schemas read, and read back the same', () => {
    const body = dayBody({ ...dayDraftFrom(islaOnBirthday), greeting: ' ' })
    expect(specialDayInputSchema.parse(body)).toEqual(body)
    const sceneJson = sceneBody(sceneDraftFrom(scene()))
    expect(specialDaySceneInputSchema.parse(sceneJson)).toEqual(sceneJson)
  })
})

describe('dayIsDirty', () => {
  it('is clean for a draft made from the saved day', () => {
    expect(dayIsDirty(dayDraftFrom(islaOnBirthday), islaOnBirthday, TODAY)).toBe(false)
  })

  it('is dirty once a field differs from the saved day', () => {
    const draft = dayDraftFrom(islaOnBirthday)
    expect(dayIsDirty({ ...draft, name: 'Isla' }, islaOnBirthday, TODAY)).toBe(true)
    expect(dayIsDirty({ ...draft, palette: 'night' }, islaOnBirthday, TODAY)).toBe(true)
    expect(dayIsDirty({ ...draft, scene_id: null }, islaOnBirthday, TODAY)).toBe(true)
  })

  it('does not count what saving would not change', () => {
    const draft = dayDraftFrom(islaOnBirthday)
    expect(dayIsDirty({ ...draft, name: `${draft.name}  `, who: ' Isla ' }, islaOnBirthday, TODAY)).toBe(false)
    // A year typed for a yearly day, and a blank greeting, are not sent.
    expect(dayIsDirty({ ...draft, year: '2027', greeting: '' }, islaOnBirthday, TODAY)).toBe(false)
    expect(dayIsDirty({ ...draft, lead_days: '5' }, islaOnBirthday, TODAY)).toBe(false)
  })

  it('treats a new day as dirty once anything is typed', () => {
    const fresh = newDayDraft(TODAY)
    expect(dayIsDirty(fresh, null, TODAY)).toBe(false)
    expect(dayIsDirty({ ...fresh, name: 'Halloween' }, null, TODAY)).toBe(true)
    expect(dayIsDirty({ ...fresh, month: 12 }, null, TODAY)).toBe(true)
    expect(dayIsDirty({ ...fresh, takeover: true }, null, TODAY)).toBe(true)
  })
})

describe('sceneIsDirty', () => {
  it('is clean for a draft made from the saved scene, and dirty when a field differs', () => {
    const draft = sceneDraftFrom(scene())
    expect(sceneIsDirty(draft, scene())).toBe(false)
    expect(sceneIsDirty({ ...draft, greeting: 'Hello' }, scene())).toBe(true)
    expect(sceneIsDirty({ ...draft, takeover: false }, scene())).toBe(true)
  })

  it('treats a scene with no greeting and a blank one as the same', () => {
    expect(sceneIsDirty(sceneDraftFrom(scene({ greeting: null })), scene({ greeting: null }))).toBe(false)
    expect(sceneIsDirty({ ...sceneDraftFrom(scene({ greeting: null })), greeting: '  ' }, scene({ greeting: null }))).toBe(false)
  })

  it('treats a new scene as dirty once anything is typed', () => {
    expect(sceneIsDirty(newSceneDraft(), null)).toBe(false)
    expect(sceneIsDirty({ ...newSceneDraft(), name: 'Christmas' }, null)).toBe(true)
  })
})

describe('fieldOrigin', () => {
  it('has no mark for a day with no scene', () => {
    const draft = { ...newDayDraft(TODAY), palette: 'night' as const }
    expect(fieldOrigin(draft, null, 'palette')).toBeNull()
    expect(fieldOrigin(draft, null, 'tile_art')).toBeNull()
  })

  it('says a field that is null follows the scene, and one that is set is the day\'s own', () => {
    const draft = { ...dayDraftFrom(islaOnBirthday), palette: 'night' as const, lead: 'days' as const, lead_days: '4', takeover: false, greeting: 'Hi' }
    expect(fieldOrigin(draft, islaOnBirthday, 'palette')).toBe('own')
    expect(fieldOrigin(draft, islaOnBirthday, 'lead')).toBe('own')
    expect(fieldOrigin(draft, islaOnBirthday, 'takeover')).toBe('own')
    expect(fieldOrigin(draft, islaOnBirthday, 'greeting')).toBe('own')
    const bare = dayDraftFrom(islaOnBirthday)
    for (const field of ['palette', 'lead', 'takeover', 'greeting'] as const) expect(fieldOrigin(bare, islaOnBirthday, field)).toBe('scene')
  })

  it('counts a takeover that is off as the day\'s own, not the scene\'s', () => {
    expect(fieldOrigin({ ...dayDraftFrom(islaOnBirthday), takeover: false }, islaOnBirthday, 'takeover')).toBe('own')
  })

  it('counts a greeting cleared to blank as the scene\'s again, as saving does', () => {
    expect(fieldOrigin({ ...dayDraftFrom(islaOnBirthday), greeting: '' }, islaOnBirthday, 'greeting')).toBe('scene')
  })

  it('reads the art from the saved day, as the draft has none', () => {
    const draft = dayDraftFrom(islaOnBirthday)
    expect(fieldOrigin(draft, islaOnBirthday, 'tile_art')).toBe('scene')
    expect(fieldOrigin(draft, { ...islaOnBirthday, tile_art: 'own.png' }, 'tile_art')).toBe('own')
    expect(fieldOrigin(draft, { ...islaOnBirthday, full_art: 'own.webp' }, 'full_art')).toBe('own')
    expect(fieldOrigin(draft, { ...islaOnBirthday, full_art: 'own.webp' }, 'tile_art')).toBe('scene')
    // A day not saved yet has no art of its own.
    expect(fieldOrigin(draft, null, 'tile_art')).toBe('scene')
  })
})

describe('resetField', () => {
  const changed = { ...dayDraftFrom(islaOnBirthday), lead: 'days' as const, lead_days: '4', takeover: true, greeting: 'Hi', palette: 'night' as const }

  it('puts a field back to the scene\'s', () => {
    expect(resetField(changed, 'palette')).toEqual({ ...changed, palette: null })
    expect(resetField(changed, 'takeover')).toEqual({ ...changed, takeover: null })
    expect(resetField(changed, 'greeting')).toEqual({ ...changed, greeting: null })
  })

  it('clears the lead days with the lead', () => {
    expect(resetField(changed, 'lead')).toEqual({ ...changed, lead: null, lead_days: '' })
  })

  it('leaves the draft it was given as it was', () => {
    const before = { ...changed }
    resetField(changed, 'palette')
    expect(changed).toEqual(before)
  })

  it('makes the field the scene\'s in the body', () => {
    expect(dayBody(resetField(changed, 'palette'))).toMatchObject({ palette: null })
  })
})

describe('withScene', () => {
  const scenes = [scene(), scene({ id: 'christmas', name: 'Christmas', lead: 'days', lead_days: 20, takeover: false, greeting: null, palette: 'sage' })]

  it('keeps what the day sets when a scene is chosen, so it stays marked as changed', () => {
    const draft = { ...newDayDraft(TODAY), palette: 'night' as const, greeting: 'Hi' }
    const chosen = withScene(draft, 'birthday', scenes)
    expect(chosen).toEqual({ ...draft, scene_id: 'birthday' })
    expect(fieldOrigin(chosen, null, 'palette')).toBe('own')
    expect(fieldOrigin(chosen, null, 'takeover')).toBe('scene')
  })

  it('moves from one scene to another keeping the day\'s own values', () => {
    const draft = { ...dayDraftFrom(islaOnBirthday), palette: 'night' as const }
    expect(withScene(draft, 'christmas', scenes)).toEqual({ ...draft, scene_id: 'christmas' })
  })

  it('copies the scene\'s values into every look field still null when None is chosen', () => {
    const draft = dayDraftFrom(islaOnBirthday)
    const none = withScene(draft, null, scenes)
    expect(none).toMatchObject({ scene_id: null, lead: 'week', lead_days: '', takeover: true, greeting: 'Happy {nth} birthday, {who}!', palette: 'frost' })
    // The look is the one the scene gave it.
    expect(draftLook(none, null, null)).toMatchObject({ lead: 'week', takeover: true, greeting: 'Happy {nth} birthday, {who}!', palette: 'frost' })
  })

  it('copies the lead days with a days lead', () => {
    const none = withScene({ ...dayDraftFrom(islaOnBirthday), scene_id: 'christmas' }, null, scenes)
    expect(none).toMatchObject({ lead: 'days', lead_days: '20', takeover: false, palette: 'sage', greeting: null })
  })

  it('keeps the day\'s own values over the scene\'s when None is chosen', () => {
    const draft = { ...dayDraftFrom(islaOnBirthday), lead: 'month' as const, takeover: false, greeting: 'Mine', palette: 'night' as const }
    expect(withScene(draft, null, scenes)).toMatchObject({ scene_id: null, lead: 'month', lead_days: '', takeover: false, greeting: 'Mine', palette: 'night' })
  })

  it('fills a blank greeting from the scene when None is chosen', () => {
    expect(withScene({ ...dayDraftFrom(islaOnBirthday), greeting: '  ' }, null, scenes).greeting).toBe('Happy {nth} birthday, {who}!')
  })

  it('only drops a scene that no longer exists', () => {
    const draft = { ...dayDraftFrom(day({ scene_id: 'gone' })), palette: 'night' as const }
    expect(withScene(draft, null, scenes)).toEqual({ ...draft, scene_id: null })
  })

  it('does nothing choosing None for a day with no scene', () => {
    const draft = newDayDraft(TODAY)
    expect(withScene(draft, null, scenes)).toEqual(draft)
  })
})

describe('draftLook', () => {
  it('uses the defaults for a day with nothing set and no scene', () => {
    expect(draftLook(newDayDraft(TODAY), null, null)).toEqual({ lead: 'day', lead_days: null, tile_art: null, takeover: false, full_art: null, greeting: null, palette: 'warm' })
  })

  it('takes the draft\'s own values over the scene\'s, and the scene\'s for the rest', () => {
    const draft = { ...dayDraftFrom(islaOnBirthday), palette: 'night' as const, lead: 'days' as const, lead_days: '4' }
    expect(draftLook(draft, islaOnBirthday, scene())).toEqual({
      lead: 'days',
      lead_days: 4,
      tile_art: 'birthday-tile.webp',
      takeover: true,
      full_art: 'birthday-full.webp',
      greeting: 'Happy {nth} birthday, {who}!',
      palette: 'night',
    })
  })

  it('uses the saved day\'s own art', () => {
    const saved = { ...islaOnBirthday, tile_art: 'own.png' }
    expect(draftLook(dayDraftFrom(saved), saved, scene())).toMatchObject({ tile_art: 'own.png', full_art: 'birthday-full.webp' })
  })

  it('reads lead days that are not a number as none', () => {
    expect(draftLook({ ...newDayDraft(TODAY), lead: 'days', lead_days: 'abc' }, null, null).lead_days).toBeNull()
    expect(draftLook({ ...newDayDraft(TODAY), lead: 'days', lead_days: '' }, null, null).lead_days).toBeNull()
  })

  it('treats a blank greeting as the scene\'s', () => {
    expect(draftLook({ ...dayDraftFrom(islaOnBirthday), greeting: ' ' }, islaOnBirthday, scene()).greeting).toBe('Happy {nth} birthday, {who}!')
  })
})

describe('nextOccurrence', () => {
  const yearly = (month: number, dayOfMonth: number, extra: Partial<ReturnType<typeof newDayDraft>> = {}) => ({ ...newDayDraft(TODAY), month, day: dayOfMonth, ...extra })

  it('is this year\'s date when it is still to come, or is today', () => {
    expect(nextOccurrence(yearly(12, 25), TODAY)).toBe('2026-12-25')
    expect(nextOccurrence(yearly(10, 31), TODAY)).toBe('2026-10-31')
  })

  it('is next year\'s date when this year\'s has gone', () => {
    expect(nextOccurrence(yearly(3, 14), TODAY)).toBe('2027-03-14')
    expect(nextOccurrence(yearly(10, 30), TODAY)).toBe('2027-10-30')
  })

  it('puts 29 February on 28 February in a year that has no 29th, and on the 29th in a leap year', () => {
    expect(nextOccurrence(yearly(2, 29), TODAY)).toBe('2027-02-28')
    expect(nextOccurrence(yearly(2, 29), '2027-03-01')).toBe('2028-02-29')
    expect(nextOccurrence(yearly(2, 29), '2028-01-10')).toBe('2028-02-29')
  })

  it('skips the since year and the years before it', () => {
    expect(nextOccurrence(yearly(12, 25, { since_year: '2026' }), TODAY)).toBe('2027-12-25')
    expect(nextOccurrence(yearly(12, 25, { since_year: '2025' }), TODAY)).toBe('2026-12-25')
    expect(nextOccurrence(yearly(3, 14, { since_year: '2030' }), TODAY)).toBe('2031-03-14')
  })

  it('ignores a since year that is not a number yet', () => {
    expect(nextOccurrence(yearly(12, 25, { since_year: '20' }), TODAY)).toBe('2026-12-25')
    expect(nextOccurrence(yearly(12, 25, { since_year: 'abc' }), TODAY)).toBe('2026-12-25')
  })

  it('is null for a date that does not exist', () => {
    expect(nextOccurrence(yearly(2, 30), TODAY)).toBeNull()
    expect(nextOccurrence(yearly(4, 31), TODAY)).toBeNull()
    expect(nextOccurrence(yearly(Number.NaN, 4), TODAY)).toBeNull()
  })

  it('is the date for a day that happens once, until it has passed', () => {
    const once = (year: string, month = 12, dayOfMonth = 25) => yearly(month, dayOfMonth, { repeat: 'once', year })
    expect(nextOccurrence(once('2027'), TODAY)).toBe('2027-12-25')
    expect(nextOccurrence(once('2026', 10, 31), TODAY)).toBe('2026-10-31')
    expect(nextOccurrence(once('2026', 10, 30), TODAY)).toBeNull()
    expect(nextOccurrence(once('2020'), TODAY)).toBeNull()
  })

  it('is null for a day that happens once with no year yet, or a date that is not in that year', () => {
    expect(nextOccurrence(yearly(12, 25, { repeat: 'once', year: '' }), TODAY)).toBeNull()
    expect(nextOccurrence(yearly(2, 29, { repeat: 'once', year: '2027' }), TODAY)).toBeNull()
    expect(nextOccurrence(yearly(2, 29, { repeat: 'once', year: '2028' }), TODAY)).toBe('2028-02-29')
  })
})

describe('greetingPreview', () => {
  const draft = (extra: Partial<ReturnType<typeof newDayDraft>> = {}) => ({ ...newDayDraft(TODAY), name: 'Isla', month: 3, day: 14, who: 'Isla', since_year: '2020', ...extra })

  it('fills every placeholder for the next time the day falls', () => {
    expect(greetingPreview(draft({ greeting: 'Happy {nth} birthday, {who}!' }), null, TODAY)).toEqual({ text: 'Happy 7th birthday, Isla!', date: '2027-03-14', missing: [] })
    expect(greetingPreview(draft({ greeting: '{who} is {years}' }), null, TODAY)).toEqual({ text: 'Isla is 7', date: '2027-03-14', missing: [] })
  })

  it('is null when there is no greeting', () => {
    expect(greetingPreview(draft(), null, TODAY)).toBeNull()
    expect(greetingPreview(draft({ greeting: '  ' }), null, TODAY)).toBeNull()
    expect(greetingPreview(draft(), scene({ greeting: null }), TODAY)).toBeNull()
  })

  it('uses the scene\'s greeting unless the day has its own', () => {
    expect(greetingPreview(draft(), scene(), TODAY)?.text).toBe('Happy 7th birthday, Isla!')
    expect(greetingPreview(draft({ greeting: 'Hello {who}' }), scene(), TODAY)?.text).toBe('Hello Isla')
    expect(greetingPreview(draft({ greeting: '' }), scene(), TODAY)?.text).toBe('Happy 7th birthday, Isla!')
  })

  it('counts the years in the year the day next falls in', () => {
    // 14 March 2027 is the next one, and 2027 - 2020 = 7. After 14 March it is 2028 and the 8th.
    expect(greetingPreview(draft({ greeting: '{nth}' }), null, '2027-03-14')?.text).toBe('7th')
    expect(greetingPreview(draft({ greeting: '{nth}' }), null, '2027-03-15')?.text).toBe('8th')
  })

  it('spells the ordinals, including the teens', () => {
    const nth = (since: number) => greetingPreview(draft({ greeting: '{nth}', since_year: String(since) }), null, '2027-01-01')?.text
    expect(nth(2026)).toBe('1st')
    expect(nth(2025)).toBe('2nd')
    expect(nth(2024)).toBe('3rd')
    expect(nth(2023)).toBe('4th')
    expect(nth(2016)).toBe('11th')
    expect(nth(2015)).toBe('12th')
    expect(nth(2014)).toBe('13th')
    expect(nth(2006)).toBe('21st')
  })

  it('lists the placeholders it cannot fill and leaves them as typed', () => {
    expect(greetingPreview(draft({ greeting: 'Happy {nth} birthday, {who}!', since_year: '' }), null, TODAY)).toEqual({
      text: 'Happy {nth} birthday, Isla!',
      date: '2027-03-14',
      missing: ['nth'],
    })
    expect(greetingPreview(draft({ greeting: '{who} is {years}', who: '', since_year: '' }), null, TODAY)).toEqual({ text: '{who} is {years}', date: '2027-03-14', missing: ['who', 'years'] })
  })

  it('has no since year for a day that happens once', () => {
    const once = draft({ repeat: 'once', year: '2027', greeting: '{who} {years}' })
    expect(greetingPreview(once, null, TODAY)).toEqual({ text: 'Isla {years}', date: '2027-03-14', missing: ['years'] })
  })

  it('fills for today\'s year when the day has no next occurrence', () => {
    const past = draft({ repeat: 'once', year: '2020', since_year: '', greeting: 'Hello {who}' })
    expect(greetingPreview(past, null, TODAY)).toEqual({ text: 'Hello Isla', date: null, missing: [] })
  })
})

describe('sceneGreetingPreview', () => {
  const draft = { ...newSceneDraft(), name: 'Birthday', greeting: 'Happy {nth} birthday, {who}!' }
  const days = [day({ id: 'plain' }), islaOnBirthday, day({ id: 'sam', name: 'Sam\'s birthday', scene_id: 'birthday', who: 'Sam', since_year: 2010 })]

  it('fills the greeting through the first day that uses the scene', () => {
    expect(sceneGreetingPreview(draft, days, 'birthday', TODAY)).toEqual({ text: 'Happy 7th birthday, Isla!', day: 'Isla\'s birthday', date: '2027-03-14', missing: [] })
  })

  it('is null for a blank greeting, a new scene and a scene no day uses', () => {
    expect(sceneGreetingPreview({ ...draft, greeting: ' ' }, days, 'birthday', TODAY)).toBeNull()
    expect(sceneGreetingPreview(draft, days, null, TODAY)).toBeNull()
    expect(sceneGreetingPreview(draft, days, 'christmas', TODAY)).toBeNull()
    expect(sceneGreetingPreview(draft, [], 'birthday', TODAY)).toBeNull()
  })

  it('lists what the day cannot fill', () => {
    const bare = [day({ scene_id: 'birthday' })]
    expect(sceneGreetingPreview(draft, bare, 'birthday', TODAY)).toMatchObject({ text: 'Happy {nth} birthday, {who}!', missing: ['nth', 'who'] })
  })
})

describe('dateChip', () => {
  it('is the day over a three-letter month', () => {
    expect(dateChip({ month: 3, day: 14 })).toEqual({ day: '14', month: 'Mar' })
    expect(dateChip({ month: 12, day: 1 })).toEqual({ day: '1', month: 'Dec' })
  })

  it('writes September as Sep, not the Sept that en-GB uses', () => {
    expect(dateChip({ month: 9, day: 5 }).month).toBe('Sep')
  })
})

describe('daySummary', () => {
  const scenes = [scene()]

  it('names the scene, and counts what the day changes', () => {
    expect(daySummary(day({ scene_id: 'birthday' }), scenes)).toBe('Birthday scene')
    expect(daySummary(day({ scene_id: 'birthday', palette: 'night' }), scenes)).toBe('Birthday scene · 1 change')
    expect(daySummary(day({ scene_id: 'birthday', palette: 'night', lead: 'days', lead_days: 3 }), scenes)).toBe('Birthday scene · 2 changes')
  })

  it('counts a lead once, whatever its lead days, and art as a change', () => {
    expect(daySummary(day({ scene_id: 'birthday', lead: 'days', lead_days: 3 }), scenes)).toBe('Birthday scene · 1 change')
    expect(daySummary(day({ scene_id: 'birthday', tile_art: 'a.png', full_art: 'b.webp', takeover: false, greeting: 'Hi' }), scenes)).toBe('Birthday scene · 4 changes')
  })

  it('adds the extra layer', () => {
    expect(daySummary(day({ scene_id: 'birthday', extra_art: 'seven.png' }), scenes)).toBe('Birthday scene · extra layer')
    expect(daySummary(day({ scene_id: 'birthday', palette: 'night', extra_art: 'seven.png' }), scenes)).toBe('Birthday scene · 1 change · extra layer')
  })

  it('says how often a day with no scene happens, and what its look has', () => {
    expect(daySummary(day(), scenes)).toBe('Every year')
    expect(daySummary(day({ repeat: 'once', year: 2027 }), scenes)).toBe('Once in 2027')
    expect(daySummary(day({ tile_art: 'a.png' }), scenes)).toBe('Every year · tile art')
    expect(daySummary(day({ tile_art: 'a.png', takeover: true }), scenes)).toBe('Every year · tile art · full screen')
    expect(daySummary(day({ repeat: 'once', year: 2027, takeover: true }), scenes)).toBe('Once in 2027 · full screen')
    expect(daySummary(day({ takeover: false, full_art: 'b.webp' }), scenes)).toBe('Every year')
  })

  it('treats a scene that no longer exists as no scene', () => {
    expect(daySummary(day({ scene_id: 'gone', takeover: true }), scenes)).toBe('Every year · full screen')
    expect(daySummary(day({ scene_id: 'birthday' }), [])).toBe('Every year')
  })
})

describe('usedByLabel, daysUsing and sceneSavedMessage', () => {
  it('says how many days use a scene', () => {
    expect(usedByLabel(0)).toBe('Not used yet')
    expect(usedByLabel(1)).toBe('Used by 1 day')
    expect(usedByLabel(4)).toBe('Used by 4 days')
  })

  it('lists the days on a scene in the order given', () => {
    const days = [day({ id: 'a', scene_id: 'birthday' }), day({ id: 'b' }), day({ id: 'c', scene_id: 'christmas' }), day({ id: 'd', scene_id: 'birthday' })]
    expect(daysUsing('birthday', days).map(({ id }) => id)).toEqual(['a', 'd'])
    expect(daysUsing('none', days)).toEqual([])
  })

  it('says what saving a scene changed', () => {
    expect(sceneSavedMessage(0)).toBe('Saved. No days use this scene yet.')
    expect(sceneSavedMessage(1)).toBe('Saved. This changes 1 day.')
    expect(sceneSavedMessage(3)).toBe('Saved. This changes 3 days.')
  })
})

describe('leadLabel', () => {
  it('names each lead', () => {
    expect(leadLabel('day', null)).toBe('On the day')
    expect(leadLabel('week', null)).toBe('A week before')
    expect(leadLabel('month', null)).toBe('All month')
  })

  it('counts the days of a days lead', () => {
    expect(leadLabel('days', 10)).toBe('10 days before')
    expect(leadLabel('days', 1)).toBe('1 day before')
    expect(leadLabel('days', null)).toBe('Days before')
  })
})

describe('the choices', () => {
  it('offers each lead, palette and repeat once, in words', () => {
    expect(LEAD_OPTIONS).toEqual([
      { value: 'day', label: 'On the day' },
      { value: 'week', label: 'A week before' },
      { value: 'month', label: 'All month' },
      { value: 'days', label: 'Days before' },
    ])
    expect(PALETTE_OPTIONS).toEqual([
      { value: 'warm', label: 'Warm' },
      { value: 'night', label: 'Night' },
      { value: 'frost', label: 'Frost' },
      { value: 'sage', label: 'Sage' },
    ])
    expect(REPEAT_OPTIONS).toEqual([{ value: 'yearly', label: 'Every year' }, { value: 'once', label: 'Once' }])
  })

  it('offers the twelve months, named in full', () => {
    expect(MONTH_OPTIONS).toHaveLength(12)
    expect(MONTH_OPTIONS[0]).toEqual({ value: 1, label: 'January' })
    expect(MONTH_OPTIONS[8]).toEqual({ value: 9, label: 'September' })
    expect(MONTH_OPTIONS[11]).toEqual({ value: 12, label: 'December' })
  })
})

describe('dayOptions', () => {
  it('runs from 1 to the last day of the month', () => {
    expect(dayOptions(1, 'yearly', '')).toHaveLength(31)
    expect(dayOptions(4, 'yearly', '')).toHaveLength(30)
    expect(dayOptions(4, 'yearly', '').at(-1)).toBe(30)
    expect(dayOptions(3, 'yearly', '')[0]).toBe(1)
  })

  it('gives February 29 for a yearly day', () => {
    expect(dayOptions(2, 'yearly', '')).toHaveLength(29)
    expect(dayOptions(2, 'yearly', '2027')).toHaveLength(29)
  })

  it('goes by the year for a day that happens once', () => {
    expect(dayOptions(2, 'once', '2027')).toHaveLength(28)
    expect(dayOptions(2, 'once', '2028')).toHaveLength(29)
    expect(dayOptions(2, 'once', '')).toHaveLength(29)
    expect(dayOptions(2, 'once', 'abc')).toHaveLength(29)
  })

  it('offers 31 days for a month that is not one', () => {
    expect(dayOptions(Number.NaN, 'yearly', '')).toHaveLength(31)
    expect(dayOptions(13, 'yearly', '')).toHaveLength(31)
  })
})

describe('writeFailure', () => {
  const failure = (statusCode: number, message?: string) => ({ statusCode, data: message === undefined ? {} : { message } })

  it('says the server could not be reached when there was no answer', () => {
    expect(writeFailure(new TypeError('Failed to fetch'), 'Couldn\'t save')).toBe('Couldn\'t reach the server')
    expect(writeFailure(undefined, 'Couldn\'t save')).toBe('Couldn\'t reach the server')
  })

  it('gives the server\'s message for a 400 or a 409, with a capital letter', () => {
    expect(writeFailure(failure(400, 'day must be a day that exists in that month'), 'Couldn\'t save')).toBe('Day must be a day that exists in that month')
    expect(writeFailure(failure(409, 'birthday is used by 2 days'), 'Couldn\'t delete')).toBe('Birthday is used by 2 days')
  })

  it('uses the fallback for any other status, or a 400 with no message', () => {
    expect(writeFailure(failure(500, 'boom'), 'Couldn\'t save')).toBe('Couldn\'t save')
    expect(writeFailure(failure(404, 'not found'), 'Couldn\'t save')).toBe('Couldn\'t save')
    expect(writeFailure(failure(400), 'Couldn\'t save')).toBe('Couldn\'t save')
  })
})
