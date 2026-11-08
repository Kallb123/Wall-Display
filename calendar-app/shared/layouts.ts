import { z } from 'zod'
import { WEEK_VIEWS, layoutIdSchema, showsPhotos } from './display'
import type { View } from './display'

// Custom layouts (PR 5.17): the view components a user arranges into rows and
// panes, kept in a shared library and shown by the `custom` view. This is the
// model and the pure helpers around it. Every layout holds two arrangements,
// one for a landscape wall and one for a portrait wall, edited independently.
// Pure: no I/O, no Vue, so the server, the display and the editors share it.

export { LAYOUT_ID_PATTERN, layoutIdSchema } from './display'

/**
 * The components a layout can place. Each at most once per layout. Most are
 * also a `View` of their own, but `days` (the day grid) is a layout component
 * only: it has no view to choose, and exists only inside a custom layout.
 */
export const LAYOUT_COMPONENTS = ['month', 'week', 'week_parts', 'agenda', 'days', 'photo'] as const
export type LayoutComponent = (typeof LAYOUT_COMPONENTS)[number]

/** The first tile of a day grid: today, or the first day of the week that today is in (the display's `week_start`). */
export const DAY_GRID_STARTS = ['today', 'week'] as const
export type DayGridStart = (typeof DAY_GRID_STARTS)[number]

/** The most and the fewest rows and columns of tiles in a day grid. */
export const MIN_DAY_GRID_ROWS = 1
export const MAX_DAY_GRID_ROWS = 6
export const MIN_DAY_GRID_COLUMNS = 1
export const MAX_DAY_GRID_COLUMNS = 7

/** The grid of day tiles that a `days` pane draws: one consecutive day per tile, left to right then top to bottom. */
export interface DayGrid {
  rows: number
  columns: number
  start: DayGridStart
}

/** What a day grid pane starts with when the editor adds one. */
export const DEFAULT_DAY_GRID: DayGrid = { rows: 2, columns: 4, start: 'today' }

/** The most rows an arrangement may have, and the most panes in one row. */
export const MAX_LAYOUT_ROWS = 4
export const MAX_LAYOUT_PANES_PER_ROW = 4
/** A row's or a pane's `size` is a relative weight, a whole number in this range. */
export const MIN_LAYOUT_SIZE = 1
export const MAX_LAYOUT_SIZE = 4
/** The longest a layout's name may be. */
export const MAX_LAYOUT_NAME = 60

/** One view component in a row. `size` is its share of the row's width, against its neighbours. */
export interface LayoutPane {
  component: LayoutComponent
  size: number
  /** The day grid's rows, columns and first tile. Required on a `days` pane and not allowed on any other. */
  grid?: DayGrid
}

/** A row of panes. `size` is its share of the stage's height, against the other rows. */
export interface LayoutRow {
  size: number
  panes: LayoutPane[]
}

/** The rows of one orientation, top to bottom. */
export interface LayoutArrangement {
  rows: LayoutRow[]
}

/**
 * The style choices a pane can have, beyond where it is: hide the title (the
 * date heading of the month, week and week by part of day), the month's sidebar
 * or the week's hour labels, colour a whole event with its person's colour, and
 * let long titles wrap onto more lines where there is room. Not every option
 * means something to every component (`PANE_OPTIONS`).
 */
export const PANE_OPTION_KEYS = ['show_title', 'show_sidebar', 'show_hours', 'fill_events', 'wrap_titles'] as const
export type PaneOptionKey = (typeof PANE_OPTION_KEYS)[number]

/** The options set on a pane. A key that is left out has its default (`DEFAULT_PANE_OPTIONS`). */
export type PaneOptions = Partial<Record<PaneOptionKey, boolean>>

/** The options a view draws by: every key present. */
export type ResolvedPaneOptions = Record<PaneOptionKey, boolean>

/** What a pane looks like when nothing is set, and what every full-screen view uses. */
export const DEFAULT_PANE_OPTIONS: ResolvedPaneOptions = {
  show_title: true,
  show_sidebar: true,
  show_hours: true,
  fill_events: false,
  wrap_titles: false,
}

/** Which options apply to which component. The editor offers these and the schema refuses any other. */
export const PANE_OPTIONS: Record<LayoutComponent, readonly PaneOptionKey[]> = {
  month: ['show_title', 'show_sidebar', 'fill_events', 'wrap_titles'],
  week: ['show_title', 'show_hours'],
  week_parts: ['show_title', 'fill_events', 'wrap_titles'],
  agenda: ['fill_events', 'wrap_titles'],
  days: ['fill_events', 'wrap_titles'],
  photo: [],
}

/** The options of a layout, by component. They are shared by both arrangements: they are style, where a day grid's shape is geometry. */
export type LayoutOptions = Partial<Record<LayoutComponent, PaneOptions>>

/** What the editor sends as the body of a create or an edit. */
export interface CustomLayoutInput {
  name: string
  landscape: LayoutArrangement
  portrait: LayoutArrangement
  /** Only the options that differ from the defaults are kept. A body without it means none. */
  options: LayoutOptions
}

/** A layout as stored and served. */
export interface CustomLayout extends CustomLayoutInput {
  id: string
  /** ISO 8601 instants. */
  created_at: string
  updated_at: string
}

/** What the control service needs to know of a layout: which one it is, and what it shows. */
export interface LayoutSummary {
  id: string
  name: string
  components: LayoutComponent[]
}

const size = z.number()
  .int('must be a whole number')
  .min(MIN_LAYOUT_SIZE, `must be from ${MIN_LAYOUT_SIZE} to ${MAX_LAYOUT_SIZE}`)
  .max(MAX_LAYOUT_SIZE, `must be from ${MIN_LAYOUT_SIZE} to ${MAX_LAYOUT_SIZE}`)

const gridCount = (min: number, max: number) => z.number()
  .int('must be a whole number')
  .min(min, `must be from ${min} to ${max}`)
  .max(max, `must be from ${min} to ${max}`)

const gridSchema = z.strictObject({
  rows: gridCount(MIN_DAY_GRID_ROWS, MAX_DAY_GRID_ROWS),
  columns: gridCount(MIN_DAY_GRID_COLUMNS, MAX_DAY_GRID_COLUMNS),
  start: z.enum(DAY_GRID_STARTS, { error: `must be ${DAY_GRID_STARTS.join(' or ')}` }),
})

const paneSchema = z.strictObject({
  component: z.enum(LAYOUT_COMPONENTS, { error: `must be ${LAYOUT_COMPONENTS.slice(0, -1).join(', ')} or ${LAYOUT_COMPONENTS.at(-1)}` }),
  size,
  grid: gridSchema.optional(),
})

const rowSchema = z.strictObject({
  size,
  panes: z.array(paneSchema)
    .min(1, 'must have at least one pane')
    .max(MAX_LAYOUT_PANES_PER_ROW, `must have at most ${MAX_LAYOUT_PANES_PER_ROW} panes`),
})

const arrangementSchema = z.strictObject({
  rows: z.array(rowSchema)
    .min(1, 'must have at least one row')
    .max(MAX_LAYOUT_ROWS, `must have at most ${MAX_LAYOUT_ROWS} rows`),
})

const nameSchema = z.string().trim().min(1, 'must not be empty').max(MAX_LAYOUT_NAME, `must be at most ${MAX_LAYOUT_NAME} characters`)

const optionFlag = z.boolean({ error: 'must be true or false' }).optional()

const paneOptionsSchema = z.strictObject({
  show_title: optionFlag,
  show_sidebar: optionFlag,
  show_hours: optionFlag,
  fill_events: optionFlag,
  wrap_titles: optionFlag,
})

const optionsSchema = z.strictObject({
  month: paneOptionsSchema.optional(),
  week: paneOptionsSchema.optional(),
  week_parts: paneOptionsSchema.optional(),
  agenda: paneOptionsSchema.optional(),
  days: paneOptionsSchema.optional(),
  photo: paneOptionsSchema.optional(),
})

const inputShape = {
  name: nameSchema,
  landscape: arrangementSchema,
  portrait: arrangementSchema,
  // Optional in what is sent, so a client from before the options still works; always there once parsed.
  options: optionsSchema.default({}),
}

/** Every component of an arrangement, in the order they are drawn (rows top to bottom, panes left to right). */
function panesOf(arrangement: LayoutArrangement): LayoutPane[] {
  return arrangement.rows.flatMap(row => row.panes)
}

/** The rules that cut across fields: no component twice in an arrangement, the same components in both, a grid on the day grid pane only, and options only where they apply. */
function checkArrangements(value: CustomLayoutInput, ctx: z.RefinementCtx): void {
  const sets = {} as Record<'landscape' | 'portrait', Set<LayoutComponent>>
  for (const which of ['landscape', 'portrait'] as const) {
    const seen = new Set<LayoutComponent>()
    value[which].rows.forEach((row, r) => row.panes.forEach((pane, p) => {
      if (seen.has(pane.component)) {
        ctx.addIssue({ code: 'custom', path: [which, 'rows', r, 'panes', p, 'component'], message: `must not be used twice (${pane.component} is already in the ${which} arrangement)` })
      }
      seen.add(pane.component)
      if (pane.component === 'days' && !pane.grid) {
        ctx.addIssue({ code: 'custom', path: [which, 'rows', r, 'panes', p, 'grid'], message: 'must have a grid (rows, columns and start) on a days pane' })
      }
      if (pane.component !== 'days' && pane.grid) {
        ctx.addIssue({ code: 'custom', path: [which, 'rows', r, 'panes', p, 'grid'], message: `must not be set on a ${pane.component} pane, only on a days pane` })
      }
    }))
    sets[which] = seen
  }
  const missing = LAYOUT_COMPONENTS.filter(component => sets.landscape.has(component) !== sets.portrait.has(component))
  if (missing.length > 0) {
    ctx.addIssue({ code: 'custom', path: ['portrait'], message: `must show the same components as landscape (they differ on ${missing.join(', ')})` })
  }
  for (const component of LAYOUT_COMPONENTS) {
    const set = value.options[component]
    if (!set) continue
    if (!sets.landscape.has(component)) {
      ctx.addIssue({ code: 'custom', path: ['options', component], message: `must not be set when the layout does not show a ${component} pane` })
      continue
    }
    for (const key of PANE_OPTION_KEYS) {
      if (set[key] !== undefined && !PANE_OPTIONS[component].includes(key)) {
        ctx.addIssue({ code: 'custom', path: ['options', component, key], message: `must not be set on a ${component} pane` })
      }
    }
  }
}

/**
 * The body of a create or an edit. Strict, so a typo is rejected. Both
 * arrangements must hold exactly the same components, each once, because the
 * server decides things like "does this layout show a week?" without knowing
 * which way up the device is.
 */
export const customLayoutInputSchema = z.strictObject(inputShape).superRefine(checkArrangements)

/** A layout as the server stores and serves it: the input, its id and when it was made and last changed. */
export const customLayoutSchema = z.strictObject({
  id: layoutIdSchema,
  ...inputShape,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
}).superRefine(checkArrangements)

/** The options `component` is drawn with in `layout`: the defaults, with what the layout sets over them. */
export function paneOptions(layout: Pick<CustomLayoutInput, 'options'> | null | undefined, component: LayoutComponent): ResolvedPaneOptions {
  return { ...DEFAULT_PANE_OPTIONS, ...layout?.options?.[component] }
}

/** The components in a layout or an arrangement, in `LAYOUT_COMPONENTS` order and without repeats. */
export function layoutComponents(layout: CustomLayoutInput | LayoutArrangement): LayoutComponent[] {
  const panes = 'rows' in layout ? panesOf(layout) : [...panesOf(layout.landscape), ...panesOf(layout.portrait)]
  const used = new Set(panes.map(pane => pane.component))
  return LAYOUT_COMPONENTS.filter(component => used.has(component))
}

/** Every day grid in a layout or an arrangement, in the order the panes are drawn (landscape's first, for a whole layout). */
export function layoutDayGrids(layout: CustomLayoutInput | LayoutArrangement): DayGrid[] {
  const panes = 'rows' in layout ? panesOf(layout) : [...panesOf(layout.landscape), ...panesOf(layout.portrait)]
  return panes.flatMap(pane => pane.component === 'days' && pane.grid ? [pane.grid] : [])
}

/** What the control service and the clients' view helpers need of a layout. Cheap, so call it where it is needed. */
export function layoutSummary(layout: CustomLayoutInput & { id: string }): LayoutSummary {
  return { id: layout.id, name: layout.name, components: layoutComponents(layout) }
}

/** Anything that knows its components: a summary, or a whole layout through `layoutSummary`. */
type HasComponents = Pick<LayoutSummary, 'components'>

export const layoutHas = (layout: HasComponents, component: LayoutComponent): boolean => layout.components.includes(component)

/** Whether the layout shows a week: the week or the week by part of day. */
export const layoutShowsWeek = (layout: HasComponents): boolean => layoutHas(layout, 'week') || layoutHas(layout, 'week_parts')
export const layoutShowsMonth = (layout: HasComponents): boolean => layoutHas(layout, 'month')
export const layoutShowsPhotos = (layout: HasComponents): boolean => layoutHas(layout, 'photo')
/** Whether the layout shows any calendar component, which is what a special day's takeover changes. */
export const layoutShowsCalendar = (layout: HasComponents): boolean => LAYOUT_COMPONENTS.some(component => component !== 'photo' && layoutHas(layout, component))

/** Whether `view` shows photos: the built-in ones, or a custom layout with a photo pane. */
export const viewShowsPhotos = (view: View, layout: HasComponents | null | undefined): boolean =>
  showsPhotos(view) || (view === 'custom' && !!layout && layoutShowsPhotos(layout))

/** Whether `view` shows one week, so it follows the pinned week: a week view, or a custom layout with a week. */
export const viewShowsWeek = (view: View, layout: HasComponents | null | undefined): boolean =>
  (WEEK_VIEWS as readonly View[]).includes(view) || (view === 'custom' && !!layout && layoutShowsWeek(layout))

/** Whether `view` shows a month, so it follows the pinned month: the month view, or a custom layout with a month. */
export const viewShowsMonth = (view: View, layout: HasComponents | null | undefined): boolean =>
  view === 'month' || (view === 'custom' && !!layout && layoutShowsMonth(layout))

/** A pane carried to the other orientation with a new `size`. A day grid turns with it, so its rows and columns swap and its start is kept. */
function turnedPane(pane: LayoutPane, size: number): LayoutPane {
  const turned: LayoutPane = { component: pane.component, size }
  if (pane.grid) turned.grid = { rows: pane.grid.columns, columns: pane.grid.rows, start: pane.grid.start }
  return turned
}

/**
 * The portrait arrangement a new layout starts from: the landscape one turned
 * on its side, so rows become columns and `[photo | week]` becomes the photo
 * above the week, which is what the week and photo view does. A single row of
 * panes becomes a column of rows, and a column of rows becomes one row. A true
 * grid takes its j-th pane of every row as the j-th portrait row (that row is as
 * tall as the largest of them, and each pane is as wide as its old row was
 * tall). Always valid, with the same components.
 */
export function transposeArrangement(arrangement: LayoutArrangement): LayoutArrangement {
  const { rows } = arrangement
  if (rows.length === 1) {
    return { rows: rows[0]!.panes.map(pane => ({ size: pane.size, panes: [turnedPane(pane, MIN_LAYOUT_SIZE)] })) }
  }
  if (rows.every(row => row.panes.length === 1)) {
    return { rows: [{ size: MIN_LAYOUT_SIZE, panes: rows.map(row => turnedPane(row.panes[0]!, row.size)) }] }
  }
  const columns = Math.max(...rows.map(row => row.panes.length))
  const turned: LayoutRow[] = []
  for (let j = 0; j < columns; j++) {
    const panes: LayoutPane[] = []
    let tallest = MIN_LAYOUT_SIZE
    for (const row of rows) {
      const pane = row.panes[j]
      if (!pane) continue
      panes.push(turnedPane(pane, row.size))
      tallest = Math.max(tallest, pane.size)
    }
    turned.push({ size: tallest, panes })
  }
  return { rows: turned }
}
