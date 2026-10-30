import { describe, expect, it } from 'vitest'
import * as schema from '../../../server/db/schema'
import {
  resolutionRange,
  resolveSpecialDays,
  SPECIAL_DAY_LEADS,
  SPECIAL_DAY_PALETTES,
  SPECIAL_DAY_REPEATS,
  specialDayInputSchema,
  specialDaySchema,
} from '../../../shared/special-days'
import type { SpecialDay } from '../../../shared/special-days'

function day(overrides: Partial<SpecialDay> & { id: string }): SpecialDay {
  return {
    name: overrides.id,
    month: 12,
    day: 25,
    year: null,
    repeat: 'yearly',
    lead: 'day',
    tile_art: null,
    takeover: false,
    full_art: null,
    greeting: null,
    palette: 'warm',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const everything = { from: '2020-01-01', to: '2040-12-31' }

/** The dates that have tiles, optionally for a narrower range. */
function tileDates(days: SpecialDay[], today: string, range: { from: string, to: string } = everything): string[] {
  return resolveSpecialDays(days, { ...range, today }).tiles.map(tile => tile.date)
}

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
  const christmas = (lead: SpecialDay['lead']) => [day({ id: 'christmas', lead })]
  const decorated = (lead: SpecialDay['lead'], today: string) => tileDates(christmas(lead), today, { from: '2026-12-25', to: '2026-12-25' }).length === 1

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
    const resolution = resolveSpecialDays(days, { from: '2026-10-01', to: '2027-01-31', today: '2027-01-31' })

    expect(resolution.tiles.map(tile => tile.date)).toEqual(['2026-10-31', '2026-12-25', '2027-01-01'])
  })

  it('carries what the tile needs to draw', () => {
    const days = [day({ id: 'halloween', name: 'Halloween', month: 10, day: 31, palette: 'night', tile_art: 'pumpkin.svg', full_art: 'full.png', greeting: 'Boo' })]
    const { tiles } = resolveSpecialDays(days, { from: '2026-10-01', to: '2026-10-31', today: '2026-10-31' })

    expect(tiles).toEqual([{ date: '2026-10-31', days: [{ id: 'halloween', name: 'Halloween', palette: 'night', tile_art: 'pumpkin.svg' }] }])
  })

  it('has no tiles for no special days, and echoes the range and today', () => {
    expect(resolveSpecialDays([], { from: '2026-10-01', to: '2026-10-31', today: '2026-10-15' })).toEqual({
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
    const { tiles } = resolveSpecialDays(days, { from: '2026-12-01', to: '2026-12-31', today: '2026-12-25' })

    expect(tiles.map(tile => [tile.date, tile.days.map(d => d.id)])).toEqual([['2026-12-25', ['a', 'b']]])
  })

  it('leaves a day out of a date it has not opened for while others on the date show', () => {
    const days = [day({ id: 'now', lead: 'day' }), day({ id: 'soon', lead: 'month' })]
    const { tiles } = resolveSpecialDays(days, { from: '2026-12-25', to: '2026-12-25', today: '2026-11-30' })

    expect(tiles).toEqual([])
    const open = resolveSpecialDays(days, { from: '2026-12-25', to: '2026-12-25', today: '2026-12-01' })
    expect(open.tiles[0]!.days.map(d => d.id)).toEqual(['soon'])
  })
})

describe('precedence', () => {
  const resolve = (days: SpecialDay[]) => resolveSpecialDays(days, { from: '2026-12-25', to: '2026-12-25', today: '2026-12-25' })
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
    const { tiles } = resolveSpecialDays(days, { from: '2027-03-14', to: '2027-03-14', today: '2027-03-14' })

    expect(tiles[0]!.days.map(d => d.id)).toEqual(['z', 'a'])
  })
})

describe('today\'s special day', () => {
  it('is null when nothing falls on today', () => {
    const resolution = resolveSpecialDays([day({ id: 'christmas' })], { from: '2026-12-01', to: '2026-12-31', today: '2026-12-24' })

    expect(resolution.current).toBeNull()
    expect(resolution.takeover).toBeNull()
  })

  it('is the day on today, even one that does not take over', () => {
    const days = [day({ id: 'christmas', name: 'Christmas', takeover: false })]
    const resolution = resolveSpecialDays(days, { from: '2026-12-01', to: '2026-12-31', today: '2026-12-25' })

    expect(resolution.current).toEqual({ id: 'christmas', name: 'Christmas' })
    expect(resolution.takeover).toBeNull()
  })

  it('is the day on today whatever its lead', () => {
    for (const lead of SPECIAL_DAY_LEADS) {
      const resolution = resolveSpecialDays([day({ id: 'christmas', lead })], { from: '2026-12-01', to: '2026-12-31', today: '2026-12-25' })

      expect(resolution.current?.id).toBe('christmas')
    }
  })

  it('is not set by a day that is ahead or past, however its lead window stands', () => {
    const days = [day({ id: 'christmas', lead: 'month', takeover: true })]

    expect(resolveSpecialDays(days, { from: '2026-12-01', to: '2026-12-31', today: '2026-12-10' }).current).toBeNull()
    expect(resolveSpecialDays(days, { from: '2026-12-01', to: '2026-12-31', today: '2026-12-26' }).current).toBeNull()
  })

  it('moves a 29 February day to 28 February in a common year', () => {
    const days = [day({ id: 'leap', month: 2, day: 29, takeover: true })]
    const range = { from: '2027-02-01', to: '2027-03-31' }

    expect(resolveSpecialDays(days, { ...range, today: '2027-02-28' }).current?.id).toBe('leap')
    expect(resolveSpecialDays(days, { ...range, today: '2027-03-01' }).current).toBeNull()
  })

  it('works out today even when it is outside the range', () => {
    const resolution = resolveSpecialDays([day({ id: 'christmas', takeover: true })], { from: '2027-01-01', to: '2027-01-31', today: '2026-12-25' })

    expect(resolution.current?.id).toBe('christmas')
    expect(resolution.takeover?.id).toBe('christmas')
    expect(resolution.tiles).toEqual([])
  })

  it('takes over only for a day with takeover on, with what the wall draws', () => {
    const days = [day({ id: 'christmas', name: 'Christmas', takeover: true, greeting: 'Merry Christmas', palette: 'frost', full_art: 'tree.png' })]
    const { takeover } = resolveSpecialDays(days, { from: '2026-12-01', to: '2026-12-31', today: '2026-12-25' })

    expect(takeover).toEqual({ id: 'christmas', name: 'Christmas', date: '2026-12-25', greeting: 'Merry Christmas', palette: 'frost', full_art: 'tree.png' })
  })

  it('lets the current day differ from the takeover when the first by precedence does not take over', () => {
    const days = [
      day({ id: 'once', repeat: 'once', year: 2026, name: 'Party', takeover: false }),
      day({ id: 'christmas', name: 'Christmas', takeover: true }),
    ]
    const resolution = resolveSpecialDays(days, { from: '2026-12-01', to: '2026-12-31', today: '2026-12-25' })

    expect(resolution.current).toEqual({ id: 'once', name: 'Party' })
    expect(resolution.takeover?.id).toBe('christmas')
  })

  it('takes over with only one day when several have takeover on, by precedence', () => {
    const days = [
      day({ id: 'older', takeover: true, updated_at: '2026-01-01T00:00:00.000Z' }),
      day({ id: 'newer', takeover: true, updated_at: '2026-02-01T00:00:00.000Z' }),
    ]
    const resolution = resolveSpecialDays(days, { from: '2026-12-01', to: '2026-12-31', today: '2026-12-25' })

    expect(resolution.takeover?.id).toBe('newer')
    expect(resolution.tiles[0]!.days.map(d => d.id)).toEqual(['newer', 'older'])
  })

  it('does not take over on a day before its date or after it', () => {
    const days = [day({ id: 'christmas', takeover: true })]
    const range = { from: '2026-12-01', to: '2026-12-31' }

    expect(resolveSpecialDays(days, { ...range, today: '2026-12-24' }).takeover).toBeNull()
    expect(resolveSpecialDays(days, { ...range, today: '2026-12-26' }).takeover).toBeNull()
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

  it('accepts a yearly day and fills in the year and greeting as null', () => {
    expect(specialDayInputSchema.parse(valid)).toEqual({ ...valid, year: null, greeting: null })
  })

  it('accepts a one-off day with a year and a greeting', () => {
    const input = { ...valid, name: 'Moving day', month: 3, day: 14, year: 2027, repeat: 'once', greeting: 'New home!' }

    expect(specialDayInputSchema.parse(input)).toEqual(input)
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
  ])('rejects %s %j', (field, value) => {
    const input = field === 'year' ? { ...valid, repeat: 'once', year: value } : { ...valid, [field]: value }

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

  it('rejects a missing field and names it', () => {
    for (const field of ['name', 'month', 'day', 'repeat', 'lead', 'takeover', 'palette']) {
      const { [field]: _left, ...input } = valid as Record<string, unknown>

      expect(failure(input)).toMatch(new RegExp(`^${field} `))
    }
  })

  it('rejects keys it does not know, including the art files', () => {
    expect(specialDayInputSchema.safeParse({ ...valid, tile_art: 'x.png' }).success).toBe(false)
    expect(specialDayInputSchema.safeParse({ ...valid, full_art: 'x.png' }).success).toBe(false)
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
