import type { ControlCommand } from './commands'
import type { ScheduleConfig, ScheduleRule } from '../config/schema'
import { WEEKDAYS } from '../config/schema'
import { wallTimeOf, zonedWallTimeToUtc } from '../sources/time'
import { MAX_TIMER_MS } from './service'
import type { DisplayControl } from './service'

// The built-in schedules policy (architecture §7.8): rules such as "agenda
// 06:30 to 09:00" or "photo frame 10:00 to 16:00 on weekdays", read on the wall
// clock of the config's time zone. It acts only at a window's start and end
// (edge-triggered), through the same control as a button press, so whatever
// someone chooses in between lasts until the next boundary. The reducer
// (commands.ts) holds the rules about who owns the view; this decides when a
// boundary is reached. Everything it touches is injected, so a test uses fake
// timers and a fake or real control.

/** The part of a schedule's config the policy reads. */
export type PolicySchedule = Pick<ScheduleConfig, 'id' | 'name'> & { rules: readonly Pick<ScheduleRule, 'view' | 'layout' | 'from' | 'to' | 'days'>[] }

type PolicyRule = PolicySchedule['rules'][number]

export interface Occurrence {
  start: Date
  end: Date
}

export interface Boundary {
  at: Date
  kind: 'start' | 'end'
  /** Index in the display's `schedules`, then in the schedule's `rules`: the config order that breaks ties. */
  scheduleIndex: number
  ruleIndex: number
}

/** How far ahead the next boundary is looked for. A rule recurs at least weekly, so a week and a day cover it. */
export const LOOKAHEAD_DAYS = 8

/** A late timer (or a clock that jumped) is caught up over this much at most, so a huge jump can't loop for ages. */
export const MAX_CATCH_UP_MS = 2 * 24 * 60 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

interface Day {
  year: number
  month: number
  day: number
}

function minutesOf(time: string): { hour: number, minute: number } {
  const [hour, minute] = time.split(':').map(Number)
  return { hour: hour!, minute: minute! }
}

/** The calendar day `offset` days from `day`, with the month and year carried. */
function shiftDay(day: Day, offset: number): Day {
  const moved = new Date(Date.UTC(day.year, day.month - 1, day.day + offset))
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() }
}

function weekdayOf(day: Day) {
  // getUTCDay is 0 for Sunday; WEEKDAYS starts on Monday.
  return WEEKDAYS[(new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay() + 6) % 7]!
}

function dayOf(instant: Date, timeZone: string): Day {
  const { year, month, day } = wallTimeOf(instant, timeZone)
  return { year, month, day }
}

/**
 * The window a rule opens on `day` (the day it starts on), or null if the
 * rule does not run that day, or the clocks make its end no later than its
 * start (possible only on a day they change). A rule with `from` after `to`
 * ends the next day, and `days` always names the day it starts. A wall time
 * the clocks skip moves forward by the gap, and one shown twice is the first.
 */
export function occurrenceOn(rule: PolicyRule, timeZone: string, day: Day): Occurrence | null {
  if (!rule.days.includes(weekdayOf(day))) return null
  const from = minutesOf(rule.from)
  const to = minutesOf(rule.to)
  const wraps = from.hour * 60 + from.minute > to.hour * 60 + to.minute
  const endDay = wraps ? shiftDay(day, 1) : day
  const start = zonedWallTimeToUtc({ ...day, hour: from.hour, minute: from.minute }, timeZone)
  const end = zonedWallTimeToUtc({ ...endDay, hour: to.hour, minute: to.minute }, timeZone)
  return end.getTime() > start.getTime() ? { start, end } : null
}

/** The windows a rule opens on the local days from `first` to `last`, both included. */
export function occurrencesBetweenDays(rule: PolicyRule, timeZone: string, first: Day, last: Day): Occurrence[] {
  const found: Occurrence[] = []
  const count = Math.round((Date.UTC(last.year, last.month - 1, last.day) - Date.UTC(first.year, first.month - 1, first.day)) / DAY_MS)
  for (let offset = 0; offset <= count; offset++) {
    const occurrence = occurrenceOn(rule, timeZone, shiftDay(first, offset))
    if (occurrence) found.push(occurrence)
  }
  return found
}

/** Whether one of the rule's windows is open at `instant` (its start included, its end not). */
export function ruleInProgress(rule: PolicyRule, timeZone: string, instant: Date): boolean {
  const today = dayOf(instant, timeZone)
  // A window that wraps past midnight started yesterday; the zone's offset can move a day either way, so a day more is looked at.
  return occurrencesBetweenDays(rule, timeZone, shiftDay(today, -2), shiftDay(today, 1))
    .some(occurrence => occurrence.start.getTime() <= instant.getTime() && instant.getTime() < occurrence.end.getTime())
}

/**
 * Every boundary of a display's schedules in the half-open interval
 * (`after`, `upTo`], by instant. At the same instant starts come before ends
 * (so back-to-back windows hand over directly), then config order.
 */
export function boundariesBetween(schedules: readonly PolicySchedule[], timeZone: string, after: Date, upTo: Date): Boundary[] {
  if (upTo.getTime() <= after.getTime()) return []
  // A window that began up to a day before `after` can end inside the interval, and the zone's offset can move a boundary across a date line.
  const first = shiftDay(dayOf(after, timeZone), -2)
  const last = shiftDay(dayOf(upTo, timeZone), 1)
  const found: Boundary[] = []
  schedules.forEach((schedule, scheduleIndex) => {
    schedule.rules.forEach((rule, ruleIndex) => {
      for (const { start, end } of occurrencesBetweenDays(rule, timeZone, first, last)) {
        if (start.getTime() > after.getTime() && start.getTime() <= upTo.getTime()) found.push({ at: start, kind: 'start', scheduleIndex, ruleIndex })
        if (end.getTime() > after.getTime() && end.getTime() <= upTo.getTime()) found.push({ at: end, kind: 'end', scheduleIndex, ruleIndex })
      }
    })
  })
  return found.sort((a, b) =>
    a.at.getTime() - b.at.getTime()
    || (a.kind === b.kind ? 0 : a.kind === 'start' ? -1 : 1)
    || a.scheduleIndex - b.scheduleIndex
    || a.ruleIndex - b.ruleIndex)
}

/** The first boundary after `instant` within the look-ahead, or null if the schedules have none. */
export function nextBoundaryAfter(schedules: readonly PolicySchedule[], timeZone: string, instant: Date): Boundary | null {
  return boundariesBetween(schedules, timeZone, instant, new Date(instant.getTime() + LOOKAHEAD_DAYS * DAY_MS))[0] ?? null
}

export interface SchedulePolicyOptions {
  /** Each display and its schedules. A display with none costs nothing. */
  displays: readonly { id: string, schedules: readonly PolicySchedule[] }[]
  timeZone: string
  control: Pick<DisplayControl, 'getState' | 'applyCommand'>
  /** The ids of the custom layouts there are now (PR 5.17), asked when a window starts, because the library changes while this runs. A rule that names another layout is skipped with a warning. Default: not checked here, so the control's refusal to start it stands alone. */
  layoutIds?: () => readonly string[]
  /** For tests. Default: the real time. */
  now?: () => Date
  /** For tests. Default: the console. */
  log?: Pick<Console, 'info' | 'warn' | 'error'>
}

export interface SchedulePolicy {
  /** Cancels the timer. Nothing more is applied. */
  stop: () => void
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createSchedulePolicy(options: SchedulePolicyOptions): SchedulePolicy {
  const { displays, timeZone, control, layoutIds, now = () => new Date(), log = console } = options
  const withSchedules = displays.filter(display => display.schedules.length > 0)
  let lastChecked = now()
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  function clock(rule: PolicyRule): string {
    return `${rule.from}–${rule.to}`
  }

  /** Applies one command and logs it when the wall's view really changed. */
  function send(displayId: string, schedule: PolicySchedule | undefined, rule: PolicyRule | undefined, command: ControlCommand, what: string): void {
    try {
      const before = control.getState(displayId)
      const after = control.applyCommand(displayId, command)
      if (after.view === before.view && after.layout === before.layout) return
      const name = schedule && rule ? `${schedule.name} (${clock(rule)})` : what
      const shown = after.view === 'custom' && after.layout !== null ? `custom layout ${after.layout}` : after.view
      log.info(`[schedule] ${displayId}: ${name} ${command.type === 'schedule_start' ? `starts, so the wall shows ${shown}` : `ends, so the wall goes back to ${shown}`}`)
    } catch (error) {
      log.error(`[schedule] ${displayId}: could not apply ${command.type} for "${what}": ${describe(error)}`)
    }
  }

  /** Ends windows the persisted state still holds but the config or the clock no longer supports (the app was down at the end, or the rule changed). */
  function endStaleWindows(): void {
    const at = now()
    for (const display of displays) {
      try {
        const window = control.getState(display.id).schedule
        if (window === null) continue
        const schedule = display.schedules.find(candidate => candidate.id === window.schedule)
        const rule = schedule?.rules[window.rule]
        if (rule && rule.view === window.view && (rule.view !== 'custom' || rule.layout === window.layout) && ruleInProgress(rule, timeZone, at)) continue
        send(display.id, schedule, rule, { type: 'schedule_end', schedule: window.schedule, rule: window.rule }, window.schedule)
      } catch (error) {
        log.error(`[schedule] ${display.id}: could not check the schedule window: ${describe(error)}`)
      }
    }
  }

  function arm(): void {
    clearTimeout(timer)
    timer = undefined
    if (stopped || withSchedules.length === 0) return
    let next: Date | null = null
    for (const display of withSchedules) {
      const boundary = nextBoundaryAfter(display.schedules, timeZone, lastChecked)
      if (boundary && (next === null || boundary.at.getTime() < next.getTime())) next = boundary.at
    }
    // Capped like the control service's timers: with nothing due, it only looks again.
    const wait = next === null ? MAX_TIMER_MS : Math.min(Math.max(next.getTime() - now().getTime(), 0), MAX_TIMER_MS)
    timer = setTimeout(() => {
      timer = undefined
      if (!stopped) due()
    }, wait)
  }

  /** Processes every boundary since the last look, so a timer that fires early, late or twice neither misses one nor repeats one. */
  function due(): void {
    const upTo = now()
    const from = new Date(Math.max(lastChecked.getTime(), upTo.getTime() - MAX_CATCH_UP_MS))
    lastChecked = upTo.getTime() > lastChecked.getTime() ? upTo : lastChecked
    try {
      for (const display of withSchedules) {
        for (const boundary of boundariesBetween(display.schedules, timeZone, from, upTo)) {
          const schedule = display.schedules[boundary.scheduleIndex]!
          const rule = schedule.rules[boundary.ruleIndex]!
          // The reducer ignores a turned-off schedule's start, but its end must not touch a window either.
          if (control.getState(display.id).schedules_off.includes(schedule.id)) continue
          if (boundary.kind === 'start' && rule.view === 'custom' && layoutIds && !layoutIds().includes(rule.layout ?? '')) {
            log.warn(`[schedule] ${display.id}: ${schedule.name} (${clock(rule)}) shows layout "${rule.layout}", which does not exist, so it is skipped`)
            continue
          }
          const command: ControlCommand = boundary.kind === 'start'
            ? { type: 'schedule_start', schedule: schedule.id, rule: boundary.ruleIndex, view: rule.view, ...(rule.layout !== undefined && { layout: rule.layout }) }
            : { type: 'schedule_end', schedule: schedule.id, rule: boundary.ruleIndex }
          send(display.id, schedule, rule, command, schedule.id)
        }
      }
    } catch (error) {
      log.error(`[schedule] could not apply the schedules: ${describe(error)}`)
    }
    arm()
  }

  endStaleWindows()
  arm()

  return {
    stop() {
      stopped = true
      clearTimeout(timer)
      timer = undefined
    },
  }
}
