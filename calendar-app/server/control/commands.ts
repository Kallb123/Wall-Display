import { addMonths, addWeeks, currentMonth, currentWeek, displayStateSchema, firstDayOfWeek, MONTH_RANGE, monthDiff, NEXT_VIEW_ORDER, showsPhotos, WEEK_RANGE, weekDiff } from '../../shared/display'
import type { CameraSummary, Command, DisplayState, MonthKey, View, WeekKey } from '../../shared/display'
import { layoutShowsPhotos, viewShowsMonth, viewShowsWeek } from '../../shared/layouts'
import type { LayoutSummary } from '../../shared/layouts'

/**
 * The commands only the schedule policy sends (PR 5.4): a schedule window
 * starting or ending. They are not in `commandSchema`, so neither the HTTP API
 * nor MQTT can send them. `rule` is the rule's index in the schedule's `rules`.
 */
export type ScheduleCommand =
  | { type: 'schedule_start', schedule: string, rule: number, view: View, layout?: string }
  | { type: 'schedule_end', schedule: string, rule: number }

/** Every command the control service applies: the public ones, and the schedule policy's. */
export type ControlCommand = Command | ScheduleCommand

// What each command does to a display's state, and the rules that change it
// with the passing of time (architecture §7.1). Pure: no I/O and no timers.
// The clock comes in through the context, so a test sets it. The service
// (service.ts) stores the result, broadcasts it and runs the timer.

export interface ControlContext {
  now: Date
  /** The display time zone, which decides what the current month is. */
  timeZone: string
  /** The display's `month_return_minutes`. */
  monthReturnMinutes: number
  /** The display's `week_start`, which decides the first day of a week. */
  weekStart: 'monday' | 'sunday'
  /** Whether a photo source is set up. Without one `next_view` skips the week and photo view, whose photo pane would be empty. */
  photosConfigured: boolean
  /** The custom layouts (PR 5.17), by name. What `set_layout` may name, and what `next_view` steps through after the built-in views. */
  layouts: readonly LayoutSummary[]
  /** The cameras in the config: what `set_camera` may name. Default: none. */
  cameras?: readonly CameraSummary[]
}

const MINUTE_MS = 60_000

export function defaultDisplayState(): DisplayState {
  return displayStateSchema.parse({})
}

/** The layout the display's `layout` field names, if it is still in the library. */
function layoutOf(state: Pick<DisplayState, 'layout'>, ctx: Pick<ControlContext, 'layouts'>): LayoutSummary | undefined {
  return state.layout === null ? undefined : ctx.layouts.find(layout => layout.id === state.layout)
}

/** One stop of `next_view`: a built-in view, or a custom layout. */
type Stop = { view: View, layout: null } | { view: 'custom', layout: LayoutSummary }

/**
 * Where `next_view` goes from the current view: the built-in order, then the
 * custom layouts by name, then round again. The views that show photos, and the
 * layouts with a photo pane, are left out when no photo source is set up.
 */
function viewAfter(state: DisplayState, ctx: ControlContext): Pick<DisplayState, 'view' | 'layout'> {
  const stops: Stop[] = [
    ...NEXT_VIEW_ORDER.map((view): Stop => ({ view, layout: null })),
    ...ctx.layouts.map((layout): Stop => ({ view: 'custom', layout })),
  ]
  const available = (stop: Stop): boolean => ctx.photosConfigured || !(stop.layout ? layoutShowsPhotos(stop.layout) : showsPhotos(stop.view))
  const index = stops.findIndex(stop => stop.layout ? state.view === 'custom' && stop.layout.id === state.layout : stop.view === state.view)
  // From a view outside the order the first view is next; from one that was left out (week_photo without photos) the one after it in the full order is.
  for (let step = 1; step <= stops.length; step++) {
    const stop = stops[(index + step) % stops.length]!
    if (available(stop)) return { view: stop.view, layout: stop.layout ? stop.layout.id : state.layout }
  }
  return { view: stops[0]!.view, layout: state.layout }
}

/** `set_view`. The custom view shows the layout the display last had if it is still there, else the first layout, and with no layouts at all it changes nothing. */
function setView(state: DisplayState, view: View, ctx: ControlContext): DisplayState {
  if (view !== 'custom') return { ...state, view }
  const layout = layoutOf(state, ctx) ?? ctx.layouts[0]
  return layout ? { ...state, view, layout: layout.id } : state
}

/** Where a `set_month` command points, before the clamp. */
function targetMonth(state: DisplayState, month: Extract<Command, { type: 'set_month' }>['month'], current: MonthKey): MonthKey {
  switch (month) {
    case 'current': return current
    case 'prev': return addMonths(state.month ?? current, -1)
    case 'next': return addMonths(state.month ?? current, 1)
    default: return month
  }
}

function setMonth(state: DisplayState, month: Extract<Command, { type: 'set_month' }>['month'], ctx: ControlContext): DisplayState {
  // A custom layout with a month in it follows the pinned month, so it stays up; any other view gives way to the month view.
  const view = viewShowsMonth(state.view, layoutOf(state, ctx)) ? state.view : 'month'
  const current = currentMonth(ctx.now, ctx.timeZone)
  const target = targetMonth(state, month, current)
  const clamped = addMonths(current, Math.max(-MONTH_RANGE, Math.min(MONTH_RANGE, monthDiff(current, target))))
  // A month only means something in a view that shows one, so asking for one shows it.
  // Every pick of another month restarts the return clock, even the same one again: someone is browsing.
  return clamped === current
    ? { ...state, view, month: null, month_set_at: null }
    : { ...state, view, month: clamped, month_set_at: ctx.now.toISOString() }
}

/** Where a `set_week` command points, before the clamp. */
function targetWeek(state: DisplayState, week: Extract<Command, { type: 'set_week' }>['week'], current: WeekKey, ctx: ControlContext): WeekKey {
  switch (week) {
    case 'current': return current
    case 'prev': return addWeeks(state.week ?? current, -1)
    case 'next': return addWeeks(state.week ?? current, 1)
    default: return firstDayOfWeek(week, ctx.weekStart)
  }
}

function setWeek(state: DisplayState, week: Extract<Command, { type: 'set_week' }>['week'], ctx: ControlContext): DisplayState {
  const current = currentWeek(ctx.now, ctx.timeZone, ctx.weekStart)
  const target = targetWeek(state, week, current, ctx)
  const clamped = addWeeks(current, Math.max(-WEEK_RANGE, Math.min(WEEK_RANGE, weekDiff(current, target))))
  // A week only means something in a week view, so asking for one shows it, unless a view that follows it is already up (a custom layout with a week counts).
  // Every pick restarts the return clock, even the same week again: someone is browsing.
  const view = viewShowsWeek(state.view, layoutOf(state, ctx)) ? state.view : 'week'
  return clamped === current
    ? { ...state, view, week: null, week_set_at: null }
    : { ...state, view, week: clamped, week_set_at: ctx.now.toISOString() }
}

/**
 * The state after `command`. Always finishes with `expireState`, so the rules
 * below hold whatever the command did: leaving the month view, for instance,
 * drops the pinned month. `photo_next` and `refresh` change nothing here; the
 * service carries them out.
 */
export function reduceCommand(state: DisplayState, command: ControlCommand, ctx: ControlContext): DisplayState {
  return expireState(releaseSchedule(rememberView(state, apply(state, command, ctx))), ctx)
}

/** Whether `window` still holds the wall: the view is the one it put there and, for a custom view, so is the layout. */
function holdsWall(state: DisplayState, window: NonNullable<DisplayState['schedule']>): boolean {
  return window.view === state.view && (window.view !== 'custom' || window.layout === state.layout)
}

/**
 * Drops the schedule window once it no longer holds the wall: the view (or, for
 * a custom view, the layout) is not the one it put there because someone, or a
 * policy, changed it, or its schedule has been turned off. Its end then changes
 * nothing, so a manual choice lasts until the next rule boundary. Done for
 * every command, like `rememberView`.
 */
function releaseSchedule(state: DisplayState): DisplayState {
  const window = state.schedule
  if (window === null) return state
  return !holdsWall(state, window) || state.schedules_off.includes(window.schedule) ? { ...state, schedule: null } : state
}

/**
 * A schedule window starting: the wall shows the rule's view (and, for a custom
 * view, its layout), and the window remembers where to go back to. A wall
 * already on that view and layout, with no window in charge, is left alone
 * (someone chose it) and nothing is remembered. When another window is still in
 * charge, the new one takes over its return view and layout, so overlapping or
 * back-to-back windows end on what was up before the first. A custom rule whose
 * layout is not in the library starts nothing.
 */
function startSchedule(state: DisplayState, command: Extract<ScheduleCommand, { type: 'schedule_start' }>, ctx: ControlContext): DisplayState {
  if (state.schedules_off.includes(command.schedule)) return state
  const layout = command.view === 'custom' ? (command.layout ?? null) : null
  if (command.view === 'custom' && !ctx.layouts.some(known => known.id === layout)) return state
  const held = state.schedule !== null && holdsWall(state, state.schedule) ? state.schedule : null
  if (held === null && state.view === command.view && (layout === null || state.layout === layout)) return state
  return {
    ...state,
    view: command.view,
    layout: layout ?? state.layout,
    schedule: { schedule: command.schedule, rule: command.rule, view: command.view, return_view: held?.return_view ?? state.view, layout, return_layout: held ? held.return_layout : state.layout },
  }
}

/** A schedule window ending: back to the view and layout from before it, but only if that window still holds the wall. */
function endSchedule(state: DisplayState, command: Extract<ScheduleCommand, { type: 'schedule_end' }>): DisplayState {
  const window = state.schedule
  if (window === null || window.schedule !== command.schedule || window.rule !== command.rule) return state
  return holdsWall(state, window) ? { ...state, view: window.return_view, layout: window.return_layout, schedule: null } : { ...state, schedule: null }
}

/** `schedules_off` with `id` added or removed, sorted so equal sets compare equal. */
function scheduleSwitched(off: readonly string[], id: string, on: boolean): string[] {
  const rest = off.filter(other => other !== id)
  return (on ? rest : [...rest, id]).sort()
}

/**
 * Keeps `last_calendar_view` as the view `toggle_photo` goes back to: whichever
 * view that isn't the photo frame the display was last on. Done for every
 * command, so it is right however the view changed (the remote, a button or
 * Home Assistant), and for a state stored before the field existed.
 */
function rememberView(before: DisplayState, after: DisplayState): DisplayState {
  const view = after.view !== 'photo' ? after.view : before.view !== 'photo' ? before.view : null
  return view === null || view === after.last_calendar_view ? after : { ...after, last_calendar_view: view }
}

function apply(state: DisplayState, command: ControlCommand, ctx: ControlContext): DisplayState {
  switch (command.type) {
    case 'set_view': return setView(state, command.view, ctx)
    case 'next_view': return { ...state, ...viewAfter(state, ctx) }
    case 'toggle_photo': return { ...state, view: state.view === 'photo' ? state.last_calendar_view : 'photo' }
    case 'set_month': return setMonth(state, command.month, ctx)
    case 'set_week': return setWeek(state, command.week, ctx)
    // Someone (or a policy) choosing the screen takes over from a camera that woke it: the camera going leaves the screen as it is.
    case 'set_screen': return { ...state, screen: command.screen, camera: state.camera?.restore_screen ? { ...state.camera, restore_screen: false } : state.camera }
    case 'set_brightness': return { ...state, brightness: command.brightness }
    case 'set_photo_source': return { ...state, photo_source: command.photo_source }
    case 'set_auto_presence': return { ...state, auto_presence: command.auto_presence }
    case 'set_auto_brightness': return { ...state, auto_brightness: command.auto_brightness }
    // Turning a schedule off leaves the wall as it is; `releaseSchedule` forgets its window.
    case 'set_schedule': return { ...state, schedules_off: scheduleSwitched(state.schedules_off, command.schedule, command.on) }
    // The service refuses an id that is not in the library before it gets here; if one does arrive, nothing changes.
    case 'set_layout': return ctx.layouts.some(layout => layout.id === command.layout) ? { ...state, view: 'custom', layout: command.layout } : state
    case 'schedule_start': return startSchedule(state, command, ctx)
    case 'schedule_end': return endSchedule(state, command)
    case 'set_overlay': {
      const { overlay } = command
      if (overlay === null) return { ...state, overlay: null }
      const until = overlay.ttl === undefined ? null : new Date(ctx.now.getTime() + overlay.ttl * 1000).toISOString()
      return { ...state, overlay: { text: overlay.text, icon: overlay.icon ?? null, until } }
    }
    case 'set_camera': return setCamera(state, command, ctx)
    case 'preview_special_day': {
      const until = new Date(ctx.now.getTime() + command.seconds * 1000).toISOString()
      // The schema makes sure exactly one of the two is there. A new preview replaces the one running.
      return { ...state, preview: command.id !== undefined ? { special_day: command.id, until } : { scene: command.scene!, until } }
    }
    case 'photo_next':
    case 'refresh':
      return state
  }
}

/**
 * `set_camera`. Showing a camera puts it up for `seconds` (a camera already up
 * is replaced, and its time starts again); with `wake` a screen that is off comes
 * on, and is remembered as the camera's to turn off again. Taking it down (null)
 * does what running out would. The service refuses an id that isn't in the
 * config; if one does arrive, nothing changes.
 */
function setCamera(state: DisplayState, command: Extract<Command, { type: 'set_camera' }>, ctx: ControlContext): DisplayState {
  if (command.camera === null) return closeCamera(state)
  const camera = ctx.cameras?.find(known => known.id === command.camera)
  if (!camera) return state
  const wakes = command.wake && state.screen === 'off'
  // A camera that replaces one which woke the screen inherits the job of turning it off again.
  const restore = wakes || (state.camera?.restore_screen === true && state.screen === 'on')
  return {
    ...state,
    screen: wakes ? 'on' : state.screen,
    camera: {
      id: camera.id,
      name: camera.name,
      url: camera.url,
      kind: camera.kind,
      until: new Date(ctx.now.getTime() + command.seconds * 1000).toISOString(),
      restore_screen: restore,
    },
  }
}

/** Takes the camera down, and turns the screen off again if the camera turned it on. A screen someone turned off meanwhile stays off. */
function closeCamera(state: DisplayState): DisplayState {
  if (state.camera === null) return state
  return { ...state, camera: null, screen: state.camera.restore_screen ? 'off' : state.screen }
}

/**
 * Forgets a `layout` that is not in the library any more, and puts the month view
 * in place of a custom view that has no layout to show. The schedule window goes
 * with it, as it no longer holds the wall.
 */
function dropDeadLayout(state: DisplayState, ctx: ControlContext): DisplayState {
  if (layoutOf(state, ctx) !== undefined) return state
  if (state.view !== 'custom' && state.layout === null) return state
  const next = state.view === 'custom' ? { ...state, view: 'month' as const, layout: null } : { ...state, layout: null }
  return releaseSchedule(next)
}

/** When the pinned month goes back to following the current one, or null if nothing is pinned. */
function monthReturnsAt(state: DisplayState, ctx: ControlContext): Date | null {
  if (state.month === null || state.month_set_at === null) return null
  return new Date(Date.parse(state.month_set_at) + ctx.monthReturnMinutes * MINUTE_MS)
}

/** When the pinned week goes back to following the current one, or null if nothing is pinned. One setting times both: how long a browsed month or week stays. */
function weekReturnsAt(state: DisplayState, ctx: ControlContext): Date | null {
  if (state.week === null || state.week_set_at === null) return null
  return new Date(Date.parse(state.week_set_at) + ctx.monthReturnMinutes * MINUTE_MS)
}

/**
 * Applies the rules that depend on time and on the view:
 * - a layout that is no longer in the library is forgotten, and a custom view
 *   showing it (or no layout at all) becomes the month view, so a deleted layout
 *   never leaves the wall blank, however the view came to be custom again;
 * - a pinned month goes when the view does not show a month (`month`, or a custom
 *   layout with a month in it), after `month_return_minutes`,
 *   when it has become the current month (the calendar rolled over) and when it
 *   has fallen out of the 12-month range;
 * - a pinned week goes when the view does not show a week, after
 *   `month_return_minutes` (one setting for months and weeks), when it has
 *   become the current week and when it is more than 52 weeks out; if the
 *   display's week start changed, it is moved to the first day of its week;
 * - an overlay goes at its `until`;
 * - a special day preview goes at its `until`;
 * - a camera goes at its `until`, turning the screen off again if it turned it on.
 *
 * Returns the same object when nothing changed, so a caller can skip a write.
 */
export function expireState(state: DisplayState, ctx: ControlContext): DisplayState {
  let next = dropDeadLayout(state, ctx)
  const layout = layoutOf(next, ctx)

  if (state.month === null) {
    if (state.month_set_at !== null) next = { ...next, month_set_at: null }
  } else {
    const returnsAt = monthReturnsAt(state, ctx)
    const current = currentMonth(ctx.now, ctx.timeZone)
    const stale = !viewShowsMonth(next.view, layout)
      // Without a time to count from, nothing would ever send it back.
      || returnsAt === null
      || ctx.now.getTime() >= returnsAt.getTime()
      || state.month === current
      || Math.abs(monthDiff(current, state.month)) > MONTH_RANGE
    if (stale) next = { ...next, month: null, month_set_at: null }
  }

  if (state.week === null) {
    if (state.week_set_at !== null) next = { ...next, week_set_at: null }
  } else {
    const returnsAt = weekReturnsAt(state, ctx)
    const current = currentWeek(ctx.now, ctx.timeZone, ctx.weekStart)
    // The week start is a setting that can change: keep the pin on a first day.
    const week = firstDayOfWeek(state.week, ctx.weekStart)
    const stale = !viewShowsWeek(next.view, layout)
      || returnsAt === null
      || ctx.now.getTime() >= returnsAt.getTime()
      || week === current
      || Math.abs(weekDiff(current, week)) > WEEK_RANGE
    if (stale) next = { ...next, week: null, week_set_at: null }
    else if (week !== state.week) next = { ...next, week }
  }

  if (state.overlay?.until != null && ctx.now.getTime() >= Date.parse(state.overlay.until)) {
    next = { ...next, overlay: null }
  }

  if (state.preview !== null && ctx.now.getTime() >= Date.parse(state.preview.until)) {
    next = { ...next, preview: null }
  }

  if (state.camera !== null && ctx.now.getTime() >= Date.parse(state.camera.until)) {
    next = closeCamera(next)
  }

  return next
}

/**
 * When `expireState` will next change something, or null if it won't without
 * a command. The midnight rollover is left out: a pinned month or week goes back
 * within `month_return_minutes` anyway, and every read runs `expireState`.
 */
export function nextExpiry(state: DisplayState, ctx: ControlContext): Date | null {
  const times: number[] = []
  const returnsAt = monthReturnsAt(state, ctx)
  if (returnsAt !== null) times.push(returnsAt.getTime())
  const weekReturns = weekReturnsAt(state, ctx)
  if (weekReturns !== null) times.push(weekReturns.getTime())
  if (state.overlay?.until != null) times.push(Date.parse(state.overlay.until))
  if (state.preview !== null) times.push(Date.parse(state.preview.until))
  if (state.camera !== null) times.push(Date.parse(state.camera.until))
  return times.length === 0 ? null : new Date(Math.min(...times))
}
