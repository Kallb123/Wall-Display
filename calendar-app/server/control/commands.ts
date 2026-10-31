import { addMonths, currentMonth, displayStateSchema, MONTH_RANGE, monthDiff, NEXT_VIEW_ORDER } from '../../shared/display'
import type { Command, DisplayState, MonthKey, View } from '../../shared/display'

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
}

const MINUTE_MS = 60_000

export function defaultDisplayState(): DisplayState {
  return displayStateSchema.parse({})
}

/** The first of the views `next_view` steps through that follows `view`, wrapping round. */
function viewAfter(view: View): View {
  const index = (NEXT_VIEW_ORDER as readonly View[]).indexOf(view)
  return NEXT_VIEW_ORDER[(index + 1) % NEXT_VIEW_ORDER.length]!
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
  const current = currentMonth(ctx.now, ctx.timeZone)
  const target = targetMonth(state, month, current)
  const clamped = addMonths(current, Math.max(-MONTH_RANGE, Math.min(MONTH_RANGE, monthDiff(current, target))))
  // A month only means something in the month view, so asking for one shows it.
  // Every pick of another month restarts the return clock, even the same one again: someone is browsing.
  return clamped === current
    ? { ...state, view: 'month', month: null, month_set_at: null }
    : { ...state, view: 'month', month: clamped, month_set_at: ctx.now.toISOString() }
}

/**
 * The state after `command`. Always finishes with `expireState`, so the rules
 * below hold whatever the command did: leaving the month view, for instance,
 * drops the pinned month. `photo_next` and `refresh` change nothing here; the
 * service carries them out.
 */
export function reduceCommand(state: DisplayState, command: Command, ctx: ControlContext): DisplayState {
  return expireState(rememberView(state, apply(state, command, ctx)), ctx)
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

function apply(state: DisplayState, command: Command, ctx: ControlContext): DisplayState {
  switch (command.type) {
    case 'set_view': return { ...state, view: command.view }
    case 'next_view': return { ...state, view: viewAfter(state.view) }
    case 'toggle_photo': return { ...state, view: state.view === 'photo' ? state.last_calendar_view : 'photo' }
    case 'set_month': return setMonth(state, command.month, ctx)
    case 'set_screen': return { ...state, screen: command.screen }
    case 'set_brightness': return { ...state, brightness: command.brightness }
    case 'set_photo_source': return { ...state, photo_source: command.photo_source }
    case 'set_auto_presence': return { ...state, auto_presence: command.auto_presence }
    case 'set_auto_brightness': return { ...state, auto_brightness: command.auto_brightness }
    case 'set_overlay': {
      const { overlay } = command
      if (overlay === null) return { ...state, overlay: null }
      const until = overlay.ttl === undefined ? null : new Date(ctx.now.getTime() + overlay.ttl * 1000).toISOString()
      return { ...state, overlay: { text: overlay.text, icon: overlay.icon ?? null, until } }
    }
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

/** When the pinned month goes back to following the current one, or null if nothing is pinned. */
function monthReturnsAt(state: DisplayState, ctx: ControlContext): Date | null {
  if (state.month === null || state.month_set_at === null) return null
  return new Date(Date.parse(state.month_set_at) + ctx.monthReturnMinutes * MINUTE_MS)
}

/**
 * Applies the rules that depend on time and on the view:
 * - a pinned month goes when the view is not `month`, after `month_return_minutes`,
 *   when it has become the current month (the calendar rolled over) and when it
 *   has fallen out of the 12-month range;
 * - an overlay goes at its `until`;
 * - a special day preview goes at its `until`.
 *
 * Returns the same object when nothing changed, so a caller can skip a write.
 */
export function expireState(state: DisplayState, ctx: ControlContext): DisplayState {
  let next = state

  if (state.month === null) {
    if (state.month_set_at !== null) next = { ...next, month_set_at: null }
  } else {
    const returnsAt = monthReturnsAt(state, ctx)
    const current = currentMonth(ctx.now, ctx.timeZone)
    const stale = state.view !== 'month'
      // Without a time to count from, nothing would ever send it back.
      || returnsAt === null
      || ctx.now.getTime() >= returnsAt.getTime()
      || state.month === current
      || Math.abs(monthDiff(current, state.month)) > MONTH_RANGE
    if (stale) next = { ...next, month: null, month_set_at: null }
  }

  if (state.overlay?.until != null && ctx.now.getTime() >= Date.parse(state.overlay.until)) {
    next = { ...next, overlay: null }
  }

  if (state.preview !== null && ctx.now.getTime() >= Date.parse(state.preview.until)) {
    next = { ...next, preview: null }
  }

  return next
}

/**
 * When `expireState` will next change something, or null if it won't without
 * a command. The midnight rollover is left out: a pinned month goes back
 * within `month_return_minutes` anyway, and every read runs `expireState`.
 */
export function nextExpiry(state: DisplayState, ctx: ControlContext): Date | null {
  const times: number[] = []
  const returnsAt = monthReturnsAt(state, ctx)
  if (returnsAt !== null) times.push(returnsAt.getTime())
  if (state.overlay?.until != null) times.push(Date.parse(state.overlay.until))
  if (state.preview !== null) times.push(Date.parse(state.preview.until))
  return times.length === 0 ? null : new Date(Math.min(...times))
}
