import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DAY_GRID, DEFAULT_PANE_OPTIONS, DEFAULT_STAR_GRID, layoutShowsStars, LAYOUT_COMPONENTS, PANE_OPTIONS, PANE_OPTION_KEYS, customLayoutInputSchema, customLayoutSchema, layoutComponents, layoutHas, layoutIdSchema, layoutShowsCalendar,
  layoutDayGrids, layoutShowsMonth, layoutShowsPhotos, layoutShowsWeek, layoutSummary, paneOptions, transposeArrangement, viewShowsMonth, viewShowsPhotos, viewShowsWeek,
} from '../../../shared/layouts'
import type { CustomLayout, CustomLayoutInput, LayoutArrangement, LayoutComponent, LayoutRow } from '../../../shared/layouts'

const row = (size: number, ...panes: [LayoutComponent, number][]): LayoutRow => ({ size, panes: panes.map(([component, paneSize]) => ({ component, size: paneSize })) })

const photoWeek: CustomLayoutInput = {
  name: 'Photo and week',
  landscape: { rows: [row(1, ['photo', 2], ['week', 3])] },
  portrait: { rows: [row(1, ['photo', 1]), row(2, ['week', 1])] },
  options: {},
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

describe('the day grid pane', () => {
  const daysPane = (grid?: unknown, size = 1) => ({ component: 'days', size, ...(grid === undefined ? {} : { grid }) })
  const withDays = (landscapeGrid?: unknown, portraitGrid?: unknown) => ({
    name: 'Days',
    landscape: { rows: [{ size: 1, panes: [daysPane(landscapeGrid)] }] },
    portrait: { rows: [{ size: 1, panes: [daysPane(portraitGrid)] }] },
  })
  const grid = { rows: 2, columns: 4, start: 'today' }

  it('comes between the agenda and the photo, and is not a view', () => {
    expect(LAYOUT_COMPONENTS).toEqual(['month', 'week', 'week_parts', 'agenda', 'days', 'stars', 'photo'])
    expect(layoutShowsCalendar({ components: ['days'] })).toBe(true)
  })

  it('accepts a days pane with a grid, and keeps the grid', () => {
    const parsed = customLayoutInputSchema.parse(withDays(grid, { rows: 4, columns: 2, start: 'week' }))
    expect(parsed.landscape.rows[0]!.panes[0]!.grid).toEqual(grid)
    expect(parsed.portrait.rows[0]!.panes[0]!.grid).toEqual({ rows: 4, columns: 2, start: 'week' })
    expect(DEFAULT_DAY_GRID).toEqual({ rows: 2, columns: 4, start: 'today' })
  })

  it('needs the grid on a days pane', () => {
    expect(problem(withDays(undefined, grid))).toBe('landscape.rows.0.panes.0.grid: must have a grid (rows, columns and start) on a days pane')
    expect(problem(withDays(grid, undefined))).toBe('portrait.rows.0.panes.0.grid: must have a grid (rows, columns and start) on a days pane')
  })

  it('rejects a grid on any other pane', () => {
    const value = { ...photoWeek, landscape: { rows: [row(1, ['photo', 2])] }, portrait: { rows: [row(1, ['photo', 2])] } }
    ;(value.landscape.rows[0]!.panes[0] as { grid?: unknown }).grid = grid
    expect(problem(value)).toBe('landscape.rows.0.panes.0.grid: must not be set on a photo pane, only on a days pane')
  })

  it('holds the grid to its bounds, whole numbers and known starts', () => {
    expect(problem(withDays({ ...grid, rows: 0 }, grid))).toBe('landscape.rows.0.panes.0.grid.rows: must be from 1 to 6')
    expect(problem(withDays({ ...grid, rows: 7 }, grid))).toBe('landscape.rows.0.panes.0.grid.rows: must be from 1 to 6')
    expect(problem(withDays({ ...grid, columns: 8 }, grid))).toBe('landscape.rows.0.panes.0.grid.columns: must be from 1 to 7')
    expect(problem(withDays({ ...grid, columns: 0 }, grid))).toBe('landscape.rows.0.panes.0.grid.columns: must be from 1 to 7')
    expect(problem(withDays({ ...grid, columns: 2.5 }, grid))).toBe('landscape.rows.0.panes.0.grid.columns: must be a whole number')
    expect(problem(withDays({ ...grid, start: 'tomorrow' }, grid))).toBe('landscape.rows.0.panes.0.grid.start: must be today or week')
    expect(customLayoutInputSchema.safeParse(withDays({ rows: 6, columns: 7, start: 'week' }, { rows: 1, columns: 1, start: 'today' })).success).toBe(true)
  })

  it('rejects a field it does not know in the grid', () => {
    expect(customLayoutInputSchema.safeParse(withDays({ ...grid, gap: 4 }, grid)).success).toBe(false)
  })

  it('still accepts layouts stored before the day grid existed', () => {
    expect(customLayoutInputSchema.safeParse(photoWeek).success).toBe(true)
    expect(customLayoutSchema.safeParse(stored()).success).toBe(true)
  })

  it('swaps rows and columns when an arrangement is turned, in all three shapes, and keeps the start', () => {
    const days = (rows: number, columns: number, size = 1) => ({ component: 'days' as const, size, grid: { rows, columns, start: 'week' as const } })
    const turned = (input: LayoutArrangement) => transposeArrangement(input).rows.flatMap(r => r.panes).find(p => p.component === 'days')!.grid

    // One row of panes becomes a column of rows.
    expect(turned({ rows: [{ size: 1, panes: [days(2, 4), { component: 'photo', size: 1 }] }] })).toEqual({ rows: 4, columns: 2, start: 'week' })
    // A column of rows becomes one row.
    expect(turned({ rows: [{ size: 1, panes: [days(2, 4)] }, { size: 1, panes: [{ component: 'photo', size: 1 }] }] })).toEqual({ rows: 4, columns: 2, start: 'week' })
    // A true grid.
    expect(turned({ rows: [{ size: 1, panes: [days(3, 5), { component: 'photo', size: 1 }] }, { size: 1, panes: [{ component: 'agenda', size: 1 }, { component: 'week', size: 1 }] }] })).toEqual({ rows: 5, columns: 3, start: 'week' })
    // Other panes gain no grid.
    expect(transposeArrangement({ rows: [{ size: 1, panes: [days(2, 4), { component: 'photo', size: 1 }] }] }).rows[1]!.panes[0]).toEqual({ component: 'photo', size: 1 })
  })

  it('lists the grids of an arrangement or a whole layout', () => {
    const input = customLayoutInputSchema.parse(withDays(grid, { rows: 4, columns: 2, start: 'week' }))
    expect(layoutDayGrids(input.landscape)).toEqual([grid])
    expect(layoutDayGrids(input)).toEqual([grid, { rows: 4, columns: 2, start: 'week' }])
    expect(layoutDayGrids(photoWeek)).toEqual([])
  })
})

describe('the star chart pane', () => {
  const starsPane = (starGrid?: unknown, size = 1) => ({ component: 'stars', size, ...(starGrid === undefined ? {} : { star_grid: starGrid }) })
  const withStars = (landscapeGrid?: unknown, portraitGrid?: unknown) => ({
    name: 'Stars',
    landscape: { rows: [{ size: 1, panes: [starsPane(landscapeGrid)] }] },
    portrait: { rows: [{ size: 1, panes: [starsPane(portraitGrid)] }] },
  })
  const starGrid = { rows: 1, columns: 4 }

  it('comes between the day grid and the photo, and is not a calendar', () => {
    expect(LAYOUT_COMPONENTS.indexOf('stars')).toBe(LAYOUT_COMPONENTS.indexOf('days') + 1)
    expect(layoutShowsCalendar({ components: ['stars'] })).toBe(false)
    expect(layoutShowsCalendar({ components: ['stars', 'photo'] })).toBe(false)
    expect(layoutShowsCalendar({ components: ['stars', 'agenda'] })).toBe(true)
    expect(layoutShowsStars({ components: ['stars'] })).toBe(true)
    expect(layoutShowsStars({ components: ['days'] })).toBe(false)
  })

  it('accepts a stars pane with a star grid, and keeps it', () => {
    const parsed = customLayoutInputSchema.parse(withStars(starGrid, { rows: 4, columns: 1 }))
    expect(parsed.landscape.rows[0]!.panes[0]!.star_grid).toEqual(starGrid)
    expect(parsed.portrait.rows[0]!.panes[0]!.star_grid).toEqual({ rows: 4, columns: 1 })
    expect(DEFAULT_STAR_GRID).toEqual({ rows: 1, columns: 4 })
  })

  it('needs the star grid on a stars pane', () => {
    expect(problem(withStars(undefined, starGrid))).toBe('landscape.rows.0.panes.0.star_grid: must have a star grid (rows and columns) on a stars pane')
    expect(problem(withStars(starGrid, undefined))).toBe('portrait.rows.0.panes.0.star_grid: must have a star grid (rows and columns) on a stars pane')
  })

  it('rejects a star grid on any other pane, and a day grid on a stars pane', () => {
    const value = { ...photoWeek, landscape: { rows: [row(1, ['photo', 2])] }, portrait: { rows: [row(1, ['photo', 2])] } }
    ;(value.landscape.rows[0]!.panes[0] as { star_grid?: unknown }).star_grid = starGrid
    expect(problem(value)).toBe('landscape.rows.0.panes.0.star_grid: must not be set on a photo pane, only on a stars pane')
    const both = withStars(starGrid, starGrid)
    ;(both.landscape.rows[0]!.panes[0] as { grid?: unknown }).grid = { rows: 1, columns: 1, start: 'today' }
    expect(problem(both)).toBe('landscape.rows.0.panes.0.grid: must not be set on a stars pane, only on a days pane')
  })

  it('holds the star grid to its bounds and whole numbers, and refuses unknown fields', () => {
    expect(problem(withStars({ ...starGrid, rows: 0 }, starGrid))).toBe('landscape.rows.0.panes.0.star_grid.rows: must be from 1 to 6')
    expect(problem(withStars({ ...starGrid, rows: 7 }, starGrid))).toBe('landscape.rows.0.panes.0.star_grid.rows: must be from 1 to 6')
    expect(problem(withStars({ ...starGrid, columns: 7 }, starGrid))).toBe('landscape.rows.0.panes.0.star_grid.columns: must be from 1 to 6')
    expect(problem(withStars({ ...starGrid, columns: 1.5 }, starGrid))).toBe('landscape.rows.0.panes.0.star_grid.columns: must be a whole number')
    expect(customLayoutInputSchema.safeParse(withStars({ ...starGrid, start: 'today' }, starGrid)).success).toBe(false)
    expect(customLayoutInputSchema.safeParse(withStars({ rows: 6, columns: 6 }, { rows: 1, columns: 1 })).success).toBe(true)
  })

  it('takes only the title option', () => {
    expect(PANE_OPTIONS.stars).toEqual(['show_title'])
    expect(customLayoutInputSchema.safeParse({ ...withStars(starGrid, starGrid), options: { stars: { show_title: false } } }).success).toBe(true)
    expect(problem({ ...withStars(starGrid, starGrid), options: { stars: { fill_events: true } } })).toBe('options.stars.fill_events: must not be set on a stars pane')
  })

  it('swaps rows and columns when an arrangement is turned', () => {
    const stars = (rows: number, columns: number) => ({ component: 'stars' as const, size: 1, star_grid: { rows, columns } })
    const turned = (input: LayoutArrangement) => transposeArrangement(input).rows.flatMap(r => r.panes).find(p => p.component === 'stars')!
    expect(turned({ rows: [{ size: 1, panes: [stars(1, 4), { component: 'photo', size: 1 }] }] }).star_grid).toEqual({ rows: 4, columns: 1 })
    expect(turned({ rows: [{ size: 1, panes: [stars(2, 3)] }, { size: 1, panes: [{ component: 'photo', size: 1 }] }] }).star_grid).toEqual({ rows: 3, columns: 2 })
    expect(turned({ rows: [{ size: 1, panes: [stars(1, 4)] }] }).grid).toBeUndefined()
  })
})

describe('pane options', () => {
  const withOptions = (options: unknown) => ({ ...photoWeek, options })

  it('defaults to none when a body sends no options, so clients from before still work', () => {
    const { options: _none, ...older } = photoWeek
    expect(customLayoutInputSchema.parse(older).options).toEqual({})
    const { options: _stored, ...olderStored } = stored()
    expect(customLayoutSchema.parse(olderStored).options).toEqual({})
  })

  it('keeps the options that are set', () => {
    const options = { week: { show_hours: false, show_title: false } }
    expect(customLayoutInputSchema.parse(withOptions(options)).options).toEqual(options)
    expect(customLayoutSchema.parse({ ...stored(), options }).options).toEqual(options)
  })

  it('knows which options each component has', () => {
    expect(PANE_OPTION_KEYS).toEqual(['show_title', 'show_sidebar', 'show_hours', 'fill_events', 'show_initials', 'wrap_titles'])
    expect(PANE_OPTIONS.month).toEqual(['show_title', 'show_sidebar', 'fill_events', 'show_initials', 'wrap_titles'])
    for (const component of ['week_parts', 'agenda', 'days'] as const) expect(PANE_OPTIONS[component]).toContain('show_initials')
    expect(PANE_OPTIONS.week).not.toContain('show_initials')
    expect(DEFAULT_PANE_OPTIONS.show_initials).toBe(true)
    expect(PANE_OPTIONS.week).toEqual(['show_title', 'show_hours'])
    expect(PANE_OPTIONS.photo).toEqual([])
    expect(Object.keys(PANE_OPTIONS)).toEqual([...LAYOUT_COMPONENTS])
  })

  it('takes show_initials as a boolean on the components that colour events, and nowhere else', () => {
    const agendaAndWeek = { ...photoWeek, landscape: { rows: [{ size: 1, panes: [{ component: 'agenda', size: 1 }, { component: 'week', size: 1 }] }] }, portrait: { rows: [{ size: 1, panes: [{ component: 'agenda', size: 1 }, { component: 'week', size: 1 }] }] } }
    const options = { agenda: { fill_events: true, show_initials: false } }
    expect(customLayoutInputSchema.parse({ ...agendaAndWeek, options }).options).toEqual(options)
    expect(problem({ ...agendaAndWeek, options: { agenda: { show_initials: 'no' } } })).toBe('options.agenda.show_initials: must be true or false')
    expect(problem(withOptions({ week: { show_initials: false } }))).toBe('options.week.show_initials: must not be set on a week pane')
  })

  it('refuses an option that does not apply to the component', () => {
    expect(problem(withOptions({ week: { fill_events: true } }))).toBe('options.week.fill_events: must not be set on a week pane')
    expect(problem(withOptions({ photo: { show_title: true } }))).toBe('options.photo.show_title: must not be set on a photo pane')
  })

  it('refuses options for a component the layout does not show', () => {
    expect(problem(withOptions({ month: { show_title: false } }))).toBe('options.month: must not be set when the layout does not show a month pane')
  })

  it('refuses unknown keys, unknown components and values that are not booleans', () => {
    expect(customLayoutInputSchema.safeParse(withOptions({ week: { show_title: false, glow: true } })).success).toBe(false)
    expect(customLayoutInputSchema.safeParse(withOptions({ sofa: {} })).success).toBe(false)
    expect(problem(withOptions({ week: { show_title: 'no' } }))).toBe('options.week.show_title: must be true or false')
    expect(customLayoutInputSchema.safeParse(withOptions({ week: { show_title: 0 } })).success).toBe(false)
    expect(customLayoutInputSchema.safeParse(withOptions([])).success).toBe(false)
  })

  it('resolves the options of a pane over the defaults', () => {
    const layout = { options: { week: { show_hours: false }, agenda: { wrap_titles: true } } }
    expect(paneOptions(layout, 'week')).toEqual({ ...DEFAULT_PANE_OPTIONS, show_hours: false })
    expect(paneOptions(layout, 'agenda')).toEqual({ ...DEFAULT_PANE_OPTIONS, wrap_titles: true })
    expect(paneOptions(layout, 'month')).toEqual(DEFAULT_PANE_OPTIONS)
    expect(paneOptions(null, 'month')).toEqual(DEFAULT_PANE_OPTIONS)
    expect(paneOptions(undefined, 'week')).toEqual(DEFAULT_PANE_OPTIONS)
  })
})
