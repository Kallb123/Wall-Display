import { z } from 'zod'
import { addDays } from './dates'
import { MONTH_RANGE } from './display'

// Special days (architecture §6): what they are, how the settings page edits
// them, and which ones the wall shows on which dates. Pure: no I/O, and no
// imports from server/, so the display, the settings page and the server can
// all use it. Dates are `YYYY-MM-DD` strings in the display's time zone (see
// shared/dates.ts), and the wire format is snake_case, like the state.

// The same values as SPECIAL_DAY_REPEATS, SPECIAL_DAY_LEADS and SPECIAL_DAY_PALETTES
// in server/db/schema.ts, which shared code can't import. A test holds them together.
export const SPECIAL_DAY_REPEATS = ['yearly', 'once'] as const
export type SpecialDayRepeat = (typeof SPECIAL_DAY_REPEATS)[number]

/** `days` is a custom lead: `lead_days` days before. */
export const SPECIAL_DAY_LEADS = ['day', 'week', 'month', 'days'] as const
export type SpecialDayLead = (typeof SPECIAL_DAY_LEADS)[number]

export const SPECIAL_DAY_PALETTES = ['warm', 'night', 'frost', 'sage'] as const
export type SpecialDayPalette = (typeof SPECIAL_DAY_PALETTES)[number]

/** The longest name and greeting the editor accepts: what fits on a tile and under the greeting on the wall. */
export const MAX_SPECIAL_DAY_NAME = 60
export const MAX_SPECIAL_DAY_GREETING = 80
/** The years a one-off day can be set in. */
export const MIN_SPECIAL_DAY_YEAR = 2000
export const MAX_SPECIAL_DAY_YEAR = 2100
/** The most days ahead a custom lead (`lead: days`) can start. */
export const MAX_SPECIAL_DAY_LEAD_DAYS = 365

// Months are 1-based, so `month` here is also the next month's 0-based index, and its day 0 is the last day of this one.
const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate()

/** A `YYYY-MM-DD` date from numbers that may overflow (month 13, day 0), the way `Date.UTC` reads them. */
const isoDate = (year: number, month: number, day: number): string => new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10)

/**
 * What `POST /api/special-days` and `PUT /api/special-days/:id` take: every
 * field the editor sets. A strict object, so a typo is rejected. The art file
 * names are not here: they are set by the upload routes (PR S.2), never by a
 * client naming a file.
 */
// The messages read after the field name, because the API says "<field> <message>".
export const specialDayInputSchema = z.strictObject({
  name: z.string().trim().min(1, 'must not be empty').max(MAX_SPECIAL_DAY_NAME, `must be at most ${MAX_SPECIAL_DAY_NAME} characters`),
  month: z.number().int('must be a whole number from 1 to 12').min(1, 'must be from 1 to 12').max(12, 'must be from 1 to 12'),
  day: z.number().int('must be a whole number from 1 to 31').min(1, 'must be from 1 to 31').max(31, 'must be from 1 to 31'),
  /** Required when `repeat` is `once`, and null (or left out) when it is `yearly`. Comes out as `number | null`. */
  year: z.number()
    .int('must be a whole number')
    .min(MIN_SPECIAL_DAY_YEAR, `must be from ${MIN_SPECIAL_DAY_YEAR} to ${MAX_SPECIAL_DAY_YEAR}`)
    .max(MAX_SPECIAL_DAY_YEAR, `must be from ${MIN_SPECIAL_DAY_YEAR} to ${MAX_SPECIAL_DAY_YEAR}`)
    .nullable()
    .default(null),
  repeat: z.enum(SPECIAL_DAY_REPEATS, `must be one of ${SPECIAL_DAY_REPEATS.join(', ')}`),
  lead: z.enum(SPECIAL_DAY_LEADS, `must be one of ${SPECIAL_DAY_LEADS.join(', ')}`),
  /** Required when `lead` is `days`, and null (or left out) otherwise. Comes out as `number | null`. */
  lead_days: z.number()
    .int('must be a whole number')
    .min(1, `must be from 1 to ${MAX_SPECIAL_DAY_LEAD_DAYS}`)
    .max(MAX_SPECIAL_DAY_LEAD_DAYS, `must be from 1 to ${MAX_SPECIAL_DAY_LEAD_DAYS}`)
    .nullable()
    .default(null),
  takeover: z.boolean('must be true or false'),
  /** Blank is stored as null. */
  greeting: z.string()
    .trim()
    .max(MAX_SPECIAL_DAY_GREETING, `must be at most ${MAX_SPECIAL_DAY_GREETING} characters`)
    .nullish()
    .transform(value => value || null),
  palette: z.enum(SPECIAL_DAY_PALETTES, `must be one of ${SPECIAL_DAY_PALETTES.join(', ')}`),
}).superRefine((input, context) => {
  if (input.lead === 'days' && input.lead_days === null) context.addIssue({ code: 'custom', path: ['lead_days'], message: 'is required when lead is days' })
  if (input.lead !== 'days' && input.lead_days !== null) context.addIssue({ code: 'custom', path: ['lead_days'], message: 'must be left out unless lead is days' })
  if (input.repeat === 'yearly') {
    if (input.year !== null) context.addIssue({ code: 'custom', path: ['year'], message: 'must be left out for a yearly day' })
    // 29 February is allowed: it falls on 28 February in years that are not leap years.
    else if (input.day > daysInMonth(2024, input.month)) context.addIssue({ code: 'custom', path: ['day'], message: 'must be a day that exists in that month' })
    return
  }
  if (input.year === null) context.addIssue({ code: 'custom', path: ['year'], message: 'is required for a day that happens once' })
  else if (input.day > daysInMonth(input.year, input.month)) context.addIssue({ code: 'custom', path: ['day'], message: `must be a day that exists in that month of ${input.year}` })
})
export type SpecialDayInput = z.output<typeof specialDayInputSchema>

/** A special day as the API returns it and the socket carries it. */
export const specialDaySchema = z.object({
  /** A slug made from the name when it was created, such as `christmas`. It stays the same when the day is renamed. */
  id: z.string(),
  name: z.string(),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  year: z.number().int().nullable(),
  repeat: z.enum(SPECIAL_DAY_REPEATS),
  lead: z.enum(SPECIAL_DAY_LEADS),
  /** How many days before the day a `days` lead starts, or null for the other leads. */
  lead_days: z.number().int().min(1).max(MAX_SPECIAL_DAY_LEAD_DAYS).nullable(),
  /** File name in `/data/special-days/`, or null. */
  tile_art: z.string().nullable(),
  takeover: z.boolean(),
  /** File name in `/data/special-days/`, or null. */
  full_art: z.string().nullable(),
  greeting: z.string().nullable(),
  palette: z.enum(SPECIAL_DAY_PALETTES),
  /** When it was last edited, as an ISO 8601 instant. The newer edit wins a tie (architecture §6.3). */
  updated_at: z.iso.datetime(),
})
export type SpecialDay = z.output<typeof specialDaySchema>

/** One special day's decoration on one date's tile (architecture §6.2). */
export interface TileDecoration {
  id: string
  name: string
  /** The tint comes from this palette's accent. */
  palette: SpecialDayPalette
  tile_art: string | null
}

/** The special day taking over the wall today (architecture §6.3). */
export interface Takeover {
  id: string
  name: string
  /** The date it is for: today, as `YYYY-MM-DD`. */
  date: string
  greeting: string | null
  palette: SpecialDayPalette
  full_art: string | null
}

/**
 * What the wall needs for a range of dates: the decorated tiles, and today's
 * special day and takeover. The display never works out dates itself
 * (architecture §6.5): it draws this.
 */
export interface SpecialDaysResolution {
  /** The date it was resolved for, `YYYY-MM-DD`. */
  today: string
  /** The first and last dates covered, inclusive. */
  from: string
  to: string
  /**
   * Only the dates in the range that have at least one decoration, in date
   * order. Each date's decorations are in precedence order (`once` before
   * `yearly`, then the most recently edited first, then by id), so the first
   * one sets the tint and they are drawn side by side in this order.
   */
  tiles: { date: string, days: TileDecoration[] }[]
  /** The special day on today's date that comes first by precedence, whether or not it takes over. Its name is what Home Assistant's "Special day" sensor reads. */
  current: { id: string, name: string } | null
  /** The special day on today's date with `takeover` on that comes first by precedence, or null. Only one takes over. */
  takeover: Takeover | null
}

export interface ResolveOptions {
  /** The first date to cover, `YYYY-MM-DD`. */
  from: string
  /** The last date to cover, `YYYY-MM-DD`, inclusive. */
  to: string
  /** Today on the wall, `YYYY-MM-DD`. A tile's art shows once its lead window has started by this date. */
  today: string
}

/**
 * Works out the tile decorations for `from`…`to` and today's special day and
 * takeover from the stored special days. Pure: the same days, range and today
 * give the same answer.
 *
 * - A `yearly` day falls on its month and day in every year; a `once` day on its one date.
 * - A 29 February `yearly` day falls on 28 February in years that are not leap years.
 * - A day's tile is decorated once its lead window has started by `today`:
 *   `day` from the day itself, `week` from 7 days before, `month` from the 1st
 *   of its month, `days` from `lead_days` days before. It stays decorated after the day has passed (the view dims past days).
 * - Several special days on one date are all listed, in precedence order.
 */
export function resolveSpecialDays(days: readonly SpecialDay[], options: ResolveOptions): SpecialDaysResolution {
  const { from, to, today } = options
  // Dates are `YYYY-MM-DD`, so comparing them as strings compares them as dates.
  const fromYear = Number(from.slice(0, 4))
  const toYear = Number(to.slice(0, 4))

  const byDate = new Map<string, SpecialDay[]>()
  for (const day of days) {
    for (let year = fromYear; year <= toYear; year++) {
      const date = occurrenceIn(day, year)
      if (date === null || date < from || date > to || today < leadStart(day, date)) continue
      const sameDate = byDate.get(date)
      if (sameDate) sameDate.push(day)
      else byDate.set(date, [day])
    }
  }

  const tiles = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, onDate]) => ({ date, days: onDate.sort(byPrecedence).map(decoration) }))

  // Today's own day is found apart from the range, so it is right even if the range were to miss today.
  const onToday = days
    .filter(day => occurrenceIn(day, Number(today.slice(0, 4))) === today)
    .sort(byPrecedence)
  const taking = onToday.find(day => day.takeover)

  return {
    today,
    from,
    to,
    tiles,
    current: onToday[0] ? { id: onToday[0].id, name: onToday[0].name } : null,
    takeover: taking
      ? { id: taking.id, name: taking.name, date: today, greeting: taking.greeting, palette: taking.palette, full_art: taking.full_art }
      : null,
  }
}

/** The date `day` falls on in `year`, or null if it has none (a one-off day in another year, or a date that does not exist). */
function occurrenceIn(day: SpecialDay, year: number): string | null {
  if (day.repeat === 'once') {
    if (day.year !== year || day.day > daysInMonth(year, day.month)) return null
    return isoDate(year, day.month, day.day)
  }
  // 29 February is kept on 28 February when the year has no 29th.
  const last = daysInMonth(year, day.month)
  if (day.day > last && !(day.month === 2 && day.day === 29)) return null
  return isoDate(year, day.month, Math.min(day.day, last))
}

/** The first date the day's tile is decorated on, for the occurrence on `date`. */
function leadStart(day: SpecialDay, date: string): string {
  if (day.lead === 'day') return date
  if (day.lead === 'week') return addDays(date, -7)
  if (day.lead === 'days') return addDays(date, -(day.lead_days ?? 0))
  return `${date.slice(0, 7)}-01`
}

/** `once` before `yearly`, then the most recently edited, then by id so the order never depends on the order they were stored in. */
function byPrecedence(a: SpecialDay, b: SpecialDay): number {
  if (a.repeat !== b.repeat) return a.repeat === 'once' ? -1 : 1
  const edited = Date.parse(b.updated_at) - Date.parse(a.updated_at)
  if (edited !== 0) return edited
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function decoration(day: SpecialDay): TileDecoration {
  return { id: day.id, name: day.name, palette: day.palette, tile_art: day.tile_art }
}

/**
 * The range of dates the server resolves and sends to the displays for `today`:
 * every month a display can show (`MONTH_RANGE` either side of today's month,
 * shared/display.ts), with two weeks either side for the days a month grid shows
 * from the months next to it.
 */
export function resolutionRange(today: string): { from: string, to: string } {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  return {
    from: addDays(isoDate(year, month - MONTH_RANGE, 1), -14),
    // Day 0 of the month after is the last day of the month.
    to: addDays(isoDate(year, month + MONTH_RANGE + 1, 0), 14),
  }
}

/** What `GET /api/special-days/resolved` returns, as the socket sends it in `special_days.updated`. Null only before the special days service has started. */
export interface SpecialDaysResponse {
  special_days: SpecialDaysResolution | null
}
