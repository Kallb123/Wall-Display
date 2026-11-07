import { describe, expect, it } from 'vitest'
import {
  LAYOUT_COMPONENTS, customLayoutInputSchema, customLayoutSchema, layoutComponents, layoutHas, layoutIdSchema, layoutShowsCalendar,
  layoutShowsMonth, layoutShowsPhotos, layoutShowsWeek, layoutSummary, transposeArrangement, viewShowsMonth, viewShowsPhotos, viewShowsWeek,
} from '../../../shared/layouts'
import type { CustomLayout, CustomLayoutInput, LayoutArrangement, LayoutComponent, LayoutRow } from '../../../shared/layouts'

const row = (size: number, ...panes: [LayoutComponent, number][]): LayoutRow => ({ size, panes: panes.map(([component, paneSize]) => ({ component, size: paneSize })) })

const photoWeek: CustomLayoutInput = {
  name: 'Photo and week',
  landscape: { rows: [row(1, ['photo', 2], ['week', 3])] },
  portrait: { rows: [row(1, ['photo', 1]), row(2, ['week', 1])] },
}

function stored(input: CustomLayoutInput = photoWeek): CustomLayout {
  return { id: 'photo-and-week', ...input, created_at: '2026-10-28T12:00:00.000Z', updated_at: '2026-10-28T12:00:00.000Z' }
}

/** The first problem the schema finds, as `path: message`. */
function problem(value: unknown): string | undefined {
  const result = customLayoutInputSchema.safeParse(value)
  if (result.success) return undefined
  const issue = result.error.issues[0]!
  return `${issue.path.join('.')}: ${issue.message}`
}

describe('layoutIdSchema', () => {
  it('takes slugs and nothing else', () => {
    expect(layoutIdSchema.safeParse('kitchen-2').success).toBe(true)
    for (const bad of ['', 'Kitchen', '-kitchen', 'kitchen wall', 'a'.repeat(65)]) expect(layoutIdSchema.safeParse(bad).success, bad).toBe(false)
  })
})

describe('customLayoutInputSchema', () => {
  it('accepts a layout and trims its name', () => {
    const parsed = customLayoutInputSchema.parse({ ...photoWeek, name: '  Kitchen  ' })
    expect(parsed.name).toBe('Kitchen')
    expect(parsed.landscape).toEqual(photoWeek.landscape)
  })

  it('refuses an empty or too long name', () => {
    expect(problem({ ...photoWeek, name: '   ' })).toBe('name: must not be empty')
    expect(problem({ ...photoWeek, name: 'x'.repeat(61) })).toBe('name: must be at most 60 characters')
    expect(customLayoutInputSchema.safeParse({ ...photoWeek, name: 'x'.repeat(60) }).success).toBe(true)
  })

  it('refuses an unknown field, at any level', () => {
    expect(customLayoutInputSchema.safeParse({ ...photoWeek, id: 'x' }).success).toBe(false)
    const withExtra = structuredClone(photoWeek) as unknown as { landscape: { rows: { colour?: string }[] } }
    withExtra.landscape.rows[0]!.colour = 'red'
    expect(customLayoutInputSchema.safeParse(withExtra).success).toBe(false)
  })

  it('needs between one and four rows', () => {
    expect(problem({ ...photoWeek, landscape: { rows: [] } })).toBe('landscape.rows: must have at least one row')
    const five = { rows: [row(1, ['month', 1]), row(1, ['week', 1]), row(1, ['agenda', 1]), row(1, ['photo', 1]), row(1, ['week_parts', 1])] }
    expect(problem({ ...photoWeek, landscape: five })).toBe('landscape.rows: must have at most 4 rows')
  })

  it('needs between one and four panes in a row', () => {
    expect(problem({ ...photoWeek, landscape: { rows: [{ size: 1, panes: [] }] } })).toBe('landscape.rows.0.panes: must have at least one pane')
    const five = { rows: [row(1, ['month', 1], ['week', 1], ['agenda', 1], ['photo', 1], ['week_parts', 1])] }
    expect(problem({ ...photoWeek, landscape: five })).toBe('landscape.rows.0.panes: must have at most 4 panes')
  })

  it('takes whole sizes from 1 to 4', () => {
    for (const bad of [0, 5, 1.5, -1]) {
      expect(problem({ ...photoWeek, landscape: { rows: [row(bad, ['photo', 2], ['week', 3])] } }), String(bad)).toMatch(/^landscape\.rows\.0\.size: /)
      expect(problem({ ...photoWeek, landscape: { rows: [row(1, ['photo', bad], ['week', 3])] } }), String(bad)).toMatch(/^landscape\.rows\.0\.panes\.0\.size: /)
    }
    expect(problem({ ...photoWeek, landscape: { rows: [row(4, ['photo', 4], ['week', 1])] } })).toBeUndefined()
  })

  it('refuses a component that is not one a layout can place', () => {
    expect(problem({ ...photoWeek, landscape: { rows: [row(1, ['night' as LayoutComponent, 1], ['week', 1])] } })).toMatch(/^landscape\.rows\.0\.panes\.0\.component: must be month, week/)
  })

  it('refuses a component twice in one arrangement, naming the second', () => {
    const twice = { rows: [row(1, ['week', 1], ['week', 1], ['photo', 1])] }
    expect(problem({ ...photoWeek, landscape: twice })).toBe('landscape.rows.0.panes.1.component: must not be used twice (week is already in the landscape arrangement)')
    const across = { rows: [row(1, ['photo', 1]), row(1, ['photo', 1]), row(1, ['week', 1])] }
    expect(problem({ ...photoWeek, portrait: across })).toMatch(/^portrait\.rows\.1\.panes\.0\.component: must not be used twice/)
  })

  it('needs both arrangements to hold the same components', () => {
    const lacking = { ...photoWeek, portrait: { rows: [row(1, ['photo', 1])] } }
    expect(problem(lacking)).toBe('portrait: must show the same components as landscape (they differ on week)')
    const other = { ...photoWeek, portrait: { rows: [row(1, ['photo', 1]), row(1, ['agenda', 1]), row(1, ['week', 1])] } }
    expect(problem(other)).toBe('portrait: must show the same components as landscape (they differ on agenda)')
  })

  it('accepts the same components in a different order and shape', () => {
    const grid: CustomLayoutInput = {
      name: 'Grid',
      landscape: { rows: [row(1, ['month', 1], ['week', 1]), row(1, ['agenda', 1], ['photo', 1])] },
      portrait: { rows: [row(1, ['photo', 2]), row(2, ['agenda', 1], ['week', 1]), row(1, ['month', 1])] },
    }
    expect(customLayoutInputSchema.safeParse(grid).success).toBe(true)
  })
})

describe('customLayoutSchema', () => {
  it('accepts a stored layout', () => {
    expect(customLayoutSchema.parse(stored())).toEqual(stored())
  })

  it('needs a good id and real timestamps', () => {
    expect(customLayoutSchema.safeParse({ ...stored(), id: 'Not An Id' }).success).toBe(false)
    expect(customLayoutSchema.safeParse({ ...stored(), created_at: 'yesterday' }).success).toBe(false)
    expect(customLayoutSchema.safeParse({ ...stored(), updated_at: undefined }).success).toBe(false)
  })

  it('applies the same rules as the input', () => {
    expect(customLayoutSchema.safeParse({ ...stored(), portrait: { rows: [row(1, ['photo', 1])] } }).success).toBe(false)
  })
})

describe('layoutComponents', () => {
  it('lists an arrangement\'s components in the canonical order', () => {
    const arrangement: LayoutArrangement = { rows: [row(1, ['photo', 1], ['agenda', 1]), row(1, ['month', 1])] }
    expect(layoutComponents(arrangement)).toEqual(['month', 'agenda', 'photo'])
  })

  it('lists a layout\'s, without repeats', () => {
    expect(layoutComponents(photoWeek)).toEqual(['week', 'photo'])
    expect(layoutComponents(photoWeek)).toEqual(LAYOUT_COMPONENTS.filter(c => c === 'week' || c === 'photo'))
  })
})

describe('layout questions', () => {
  const summary = (...components: LayoutComponent[]) => ({ id: 'x', name: 'X', components })

  it('answers what a layout shows', () => {
    expect(layoutHas(summary('week'), 'week')).toBe(true)
    expect(layoutHas(summary('week'), 'month')).toBe(false)
    expect(layoutShowsWeek(summary('week'))).toBe(true)
    expect(layoutShowsWeek(summary('week_parts'))).toBe(true)
    expect(layoutShowsWeek(summary('month', 'agenda', 'photo'))).toBe(false)
    expect(layoutShowsMonth(summary('month'))).toBe(true)
    expect(layoutShowsMonth(summary('week'))).toBe(false)
    expect(layoutShowsPhotos(summary('photo'))).toBe(true)
    expect(layoutShowsPhotos(summary('month'))).toBe(false)
  })

  it('counts every component but the photo as calendar', () => {
    for (const component of ['month', 'week', 'week_parts', 'agenda'] as const) expect(layoutShowsCalendar(summary(component)), component).toBe(true)
    expect(layoutShowsCalendar(summary('photo'))).toBe(false)
  })
})

describe('layoutSummary', () => {
  it('keeps the id and name and the components of both arrangements', () => {
    expect(layoutSummary(stored())).toEqual({ id: 'photo-and-week', name: 'Photo and week', components: ['week', 'photo'] })
  })
})

describe('the view helpers', () => {
  const withPhoto = layoutSummary(stored())
  const calendarOnly = { id: 'cal', name: 'Cal', components: ['month', 'agenda'] as LayoutComponent[] }

  it('follows the built-in views without a layout', () => {
    expect(viewShowsPhotos('photo', null)).toBe(true)
    expect(viewShowsPhotos('week_photo', undefined)).toBe(true)
    expect(viewShowsPhotos('month', withPhoto)).toBe(false)
    expect(viewShowsWeek('week_parts', null)).toBe(true)
    expect(viewShowsWeek('month', withPhoto)).toBe(false)
    expect(viewShowsMonth('month', null)).toBe(true)
    expect(viewShowsMonth('week', null)).toBe(false)
  })

  it('looks into the layout for the custom view', () => {
    expect(viewShowsPhotos('custom', withPhoto)).toBe(true)
    expect(viewShowsPhotos('custom', calendarOnly)).toBe(false)
    expect(viewShowsWeek('custom', withPhoto)).toBe(true)
    expect(viewShowsWeek('custom', calendarOnly)).toBe(false)
    expect(viewShowsMonth('custom', calendarOnly)).toBe(true)
    expect(viewShowsMonth('custom', withPhoto)).toBe(false)
  })

  it('shows nothing for custom with no layout', () => {
    expect(viewShowsPhotos('custom', null)).toBe(false)
    expect(viewShowsWeek('custom', undefined)).toBe(false)
    expect(viewShowsMonth('custom', null)).toBe(false)
  })
})

describe('transposeArrangement', () => {
  /** Whatever the shape, the result must be a valid layout with the same components. */
  function expectValid(landscape: LayoutArrangement, portrait: LayoutArrangement) {
    const result = customLayoutInputSchema.safeParse({ name: 'T', landscape, portrait })
    expect(result.error?.issues).toBeUndefined()
    expect(layoutComponents(portrait)).toEqual(layoutComponents(landscape))
  }

  it('turns a row of panes into a column of rows: photo beside week becomes photo above week', () => {
    const landscape: LayoutArrangement = { rows: [row(1, ['photo', 2], ['week', 3])] }
    const portrait = transposeArrangement(landscape)
    expect(portrait).toEqual({ rows: [row(2, ['photo', 1]), row(3, ['week', 1])] })
    expectValid(landscape, portrait)
  })

  it('turns a column of rows into one row of panes', () => {
    const landscape: LayoutArrangement = { rows: [row(1, ['month', 1]), row(3, ['agenda', 1]), row(2, ['photo', 1])] }
    const portrait = transposeArrangement(landscape)
    expect(portrait).toEqual({ rows: [row(1, ['month', 1], ['agenda', 3], ['photo', 2])] })
    expectValid(landscape, portrait)
  })

  it('turns a grid by pane index', () => {
    const landscape: LayoutArrangement = { rows: [row(2, ['month', 3], ['week', 1]), row(1, ['agenda', 2], ['photo', 4])] }
    const portrait = transposeArrangement(landscape)
    expect(portrait).toEqual({ rows: [row(3, ['month', 2], ['agenda', 1]), row(4, ['week', 2], ['photo', 1])] })
    expectValid(landscape, portrait)
  })

  it('copes with a ragged grid, where some rows are shorter', () => {
    const landscape: LayoutArrangement = { rows: [row(1, ['month', 1], ['week', 2], ['agenda', 1]), row(2, ['photo', 1])] }
    const portrait = transposeArrangement(landscape)
    expect(portrait).toEqual({ rows: [row(1, ['month', 1], ['photo', 2]), row(2, ['week', 1]), row(1, ['agenda', 1])] })
    expectValid(landscape, portrait)
  })

  it('keeps a single pane as it is', () => {
    const landscape: LayoutArrangement = { rows: [row(3, ['week', 3])] }
    expect(transposeArrangement(landscape)).toEqual({ rows: [row(3, ['week', 1])] })
  })

  it('stays valid for the biggest shapes', () => {
    const four: LayoutArrangement = { rows: [row(1, ['month', 1], ['week', 1], ['agenda', 1], ['photo', 1])] }
    expectValid(four, transposeArrangement(four))
    const column: LayoutArrangement = { rows: [row(1, ['month', 1]), row(1, ['week', 1]), row(1, ['agenda', 1]), row(1, ['photo', 1])] }
    expectValid(column, transposeArrangement(column))
    const full: LayoutArrangement = { rows: [row(4, ['month', 4], ['week', 4], ['agenda', 4], ['photo', 4]), row(4, ['week_parts', 4])] }
    expectValid(full, transposeArrangement(full))
  })

  it('does not change what it is given', () => {
    const landscape: LayoutArrangement = { rows: [row(1, ['photo', 2], ['week', 3])] }
    const before = structuredClone(landscape)
    transposeArrangement(landscape)
    expect(landscape).toEqual(before)
  })
})
