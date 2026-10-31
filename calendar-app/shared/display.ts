import { z } from 'zod'
import type { SpecialDaysResolution } from './special-days'
import type { WeatherSnapshot } from './weather'

// What a display is showing (the state document) and the commands that change
// it (architecture §7.1). Pure: no I/O, and no imports from server/, so the
// display and the remote can use it too. The wire format is snake_case, as in
// the config. Every state field has a default, so a stored document that
// predates a newer field still parses.

export const VIEWS = ['month', 'week', 'agenda', 'photo', 'night'] as const
export type View = (typeof VIEWS)[number]

/** The calendar views `next_view` steps through. From any other view it goes to the first. */
export const NEXT_VIEW_ORDER = ['month', 'agenda', 'week'] as const satisfies readonly View[]

// The same values as PHOTO_PROVIDERS in server/db/schema.ts, which shared code can't import.
export const PHOTO_SOURCES = ['immich', 'google', 'local'] as const
export type PhotoSource = (typeof PHOTO_SOURCES)[number]

export const SCREEN_STATES = ['on', 'off'] as const
export type ScreenState = (typeof SCREEN_STATES)[number]

/** The base themes, set per display in config. A special day's palette (later) is another set of the same tokens. */
export const THEMES = ['light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

export const SOCKET_ROLES = ['display', 'remote'] as const
export type SocketRole = (typeof SOCKET_ROLES)[number]

/** How many months either side of the current month a pinned month may be. */
export const MONTH_RANGE = 12
/** The longest an overlay may be set for: a week, in seconds. */
export const MAX_OVERLAY_TTL_SECONDS = 7 * 24 * 60 * 60
/** How long `preview_special_day` shows a special day for when it isn't told (architecture §6.5). */
export const DEFAULT_PREVIEW_SECONDS = 60
/** The shortest and longest a preview may run, in seconds. */
export const MIN_PREVIEW_SECONDS = 5
export const MAX_PREVIEW_SECONDS = 600

/** A month as `YYYY-MM`. */
export type MonthKey = string

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

export const displayStateSchema = z.object({
  view: z.enum(VIEWS).default('month'),
  /** The pinned month, or null to follow the current month. */
  month: monthKey.nullable().default(null),
  /** When the pinned month was last set, as an ISO 8601 instant. `month_return_minutes` counts from here. */
  month_set_at: z.iso.datetime().nullable().default(null),
  screen: z.enum(SCREEN_STATES).default('on'),
  photo_source: z.enum(PHOTO_SOURCES).default('immich'),
  brightness: brightness.default(100),
  /** Whether the presence policy may switch the screen. Home Assistant can turn it off. */
  auto_presence: z.boolean().default(true),
  /** Whether the brightness policy may act on the light level. */
  auto_brightness: z.boolean().default(true),
  overlay: overlaySchema.nullable().default(null),
  /** The special day or scene being previewed on the wall, or null. */
  preview: previewSchema.nullable().default(null),
})

export type Overlay = z.output<typeof overlaySchema>
export type Preview = z.output<typeof previewSchema>
export type DisplayState = z.output<typeof displayStateSchema>

// Strict objects, so a typo in a command is rejected instead of ignored.
export const commandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('set_view'), view: z.enum(VIEWS) }),
  z.strictObject({ type: z.literal('next_view') }),
  z.strictObject({ type: z.literal('set_month'), month: z.union([monthKey, z.enum(['current', 'prev', 'next'])], { error: 'must be a month like 2026-10, or current, prev or next' }) }),
  z.strictObject({ type: z.literal('set_screen'), screen: z.enum(SCREEN_STATES) }),
  // Out of range is an error, not clamped: a slider that sends 120 has a bug worth seeing.
  z.strictObject({ type: z.literal('set_brightness'), brightness }),
  z.strictObject({ type: z.literal('set_photo_source'), photo_source: z.enum(PHOTO_SOURCES) }),
  z.strictObject({ type: z.literal('set_auto_presence'), auto_presence: z.boolean() }),
  z.strictObject({ type: z.literal('set_auto_brightness'), auto_brightness: z.boolean() }),
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
], { error: 'must be set_view, next_view, set_month, set_screen, set_brightness, set_photo_source, set_auto_presence, set_auto_brightness, set_overlay, photo_next, refresh or preview_special_day' })

export type Command = z.output<typeof commandSchema>
export type CommandType = Command['type']

/**
 * A display's settings from config: what `GET /api/displays` returns, and
 * what the page needs that the state does not hold. `timezone` is the config's
 * top-level time zone, which the wall shows its times in. No secrets.
 */
export interface DisplaySettings {
  id: string
  name: string
  theme: Theme
  month_style: 'soft' | 'classic'
  week_start: 'monday' | 'sunday'
  timezone: string
}

/** What the server sends down a socket. */
export type ServerMessage =
  | { type: 'state.updated', display_id: string, state: DisplayState }
  | { type: 'events.updated', calendar_ids: string[] }
  | { type: 'photo.next', display_id: string }
  /** To every socket when the weather changes, and to a new socket on connect. Null when there is none (no weather entity, or no successful fetch yet). */
  | { type: 'weather.updated', weather: WeatherSnapshot | null }
  /** To every socket when the special days change or the date does, and to a new socket on connect. Null only before the special days service has started. */
  | { type: 'special_days.updated', special_days: SpecialDaysResolution | null }

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
