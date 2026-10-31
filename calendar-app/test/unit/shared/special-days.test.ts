import { describe, expect, it } from 'vitest'
import * as schema from '../../../server/db/schema'
import {
  DEFAULT_LOOK,
  effectiveLook,
  fillGreeting,
  GREETING_PLACEHOLDERS,
  greetingPlaceholders,
  LOOK_FIELDS,
  ordinal,
  resolutionRange,
  resolveSpecialDays,
  SPECIAL_DAY_LEADS,
  SPECIAL_DAY_PALETTES,
  SPECIAL_DAY_REPEATS,
  specialDayArtUrl,
  specialDayInputSchema,
  specialDaySceneInputSchema,
  specialDaySceneSchema,
  specialDaySchema,
  unfillablePlaceholders,
} from '../../../shared/special-days'
import type { ResolveOptions, SpecialDay, SpecialDayScene } from '../../../shared/special-days'

function day(overrides: Partial<SpecialDay> & { id: string }): SpecialDay {
  return {
    name: overrides.id,
    month: 12,
    day: 25,
    year: null,
    repeat: 'yearly',
    scene_id: null,
    who: null,
    since_year: null,
    lead: 'day',
    lead_days: null,
    tile_art: null,
    takeover: false,
    full_art: null,
    greeting: null,
    palette: 'warm',
    extra_art: null,
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** A day that takes everything from its scene, which is how most days will be stored. */
function sceneDay(overrides: Partial<SpecialDay> & { id: string }): SpecialDay {
  return day({ scene_id: 'birthday', lead: null, lead_days: null, takeover: null, palette: null, ...overrides })
}

function scene(overrides: Partial<SpecialDayScene> & { id: string }): SpecialDayScene {
  return {
    name: overrides.id,
    lead: 'day',
    lead_days: null,
    tile_art: null,
    takeover: false,
    full_art: null,
    greeting: null,
    palette: 'warm',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

// The S.1 tests run with no scenes: a day with no scene must resolve as it did then.
const resolveWithoutScenes = (days: SpecialDay[], options: ResolveOptions) => resolveSpecialDays(days, [], options)

const everything = { from: '2020-01-01', to: '2040-12-31' }

/** The dates that have tiles, optionally for a narrower range. */
function tileDates(days: SpecialDay[], today: string, range: { from: string, to: string } = everything): string[] {
  return resolveWithoutScenes(days, { ...range, today }).tiles.map(tile => tile.date)
}

describe('specialDayArtUrl', () => {
  it('is the path the server serves an art file from', () => {
    const name = `${'ab'.repeat(32)}.webp`
    expect(specialDayArtUrl(name)).toBe(`/special-days/${name}`)
  })
})

describe('the shared constants', () => {
  it('match the ones the database schema uses', () => {
    expect(SPECIAL_DAY_REPEATS).toEqual(schema.SPECIAL_DAY_REPEATS)
    expect(SPECIAL_DAY_LEADS).toEqual(schema.SPECIAL_DAY_LEADS)
    expect(SPECIAL_DAY_PALETTES).toEqual(schema.SPECIAL_DAY_PALETTES)
  })
})

describe('occurrences', () => {
  it('puts a yearly day on its date in every year in the range', () => {
    const days = [day({ id: 'christmas' })]

    expect(tileDates(days, '2030-01-01', { from: '2025-01-01', to: '2028-12-31' })).toEqual(['2025-12-25', '2026-12-25', '2027-12-25', '2028-12-25'])
  })

  it('leaves out a yearly occurrence outside the range, and includes both ends', () => {
    const days = [day({ id: 'christmas' })]
    const today = '2030-01-01'

    expect(tileDates(days, today, { from: '2026-12-26', to: '2027-12-24' })).toEqual([])
    expect(tileDates(days, today, { from: '2026-12-25', to: '2027-12-25' })).toEqual(['2026-12-25', '2027-12-25'])
    expect(tileDates(days, today, { from: '2027-12-25', to: '2027-12-25' })).toEqual(['2027-12-25'])
  })

  it('puts a one-off day on its one date only', () => {
    const days = [day({ id: 'moving', repeat: 'once', year: 2027, month: 3, day: 14 })]

    expect(tileDates(days, '2030-01-01')).toEqual(['2027-03-14'])
    expect(tileDates(days, '2030-01-01', { from: '2027-03-15', to: '2040-01-01' })).toEqual([])
    expect(tileDates(days, '2030-01-01', { from: '2020-01-01', to: '2027-03-13' })).toEqual([])
    expect(tileDates(days, '2030-01-01', { from: '2027-03-14', to: '2027-03-14' })).toEqual(['2027-03-14'])
  })

  it('shows a one-off day whose year is in the range even when the range starts mid-year', () => {
    const days = [day({ id: 'moving', repeat: 'once', year: 2026, month: 11, day: 2 })]

    expect(tileDates(days, '2026-11-02', { from: '2026-10-01', to: '2026-11-30' })).toEqual(['2026-11-02'])
  })

  it('moves a 29 February day to 28 February in years that are not leap years', () => {
    const days = [day({ id: 'leap', month: 2, day: 29 })]

    expect(tileDates(days, '2030-01-01', { from: '2027-01-01', to: '2028-12-31' })).toEqual(['2027-02-28', '2028-02-29'])
    expect(tileDates(days, '2101-01-01', { from: '2099-01-01', to: '2100-12-31' })).toEqual(['2099-02-28', '2100-02-28'])
    expect(tileDates(days, '2030-01-01', { from: '2000-01-01', to: '2000-12-31' })).toEqual(['2000-02-29'])
  })

  it('keeps a one-off 29 February on that date in a leap year', () => {
    const days = [day({ id: 'leap', repeat: 'once', year: 2028, month: 2, day: 29 })]

    expect(tileDates(days, '2030-01-01')).toEqual(['2028-02-29'])
  })

  it('does not move other dates, such as 28 February, in leap years', () => {
    const days = [day({ id: 'feb', month: 2, day: 28 })]

    expect(tileDates(days, '2030-01-01', { from: '2027-01-01', to: '2028-12-31' })).toEqual(['2027-02-28', '2028-02-28'])
  })

  it('skips a stored date that does not exist rather than rolling it into the next month', () => {
    const days = [day({ id: 'bad', month: 4, day: 31 }), day({ id: 'bad-once', repeat: 'once', year: 2027, month: 2, day: 29 })]

    expect(tileDates(days, '2030-01-01')).toEqual([])
  })
})

describe('lead windows', () => {
  // A `days` lead needs its count, so it gets 3 here unless a test says otherwise.
  const christmas = (lead: SpecialDay['lead'], leadDays = 3) => [day({ id: 'christmas', lead, lead_days: lead === 'days' ? leadDays : null })]
  const decorated = (lead: SpecialDay['lead'], today: string, leadDays?: number) => tileDates(christmas(lead, leadDays), today, { from: '2026-12-25', to: '2026-12-25' }).length === 1

  it('starts a day lead on the day itself', () => {
    expect(decorated('day', '2026-12-24')).toBe(false)
    expect(decorated('day', '2026-12-25')).toBe(true)
  })

  it('starts a week lead 7 days before', () => {
    expect(decorated('week', '2026-12-17')).toBe(false)
    expect(decorated('week', '2026-12-18')).toBe(true)
    expect(decorated('week', '2026-12-24')).toBe(true)
  })

  it('starts a month lead on the 1st of the day\'s month', () => {
    expect(decorated('month', '2026-11-30')).toBe(false)
    expect(decorated('month', '2026-12-01')).toBe(true)
    expect(decorated('month', '2026-12-31')).toBe(true)
  })

  it('starts a days lead that many days before', () => {
    expect(decorated('days', '2026-12-21', 3)).toBe(false)
    expect(decorated('days', '2026-12-22', 3)).toBe(true)
    expect(decorated('days', '2026-12-24', 3)).toBe(true)
  })

  it('takes a days lead of 1 as from the day before', () => {
    expect(decorated('days', '2026-12-23', 1)).toBe(false)
    expect(decorated('days', '2026-12-24', 1)).toBe(true)
  })

  it('lets a long days lead start months ahead, across a year boundary', () => {
    const days = [day({ id: 'birthday', month: 2, day: 10, lead: 'days', lead_days: 60 })]
    const range = { from: '2027-02-10', to: '2027-02-10' }

    // 60 days before 10 February 2027 is 12 December 2026.
    expect(tileDates(days, '2026-12-11', range)).toEqual([])
    expect(tileDates(days, '2026-12-12', range)).toEqual(['2027-02-10'])
  })

  it('counts a days lead back from 28 February for 29 February in a common year', () => {
    const days = [day({ id: 'leap', month: 2, day: 29, lead: 'days', lead_days: 10 })]

    expect(tileDates(days, '2027-02-17', { from: '2027-02-28', to: '2027-02-28' })).toEqual([])
    expect(tileDates(days, '2027-02-18', { from: '2027-02-28', to: '2027-02-28' })).toEqual(['2027-02-28'])
  })

  it('lets a week lead cross a month boundary', () => {
    const days = [day({ id: 'bonfire', month: 11, day: 5, lead: 'week' })]
    const range = { from: '2026-11-05', to: '2026-11-05' }

    expect(tileDates(days, '2026-10-28', range)).toEqual([])
    expect(tileDates(days, '2026-10-29', range)).toEqual(['2026-11-05'])
  })

  it('lets a week lead cross a year boundary, from 27 December for 3 January', () => {
    const days = [day({ id: 'new-term', month: 1, day: 3, lead: 'week' })]
    const range = { from: '2027-01-03', to: '2027-01-03' }

    expect(tileDates(days, '2026-12-26', range)).toEqual([])
    expect(tileDates(days, '2026-12-27', range)).toEqual(['2027-01-03'])
  })

  it('leaves a week lead before 1 March for 29 February, 7 days before 28 February in a common year', () => {
    const days = [day({ id: 'leap', month: 2, day: 29, lead: 'week' })]

    expect(tileDates(days, '2027-02-20', { from: '2027-02-28', to: '2027-02-28' })).toEqual([])
    expect(tileDates(days, '2027-02-21', { from: '2027-02-28', to: '2027-02-28' })).toEqual(['2027-02-28'])
    expect(tileDates(days, '2028-02-22', { from: '2028-02-29', to: '2028-02-29' })).toEqual(['2028-02-29'])
    expect(tileDates(days, '2028-02-21', { from: '2028-02-29', to: '2028-02-29' })).toEqual([])
  })

  it('keeps past occurrences decorated whatever the lead', () => {
    const range = { from: '2026-01-01', to: '2026-12-31' }

    for (const lead of SPECIAL_DAY_LEADS) {
      expect(tileDates(christmas(lead), '2027-06-01', range)).toEqual(['2026-12-25'])
    }
  })

  it('decorates each year by its own lead start, so this year\'s window does not open next year\'s tile', () => {
    const range = { from: '2026-12-25', to: '2027-12-25' }

    expect(tileDates(christmas('month'), '2026-12-10', range)).toEqual(['2026-12-25'])
    expect(tileDates(christmas('month'), '2027-12-01', range)).toEqual(['2026-12-25', '2027-12-25'])
  })

  it('decorates a one-off day by the same windows', () => {
    const days = [day({ id: 'moving', repeat: 'once', year: 2027, month: 3, day: 14, lead: 'month' })]

    expect(tileDates(days, '2027-02-28')).toEqual([])
    expect(tileDates(days, '2027-03-01')).toEqual(['2027-03-14'])
  })
})

describe('tiles', () => {
  it('lists only dates with decorations, in date order whatever the order stored', () => {
    const days = [
      day({ id: 'later', month: 12, day: 25 }),
      day({ id: 'earlier', month: 10, day: 31 }),
      day({ id: 'next-year', month: 1, day: 1 }),
    ]
    const resolution = resolveWithoutScenes(days, { from: '2026-10-01', to: '2027-01-31', today: '2027-01-31' })

    expect(resolution.tiles.map(tile => tile.date)).toEqual(['2026-10-31', '2026-12-25', '2027-01-01'])
  })

  it('carries what the tile needs to draw', () => {
    const days = [day({ id: 'halloween', name: 'Halloween', month: 10, day: 31, palette: 'night', tile_art: 'pumpkin.svg', full_art: 'full.png', greeting: 'Boo' })]
    const { tiles } = resolveWithoutScenes(days, { from: '2026-10-01', to: '2026-10-31', today: '2026-10-31' })

    expect(tiles).toEqual([{ date: '2026-10-31', days: [{ id: 'halloween', name: 'Halloween', palette: 'night', tile_art: 'pumpkin.svg' }] }])
  })

  it('has no tiles for no special days, and echoes the range and today', () => {
    expect(resolveWithoutScenes([], { from: '2026-10-01', to: '2026-10-31', today: '2026-10-15' })).toEqual({
      today: '2026-10-15',
      from: '2026-10-01',
      to: '2026-10-31',
      tiles: [],
      current: null,
      takeover: null,
    })
  })

  it('lists every special day on one date', () => {
    const days = [day({ id: 'b' }), day({ id: 'a' }), day({ id: 'elsewhere', month: 12, day: 26 })]
    const { tiles } = resolveWithoutScenes(days, { from: '2026-12-01', to: '2026-12-31', today: '2026-12-25' })

    expect(tiles.map(tile => [tile.date, tile.days.map(d => d.id)])).toEqual([['2026-12-25', ['a', 'b']]])
  })

  it('leaves a day out of a date it has not opened for while others on the date show', () => {
    const days = [day({ id: 'now', lead: 'day' }), day({ id: 'soon', lead: 'month' })]
    const { tiles } = resolveWithoutScenes(days, { from: '2026-12-25', to: '2026-12-25', today: '2026-11-30' })

    expect(tiles).toEqual([])
    const open = resolveWithoutScenes(days, { from: '2026-12-25', to: '2026-12-25', today: '2026-12-01' })
    expect(open.tiles[0]!.days.map(d => d.id)).toEqual(['soon'])
  })
})

describe('precedence', () => {
  const resolve = (days: SpecialDay[]) => resolveWithoutScenes(days, { from: '2026-12-25', to: '2026-12-25', today: '2026-12-25' })
  const order = (days: SpecialDay[]) => resolve(days).tiles[0]!.days.map(d => d.id)

  it('puts a one-off day before a yearly one, even when the yearly one was edited later', () => {
    const days = [
      day({ id: 'yearly', updated_at: '2026-06-01T00:00:00.000Z' }),
      day({ id: 'once', repeat: 'once', year: 2026, updated_at: '2026-01-01T00:00:00.000Z' }),
    ]

    expect(order(days)).toEqual(['once', 'yearly'])
    expect(resolve(days).current?.id).toBe('once')
  })

  it('then puts the most recently edited first', () => {
    const days = [
      day({ id: 'a', updated_at: '2026-01-01T00:00:00.000Z' }),
      day({ id: 'b', updated_at: '2026-03-01T00:00:00.000Z' }),
      day({ id: 'c', updated_at: '2026-02-01T00:00:00.000Z' }),
    ]

    expect(order(days)).toEqual(['b', 'c', 'a'])
  })

  it('then puts ids in ascending order, whatever order they were stored in', () => {
    const days = [day({ id: 'c' }), day({ id: 'a' }), day({ id: 'b' })]

    expect(order(days)).toEqual(['a', 'b', 'c'])
    expect(order([...days].reverse())).toEqual(['a', 'b', 'c'])
  })

  it('compares edit times as instants', () => {
    const days = [
      day({ id: 'a', updated_at: '2026-05-01T09:00:00.000Z' }),
      day({ id: 'b', updated_at: '2026-05-01T09:00:00.001Z' }),
    ]

    expect(order(days)).toEqual(['b', 'a'])
  })

  it('applies the one-off rule to a one-off day on its own date among yearly days', () => {
    const days = [
      day({ id: 'a', month: 3, day: 14 }),
      day({ id: 'z', repeat: 'once', year: 2027, month: 3, day: 14 }),
    ]
    const { tiles } = resolveWithoutScenes(days, { from: '2027-03-14', to: '2027-03-14', today: '2027-03-14' })

    expect(tiles[0]!.days.map(d => d.id)).toEqual(['z', 'a'])
  })
})

describe('today\'s special day', () => {
  it('is null when nothing falls on today', () => {
    const resolution = resolveWithoutScenes([day({ id: 'christmas' })], { from: '2026-12-01', to: '2026-12-31', today: '2026-12-24' })

    expect(resolution.current).toBeNull()
    expect(resolution.takeover).toBeNull()
  })

  it('is the day on today, even one that does not take over', () => {
    const days = [day({ id: 'christmas', name: 'Christmas', takeover: false })]
    const resolution = resolveWithoutScenes(days, { from: '2026-12-01', to: '2026-12-31', today: '2026-12-25' })

    expect(resolution.current).toEqual({ id: 'christmas', name: 'Christmas' })
    expect(resolution.takeover).toBeNull()
  })

  it('is the day on today whatever its lead', () => {
    for (const lead of SPECIAL_DAY_LEADS) {
      const resolution = resolveWithoutScenes([day({ id: 'christmas', lead })], { from: '2026-12-01', to: '2026-12-31', today: '2026-12-25' })

      expect(resolution.current?.id).toBe('christmas')
    }
  })

  it('is not set by a day that is ahead or past, however its lead window stands', () => {
    const days = [day({ id: 'christmas', lead: 'month', takeover: true })]

    expect(resolveWithoutScenes(days, { from: '2026-12-01', to: '2026-12-31', today: '2026-12-10' }).current).toBeNull()
    expect(resolveWithoutScenes(days, { from: '2026-12-01', to: '2026-12-31', today: '2026-12-26' }).current).toBeNull()
  })

  it('moves a 29 February day to 28 February in a common year', () => {
    const days = [day({ id: 'leap', month: 2, day: 29, takeover: true })]
    const range = { from: '2027-02-01', to: '2027-03-31' }

    expect(resolveWithoutScenes(days, { ...range, today: '2027-02-28' }).current?.id).toBe('leap')
    expect(resolveWithoutScenes(days, { ...range, today: '2027-03-01' }).current).toBeNull()
  })

  it('works out today even when it is outside the range', () => {
    const resolution = resolveWithoutScenes([day({ id: 'christmas', takeover: true })], { from: '2027-01-01', to: '2027-01-31', today: '2026-12-25' })

    expect(resolution.current?.id).toBe('christmas')
    expect(resolution.takeover?.id).toBe('christmas')
    expect(resolution.tiles).toEqual([])
  })

  it('takes over only for a day with takeover on, with what the wall draws', () => {
    const days = [day({ id: 'christmas', name: 'Christmas', takeover: true, greeting: 'Merry Christmas', palette: 'frost', full_art: 'tree.png' })]
    const { takeover } = resolveWithoutScenes(days, { from: '2026-12-01', to: '2026-12-31', today: '2026-12-25' })

    expect(takeover).toEqual({ id: 'christmas', name: 'Christmas', date: '2026-12-25', greeting: 'Merry Christmas', palette: 'frost', full_art: 'tree.png', extra_art: null })
  })

  it('lets the current day differ from the takeover when the first by precedence does not take over', () => {
    const days = [
      day({ id: 'once', repeat: 'once', year: 2026, name: 'Party', takeover: false }),
      day({ id: 'christmas', name: 'Christmas', takeover: true }),
    ]
    const resolution = resolveWithoutScenes(days, { from: '2026-12-01', to: '2026-12-31', today: '2026-12-25' })

    expect(resolution.current).toEqual({ id: 'once', name: 'Party' })
    expect(resolution.takeover?.id).toBe('christmas')
  })

  it('takes over with only one day when several have takeover on, by precedence', () => {
    const days = [
      day({ id: 'older', takeover: true, updated_at: '2026-01-01T00:00:00.000Z' }),
      day({ id: 'newer', takeover: true, updated_at: '2026-02-01T00:00:00.000Z' }),
    ]
    const resolution = resolveWithoutScenes(days, { from: '2026-12-01', to: '2026-12-31', today: '2026-12-25' })

    expect(resolution.takeover?.id).toBe('newer')
    expect(resolution.tiles[0]!.days.map(d => d.id)).toEqual(['newer', 'older'])
  })

  it('does not take over on a day before its date or after it', () => {
    const days = [day({ id: 'christmas', takeover: true })]
    const range = { from: '2026-12-01', to: '2026-12-31' }

    expect(resolveWithoutScenes(days, { ...range, today: '2026-12-24' }).takeover).toBeNull()
    expect(resolveWithoutScenes(days, { ...range, today: '2026-12-26' }).takeover).toBeNull()
  })
})

describe('resolutionRange', () => {
  it('runs from 14 days before the first of the month 12 months back to 14 days after the end of the month 12 months ahead', () => {
    expect(resolutionRange('2026-10-30')).toEqual({ from: '2025-09-17', to: '2027-11-14' })
  })

  it('does not depend on the day of the month', () => {
    expect(resolutionRange('2026-10-01')).toEqual(resolutionRange('2026-10-31'))
  })

  it('takes the last day of a short month, and of a leap February', () => {
    // 12 months ahead of February 2027 is February 2028, which has 29 days.
    expect(resolutionRange('2027-02-10')).toEqual({ from: '2026-01-18', to: '2028-03-14' })
    // 12 months ahead of February 2026 is February 2027, which has 28 days.
    expect(resolutionRange('2026-02-10')).toEqual({ from: '2025-01-18', to: '2027-03-14' })
  })

  it('crosses the year at both ends', () => {
    expect(resolutionRange('2026-01-15')).toEqual({ from: '2024-12-18', to: '2027-02-14' })
    expect(resolutionRange('2026-12-15')).toEqual({ from: '2025-11-17', to: '2028-01-14' })
  })

  it('covers every month a display can pin, with the days its grid shows from the next', () => {
    const today = '2026-10-30'
    const { from, to } = resolutionRange(today)

    expect(from <= '2025-10-01').toBe(true)
    expect(to >= '2027-10-31').toBe(true)
  })
})

describe('the input schema', () => {
  const valid = { name: 'Christmas', month: 12, day: 25, repeat: 'yearly', lead: 'week', takeover: true, palette: 'frost' }
  const failure = (input: unknown) => {
    const result = specialDayInputSchema.safeParse(input)
    expect(result.success).toBe(false)
    const issue = result.error!.issues[0]!
    return `${issue.path.join('.')} ${issue.message}`
  }

  it('accepts a yearly day and fills in what is left out as null', () => {
    expect(specialDayInputSchema.parse(valid)).toEqual({ ...valid, year: null, lead_days: null, greeting: null, scene_id: null, who: null, since_year: null })
  })

  it('accepts a days lead with its count, from 1 to 365', () => {
    expect(specialDayInputSchema.parse({ ...valid, lead: 'days', lead_days: 10 })).toMatchObject({ lead: 'days', lead_days: 10 })
    expect(specialDayInputSchema.safeParse({ ...valid, lead: 'days', lead_days: 1 }).success).toBe(true)
    expect(specialDayInputSchema.safeParse({ ...valid, lead: 'days', lead_days: 365 }).success).toBe(true)
  })

  it('needs lead days for a days lead, and only for one', () => {
    expect(failure({ ...valid, lead: 'days' })).toBe('lead_days is required when lead is days')
    expect(failure({ ...valid, lead: 'days', lead_days: null })).toBe('lead_days is required when lead is days')
    expect(failure({ ...valid, lead: 'week', lead_days: 7 })).toBe('lead_days must be left out unless lead is days')
    expect(specialDayInputSchema.parse({ ...valid, lead: 'week', lead_days: null }).lead_days).toBeNull()
  })

  it('accepts a one-off day with a year and a greeting', () => {
    const input = { ...valid, name: 'Moving day', month: 3, day: 14, year: 2027, repeat: 'once', greeting: 'New home!' }

    expect(specialDayInputSchema.parse(input)).toEqual({ ...input, lead_days: null, scene_id: null, who: null, since_year: null })
  })

  it('accepts a null year on a yearly day', () => {
    expect(specialDayInputSchema.parse({ ...valid, year: null }).year).toBeNull()
  })

  it('trims the name and the greeting, and turns a blank or missing greeting into null', () => {
    expect(specialDayInputSchema.parse({ ...valid, name: '  Christmas  ', greeting: '  Merry Christmas ' })).toMatchObject({ name: 'Christmas', greeting: 'Merry Christmas' })
    expect(specialDayInputSchema.parse({ ...valid, greeting: '   ' }).greeting).toBeNull()
    expect(specialDayInputSchema.parse({ ...valid, greeting: '' }).greeting).toBeNull()
    expect(specialDayInputSchema.parse({ ...valid, greeting: null }).greeting).toBeNull()
  })

  it('accepts names and greetings at their limits, and rejects them past', () => {
    expect(specialDayInputSchema.safeParse({ ...valid, name: 'n'.repeat(60) }).success).toBe(true)
    expect(specialDayInputSchema.safeParse({ ...valid, greeting: 'g'.repeat(80) }).success).toBe(true)
    expect(failure({ ...valid, name: 'n'.repeat(61) })).toMatch(/^name /)
    expect(failure({ ...valid, greeting: 'g'.repeat(81) })).toMatch(/^greeting /)
  })

  it('rejects a blank name, whatever the spaces', () => {
    expect(failure({ ...valid, name: '' })).toMatch(/^name /)
    expect(failure({ ...valid, name: '   ' })).toMatch(/^name /)
    expect(failure({ ...valid, name: undefined })).toMatch(/^name /)
  })

  it.each([
    ['month', 0],
    ['month', 13],
    ['month', 1.5],
    ['month', '12'],
    ['day', 0],
    ['day', 32],
    ['day', 2.5],
    ['year', 1999],
    ['year', 2101],
    ['year', 2027.5],
    ['lead_days', 0],
    ['lead_days', 366],
    ['lead_days', 2.5],
    ['lead_days', '10'],
  ])('rejects %s %j', (field, value) => {
    const input = field === 'year'
      ? { ...valid, repeat: 'once', year: value }
      : field === 'lead_days' ? { ...valid, lead: 'days', lead_days: value } : { ...valid, [field]: value }

    expect(failure(input)).toMatch(new RegExp(`^${field} `))
  })

  it.each([
    ['repeat', 'monthly'],
    ['lead', 'fortnight'],
    ['palette', 'neon'],
    ['takeover', 'yes'],
  ])('rejects %s %j', (field, value) => {
    expect(failure({ ...valid, [field]: value })).toMatch(new RegExp(`^${field} `))
  })

  it.each([
    ['since_year', 1899],
    ['since_year', 2101],
    ['since_year', 2019.5],
    ['since_year', '2019'],
    ['who', 'w'.repeat(41)],
    ['who', 7],
    ['scene_id', 7],
  ])('rejects %s %j', (field, value) => {
    expect(failure({ ...valid, [field]: value })).toMatch(new RegExp(`^${field} `))
  })

  it('rejects a missing field and names it', () => {
    for (const field of ['name', 'month', 'day', 'repeat']) {
      const { [field]: _left, ...input } = valid as Record<string, unknown>

      expect(failure(input)).toMatch(new RegExp(`^${field} `))
    }
  })

  it('rejects keys it does not know, including the art files', () => {
    expect(specialDayInputSchema.safeParse({ ...valid, tile_art: 'x.png' }).success).toBe(false)
    expect(specialDayInputSchema.safeParse({ ...valid, full_art: 'x.png' }).success).toBe(false)
    expect(specialDayInputSchema.safeParse({ ...valid, extra_art: 'x.png' }).success).toBe(false)
    expect(specialDayInputSchema.safeParse({ ...valid, id: 'christmas' }).success).toBe(false)
    expect(specialDayInputSchema.safeParse({ ...valid, nmae: 'oops' }).success).toBe(false)
  })

  it('rejects a body that is not an object', () => {
    expect(specialDayInputSchema.safeParse(null).success).toBe(false)
    expect(specialDayInputSchema.safeParse('Christmas').success).toBe(false)
    expect(specialDayInputSchema.safeParse([]).success).toBe(false)
  })

  describe('dates that exist', () => {
    it.each([
      [1, 31],
      [2, 29],
      [4, 30],
      [12, 31],
    ])('accepts a yearly day on %i/%i', (month, dayOfMonth) => {
      expect(specialDayInputSchema.safeParse({ ...valid, month, day: dayOfMonth }).success).toBe(true)
    })

    it.each([
      [2, 30],
      [2, 31],
      [4, 31],
      [6, 31],
      [11, 31],
    ])('rejects a yearly day on %i/%i, naming the day', (month, dayOfMonth) => {
      expect(failure({ ...valid, month, day: dayOfMonth })).toMatch(/^day /)
    })

    it('accepts a one-off 29 February in a leap year, including 2000', () => {
      expect(specialDayInputSchema.safeParse({ ...valid, repeat: 'once', year: 2028, month: 2, day: 29 }).success).toBe(true)
      expect(specialDayInputSchema.safeParse({ ...valid, repeat: 'once', year: 2000, month: 2, day: 29 }).success).toBe(true)
    })

    it('rejects a one-off 29 February in a year that is not a leap year, including 2100', () => {
      expect(failure({ ...valid, repeat: 'once', year: 2027, month: 2, day: 29 })).toMatch(/^day /)
      expect(failure({ ...valid, repeat: 'once', year: 2100, month: 2, day: 29 })).toMatch(/^day /)
    })

    it('rejects a one-off 31 April', () => {
      expect(failure({ ...valid, repeat: 'once', year: 2027, month: 4, day: 31 })).toMatch(/^day /)
    })
  })

  describe('the year', () => {
    it('is required when the day happens once', () => {
      expect(failure({ ...valid, repeat: 'once' })).toMatch(/^year /)
      expect(failure({ ...valid, repeat: 'once', year: null })).toMatch(/^year /)
    })

    it('must be left out for a yearly day', () => {
      expect(failure({ ...valid, repeat: 'yearly', year: 2027 })).toMatch(/^year /)
    })
  })
})

describe('the special day schema', () => {
  const stored = day({ id: 'christmas', name: 'Christmas', tile_art: 'tree.svg', greeting: 'Merry Christmas' })

  it('accepts a special day as the API returns it', () => {
    expect(specialDaySchema.parse(stored)).toEqual(stored)
  })

  it('rejects an id it does not have, a month that does not exist and an edit time that is not an instant', () => {
    expect(specialDaySchema.safeParse({ ...stored, id: undefined }).success).toBe(false)
    expect(specialDaySchema.safeParse({ ...stored, month: 13 }).success).toBe(false)
    expect(specialDaySchema.safeParse({ ...stored, updated_at: 'yesterday' }).success).toBe(false)
  })
})

describe('the input schema with scenes', () => {
  const valid = { name: 'Isla\'s birthday', month: 3, day: 14, repeat: 'yearly' }
  const failure = (input: unknown) => {
    const result = specialDayInputSchema.safeParse(input)
    expect(result.success).toBe(false)
    const issue = result.error!.issues[0]!
    return `${issue.path.join('.')} ${issue.message}`
  }

  it('takes a day that uses a scene for all of its look', () => {
    expect(specialDayInputSchema.parse({ ...valid, scene_id: 'birthday', who: 'Isla', since_year: 2019 })).toEqual({
      ...valid,
      year: null,
      scene_id: 'birthday',
      who: 'Isla',
      since_year: 2019,
      lead: null,
      lead_days: null,
      takeover: null,
      greeting: null,
      palette: null,
    })
  })

  it('takes null for the look fields, to use the scene\'s', () => {
    const parsed = specialDayInputSchema.parse({ ...valid, lead: null, lead_days: null, takeover: null, palette: null, scene_id: null })

    expect([parsed.lead, parsed.takeover, parsed.palette, parsed.scene_id]).toEqual([null, null, null, null])
  })

  it('trims who and turns a blank one into null', () => {
    expect(specialDayInputSchema.parse({ ...valid, who: '  Isla ' }).who).toBe('Isla')
    expect(specialDayInputSchema.parse({ ...valid, who: '   ' }).who).toBeNull()
    expect(specialDayInputSchema.parse({ ...valid, who: null }).who).toBeNull()
    expect(specialDayInputSchema.safeParse({ ...valid, who: 'w'.repeat(40) }).success).toBe(true)
  })

  it('takes a since_year from 1900 to 2100 for a yearly day', () => {
    expect(specialDayInputSchema.safeParse({ ...valid, since_year: 1900 }).success).toBe(true)
    expect(specialDayInputSchema.safeParse({ ...valid, since_year: 2100 }).success).toBe(true)
    expect(specialDayInputSchema.parse({ ...valid, since_year: null }).since_year).toBeNull()
  })

  it('rejects a since_year on a day that happens once', () => {
    expect(failure({ ...valid, repeat: 'once', year: 2027, since_year: 2019 })).toBe('since_year must be left out for a day that happens once')
    expect(specialDayInputSchema.safeParse({ ...valid, repeat: 'once', year: 2027, since_year: null }).success).toBe(true)
  })

  it('does not take lead days without a lead of its own, or for a lead other than days', () => {
    expect(failure({ ...valid, lead_days: 5 })).toBe('lead_days must be left out unless lead is days')
    expect(failure({ ...valid, lead: 'week', lead_days: 5 })).toBe('lead_days must be left out unless lead is days')
    expect(failure({ ...valid, lead: 'days' })).toBe('lead_days is required when lead is days')
  })

  it('still takes a body written for S.1, with the whole look and no scene', () => {
    const s1 = { name: 'Christmas', month: 12, day: 25, year: null, repeat: 'yearly', lead: 'days', lead_days: 10, takeover: true, greeting: 'Merry Christmas', palette: 'frost' }

    expect(specialDayInputSchema.parse(s1)).toEqual({ ...s1, scene_id: null, who: null, since_year: null })
  })

  describe('greeting placeholders', () => {
    const sceneValid = { name: 'Birthday', lead: 'week', takeover: true, palette: 'warm' }
    const sceneFailure = (input: unknown) => {
      const result = specialDaySceneInputSchema.safeParse(input)
      expect(result.success).toBe(false)
      const issue = result.error!.issues[0]!
      return `${issue.path.join('.')} ${issue.message}`
    }

    it('accepts every known placeholder on a day and on a scene', () => {
      const greeting = 'Happy {nth} birthday, {who}! That is {years} years.'

      expect(specialDayInputSchema.parse({ ...valid, greeting }).greeting).toBe(greeting)
      expect(specialDaySceneInputSchema.parse({ ...sceneValid, greeting }).greeting).toBe(greeting)
    })

    it('rejects an unknown placeholder on a day and on a scene, naming it', () => {
      const message = 'greeting has an unknown placeholder {foo}; use {who}, {years} or {nth}'

      expect(failure({ ...valid, greeting: 'Hi {foo}' })).toBe(message)
      expect(sceneFailure({ ...sceneValid, greeting: 'Hi {foo}' })).toBe(message)
    })

    it('names the first unknown one, and does not know the wrong case or an empty pair', () => {
      expect(failure({ ...valid, greeting: '{who} {oops} {nope}' })).toMatch(/\{oops\}/)
      expect(failure({ ...valid, greeting: 'Hi {Who}' })).toMatch(/\{Who\}/)
      expect(failure({ ...valid, greeting: 'Hi {}' })).toMatch(/\{\}/)
      expect(failure({ ...valid, greeting: 'Hi { who }' })).toMatch(/\{ who \}/)
    })

    it('leaves lone braces as plain text', () => {
      expect(specialDayInputSchema.parse({ ...valid, greeting: 'Hello :} and {' }).greeting).toBe('Hello :} and {')
      expect(specialDaySceneInputSchema.parse({ ...sceneValid, greeting: '} {' }).greeting).toBe('} {')
    })
  })
})

describe('the scene input schema', () => {
  const valid = { name: 'Birthday', lead: 'week', takeover: true, palette: 'warm' }
  const failure = (input: unknown) => {
    const result = specialDaySceneInputSchema.safeParse(input)
    expect(result.success).toBe(false)
    const issue = result.error!.issues[0]!
    return `${issue.path.join('.')} ${issue.message}`
  }

  it('accepts a scene and fills in the lead days and greeting as null', () => {
    expect(specialDaySceneInputSchema.parse(valid)).toEqual({ ...valid, lead_days: null, greeting: null })
  })

  it('trims the name and the greeting, and turns a blank greeting into null', () => {
    expect(specialDaySceneInputSchema.parse({ ...valid, name: '  Birthday ', greeting: ' Hello ' })).toMatchObject({ name: 'Birthday', greeting: 'Hello' })
    expect(specialDaySceneInputSchema.parse({ ...valid, greeting: '  ' }).greeting).toBeNull()
  })

  it('has the same limits on the name and greeting as a day', () => {
    expect(specialDaySceneInputSchema.safeParse({ ...valid, name: 'n'.repeat(60), greeting: 'g'.repeat(80) }).success).toBe(true)
    expect(failure({ ...valid, name: 'n'.repeat(61) })).toMatch(/^name /)
    expect(failure({ ...valid, name: '  ' })).toMatch(/^name /)
    expect(failure({ ...valid, greeting: 'g'.repeat(81) })).toMatch(/^greeting /)
  })

  it('needs lead days for a days lead, and only for one', () => {
    expect(specialDaySceneInputSchema.parse({ ...valid, lead: 'days', lead_days: 10 })).toMatchObject({ lead: 'days', lead_days: 10 })
    expect(failure({ ...valid, lead: 'days' })).toBe('lead_days is required when lead is days')
    expect(failure({ ...valid, lead: 'week', lead_days: 7 })).toBe('lead_days must be left out unless lead is days')
    expect(failure({ ...valid, lead: 'days', lead_days: 366 })).toMatch(/^lead_days /)
    expect(failure({ ...valid, lead: 'days', lead_days: 0 })).toMatch(/^lead_days /)
  })

  it('needs a lead, takeover and palette: a scene is a whole look', () => {
    for (const field of ['name', 'lead', 'takeover', 'palette']) {
      const { [field]: _left, ...input } = valid as Record<string, unknown>

      expect(failure(input)).toMatch(new RegExp(`^${field} `))
      expect(failure({ ...valid, [field]: null })).toMatch(new RegExp(`^${field} `))
    }
  })

  it('rejects values it does not know', () => {
    expect(failure({ ...valid, lead: 'fortnight' })).toMatch(/^lead /)
    expect(failure({ ...valid, palette: 'neon' })).toMatch(/^palette /)
    expect(failure({ ...valid, takeover: 'yes' })).toMatch(/^takeover /)
  })

  it('rejects keys it does not know, including the art files and day-only fields', () => {
    for (const extra of [{ tile_art: 'x.png' }, { full_art: 'x.png' }, { id: 'birthday' }, { who: 'Isla' }, { month: 3 }, { scene_id: null }]) {
      expect(specialDaySceneInputSchema.safeParse({ ...valid, ...extra }).success).toBe(false)
    }
  })

  it('rejects a body that is not an object', () => {
    expect(specialDaySceneInputSchema.safeParse(null).success).toBe(false)
    expect(specialDaySceneInputSchema.safeParse([]).success).toBe(false)
  })
})

describe('the scene schema', () => {
  const stored = scene({ id: 'birthday', name: 'Birthday', tile_art: 'cake.svg', greeting: 'Happy {nth} birthday, {who}!' })

  it('accepts a scene as the API returns it', () => {
    expect(specialDaySceneSchema.parse(stored)).toEqual(stored)
  })

  it('has no null lead, takeover or palette', () => {
    expect(specialDaySceneSchema.safeParse({ ...stored, lead: null }).success).toBe(false)
    expect(specialDaySceneSchema.safeParse({ ...stored, takeover: null }).success).toBe(false)
    expect(specialDaySceneSchema.safeParse({ ...stored, palette: null }).success).toBe(false)
  })

  it('rejects an edit time that is not an instant', () => {
    expect(specialDaySceneSchema.safeParse({ ...stored, updated_at: 'yesterday' }).success).toBe(false)
  })
})

describe('the special day schema with scenes', () => {
  it('accepts a day that uses a scene, with nulls for the look', () => {
    const stored = sceneDay({ id: 'isla', who: 'Isla', since_year: 2019, extra_art: 'seven.png' })

    expect(specialDaySchema.parse(stored)).toEqual(stored)
  })
})

describe('effectiveLook', () => {
  const birthday = scene({
    id: 'birthday',
    lead: 'days',
    lead_days: 14,
    tile_art: 'cake.svg',
    takeover: true,
    full_art: 'party.webp',
    greeting: 'Happy birthday!',
    palette: 'sage',
  })
  const bare = sceneDay({ id: 'isla' })

  it('takes everything from the scene for a day that sets nothing', () => {
    expect(effectiveLook(bare, birthday)).toEqual({
      lead: 'days',
      lead_days: 14,
      tile_art: 'cake.svg',
      takeover: true,
      full_art: 'party.webp',
      greeting: 'Happy birthday!',
      palette: 'sage',
    })
  })

  it('lets the day\'s own value win, for each field in turn, and leaves the rest to the scene', () => {
    const own = {
      lead: 'month',
      tile_art: 'own-tile.svg',
      takeover: false,
      full_art: 'own-full.webp',
      greeting: 'Own greeting',
      palette: 'night',
    } as const

    expect([...LOOK_FIELDS].sort()).toEqual(Object.keys(own).sort())
    for (const field of LOOK_FIELDS) {
      const look = effectiveLook({ ...bare, [field]: own[field] }, birthday)

      expect(look[field], field).toBe(own[field])
      for (const other of LOOK_FIELDS.filter(name => name !== field)) {
        expect(look[other], `${other} while ${field} is set`).toBe(effectiveLook(bare, birthday)[other])
      }
    }
  })

  it('counts a takeover of false as the day\'s own value, not as unset', () => {
    expect(effectiveLook({ ...bare, takeover: false }, birthday).takeover).toBe(false)
    expect(effectiveLook({ ...bare, takeover: true }, scene({ id: 'quiet', takeover: false })).takeover).toBe(true)
  })

  it('takes lead and lead_days together from the day when it has a lead', () => {
    // The scene's 14 days must not leak into a day with its own week.
    expect(effectiveLook({ ...bare, lead: 'week' }, birthday)).toMatchObject({ lead: 'week', lead_days: null })
    expect(effectiveLook({ ...bare, lead: 'days', lead_days: 3 }, birthday)).toMatchObject({ lead: 'days', lead_days: 3 })
    expect(effectiveLook({ ...bare, lead: 'days', lead_days: 3 }, scene({ id: 'plain', lead: 'month' }))).toMatchObject({ lead: 'days', lead_days: 3 })
  })

  it('takes lead and lead_days together from the scene when the day has no lead', () => {
    expect(effectiveLook(bare, birthday)).toMatchObject({ lead: 'days', lead_days: 14 })
    expect(effectiveLook(bare, scene({ id: 'plain', lead: 'month' }))).toMatchObject({ lead: 'month', lead_days: null })
  })

  it('uses the defaults for a day with no scene and nothing of its own', () => {
    const empty = sceneDay({ id: 'isla', scene_id: null })

    expect(effectiveLook(empty, null)).toEqual(DEFAULT_LOOK)
    expect(effectiveLook(empty)).toEqual(DEFAULT_LOOK)
    expect(DEFAULT_LOOK).toEqual({ lead: 'day', lead_days: null, tile_art: null, takeover: false, full_art: null, greeting: null, palette: 'warm' })
  })

  it('uses the defaults for a day whose scene is missing from the list', () => {
    const { days } = resolveSpecialDays([sceneDay({ id: 'isla', scene_id: 'gone', month: 3, day: 14 })], [], { from: '2026-03-01', to: '2026-03-31', today: '2026-03-14' }).tiles[0]!

    expect(days).toEqual([{ id: 'isla', name: 'isla', palette: 'warm', tile_art: null }])
  })

  it('uses the defaults only for the fields neither the day nor the scene sets', () => {
    const partial = scene({ id: 'partial', palette: 'frost', greeting: null })

    expect(effectiveLook(sceneDay({ id: 'isla', tile_art: 'own.svg' }), partial)).toEqual({ ...DEFAULT_LOOK, tile_art: 'own.svg', palette: 'frost' })
  })

  it('leaves a day with its own whole look as it is, with or without a scene', () => {
    const whole = day({ id: 'christmas', lead: 'days', lead_days: 3, tile_art: 'tree.svg', takeover: true, full_art: 'full.png', greeting: 'Merry', palette: 'frost' })
    const expected = { lead: 'days', lead_days: 3, tile_art: 'tree.svg', takeover: true, full_art: 'full.png', greeting: 'Merry', palette: 'frost' }

    expect(effectiveLook(whole, null)).toEqual(expected)
    expect(effectiveLook({ ...whole, scene_id: 'birthday' }, birthday)).toEqual(expected)
  })

  it('does not change the day or the scene', () => {
    const before = JSON.stringify([bare, birthday])
    effectiveLook(bare, birthday)

    expect(JSON.stringify([bare, birthday])).toBe(before)
  })
})

describe('greeting placeholders', () => {
  it('are who, years and nth', () => {
    expect(GREETING_PLACEHOLDERS).toEqual(['who', 'years', 'nth'])
  })

  it('are listed once each, in the order they appear', () => {
    expect(greetingPlaceholders('Happy {nth} birthday, {who}! {who}, {years}')).toEqual(['nth', 'who', 'years'])
    expect(greetingPlaceholders('No placeholders, and a lone { brace }')).toEqual([])
    expect(greetingPlaceholders('{foo} {who}')).toEqual(['who'])
    expect(greetingPlaceholders(null)).toEqual([])
    expect(greetingPlaceholders(undefined)).toEqual([])
  })

  describe('ordinal', () => {
    it.each([
      [1, '1st'],
      [2, '2nd'],
      [3, '3rd'],
      [4, '4th'],
      [10, '10th'],
      [11, '11th'],
      [12, '12th'],
      [13, '13th'],
      [14, '14th'],
      [20, '20th'],
      [21, '21st'],
      [22, '22nd'],
      [23, '23rd'],
      [24, '24th'],
      [100, '100th'],
      [101, '101st'],
      [102, '102nd'],
      [103, '103rd'],
      [111, '111th'],
      [112, '112th'],
      [113, '113th'],
      [121, '121st'],
    ])('writes %i as %s', (n, expected) => {
      expect(ordinal(n)).toBe(expected)
    })
  })

  describe('fillGreeting', () => {
    const isla = { who: 'Isla', since_year: 2019 }

    it('fills each placeholder', () => {
      expect(fillGreeting('Hi {who}', isla, 2026)).toBe('Hi Isla')
      expect(fillGreeting('{years} years', isla, 2026)).toBe('7 years')
      expect(fillGreeting('The {nth}', isla, 2026)).toBe('The 7th')
    })

    it('fills them all together, and each as often as it appears', () => {
      expect(fillGreeting('Happy {nth} birthday, {who}! {who} is {years}.', isla, 2026)).toBe('Happy 7th birthday, Isla! Isla is 7.')
    })

    it('fills per occurrence: the 7th this year and the 8th next year', () => {
      expect(fillGreeting('Happy {nth} birthday', isla, 2026)).toBe('Happy 7th birthday')
      expect(fillGreeting('Happy {nth} birthday', isla, 2027)).toBe('Happy 8th birthday')
      expect(fillGreeting('{years}', isla, 2027)).toBe('8')
    })

    it('leaves a placeholder it has nothing for as typed', () => {
      expect(fillGreeting('{who} is {nth} ({years})', { who: null, since_year: null }, 2026)).toBe('{who} is {nth} ({years})')
      expect(fillGreeting('{who} is {nth}', { who: 'Isla', since_year: null }, 2026)).toBe('Isla is {nth}')
      expect(fillGreeting('{who} is {nth}', { who: null, since_year: 2019 }, 2026)).toBe('{who} is 7th')
    })

    it('leaves other braces and unknown placeholders alone', () => {
      expect(fillGreeting('{foo} } { {who}', isla, 2026)).toBe('{foo} } { Isla')
    })

    it('does not fill a placeholder that came from the name, or treat it as a pattern', () => {
      expect(fillGreeting('Hi {who}', { who: '{nth} $& $1', since_year: 2019 }, 2026)).toBe('Hi {nth} $& $1')
    })
  })

  describe('unfillablePlaceholders', () => {
    it('needs who for who, and since_year for years and nth', () => {
      const look = { greeting: '{who} {years} {nth}' }

      expect(unfillablePlaceholders({ who: null, since_year: null }, look)).toEqual(['who', 'years', 'nth'])
      expect(unfillablePlaceholders({ who: 'Isla', since_year: null }, look)).toEqual(['years', 'nth'])
      expect(unfillablePlaceholders({ who: null, since_year: 2019 }, look)).toEqual(['who'])
      expect(unfillablePlaceholders({ who: 'Isla', since_year: 2019 }, look)).toEqual([])
    })

    it('looks only at the placeholders the greeting uses', () => {
      expect(unfillablePlaceholders({ who: null, since_year: null }, { greeting: 'Happy {nth}' })).toEqual(['nth'])
      expect(unfillablePlaceholders({ who: null, since_year: null }, { greeting: 'Merry Christmas' })).toEqual([])
      expect(unfillablePlaceholders({ who: null, since_year: null }, { greeting: null })).toEqual([])
    })
  })
})

describe('resolving with scenes', () => {
  const birthday = scene({ id: 'birthday', name: 'Birthday', tile_art: 'cake.svg', palette: 'sage', takeover: true, full_art: 'party.webp', greeting: 'Happy {nth} birthday, {who}!' })
  const march = { from: '2026-03-01', to: '2026-03-31' }
  const resolve = (days: SpecialDay[], scenes: SpecialDayScene[], today: string, range: { from: string, to: string } = march) => resolveSpecialDays(days, scenes, { ...range, today })

  it('resolves days that use no scene exactly as with an empty scene list, whatever scenes exist', () => {
    const days = [
      day({ id: 'christmas', lead: 'week', palette: 'frost', tile_art: 'tree.svg', takeover: true, greeting: 'Merry' }),
      day({ id: 'moving', repeat: 'once', year: 2027, month: 3, day: 14, lead: 'month' }),
    ]
    const options = { from: '2026-01-01', to: '2027-12-31', today: '2026-12-25' }

    expect(resolveSpecialDays(days, [birthday], options)).toEqual(resolveSpecialDays(days, [], options))
  })

  it('draws a day on its scene\'s look', () => {
    const isla = sceneDay({ id: 'isla', month: 3, day: 14, who: 'Isla', since_year: 2019 })
    const { tiles, takeover } = resolve([isla], [birthday], '2026-03-14')

    expect(tiles).toEqual([{ date: '2026-03-14', days: [{ id: 'isla', name: 'isla', palette: 'sage', tile_art: 'cake.svg' }] }])
    expect(takeover).toEqual({ id: 'isla', name: 'isla', date: '2026-03-14', greeting: 'Happy 7th birthday, Isla!', palette: 'sage', full_art: 'party.webp', extra_art: null })
  })

  it('runs the date rules on the effective lead, not the stored one', () => {
    const lead = (scene_id: string, today: string, own: Partial<SpecialDay> = {}) =>
      resolve([sceneDay({ id: 'isla', month: 3, day: 14, scene_id, ...own })], [scene({ id: 'weekly', lead: 'week' }), scene({ id: 'custom', lead: 'days', lead_days: 3 })], today).tiles.length

    expect(lead('weekly', '2026-03-06')).toBe(0)
    expect(lead('weekly', '2026-03-07')).toBe(1)
    expect(lead('custom', '2026-03-10')).toBe(0)
    expect(lead('custom', '2026-03-11')).toBe(1)
    // The day's own lead beats the scene's, with its own count.
    expect(lead('custom', '2026-03-12', { lead: 'days', lead_days: 2 })).toBe(1)
    expect(lead('custom', '2026-03-11', { lead: 'days', lead_days: 2 })).toBe(0)
    expect(lead('custom', '2026-03-14', { lead: 'day' })).toBe(1)
    expect(lead('custom', '2026-03-13', { lead: 'day' })).toBe(0)
  })

  it('takes over by the effective takeover, with the day able to turn it off or on', () => {
    const quiet = scene({ id: 'quiet', takeover: false })
    const takes = (days: SpecialDay[], scenes: SpecialDayScene[]) => resolve(days, scenes, '2026-03-14').takeover?.id ?? null

    expect(takes([sceneDay({ id: 'isla', month: 3, day: 14 })], [birthday])).toBe('isla')
    expect(takes([sceneDay({ id: 'isla', month: 3, day: 14, takeover: false })], [birthday])).toBeNull()
    expect(takes([sceneDay({ id: 'isla', month: 3, day: 14, scene_id: 'quiet' })], [quiet])).toBeNull()
    expect(takes([sceneDay({ id: 'isla', month: 3, day: 14, scene_id: 'quiet', takeover: true })], [quiet])).toBe('isla')
  })

  it('lets two days share one scene\'s art, each with its own name and occurrence', () => {
    const days = [
      sceneDay({ id: 'isla', name: 'Isla\'s birthday', month: 3, day: 14, who: 'Isla', since_year: 2019 }),
      sceneDay({ id: 'theo', name: 'Theo\'s birthday', month: 3, day: 20, who: 'Theo', since_year: 2021 }),
    ]
    const { tiles } = resolve(days, [birthday], '2026-03-20')

    expect(tiles).toEqual([
      { date: '2026-03-14', days: [{ id: 'isla', name: 'Isla\'s birthday', palette: 'sage', tile_art: 'cake.svg' }] },
      { date: '2026-03-20', days: [{ id: 'theo', name: 'Theo\'s birthday', palette: 'sage', tile_art: 'cake.svg' }] },
    ])
  })

  it('fills the greeting per day on the same scene', () => {
    const days = [
      sceneDay({ id: 'isla', month: 3, day: 14, who: 'Isla', since_year: 2019 }),
      sceneDay({ id: 'theo', month: 3, day: 14, who: 'Theo', since_year: 2021, updated_at: '2026-02-01T00:00:00.000Z' }),
    ]

    // Theo's was edited later, so he takes over, with his own name and age.
    expect(resolve(days, [birthday], '2026-03-14').takeover?.greeting).toBe('Happy 5th birthday, Theo!')
    expect(resolve(days.slice(0, 1), [birthday], '2026-03-14').takeover?.greeting).toBe('Happy 7th birthday, Isla!')
  })

  it('fills the takeover greeting for today\'s year, so it says 8th the next year', () => {
    const isla = [sceneDay({ id: 'isla', month: 3, day: 14, who: 'Isla', since_year: 2019 })]

    expect(resolve(isla, [birthday], '2026-03-14').takeover?.greeting).toBe('Happy 7th birthday, Isla!')
    expect(resolve(isla, [birthday], '2027-03-14', { from: '2027-03-01', to: '2027-03-31' }).takeover?.greeting).toBe('Happy 8th birthday, Isla!')
  })

  it('fills a day\'s own greeting too, and leaves a greeting with no placeholders as it is', () => {
    const own = sceneDay({ id: 'isla', month: 3, day: 14, who: 'Isla', since_year: 2019, greeting: '{years} today, {who}' })

    expect(resolve([own], [birthday], '2026-03-14').takeover?.greeting).toBe('7 today, Isla')
    expect(resolve([day({ id: 'plain', month: 3, day: 14, takeover: true, greeting: 'Hello {foo}' })], [], '2026-03-14').takeover?.greeting).toBe('Hello {foo}')
  })

  it('has a null greeting when there is none', () => {
    const none = scene({ id: 'none', takeover: true })

    expect(resolve([sceneDay({ id: 'isla', month: 3, day: 14, scene_id: 'none' })], [none], '2026-03-14').takeover?.greeting).toBeNull()
  })

  it('changes both days when the scene\'s palette changes', () => {
    const days = [
      sceneDay({ id: 'isla', month: 3, day: 14 }),
      sceneDay({ id: 'theo', month: 3, day: 20 }),
    ]
    const palettes = (palette: SpecialDayScene['palette']) =>
      resolve(days, [{ ...birthday, palette }], '2026-03-20').tiles.flatMap(tile => tile.days.map(d => d.palette))

    expect(palettes('sage')).toEqual(['sage', 'sage'])
    expect(palettes('night')).toEqual(['night', 'night'])
  })

  it('keeps a day\'s own palette when the scene\'s changes', () => {
    const days = [sceneDay({ id: 'isla', month: 3, day: 14, palette: 'frost' }), sceneDay({ id: 'theo', month: 3, day: 20 })]
    const { tiles } = resolve(days, [{ ...birthday, palette: 'night' }], '2026-03-20')

    expect(tiles.flatMap(tile => tile.days.map(d => d.palette))).toEqual(['frost', 'night'])
  })

  it('does not let a scene\'s updated_at change which day comes first', () => {
    const days = [
      sceneDay({ id: 'a', month: 3, day: 14, updated_at: '2026-01-01T00:00:00.000Z' }),
      sceneDay({ id: 'b', month: 3, day: 14, scene_id: 'other', updated_at: '2026-02-01T00:00:00.000Z' }),
    ]
    const order = (birthdayEdited: string, otherEdited: string) => resolve(days, [
      { ...birthday, updated_at: birthdayEdited },
      scene({ id: 'other', updated_at: otherEdited, takeover: true }),
    ], '2026-03-14').tiles[0]!.days.map(d => d.id)

    // The day edited later comes first, whichever scene was edited most recently.
    expect(order('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toEqual(['b', 'a'])
    expect(order('2027-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')).toEqual(['b', 'a'])
    expect(order('2025-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z')).toEqual(['b', 'a'])
  })

  it('still puts a one-off day before a yearly one, whatever their scenes', () => {
    const days = [
      sceneDay({ id: 'yearly', month: 3, day: 14, updated_at: '2026-06-01T00:00:00.000Z' }),
      sceneDay({ id: 'once', repeat: 'once', year: 2026, month: 3, day: 14 }),
    ]

    expect(resolve(days, [birthday], '2026-03-14').current?.id).toBe('once')
  })

  it('ignores scenes that no day uses', () => {
    expect(resolve([], [birthday], '2026-03-14')).toEqual(resolve([], [], '2026-03-14'))
  })

  it('does not change the days or scenes it is given', () => {
    const days = [sceneDay({ id: 'isla', month: 3, day: 14, who: 'Isla', since_year: 2019 })]
    const scenes = [birthday]
    const before = JSON.stringify([days, scenes])
    resolve(days, scenes, '2026-03-14')

    expect(JSON.stringify([days, scenes])).toBe(before)
  })

  describe('since_year', () => {
    const isla = day({ id: 'isla', month: 3, day: 14, since_year: 2019, takeover: true, greeting: '{nth}' })
    const wide = { from: '2018-01-01', to: '2021-12-31' }

    it('hides the tiles in that year and before it, and shows them after', () => {
      expect(resolve([isla], [], '2022-01-01', wide).tiles.map(tile => tile.date)).toEqual(['2020-03-14', '2021-03-14'])
    })

    it('hides the day in its own since_year', () => {
      expect(resolve([isla], [], '2019-03-14', wide).tiles).toEqual([])
    })

    it('is not the current day or the takeover in that year or before it, but is the year after', () => {
      for (const today of ['2018-03-14', '2019-03-14']) {
        const resolution = resolve([isla], [], today, { from: today, to: today })

        expect(resolution.current, today).toBeNull()
        expect(resolution.takeover, today).toBeNull()
      }
      const next = resolve([isla], [], '2020-03-14', { from: '2020-03-14', to: '2020-03-14' })

      expect(next.current?.id).toBe('isla')
      expect(next.takeover?.greeting).toBe('1st')
    })

    it('hides a day that uses a scene by its own since_year', () => {
      // A scene has no since_year to lend, so it is always the day's own.
      const viaScene = sceneDay({ id: 'isla', month: 3, day: 14, since_year: 2019 })

      expect(resolve([viaScene], [birthday], '2022-01-01', wide).tiles.map(tile => tile.date)).toEqual(['2020-03-14', '2021-03-14'])
    })

    it('hides only the day that has the since_year, and not others on the same date', () => {
      const days = [isla, day({ id: 'other', month: 3, day: 14 })]
      const { tiles } = resolve(days, [], '2022-01-01', { from: '2019-01-01', to: '2019-12-31' })

      expect(tiles.map(tile => tile.days.map(d => d.id))).toEqual([['other']])
    })

    it('applies to a 29 February day too, in the year it moves to 28 February', () => {
      const leap = day({ id: 'leap', month: 2, day: 29, since_year: 2026 })

      expect(resolve([leap], [], '2030-01-01', { from: '2026-01-01', to: '2028-12-31' }).tiles.map(tile => tile.date)).toEqual(['2027-02-28', '2028-02-29'])
    })

    it('leaves a day with no since_year in every year', () => {
      expect(resolve([day({ id: 'always', month: 3, day: 14 })], [], '2022-01-01', wide).tiles).toHaveLength(4)
    })
  })

  describe('extra_art', () => {
    it('is the day\'s own layer on the takeover, over the scene\'s full art', () => {
      const isla = sceneDay({ id: 'isla', month: 3, day: 14, extra_art: 'seven.png' })
      const { takeover } = resolve([isla], [birthday], '2026-03-14')

      expect(takeover).toMatchObject({ full_art: 'party.webp', extra_art: 'seven.png' })
    })

    it('differs per day sharing a scene', () => {
      const days = [
        sceneDay({ id: 'isla', month: 3, day: 14, extra_art: 'seven.png' }),
        sceneDay({ id: 'theo', month: 3, day: 20, extra_art: 'five.png' }),
      ]

      expect(resolve(days, [birthday], '2026-03-14').takeover?.extra_art).toBe('seven.png')
      expect(resolve(days, [birthday], '2026-03-20').takeover?.extra_art).toBe('five.png')
    })

    it('is null for a day without one, and is not on the tiles', () => {
      const { takeover, tiles } = resolve([sceneDay({ id: 'isla', month: 3, day: 14 })], [birthday], '2026-03-14')

      expect(takeover?.extra_art).toBeNull()
      expect(tiles[0]!.days[0]).not.toHaveProperty('extra_art')
    })
  })
})
