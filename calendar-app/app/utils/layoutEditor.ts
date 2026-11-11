import { DEFAULT_DAY_GRID, DEFAULT_PANE_OPTIONS, DEFAULT_STAR_GRID, LAYOUT_COMPONENTS, MAX_DAY_GRID_COLUMNS, MAX_DAY_GRID_ROWS, MAX_LAYOUT_PANES_PER_ROW, MAX_LAYOUT_ROWS, MAX_LAYOUT_SIZE, MAX_STAR_GRID_COLUMNS, MAX_STAR_GRID_ROWS, MIN_DAY_GRID_COLUMNS, MIN_DAY_GRID_ROWS, MIN_LAYOUT_SIZE, MIN_STAR_GRID_COLUMNS, MIN_STAR_GRID_ROWS, PANE_CORNERS, PANE_OPTIONS, customLayoutInputSchema, transposeArrangement } from '../../shared/layouts'
import type { CustomLayout, CustomLayoutInput, DayGrid, DayGridStart, LayoutArrangement, LayoutComponent, LayoutPane, OverlayCorner, PaneCornerKey, PaneOptionKey, StarGrid, PaneOptions, ResolvedPaneOptions } from '../../shared/layouts'

// What the layout editor does to the layout it is editing (architecture §7.6,
// PR 5.17): turning a component on or off, moving a pane, making a pane or a
// row bigger or smaller. Each is a pure function from one `CustomLayoutInput` to
// the next, never changing the one it is given, and the result is always a
// valid input (the editor offers nothing else). An operation that cannot be
// done, such as moving a pane left from the left edge, hands back the very same
// object it was given, so the editor can tell with `===` and disable the button.
// Pure: no Nuxt or Vue imports.

/** The two arrangements a layout holds. */
export type Orientation = 'landscape' | 'portrait'

/** Where a pane is: its row, and its place in that row. */
export interface PaneAt {
  row: number
  pane: number
}

export type MoveDirection = 'left' | 'right' | 'up' | 'down'

/** The words the editor and the previews use for each component. */
export const COMPONENT_LABELS: Record<LayoutComponent, string> = {
  month: 'Month',
  week: 'Week',
  week_parts: 'Day parts',
  agenda: 'Agenda',
  days: 'Days',
  stars: 'Stars',
  photo: 'Photo',
}

/** The words the editor uses for each pane option. The title is the month's name or the week's dates, so its label depends on the component. */
export function paneOptionLabel(component: LayoutComponent, key: PaneOptionKey): string {
  switch (key) {
    case 'show_title': return component === 'month' ? 'Month title' : component === 'stars' ? 'Title' : 'Date title'
    case 'show_sidebar': return 'Sidebar'
    case 'show_hours': return 'Hour labels'
    case 'fill_events': return 'Colour whole events'
    case 'show_initials': return 'Initials'
    case 'wrap_titles': return 'Wrap long titles'
    case 'show_time': return 'Time'
    case 'show_date': return 'Date'
    case 'show_weather': return 'Weather'
    case 'weather_on_dates': return 'Weather on dates'
  }
}

/** Whether the editor shows an option switched off and out of reach: the initials only matter on events that are coloured. */
export const paneOptionDisabled = (key: PaneOptionKey, options: ResolvedPaneOptions): boolean => key === 'show_initials' && !options.fill_events

/** The words the editor uses for each corner option. The weather sits beside the time, so it goes where the time goes. */
export const PANE_CORNER_LABELS: Record<PaneCornerKey, string> = {
  time_corner: 'Time and weather',
  date_corner: 'Date',
}

/** The words the editor uses for each corner. `auto` walks round the corners against burn-in. */
export const OVERLAY_CORNER_LABELS: Record<OverlayCorner, string> = {
  'auto': 'Moving',
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
}

/** Whether the editor shows a corner choice out of reach: there is nothing to place when what it places is off. The time's corner is still the weather's when the time is off. */
export function paneCornerDisabled(key: PaneCornerKey, options: ResolvedPaneOptions): boolean {
  return key === 'time_corner' ? !options.show_time && !options.show_weather : !options.show_date
}

/** A copy that shares nothing with the original, so an edit can't reach back into it. */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** The record without `key`. */
const withoutKey = <K extends string, T extends Partial<Record<K, unknown>>>(record: T, key: K): T =>
  Object.fromEntries(Object.entries(record).filter(([name]) => name !== key)) as T

const clamp = (size: number): number => Math.min(MAX_LAYOUT_SIZE, Math.max(MIN_LAYOUT_SIZE, size))

/** The same input with one arrangement replaced. */
function withArrangement(input: CustomLayoutInput, which: Orientation, arrangement: LayoutArrangement): CustomLayoutInput {
  return { ...input, [which]: arrangement }
}

/** What a new layout starts as: a week beside an agenda, with the portrait arrangement made from it. */
export function newLayoutInput(name = ''): CustomLayoutInput {
  const landscape: LayoutArrangement = { rows: [{ size: 1, panes: [{ component: 'week', size: 3 }, { component: 'agenda', size: 2 }] }] }
  return { name, landscape, portrait: transposeArrangement(landscape), options: {} }
}

/** What the editor edits of a saved layout: everything the server accepts back. */
export function inputOf(layout: CustomLayout): CustomLayoutInput {
  return copy({ name: layout.name, landscape: layout.landscape, portrait: layout.portrait, options: layout.options })
}

/** Whether two inputs are the same, for knowing if there is anything to save. */
export function sameInput(a: CustomLayoutInput, b: CustomLayoutInput): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Where `component` is in the arrangement, or null if it is not there. */
export function findPane(arrangement: LayoutArrangement, component: LayoutComponent): PaneAt | null {
  for (const [row, { panes }] of arrangement.rows.entries()) {
    const pane = panes.findIndex(candidate => candidate.component === component)
    if (pane !== -1) return { row, pane }
  }
  return null
}

/** The components the input shows. Both arrangements hold the same ones. */
export function componentsOf(input: CustomLayoutInput): LayoutComponent[] {
  const used = new Set(input.landscape.rows.flatMap(row => row.panes.map(pane => pane.component)))
  return LAYOUT_COMPONENTS.filter(component => used.has(component))
}

/** A new pane for `component`: the day grid and the star chart start with their defaults, turned on its side in portrait like a transposed arrangement. */
function newPane(which: Orientation, component: LayoutComponent): LayoutPane {
  const pane: LayoutPane = { component, size: MIN_LAYOUT_SIZE }
  if (component === 'days') {
    const { rows, columns, start } = DEFAULT_DAY_GRID
    pane.grid = which === 'landscape' ? { rows, columns, start } : { rows: columns, columns: rows, start }
  }
  if (component === 'stars') {
    const { rows, columns } = DEFAULT_STAR_GRID
    pane.star_grid = which === 'landscape' ? { rows, columns } : { rows: columns, columns: rows }
  }
  return pane
}

/**
 * Puts a component in, or takes it out of, both arrangements. A new one goes at
 * the end of the last row, or in a row of its own below if that row is full.
 * Taking one out drops a row it leaves empty. The last component cannot be
 * taken out: a layout must show something.
 */
export function toggleComponent(input: CustomLayoutInput, component: LayoutComponent, on: boolean): CustomLayoutInput {
  const present = componentsOf(input)
  if (on === present.includes(component)) return input
  if (!on && present.length === 1) return input
  const next = copy(input)
  for (const which of ['landscape', 'portrait'] as const) {
    const { rows } = next[which]
    if (on) {
      const last = rows.at(-1)!
      if (last.panes.length < MAX_LAYOUT_PANES_PER_ROW) last.panes.push(newPane(which, component))
      else if (rows.length < MAX_LAYOUT_ROWS) rows.push({ size: MIN_LAYOUT_SIZE, panes: [newPane(which, component)] })
      else return input
    } else {
      for (const row of rows) row.panes = row.panes.filter(pane => pane.component !== component)
      next[which].rows = rows.filter(row => row.panes.length > 0)
    }
  }
  if (!on) next.options = withoutKey(next.options, component)
  return next
}

/**
 * Moves a pane one step. Left and right swap it with its neighbour in the row.
 * Up and down move it to the end of the row above or below; at the top or the
 * bottom they give it a new row there, if the pane has company in its row (a
 * pane alone already is a row) and there is room for another row. A row the move
 * empties is dropped, and a full row takes nothing more.
 */
export function movePane(input: CustomLayoutInput, which: Orientation, from: PaneAt, direction: MoveDirection): CustomLayoutInput {
  const rows = copy(input[which].rows)
  const row = rows[from.row]
  const pane = row?.panes[from.pane]
  if (!row || !pane) return input

  if (direction === 'left' || direction === 'right') {
    const to = from.pane + (direction === 'left' ? -1 : 1)
    const other = row.panes[to]
    if (!other) return input
    row.panes[to] = pane
    row.panes[from.pane] = other
    return withArrangement(input, which, { rows })
  }

  const step = direction === 'up' ? -1 : 1
  const target = rows[from.row + step]
  if (target) {
    if (target.panes.length >= MAX_LAYOUT_PANES_PER_ROW) return input
    row.panes.splice(from.pane, 1)
    target.panes.push(pane)
  } else {
    if (row.panes.length < 2 || rows.length >= MAX_LAYOUT_ROWS) return input
    row.panes.splice(from.pane, 1)
    const added = { size: MIN_LAYOUT_SIZE, panes: [pane] }
    if (step < 0) rows.unshift(added)
    else rows.push(added)
  }
  return withArrangement(input, which, { rows: rows.filter(candidate => candidate.panes.length > 0) })
}

/** Makes a pane wider (`delta` 1) or narrower (−1) against its row, within the allowed sizes. */
export function resizePane(input: CustomLayoutInput, which: Orientation, at: PaneAt, delta: 1 | -1): CustomLayoutInput {
  const pane = input[which].rows[at.row]?.panes[at.pane]
  if (!pane || clamp(pane.size + delta) === pane.size) return input
  const rows = copy(input[which].rows)
  rows[at.row]!.panes[at.pane]!.size = clamp(pane.size + delta)
  return withArrangement(input, which, { rows })
}

/** Makes a row taller (`delta` 1) or shorter (−1) against the other rows, within the allowed sizes. */
export function resizeRow(input: CustomLayoutInput, which: Orientation, row: number, delta: 1 | -1): CustomLayoutInput {
  const current = input[which].rows[row]
  if (!current || clamp(current.size + delta) === current.size) return input
  const rows = copy(input[which].rows)
  rows[row]!.size = clamp(current.size + delta)
  return withArrangement(input, which, { rows })
}

/** Swaps a row with the one above or below it. */
export function moveRow(input: CustomLayoutInput, which: Orientation, row: number, direction: 'up' | 'down'): CustomLayoutInput {
  const to = row + (direction === 'up' ? -1 : 1)
  const rows = copy(input[which].rows)
  if (!rows[row] || !rows[to]) return input
  ;[rows[row], rows[to]] = [rows[to]!, rows[row]!]
  return withArrangement(input, which, { rows })
}

/** The day grid of the pane at `at`, or null if it is not a day grid. */
export function paneGrid(input: CustomLayoutInput, which: Orientation, at: PaneAt): DayGrid | null {
  return input[which].rows[at.row]?.panes[at.pane]?.grid ?? null
}

/** Changes the day grid of the pane at `at` in one arrangement, handing back the same input when nothing would change. */
function withGrid(input: CustomLayoutInput, which: Orientation, at: PaneAt, change: (grid: DayGrid) => DayGrid): CustomLayoutInput {
  const current = paneGrid(input, which, at)
  if (!current) return input
  const next = change({ ...current })
  if (next.rows === current.rows && next.columns === current.columns && next.start === current.start) return input
  const rows = copy(input[which].rows)
  rows[at.row]!.panes[at.pane]!.grid = next
  return withArrangement(input, which, { rows })
}

/** Gives a day grid one more (`delta` 1) or one fewer (−1) row, within the limits. */
export function resizeGridRows(input: CustomLayoutInput, which: Orientation, at: PaneAt, delta: 1 | -1): CustomLayoutInput {
  return withGrid(input, which, at, grid => ({ ...grid, rows: Math.min(MAX_DAY_GRID_ROWS, Math.max(MIN_DAY_GRID_ROWS, grid.rows + delta)) }))
}

/** Gives a day grid one more (`delta` 1) or one fewer (−1) column, within the limits. */
export function resizeGridColumns(input: CustomLayoutInput, which: Orientation, at: PaneAt, delta: 1 | -1): CustomLayoutInput {
  return withGrid(input, which, at, grid => ({ ...grid, columns: Math.min(MAX_DAY_GRID_COLUMNS, Math.max(MIN_DAY_GRID_COLUMNS, grid.columns + delta)) }))
}

/** Sets where a day grid starts: today, or the first day of the week. */
export function setGridStart(input: CustomLayoutInput, which: Orientation, at: PaneAt, start: DayGridStart): CustomLayoutInput {
  return withGrid(input, which, at, grid => ({ ...grid, start }))
}

/** The star chart grid of the pane at `at`, or null if it is not a star chart. */
export function paneStarGrid(input: CustomLayoutInput, which: Orientation, at: PaneAt): StarGrid | null {
  return input[which].rows[at.row]?.panes[at.pane]?.star_grid ?? null
}

/** Changes the star grid of the pane at `at` in one arrangement, handing back the same input when nothing would change. */
function withStarGrid(input: CustomLayoutInput, which: Orientation, at: PaneAt, change: (grid: StarGrid) => StarGrid): CustomLayoutInput {
  const current = paneStarGrid(input, which, at)
  if (!current) return input
  const next = change({ ...current })
  if (next.rows === current.rows && next.columns === current.columns) return input
  const rows = copy(input[which].rows)
  rows[at.row]!.panes[at.pane]!.star_grid = next
  return withArrangement(input, which, { rows })
}

/** Gives a star chart one more (`delta` 1) or one fewer (−1) row of people, within the limits. */
export function resizeStarGridRows(input: CustomLayoutInput, which: Orientation, at: PaneAt, delta: 1 | -1): CustomLayoutInput {
  return withStarGrid(input, which, at, grid => ({ ...grid, rows: Math.min(MAX_STAR_GRID_ROWS, Math.max(MIN_STAR_GRID_ROWS, grid.rows + delta)) }))
}

/** Gives a star chart one more (`delta` 1) or one fewer (−1) column of people, within the limits. */
export function resizeStarGridColumns(input: CustomLayoutInput, which: Orientation, at: PaneAt, delta: 1 | -1): CustomLayoutInput {
  return withStarGrid(input, which, at, grid => ({ ...grid, columns: Math.min(MAX_STAR_GRID_COLUMNS, Math.max(MIN_STAR_GRID_COLUMNS, grid.columns + delta)) }))
}

/**
 * Sets one option of a component's pane. Only what differs from the default is
 * kept, so setting a key back to its default drops it, and a component left
 * with nothing set drops its entry. An option that does not apply to the
 * component, or a component the input does not show, changes nothing.
 */
export function setPaneOption(input: CustomLayoutInput, component: LayoutComponent, key: PaneOptionKey, value: boolean): CustomLayoutInput {
  if (!PANE_OPTIONS[component].includes(key) || !componentsOf(input).includes(component)) return input
  const current = input.options[component] ?? {}
  if ((current[key] ?? DEFAULT_PANE_OPTIONS[key]) === value) return input
  const set: PaneOptions = value === DEFAULT_PANE_OPTIONS[key] ? withoutKey(current, key) : { ...current, [key]: value }
  const options = Object.keys(set).length > 0 ? { ...input.options, [component]: set } : withoutKey(input.options, component)
  return { ...input, options }
}

/**
 * Sets where one of a component's overlays sits, as `setPaneOption` does for an
 * on-or-off option: only a corner that differs from the default is kept, and an
 * option that does not apply, or a component the input does not show, changes
 * nothing.
 */
export function setPaneCorner(input: CustomLayoutInput, component: LayoutComponent, key: PaneCornerKey, value: OverlayCorner): CustomLayoutInput {
  if (!PANE_CORNERS[component].includes(key) || !componentsOf(input).includes(component)) return input
  const current = input.options[component] ?? {}
  if ((current[key] ?? DEFAULT_PANE_OPTIONS[key]) === value) return input
  const set: PaneOptions = value === DEFAULT_PANE_OPTIONS[key] ? withoutKey(current, key) : { ...current, [key]: value }
  const options = Object.keys(set).length > 0 ? { ...input.options, [component]: set } : withoutKey(input.options, component)
  return { ...input, options }
}

/** Throws away the portrait arrangement and makes it again from the landscape one. */
export function resetPortrait(input: CustomLayoutInput): CustomLayoutInput {
  return { ...input, portrait: transposeArrangement(copy(input.landscape)) }
}

/** One thing wrong with the input, for showing beside the field. `path` is dotted, like the server's, such as `landscape.rows.0.size`. */
export interface EditorError {
  path: string
  message: string
}

/** What is wrong with the input, as the server would find it. Empty when it can be saved. */
export function editorErrors(input: CustomLayoutInput): EditorError[] {
  const parsed = customLayoutInputSchema.safeParse(input)
  if (parsed.success) return []
  return parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }))
}
