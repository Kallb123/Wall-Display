import { describe, expect, it } from 'vitest'
import { DEFAULT_DAY_GRID, DEFAULT_PANE_OPTIONS, DEFAULT_STAR_GRID, MAX_STAR_GRID_COLUMNS, MAX_STAR_GRID_ROWS, MAX_DAY_GRID_COLUMNS, MAX_DAY_GRID_ROWS, MAX_LAYOUT_PANES_PER_ROW, MAX_LAYOUT_ROWS, MAX_LAYOUT_SIZE, customLayoutInputSchema } from '../../../shared/layouts'
import type { CustomLayoutInput, LayoutArrangement, LayoutComponent } from '../../../shared/layouts'
import { componentsOf, editorErrors, findPane, inputOf, movePane, moveRow, newLayoutInput, paneGrid, paneOptionDisabled, paneOptionLabel, paneStarGrid, resetPortrait, resizeGridColumns, resizeGridRows, resizePane, resizeRow, resizeStarGridColumns, resizeStarGridRows, sameInput, setGridStart, setPaneCorner, setPaneOption, toggleComponent, paneCornerDisabled, PANE_CORNER_LABELS } from '../../../app/utils/layoutEditor'

const arrangement = (...rows: [number, ...[LayoutComponent, number][]][]): LayoutArrangement => ({
  rows: rows.map(([size, ...panes]) => ({ size, panes: panes.map(([component, paneSize]) => ({ component, size: paneSize })) })),
})

const valid = (input: CustomLayoutInput) => expect(customLayoutInputSchema.safeParse(input).success, JSON.stringify(input)).toBe(true)

/** The components of each row, for comparing shapes. */
const shape = (value: LayoutArrangement) => value.rows.map(row => row.panes.map(pane => pane.component))

/** photo | week over agenda in landscape, and the three stacked in portrait. */
const grid = (): CustomLayoutInput => ({
  name: 'Grid',
  landscape: arrangement([2, ['photo', 1], ['week', 3]], [1, ['agenda', 1]]),
  portrait: arrangement([1, ['photo', 1]], [2, ['week', 1]], [1, ['agenda', 1]]),
  options: {},
})

const same = (landscape: LayoutArrangement): CustomLayoutInput => ({ name: 'x', landscape, portrait: landscape, options: {} })

describe('newLayoutInput', () => {
  it('is valid, with the portrait made from the landscape', () => {
    const input = newLayoutInput('Kitchen')

    valid(input)
    expect(input.name).toBe('Kitchen')
    expect(componentsOf(input)).toEqual(['week', 'agenda'])
    expect(shape(input.portrait)).toEqual([['week'], ['agenda']])
  })

  it('starts with an empty name by default, which the editor reports', () => {
    expect(newLayoutInput().name).toBe('')
    expect(editorErrors(newLayoutInput())).toEqual([{ path: 'name', message: 'must not be empty' }])
  })
})

describe('toggleComponent', () => {
  it('adds a component to the last row of both arrangements', () => {
    const next = toggleComponent(newLayoutInput('x'), 'photo', true)

    valid(next)
    expect(shape(next.landscape)).toEqual([['week', 'agenda', 'photo']])
    expect(shape(next.portrait)).toEqual([['week'], ['agenda', 'photo']])
    expect(componentsOf(next)).toEqual(['week', 'agenda', 'photo'])
  })

  it('starts a new row when the last one is full', () => {
    let input = newLayoutInput('x')
    input = toggleComponent(input, 'month', true)
    input = toggleComponent(input, 'week_parts', true)
    expect(input.landscape.rows[0]!.panes).toHaveLength(MAX_LAYOUT_PANES_PER_ROW)

    const next = toggleComponent(input, 'photo', true)

    valid(next)
    expect(next.landscape.rows).toHaveLength(2)
    expect(next.landscape.rows[1]).toEqual({ size: 1, panes: [{ component: 'photo', size: 1 }] })
  })

  it('removes a component from both and drops a row it empties', () => {
    const next = toggleComponent(grid(), 'agenda', false)

    valid(next)
    expect(shape(next.landscape)).toEqual([['photo', 'week']])
    expect(shape(next.portrait)).toEqual([['photo'], ['week']])
  })

  it('refuses to remove the last component', () => {
    const single = same(arrangement([1, ['week', 1]]))

    expect(toggleComponent(single, 'week', false)).toBe(single)
  })

  it('does nothing when it is already as asked', () => {
    const input = grid()

    expect(toggleComponent(input, 'photo', true)).toBe(input)
    expect(toggleComponent(input, 'month', false)).toBe(input)
  })

  it('never changes the input it is given', () => {
    const input = grid()
    const before = structuredClone(input)

    toggleComponent(input, 'month', true)
    toggleComponent(input, 'agenda', false)

    expect(input).toEqual(before)
  })

  it('keeps the input valid through any sequence of toggles', () => {
    let input = newLayoutInput('x')
    for (const component of ['month', 'week_parts', 'photo'] as const) input = toggleComponent(input, component, true)
    valid(input)
    for (const component of ['week', 'month', 'agenda', 'photo'] as const) {
      input = toggleComponent(input, component, false)
      valid(input)
    }
    expect(componentsOf(input)).toEqual(['week_parts'])
  })
})

describe('movePane', () => {
  it('swaps with the neighbour to the left or right', () => {
    const right = movePane(grid(), 'landscape', { row: 0, pane: 0 }, 'right')

    valid(right)
    expect(shape(right.landscape)).toEqual([['week', 'photo'], ['agenda']])
    expect(movePane(right, 'landscape', { row: 0, pane: 1 }, 'left').landscape).toEqual(grid().landscape)
  })

  it('leaves the other arrangement alone, and the input it was given', () => {
    const input = grid()

    const next = movePane(input, 'landscape', { row: 0, pane: 0 }, 'right')

    expect(next.portrait).toEqual(grid().portrait)
    expect(input).toEqual(grid())
  })

  it('does nothing at the edge of a row', () => {
    const input = grid()

    expect(movePane(input, 'landscape', { row: 0, pane: 0 }, 'left')).toBe(input)
    expect(movePane(input, 'landscape', { row: 0, pane: 1 }, 'right')).toBe(input)
  })

  it('moves a pane down to the end of the row below, and drops a row it empties', () => {
    const next = movePane(grid(), 'portrait', { row: 0, pane: 0 }, 'down')

    valid(next)
    expect(shape(next.portrait)).toEqual([['week', 'photo'], ['agenda']])
  })

  it('moves a pane up to the end of the row above', () => {
    const next = movePane(grid(), 'landscape', { row: 1, pane: 0 }, 'up')

    valid(next)
    expect(shape(next.landscape)).toEqual([['photo', 'week', 'agenda']])
  })

  it('gives a pane in company a new row above or below when there is none', () => {
    const up = movePane(grid(), 'landscape', { row: 0, pane: 1 }, 'up')
    const down = movePane(same(arrangement([1, ['photo', 2], ['week', 1]])), 'landscape', { row: 0, pane: 0 }, 'down')

    valid(up)
    valid(down)
    expect(shape(up.landscape)).toEqual([['week'], ['photo'], ['agenda']])
    expect(up.landscape.rows[0]).toEqual({ size: 1, panes: [{ component: 'week', size: 3 }] })
    expect(shape(down.landscape)).toEqual([['week'], ['photo']])
    expect(down.landscape.rows[1]).toEqual({ size: 1, panes: [{ component: 'photo', size: 2 }] })
  })

  it('does not move a lone pane off the edge, nor make more rows than allowed', () => {
    const lone = same(arrangement([1, ['week', 1]]))
    expect(movePane(lone, 'landscape', { row: 0, pane: 0 }, 'up')).toBe(lone)
    expect(movePane(grid(), 'landscape', { row: 1, pane: 0 }, 'down')).toEqual(grid())

    const rows = same(arrangement([1, ['month', 1], ['week', 1]], [1, ['week_parts', 1]], [1, ['agenda', 1]], [1, ['photo', 1]]))
    expect(rows.landscape.rows).toHaveLength(MAX_LAYOUT_ROWS)
    expect(movePane(rows, 'landscape', { row: 0, pane: 0 }, 'up')).toBe(rows)
  })

  it('does not move a pane into a full row', () => {
    const full = same(arrangement([1, ['month', 1], ['week', 1], ['week_parts', 1], ['agenda', 1]], [1, ['photo', 1]]))

    expect(movePane(full, 'landscape', { row: 1, pane: 0 }, 'up')).toBe(full)
  })

  it('does nothing for a pane that is not there', () => {
    const input = grid()

    expect(movePane(input, 'landscape', { row: 5, pane: 0 }, 'left')).toBe(input)
    expect(movePane(input, 'landscape', { row: 0, pane: 9 }, 'left')).toBe(input)
  })
})

describe('resizePane and resizeRow', () => {
  it('changes one size by one', () => {
    const wider = resizePane(grid(), 'landscape', { row: 0, pane: 0 }, 1)

    valid(wider)
    expect(wider.landscape.rows[0]!.panes.map(pane => pane.size)).toEqual([2, 3])
    expect(grid().landscape.rows[0]!.panes[0]!.size).toBe(1)
  })

  it('stops at the limits, handing back the same input', () => {
    const input = grid()

    expect(resizePane(input, 'landscape', { row: 0, pane: 0 }, -1)).toBe(input)
    expect(resizePane(input, 'landscape', { row: 0, pane: 9 }, 1)).toBe(input)
    expect(resizeRow(input, 'landscape', 1, -1)).toBe(input)
    expect(resizeRow(input, 'landscape', 7, 1)).toBe(input)
    const tallest = resizeRow(resizeRow(resizeRow(input, 'landscape', 1, 1), 'landscape', 1, 1), 'landscape', 1, 1)
    expect(tallest.landscape.rows[1]!.size).toBe(MAX_LAYOUT_SIZE)
    expect(resizeRow(tallest, 'landscape', 1, 1)).toBe(tallest)
  })

  it('makes a row taller or shorter', () => {
    const taller = resizeRow(grid(), 'portrait', 0, 1)
    const shorter = resizeRow(grid(), 'portrait', 1, -1)

    valid(taller)
    valid(shorter)
    expect(taller.portrait.rows.map(row => row.size)).toEqual([2, 2, 1])
    expect(shorter.portrait.rows.map(row => row.size)).toEqual([1, 1, 1])
  })
})

describe('moveRow', () => {
  it('swaps a row with its neighbour', () => {
    const next = moveRow(grid(), 'landscape', 1, 'up')

    valid(next)
    expect(shape(next.landscape)).toEqual([['agenda'], ['photo', 'week']])
    expect(next.landscape.rows.map(row => row.size)).toEqual([1, 2])
  })

  it('does nothing at the top or the bottom', () => {
    const input = grid()

    expect(moveRow(input, 'landscape', 0, 'up')).toBe(input)
    expect(moveRow(input, 'landscape', 1, 'down')).toBe(input)
  })
})

describe('resetPortrait', () => {
  it('makes the portrait arrangement from the landscape one, as a new layout does', () => {
    const edited: CustomLayoutInput = { ...grid(), portrait: arrangement([1, ['photo', 1], ['week', 1], ['agenda', 1]]) }

    const reset = resetPortrait(edited)

    valid(reset)
    expect(reset.landscape).toEqual(edited.landscape)
    expect(componentsOf(reset)).toEqual(['week', 'agenda', 'photo'])
    expect(shape(reset.portrait)).toEqual([['photo', 'agenda'], ['week']])
  })

  it('turns [photo | week] into the photo above the week', () => {
    const input: CustomLayoutInput = { name: 'x', landscape: arrangement([1, ['photo', 1], ['week', 3]]), portrait: arrangement([1, ['week', 1], ['photo', 1]]) }

    expect(resetPortrait(input).portrait).toEqual(arrangement([1, ['photo', 1]], [3, ['week', 1]]))
  })
})

describe('the other helpers', () => {
  it('finds a pane', () => {
    expect(findPane(grid().landscape, 'week')).toEqual({ row: 0, pane: 1 })
    expect(findPane(grid().landscape, 'agenda')).toEqual({ row: 1, pane: 0 })
    expect(findPane(grid().landscape, 'month')).toBeNull()
  })

  it('takes a saved layout down to what the server accepts, as a copy', () => {
    const saved = { ...grid(), id: 'grid', created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-01T10:00:00.000Z' }

    const input = inputOf(saved)

    expect(input).toEqual(grid())
    expect(input.landscape).not.toBe(saved.landscape)
    expect(sameInput(input, grid())).toBe(true)
    expect(sameInput(resizeRow(input, 'landscape', 0, -1), input)).toBe(false)
  })

  it('lists what is wrong with an input, with dotted paths', () => {
    const bad = { ...grid(), name: '  ', portrait: arrangement([1, ['photo', 1]]) }

    expect(editorErrors(bad)).toEqual([
      { path: 'name', message: 'must not be empty' },
      { path: 'portrait', message: expect.stringContaining('must show the same components as landscape') },
    ])
    expect(editorErrors(grid())).toEqual([])
  })
})

describe('the day grid', () => {
  const withDays = () => toggleComponent(newLayoutInput('x'), 'days', true)
  const landscapeAt = { row: 0, pane: 2 }
  /** Where the days pane is in the portrait arrangement. */
  const portraitAt = (input: CustomLayoutInput) => findPane(input.portrait, 'days')!
  const grids = (input: CustomLayoutInput) => [input.landscape, input.portrait].flatMap(a => a.rows.flatMap(row => row.panes.filter(pane => pane.grid).map(pane => pane.component)))

  it('gives a new days pane the default grid, turned on its side in portrait', () => {
    const next = withDays()

    valid(next)
    expect(next.landscape.rows[0]!.panes[2]).toEqual({ component: 'days', size: 1, grid: DEFAULT_DAY_GRID })
    expect(next.landscape.rows[0]!.panes[2]!.grid).not.toBe(DEFAULT_DAY_GRID)
    const portrait = next.portrait.rows.flatMap(row => row.panes).find(pane => pane.component === 'days')
    expect(portrait!.grid).toEqual({ rows: DEFAULT_DAY_GRID.columns, columns: DEFAULT_DAY_GRID.rows, start: 'today' })
  })

  it('gives a days pane in a row of its own the grid too, and removes it cleanly', () => {
    let input = toggleComponent(newLayoutInput('x'), 'month', true)
    input = toggleComponent(input, 'week_parts', true)
    const next = toggleComponent(input, 'days', true)

    valid(next)
    expect(next.landscape.rows[1]!.panes[0]!.grid).toEqual(DEFAULT_DAY_GRID)
    const off = toggleComponent(next, 'days', false)
    valid(off)
    expect(grids(off)).toEqual([])
    expect(componentsOf(off)).not.toContain('days')
  })

  it('never adds a grid to other panes', () => {
    expect(grids(withDays())).toEqual(['days', 'days'])
  })

  it('changes rows and columns by one in one arrangement only', () => {
    const input = withDays()
    const portraitBefore = input.portrait

    const rows = resizeGridRows(input, 'landscape', landscapeAt, 1)
    const columns = resizeGridColumns(rows, 'landscape', landscapeAt, -1)

    valid(columns)
    expect(paneGrid(columns, 'landscape', landscapeAt)).toEqual({ rows: 3, columns: 3, start: 'today' })
    expect(columns.portrait).toEqual(portraitBefore)
    expect(paneGrid(input, 'landscape', landscapeAt)).toEqual(DEFAULT_DAY_GRID)
  })

  it('stops at the limits, handing back the same input', () => {
    let input = withDays()
    for (let i = 0; i < 10; i++) {
      input = resizeGridRows(input, 'landscape', landscapeAt, 1)
      input = resizeGridColumns(input, 'landscape', landscapeAt, 1)
    }
    expect(paneGrid(input, 'landscape', landscapeAt)).toMatchObject({ rows: MAX_DAY_GRID_ROWS, columns: MAX_DAY_GRID_COLUMNS })
    expect(resizeGridRows(input, 'landscape', landscapeAt, 1)).toBe(input)
    expect(resizeGridColumns(input, 'landscape', landscapeAt, 1)).toBe(input)
    for (let i = 0; i < 10; i++) {
      input = resizeGridRows(input, 'landscape', landscapeAt, -1)
      input = resizeGridColumns(input, 'landscape', landscapeAt, -1)
    }
    expect(paneGrid(input, 'landscape', landscapeAt)).toMatchObject({ rows: 1, columns: 1 })
    expect(resizeGridRows(input, 'landscape', landscapeAt, -1)).toBe(input)
    expect(resizeGridColumns(input, 'landscape', landscapeAt, -1)).toBe(input)
    valid(input)
  })

  it('sets where the grid starts', () => {
    const input = withDays()
    const week = setGridStart(input, 'portrait', portraitAt(input), 'week')

    valid(week)
    expect(paneGrid(week, 'portrait', portraitAt(input))!.start).toBe('week')
    expect(paneGrid(week, 'landscape', landscapeAt)!.start).toBe('today')
    expect(setGridStart(input, 'landscape', landscapeAt, 'today')).toBe(input)
  })

  it('does nothing on a pane that is not a day grid', () => {
    const input = withDays()

    expect(resizeGridRows(input, 'landscape', { row: 0, pane: 0 }, 1)).toBe(input)
    expect(setGridStart(input, 'landscape', { row: 5, pane: 0 }, 'week')).toBe(input)
    expect(paneGrid(input, 'landscape', { row: 0, pane: 0 })).toBeNull()
  })

  it('keeps the grid through every other operation', () => {
    const base = setGridStart(resizeGridRows(withDays(), 'landscape', landscapeAt, 1), 'landscape', landscapeAt, 'week')
    const expected = { rows: 3, columns: 4, start: 'week' }
    const gridOf = (input: CustomLayoutInput) => input.landscape.rows.flatMap(row => row.panes).find(pane => pane.component === 'days')!.grid

    const steps = [
      movePane(base, 'landscape', landscapeAt, 'left'),
      movePane(base, 'landscape', landscapeAt, 'down'),
      movePane(base, 'landscape', landscapeAt, 'up'),
      resizePane(base, 'landscape', landscapeAt, 1),
      resizeRow(base, 'landscape', 0, 1),
      toggleComponent(base, 'photo', true),
      toggleComponent(base, 'agenda', false),
      resizeGridRows(base, 'portrait', portraitAt(base), 1),
    ]
    for (const step of steps) {
      valid(step)
      expect(gridOf(step), JSON.stringify(step)).toEqual(expected)
      expect(grids(step)).toEqual(['days', 'days'])
    }
    const moved = movePane(base, 'landscape', landscapeAt, 'down')
    expect(moved).not.toBe(base)
    const two = toggleComponent(toggleComponent(base, 'month', true), 'week_parts', true)
    expect(moveRow(two, 'landscape', 0, 'down').landscape.rows.flatMap(row => row.panes).find(pane => pane.component === 'days')!.grid).toEqual(expected)
  })

  it('turns the grid with "start again from landscape"', () => {
    const base = resizeGridColumns(withDays(), 'landscape', landscapeAt, 1)

    const reset = resetPortrait(base)

    valid(reset)
    expect(paneGrid(reset, 'portrait', portraitAt(reset))).toEqual({ rows: 5, columns: 2, start: 'today' })
  })
})

describe('pane options', () => {
  it('starts with none, and inputOf copies them', () => {
    expect(newLayoutInput().options).toEqual({})
    const saved = { id: 'x', ...setPaneOption(newLayoutInput('X'), 'week', 'show_hours', false), created_at: '', updated_at: '' }
    const copied = inputOf(saved)

    expect(copied.options).toEqual({ week: { show_hours: false } })
    expect(copied.options).not.toBe(saved.options)
    expect(sameInput(copied, newLayoutInput('X'))).toBe(false)
  })

  it('sets an option, valid and without changing the input', () => {
    const input = newLayoutInput('X')
    const before = structuredClone(input)
    const next = setPaneOption(input, 'agenda', 'wrap_titles', true)

    expect(next.options).toEqual({ agenda: { wrap_titles: true } })
    valid(next)
    expect(input).toEqual(before)
  })

  it('keeps only what differs from the default', () => {
    const hidden = setPaneOption(newLayoutInput('X'), 'week', 'show_title', false)
    const both = setPaneOption(hidden, 'week', 'show_hours', false)
    const back = setPaneOption(both, 'week', 'show_title', true)

    expect(back.options).toEqual({ week: { show_hours: false } })
    expect(setPaneOption(back, 'week', 'show_hours', true).options).toEqual({})
  })

  it('sets where the photo frame\'s overlays sit, keeping only what differs from the default', () => {
    const input = toggleComponent(newLayoutInput('X'), 'photo', true)
    const next = setPaneCorner(input, 'photo', 'date_corner', 'bottom-right')

    expect(next.options).toEqual({ photo: { date_corner: 'bottom-right' } })
    valid(next)
    expect(setPaneCorner(next, 'photo', 'date_corner', 'auto').options).toEqual({})
    expect(setPaneCorner(next, 'photo', 'date_corner', 'bottom-right')).toBe(next)
    // Only the photo frame has corners, and only when it is shown.
    expect(setPaneCorner(input, 'week', 'time_corner', 'top-left')).toBe(input)
    expect(setPaneCorner(newLayoutInput('X'), 'photo', 'time_corner', 'top-left').options).toEqual({})
  })

  it('offers a corner only for an overlay that is shown, and the time\'s for the weather alone', () => {
    const options = { ...DEFAULT_PANE_OPTIONS }
    expect(paneCornerDisabled('time_corner', options)).toBe(false)
    expect(paneCornerDisabled('date_corner', options)).toBe(true)
    expect(paneCornerDisabled('date_corner', { ...options, show_date: true })).toBe(false)
    expect(paneCornerDisabled('time_corner', { ...options, show_time: false })).toBe(false)
    expect(paneCornerDisabled('time_corner', { ...options, show_time: false, show_weather: false })).toBe(true)
    expect(paneCornerDisabled('forecast_corner', options)).toBe(true)
    expect(paneCornerDisabled('forecast_corner', { ...options, show_forecast: true })).toBe(false)
  })

  it('hands back the same input when nothing changes', () => {
    const input = newLayoutInput('X')

    expect(setPaneOption(input, 'week', 'show_title', true)).toBe(input)
    expect(setPaneOption(input, 'week', 'fill_events', true)).toBe(input)
    expect(setPaneOption(input, 'month', 'show_title', false)).toBe(input)
  })

  it('drops a component\'s options when it is taken out, and they stay valid', () => {
    const input = setPaneOption(setPaneOption(newLayoutInput('X'), 'agenda', 'fill_events', true), 'week', 'show_hours', false)
    const next = toggleComponent(input, 'agenda', false)

    expect(next.options).toEqual({ week: { show_hours: false } })
    valid(next)
    expect(toggleComponent(next, 'agenda', true).options).toEqual({ week: { show_hours: false } })
  })

  it('words the title by what it is', () => {
    expect(paneOptionLabel('month', 'show_title')).toBe('Month title')
    expect(paneOptionLabel('week', 'show_title')).toBe('Date title')
    expect(paneOptionLabel('week_parts', 'show_title')).toBe('Date title')
    expect(paneOptionLabel('month', 'show_sidebar')).toBe('Sidebar')
    expect(paneOptionLabel('week', 'show_hours')).toBe('Hour labels')
    expect(paneOptionLabel('agenda', 'fill_events')).toBe('Colour whole events')
    expect(paneOptionLabel('agenda', 'wrap_titles')).toBe('Wrap long titles')
    expect(paneOptionLabel('agenda', 'show_initials')).toBe('Initials')
    expect(paneOptionLabel('month', 'weather_on_dates')).toBe('Weather on dates')
  })

  it('labels show_locations, and stores it only when it is off and only on the components that have it', () => {
    expect(paneOptionLabel('agenda', 'show_locations')).toBe('Locations')
    expect(paneOptionLabel('photo', 'show_forecast')).toBe("Today's forecast")
    expect(PANE_CORNER_LABELS.forecast_corner).toBe('Forecast')
    const input = setPaneOption(newLayoutInput('X'), 'week', 'show_locations', false)
    expect(input.options).toEqual({ week: { show_locations: false } })
    expect(setPaneOption(input, 'week', 'show_locations', true).options).toEqual({})
    expect(setPaneOption(newLayoutInput('X'), 'stars', 'show_locations', false)).toEqual(newLayoutInput('X'))
  })

  it('stores weather_on_dates only when it is off, and only on the components that have it', () => {
    const input = setPaneOption(newLayoutInput('X'), 'agenda', 'weather_on_dates', false)
    expect(input.options).toEqual({ agenda: { weather_on_dates: false } })
    expect(setPaneOption(input, 'agenda', 'weather_on_dates', true).options).toEqual({})
    expect(setPaneOption(newLayoutInput('X'), 'photo', 'weather_on_dates', false)).toEqual(newLayoutInput('X'))
  })

  it('puts the initials out of reach until events are coloured', () => {
    expect(paneOptionDisabled('show_initials', DEFAULT_PANE_OPTIONS)).toBe(true)
    expect(paneOptionDisabled('show_initials', { ...DEFAULT_PANE_OPTIONS, fill_events: true })).toBe(false)
    expect(paneOptionDisabled('wrap_titles', DEFAULT_PANE_OPTIONS)).toBe(false)
    expect(paneOptionDisabled('fill_events', DEFAULT_PANE_OPTIONS)).toBe(false)
  })

  it('stores show_initials only when it is off', () => {
    const input = setPaneOption(newLayoutInput('X'), 'agenda', 'show_initials', false)
    expect(input.options).toEqual({ agenda: { show_initials: false } })
    valid(input)
    expect(setPaneOption(input, 'agenda', 'show_initials', true).options).toEqual({})
  })
})

describe('the star chart grid', () => {
  const withStars = () => toggleComponent(newLayoutInput('x'), 'stars', true)
  const landscapeAt = { row: 0, pane: 2 }
  const portraitAt = (input: CustomLayoutInput) => findPane(input.portrait, 'stars')!

  it('gives a new stars pane the default grid, turned on its side in portrait', () => {
    const next = withStars()

    valid(next)
    expect(next.landscape.rows[0]!.panes[2]).toEqual({ component: 'stars', size: 1, star_grid: DEFAULT_STAR_GRID })
    expect(next.landscape.rows[0]!.panes[2]!.star_grid).not.toBe(DEFAULT_STAR_GRID)
    expect(paneStarGrid(next, 'portrait', portraitAt(next))).toEqual({ rows: DEFAULT_STAR_GRID.columns, columns: DEFAULT_STAR_GRID.rows })
  })

  it('removes cleanly, with its options', () => {
    const on = setPaneOption(withStars(), 'stars', 'show_title', false)
    expect(on.options.stars).toEqual({ show_title: false })
    const off = toggleComponent(on, 'stars', false)
    valid(off)
    expect(off.options.stars).toBeUndefined()
    expect(componentsOf(off)).not.toContain('stars')
  })

  it('offers the title option, labelled Title', () => {
    expect(paneOptionLabel('stars', 'show_title')).toBe('Title')
    const next = setPaneOption(withStars(), 'stars', 'show_title', false)
    expect(next.options.stars).toEqual({ show_title: false })
    expect(setPaneOption(withStars(), 'stars', 'show_sidebar', true)).toEqual(withStars())
  })

  it('changes rows and columns by one in one arrangement only', () => {
    const input = withStars()
    const next = resizeStarGridColumns(resizeStarGridRows(input, 'landscape', landscapeAt, 1), 'landscape', landscapeAt, -1)

    valid(next)
    expect(paneStarGrid(next, 'landscape', landscapeAt)).toEqual({ rows: 2, columns: 3 })
    expect(next.portrait).toEqual(input.portrait)
    expect(paneStarGrid(input, 'landscape', landscapeAt)).toEqual(DEFAULT_STAR_GRID)
  })

  it('stops at the limits, handing back the same input', () => {
    let input = withStars()
    for (let i = 0; i < 10; i++) {
      input = resizeStarGridRows(input, 'landscape', landscapeAt, 1)
      input = resizeStarGridColumns(input, 'landscape', landscapeAt, 1)
    }
    expect(paneStarGrid(input, 'landscape', landscapeAt)).toEqual({ rows: MAX_STAR_GRID_ROWS, columns: MAX_STAR_GRID_COLUMNS })
    expect(resizeStarGridRows(input, 'landscape', landscapeAt, 1)).toBe(input)
    expect(resizeStarGridColumns(input, 'landscape', landscapeAt, 1)).toBe(input)
    for (let i = 0; i < 10; i++) {
      input = resizeStarGridRows(input, 'landscape', landscapeAt, -1)
      input = resizeStarGridColumns(input, 'landscape', landscapeAt, -1)
    }
    expect(paneStarGrid(input, 'landscape', landscapeAt)).toEqual({ rows: 1, columns: 1 })
    expect(resizeStarGridRows(input, 'landscape', landscapeAt, -1)).toBe(input)
    valid(input)
  })

  it('changes nothing on a pane that is not a star chart', () => {
    const input = withStars()
    expect(resizeStarGridRows(input, 'landscape', { row: 0, pane: 0 }, 1)).toBe(input)
    expect(resizeGridRows(input, 'landscape', landscapeAt, 1)).toBe(input)
    expect(paneStarGrid(input, 'landscape', { row: 0, pane: 0 })).toBeNull()
  })
})
