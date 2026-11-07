import { z } from 'zod'
import { addDays, dayOfWeek, todayIn } from './dates'
import type { SpecialDaysResolution } from './special-days'
import type { WeatherSnapshot } from './weather'

// What a display is showing (the state document) and the commands that change
// it (architecture §7.1). Pure: no I/O, and no imports from server/, so the
// display and the remote can use it too. The wire format is snake_case, as in
// the config. Every state field has a default, so a stored document that
// predates a newer field still parses.

export const VIEWS = ['month', 'week', 'week_parts', 'week_photo', 'agenda', 'photo', 'night'] as const
export type View = (typeof VIEWS)[number]

/** The calendar views `next_view` steps through. From any other view it goes to the first. */
export const NEXT_VIEW_ORDER = ['month', 'agenda', 'week', 'week_parts', 'week_photo'] as const satisfies readonly View[]

/**
 * The views `toggle_photo` can go back to: every view but the photo frame.
 * Night is one too: it is whatever was on the wall before the photos came on.
 */
export const RETURN_VIEWS = ['month', 'week', 'week_parts', 'week_photo', 'agenda', 'night'] as const satisfies readonly View[]

/**
 * The views that show one week and follow a pinned week (`state.week`). Later
 * week-based views join this list, so they are browsed like the week view.
 */
export const WEEK_VIEWS = ['week', 'week_parts', 'week_photo'] as const satisfies readonly View[]

/**
 * The views that show photos (PR 5.14): the photo frame, and the week and
 * photo hybrid, whose photo pane is the photo frame in a box. The server's
 * rotation timer runs while a display is on one of these, and "Next photo"
 * works in all of them.
 */
export const PHOTO_VIEWS = ['photo', 'week_photo'] as const satisfies readonly View[]

export const showsPhotos = (view: View): boolean => (PHOTO_VIEWS as readonly View[]).includes(view)

// The same values as PHOTO_PROVIDERS in server/db/schema.ts, which shared code can't import.
export const PHOTO_SOURCES = ['immich', 'google', 'local'] as const
export type PhotoSource = (typeof PHOTO_SOURCES)[number]

export const SCREEN_STATES = ['on', 'off'] as const
export type ScreenState = (typeof SCREEN_STATES)[number]

/** The base themes, set per display in config. A special day's palette (later) is another set of the same tokens. */
export const THEMES = ['light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

/**
 * What the night view shows under its clock (PR 5.2), set per display in
 * config: nothing, the first timed event still to come in the next 24 hours,
 * or the next alarm from a Home Assistant entity (the top-level `alarm` block).
 */
export const NIGHT_TEXTS = ['none', 'first_event', 'next_alarm'] as const
export type NightText = (typeof NIGHT_TEXTS)[number]

/**
 * Which way up a display is laid out (PR 5.10), set per display in config and
 * on the settings page: `auto` (portrait when the window is taller than it is
 * wide), or always `landscape` (the 2560×1440 stage) or `portrait` (1440×2560).
 * `?orientation=` on `/display` overrides it for one device.
 */
export const ORIENTATIONS = ['auto', 'landscape', 'portrait'] as const
export type Orientation = (typeof ORIENTATIONS)[number]

/** The next alarm the server knows of, as an ISO 8601 instant, or null for none. What `alarm.updated` carries. */
export const nextAlarmSchema = z.iso.datetime({ offset: true }).nullable()
export type NextAlarm = z.output<typeof nextAlarmSchema>

export const SOCKET_ROLES = ['display', 'remote'] as const
export type SocketRole = (typeof SOCKET_ROLES)[number]

/** How many months either side of the current month a pinned month may be. */
export const MONTH_RANGE = 12
/** How many weeks either side of the current week a pinned week may be. */
export const WEEK_RANGE = 52
/** The longest an overlay may be set for: a week, in seconds. */
export const MAX_OVERLAY_TTL_SECONDS = 7 * 24 * 60 * 60
/** How long `preview_special_day` shows a special day for when it isn't told (architecture §6.5). */
export const DEFAULT_PREVIEW_SECONDS = 60
/** The shortest and longest a preview may run, in seconds. */
export const MIN_PREVIEW_SECONDS = 5
export const MAX_PREVIEW_SECONDS = 600

/**
 * A built-in schedule's id (PR 5.4): lowercase letters, digits and hyphens, as
 * the config's other ids. Unique within a display, and part of its MQTT topics.
 */
export const SCHEDULE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
export const scheduleIdSchema = z.string().regex(SCHEDULE_ID_PATTERN, 'must be lowercase letters, digits and hyphens, starting with a letter or digit')

/** A month as `YYYY-MM`. */
export type MonthKey = string

/** A week as the date of its first day, `YYYY-MM-DD`: a Monday or a Sunday, by the display's `week_start`. */
export type WeekKey = string

/** `YYYY-MM-DD` that is a real date (not 2026-02-30). */
const dateKey = z.string()
  .regex(/^[1-9]\d{3}-\d{2}-\d{2}$/, 'must be a date like 2026-10-26')
  // The regex does not stop the checks after it, so this must cope with any text. Years before 1000 are out: `Date.UTC` reads 0 to 99 as 19xx.
  .refine(value => /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value, 'must be a real date like 2026-10-26')

const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be a month like 2026-10')

const text = z.string().trim().min(1, 'must not be empty').max(200, 'must be at most 200 characters')
const icon = z.string().trim().min(1, 'must not be empty').max(50, 'must be at most 50 characters')
const brightness = z.number().int('must be a whole number').min(0, 'must be from 0 to 100').max(100, 'must be from 0 to 100')

/** An overlay as stored: `until` is an ISO 8601 instant, or null to stay until cleared. */
export const overlaySchema = z.object({
  text,
  icon: icon.nullable(),
  until: z.iso.datetime().nullable(),
})

/**
 * A special day preview while it runs (architecture §7.1): a special day by
 * its id, or a scene by its id (shown through the first day that uses it).
 * `until` is an ISO 8601 instant; the server clears the preview then.
 */
export const previewSchema = z.union([
  z.strictObject({ special_day: z.string().min(1), until: z.iso.datetime() }),
  z.strictObject({ scene: z.string().min(1), until: z.iso.datetime() }),
])

/**
 * The schedule window that put the view on the wall (PR 5.4, architecture §7.8):
 * the schedule's id, the rule's index in its `rules`, the view the rule shows,
 * and the view to go back to when the window ends. It is null when no window
 * is in charge, and goes as soon as the view changes to anything else, so a
 * view chosen by hand is never undone.
 */
export const scheduleWindowSchema = z.strictObject({
  schedule: scheduleIdSchema,
  rule: z.number().int().min(0),
  view: z.enum(VIEWS),
  return_view: z.enum(VIEWS),
})

export const displayStateSchema = z.object({
  view: z.enum(VIEWS).default('month'),
  /** The pinned month, or null to follow the current month. */
  month: monthKey.nullable().default(null),
  /** When the pinned month was last set, as an ISO 8601 instant. `month_return_minutes` counts from here. */
  month_set_at: z.iso.datetime().nullable().default(null),
  /** The first day of the pinned week, or null to follow the current week. */
  week: dateKey.nullable().default(null),
  /** When the pinned week was last set, as an ISO 8601 instant. `month_return_minutes` counts from here. */
  week_set_at: z.iso.datetime().nullable().default(null),
  screen: z.enum(SCREEN_STATES).default('on'),
  photo_source: z.enum(PHOTO_SOURCES).default('immich'),
  /** The last view that wasn't the photo frame: where `toggle_photo` goes back to. Kept by the command handler. */
  last_calendar_view: z.enum(RETURN_VIEWS).default('month'),
  brightness: brightness.default(100),
  /** Whether the presence policy may switch the screen. Home Assistant can turn it off. */
  auto_presence: z.boolean().default(true),
  /** Whether the brightness policy may act on the light level. */
  auto_brightness: z.boolean().default(true),
  overlay: overlaySchema.nullable().default(null),
  /** The special day or scene being previewed on the wall, or null. */
  preview: previewSchema.nullable().default(null),
  /** The ids of this display's schedules that are turned off (from Home Assistant). A schedule not listed is on. Sorted, no repeats. */
  schedules_off: z.array(scheduleIdSchema).default([]),
  /** The schedule window in charge of the view, or null. Kept by the command handler. */
  schedule: scheduleWindowSchema.nullable().default(null),
})

export type Overlay = z.output<typeof overlaySchema>
export type Preview = z.output<typeof previewSchema>
export type ScheduleWindow = z.output<typeof scheduleWindowSchema>
export type DisplayState = z.output<typeof displayStateSchema>

// Strict objects, so a typo in a command is rejected instead of ignored.
export const commandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('set_view'), view: z.enum(VIEWS) }),
  z.strictObject({ type: z.literal('next_view') }),
  z.strictObject({ type: z.literal('set_month'), month: z.union([monthKey, z.enum(['current', 'prev', 'next'])], { error: 'must be a month like 2026-10, or current, prev or next' }) }),
  // A date in the wanted week (moved to the week's first day), or current, prev or next.
  z.strictObject({ type: z.literal('set_week'), week: z.union([dateKey, z.enum(['current', 'prev', 'next'])], { error: 'must be a date like 2026-10-26, or current, prev or next' }) }),
  z.strictObject({ type: z.literal('set_screen'), screen: z.enum(SCREEN_STATES) }),
  // Out of range is an error, not clamped: a slider that sends 120 has a bug worth seeing.
  z.strictObject({ type: z.literal('set_brightness'), brightness }),
  z.strictObject({ type: z.literal('set_photo_source'), photo_source: z.enum(PHOTO_SOURCES) }),
  z.strictObject({ type: z.literal('set_auto_presence'), auto_presence: z.boolean() }),
  z.strictObject({ type: z.literal('set_auto_brightness'), auto_brightness: z.boolean() }),
  // Turns one of the display's built-in schedules on or off (PR 5.4). An id the display doesn't have is refused by the control service.
  z.strictObject({ type: z.literal('set_schedule'), schedule: scheduleIdSchema, on: z.boolean() }),
  z.strictObject({
    type: z.literal('set_overlay'),
    // null clears the overlay.
    overlay: z.strictObject({
      text,
      icon: icon.optional(),
      /** Seconds until the overlay goes away. Left out, it stays until cleared. */
      ttl: z.number().int('must be a whole number').min(1, 'must be at least 1 second').max(MAX_OVERLAY_TTL_SECONDS, 'must be at most 604800 seconds (a week)').optional(),
    }).nullable(),
  }),
  z.strictObject({ type: z.literal('photo_next') }),
  // The photo frame if it isn't on, otherwise the view it replaced (`last_calendar_view`). The button's double press, not an MQTT topic.
  z.strictObject({ type: z.literal('toggle_photo') }),
  z.strictObject({ type: z.literal('refresh') }),
  // Shows a special day (`id`) or a scene (`scene`) on the wall for `seconds`, as if today were that day (architecture §6.5).
  z.strictObject({
    type: z.literal('preview_special_day'),
    id: z.string().trim().min(1, 'must not be empty').optional(),
    scene: z.string().trim().min(1, 'must not be empty').optional(),
    seconds: z.number()
      .int('must be a whole number')
      .min(MIN_PREVIEW_SECONDS, `must be from ${MIN_PREVIEW_SECONDS} to ${MAX_PREVIEW_SECONDS}`)
      .max(MAX_PREVIEW_SECONDS, `must be from ${MIN_PREVIEW_SECONDS} to ${MAX_PREVIEW_SECONDS}`)
      .default(DEFAULT_PREVIEW_SECONDS),
  }).refine(command => (command.id === undefined) !== (command.scene === undefined), { message: 'needs exactly one of id and scene' }),
], { error: 'must be set_view, next_view, set_month, set_week, set_screen, set_brightness, set_photo_source, set_auto_presence, set_auto_brightness, set_schedule, set_overlay, photo_next, toggle_photo, refresh or preview_special_day' })

export type Command = z.output<typeof commandSchema>
export type CommandType = Command['type']

/** The hours of the day the week view draws in full, `from` inclusive to `to` exclusive. Whole hours, 0 to 24. */
export interface WeekHours {
  from: number
  to: number
}

/** The week view's hours when config does not say, and what the client uses for settings cached before `week_hours` existed. */
export const DEFAULT_WEEK_HOURS: WeekHours = { from: 7, to: 21 }

/**
 * Where the week by part of day view (`week_parts`, PR 5.16) splits a day:
 * morning is from midnight to `afternoon`, afternoon to `evening`, and evening
 * to midnight. Whole hours, `1 <= afternoon < evening <= 23`.
 */
export interface DayParts {
  afternoon: number
  evening: number
}

/** The day parts when config does not say, and what the client uses for settings cached before `day_parts` existed. */
export const DEFAULT_DAY_PARTS: DayParts = { afternoon: 12, evening: 17 }

/**
 * A display's settings: what `GET /api/displays` returns, and what the page
 * needs that the state does not hold. They come from config, with any changes
 * saved on the settings page's Displays tab on top (PR 5.6), and the server
 * sends them again as `settings.updated` when those change. `timezone` is the
 * config's top-level time zone, which the wall shows its times in. No secrets.
 */
export const displaySettingsSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  theme: z.enum(THEMES),
  month_style: z.enum(['soft', 'classic']),
  week_start: z.enum(['monday', 'sunday']),
  timezone: z.string().min(1),
  /** Whether the wall shifts its content in a slow orbit and moves the photo frame's pill between corners, against burn-in (PR 5.3). */
  burn_in: z.boolean(),
  /** What the night view shows under its clock. */
  night_text: z.enum(NIGHT_TEXTS),
  /** Which way up the wall is laid out (PR 5.10). The client takes settings cached before it existed as `auto`. */
  orientation: z.enum(ORIENTATIONS),
  /** The hours the week view draws in full; earlier and later hours are folded into a band. */
  week_hours: z.object({ from: z.number().int().min(0).max(23), to: z.number().int().min(1).max(24) }),
  /** Where the week by part of day view splits a day (PR 5.16). The client takes settings cached before it existed as `DEFAULT_DAY_PARTS`. */
  day_parts: z.object({ afternoon: z.number().int().min(1).max(22), evening: z.number().int().min(2).max(23) }),
  /**
   * The photo sources the server has set up, in the order a display falls back
   * to them (Immich, Google, folder). Empty with no `photos` block. The remote
   * disables the others. The same for every display.
   */
  photo_sources: z.array(z.enum(PHOTO_SOURCES)),
})

export type DisplaySettings = z.output<typeof displaySettingsSchema>

/** What the server sends down a socket. */
export type ServerMessage =
  | { type: 'state.updated', display_id: string, state: DisplayState }
  | { type: 'events.updated', calendar_ids: string[] }
  | { type: 'photo.next', display_id: string }
  /** To every socket when the weather changes, and to a new socket on connect. Null when there is none (no weather entity, or no successful fetch yet). */
  | { type: 'weather.updated', weather: WeatherSnapshot | null }
  /** To every socket when the special days change or the date does, and to a new socket on connect. Null only before the special days service has started. */
  | { type: 'special_days.updated', special_days: SpecialDaysResolution | null }
  /** To every socket when the next alarm changes, and to a new socket on connect. Null when there is none (no `alarm` block, no alarm set, or no successful fetch yet). */
  | { type: 'alarm.updated', alarm: NextAlarm }
  /** To the display's sockets when its settings change on the settings page (PR 5.6), and to a new socket on connect. The whole of them, as `GET /api/displays` has them. */
  | { type: 'settings.updated', display_id: string, settings: DisplaySettings }

// Months, as `YYYY-MM` keys. Done with `Intl` and arithmetic, never the
// process's time zone. A month's index is year * 12 + (month - 1).

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: 'numeric' })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

function monthIndex(key: MonthKey): number {
  return Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1
}

function monthFromIndex(index: number): MonthKey {
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`
}

/** The month it is at `now` on a wall in `timeZone`. */
export function currentMonth(now: Date, timeZone: string): MonthKey {
  const fields: Record<string, number> = {}
  for (const part of formatterFor(timeZone).formatToParts(now)) {
    if (part.type !== 'literal') fields[part.type] = Number(part.value)
  }
  return monthFromIndex(fields.year! * 12 + fields.month! - 1)
}

/** The month `count` months after `key` (before it, if negative). */
export function addMonths(key: MonthKey, count: number): MonthKey {
  return monthFromIndex(monthIndex(key) + count)
}

/** How many months `to` is after `from` (negative if it is before). */
export function monthDiff(from: MonthKey, to: MonthKey): number {
  return monthIndex(to) - monthIndex(from)
}

// Weeks, as the date of their first day. The first day depends on the
// display's `week_start`, so every helper takes it. Dates only, no times, so
// the process's time zone never matters.

/** The first day of the week `date` is in. */
export function firstDayOfWeek(date: string, weekStart: 'monday' | 'sunday'): WeekKey {
  return addDays(date, -((dayOfWeek(date) - (weekStart === 'monday' ? 1 : 0) + 7) % 7))
}

/** The week it is at `now` on a wall in `timeZone`. */
export function currentWeek(now: Date, timeZone: string, weekStart: 'monday' | 'sunday'): WeekKey {
  return firstDayOfWeek(todayIn(now, timeZone), weekStart)
}

/** The week `count` weeks after `key` (before it, if negative). */
export function addWeeks(key: WeekKey, count: number): WeekKey {
  return addDays(key, count * 7)
}

/** How many weeks `to` is after `from` (negative if it is before). Both are first days of weeks. */
export function weekDiff(from: WeekKey, to: WeekKey): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (7 * 24 * 60 * 60 * 1000))
}
