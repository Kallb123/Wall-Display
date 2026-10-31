import { z } from 'zod'
import { addDays } from './dates'
import { MONTH_RANGE } from './display'

// Special days (architecture §6): what they are, how the settings page edits
// them, and which ones the wall shows on which dates. A scene is a look with no
// date, and a day can use one and change any part of it (§6.1), so every day is
// first reduced to the look it really has (`effectiveLook`), and the date rules
// then run on that. Pure: no I/O, and no imports from server/, so the display,
// the settings page and the server can all use it. Dates are `YYYY-MM-DD`
// strings in the display's time zone (see shared/dates.ts), and the wire format
// is snake_case, like the state.

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
/** The longest `who` (the name that fills `{who}`), so a greeting with it still fits. */
export const MAX_SPECIAL_DAY_WHO = 40
/** The years a one-off day can be set in. */
export const MIN_SPECIAL_DAY_YEAR = 2000
export const MAX_SPECIAL_DAY_YEAR = 2100
/** The earliest `since_year`, such as the year someone was born. It can't be later than `MAX_SPECIAL_DAY_YEAR`. */
export const MIN_SPECIAL_DAY_SINCE_YEAR = 1900
/** The most days ahead a custom lead (`lead: days`) can start. */
export const MAX_SPECIAL_DAY_LEAD_DAYS = 365

// Months are 1-based, so `month` here is also the next month's 0-based index, and its day 0 is the last day of this one.
const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate()

/** A `YYYY-MM-DD` date from numbers that may overflow (month 13, day 0), the way `Date.UTC` reads them. */
const isoDate = (year: number, month: number, day: number): string => new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10)

/** The placeholders a greeting can use (architecture §6.1). */
export const GREETING_PLACEHOLDERS = ['who', 'years', 'nth'] as const
export type GreetingPlaceholder = (typeof GREETING_PLACEHOLDERS)[number]

// Anything in braces is a placeholder. A lone brace is plain text, so "Hello :}" is fine.
const PLACEHOLDER = /\{([^{}]*)\}/g
const PLACEHOLDER_HINT = 'use {who}, {years} or {nth}'

/** The known placeholders a greeting uses, each once, in the order they first appear. */
export function greetingPlaceholders(greeting: string | null | undefined): GreetingPlaceholder[] {
  const found = new Set<GreetingPlaceholder>()
  for (const match of (greeting ?? '').matchAll(PLACEHOLDER)) {
    const name = match[1]!
    if (isPlaceholder(name)) found.add(name)
  }
  return [...found]
}

function isPlaceholder(name: string): name is GreetingPlaceholder {
  return (GREETING_PLACEHOLDERS as readonly string[]).includes(name)
}

/** Where an art file (a name from a day's or scene's art fields) is served from. */
export function specialDayArtUrl(name: string): string {
  return `/special-days/${name}`
}

/** 1 becomes "1st", 2 "2nd", 3 "3rd", 4 "4th", and 11, 12 and 13 "11th", "12th" and "13th". For whole numbers from 1. */
export function ordinal(n: number): string {
  const lastTwo = n % 100
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'
  return `${n}${suffix}`
}

/**
 * The greeting for the occurrence in `year`: `{who}` becomes the day's `who`,
 * `{years}` the years since `since_year` and `{nth}` the same as an ordinal.
 * One that can't be filled (no `who`, no `since_year`) is left as typed, which
 * is why saving refuses it (`unfillablePlaceholders`).
 */
export function fillGreeting(greeting: string, day: Pick<SpecialDay, 'who' | 'since_year'>, year: number): string {
  return greeting.replace(PLACEHOLDER, (typed, name: string) => {
    if (name === 'who' && day.who !== null) return day.who
    if (day.since_year === null) return typed
    if (name === 'years') return String(year - day.since_year)
    if (name === 'nth') return ordinal(year - day.since_year)
    return typed
  })
}

/** The placeholders in the look's greeting that `day` has nothing to fill: `{who}` needs `who`, and `{years}` and `{nth}` need `since_year`. */
export function unfillablePlaceholders(day: Pick<SpecialDay, 'who' | 'since_year'>, look: Pick<SpecialDayLook, 'greeting'>): GreetingPlaceholder[] {
  return greetingPlaceholders(look.greeting).filter(name => (name === 'who' ? day.who === null : day.since_year === null))
}

// The pieces the day and scene input schemas share, so a rule is written once.
// The messages read after the field name, because the API says "<field> <message>".
const nameField = z.string().trim().min(1, 'must not be empty').max(MAX_SPECIAL_DAY_NAME, `must be at most ${MAX_SPECIAL_DAY_NAME} characters`)
const leadField = z.enum(SPECIAL_DAY_LEADS, `must be one of ${SPECIAL_DAY_LEADS.join(', ')}`)
const paletteField = z.enum(SPECIAL_DAY_PALETTES, `must be one of ${SPECIAL_DAY_PALETTES.join(', ')}`)
const takeoverField = z.boolean('must be true or false')
/** Required when `lead` is `days`, and null (or left out) otherwise. Comes out as `number | null`. */
const leadDaysField = z.number()
  .int('must be a whole number')
  .min(1, `must be from 1 to ${MAX_SPECIAL_DAY_LEAD_DAYS}`)
  .max(MAX_SPECIAL_DAY_LEAD_DAYS, `must be from 1 to ${MAX_SPECIAL_DAY_LEAD_DAYS}`)
  .nullable()
  .default(null)
/** Blank is stored as null. A `{…}` that is not a placeholder is refused here, rather than shown as typed on the wall. */
const greetingField = z.string()
  .trim()
  .max(MAX_SPECIAL_DAY_GREETING, `must be at most ${MAX_SPECIAL_DAY_GREETING} characters`)
  .superRefine((greeting, context) => {
    for (const [typed, name] of greeting.matchAll(PLACEHOLDER)) {
      if (isPlaceholder(name!)) continue
      context.addIssue({ code: 'custom', message: `has an unknown placeholder ${typed}; ${PLACEHOLDER_HINT}` })
      return
    }
  })
  .nullish()
  .transform(value => value || null)

// `lead` is null on a day that takes its lead from its scene, which has no lead days either.
function checkLeadDays(input: { lead: SpecialDayLead | null, lead_days: number | null }, context: z.RefinementCtx): void {
  if (input.lead === 'days' && input.lead_days === null) context.addIssue({ code: 'custom', path: ['lead_days'], message: 'is required when lead is days' })
  if (input.lead !== 'days' && input.lead_days !== null) context.addIssue({ code: 'custom', path: ['lead_days'], message: 'must be left out unless lead is days' })
}

/**
 * What `POST /api/special-days` and `PUT /api/special-days/:id` take: every
 * field the editor sets. A strict object, so a typo is rejected. The art file
 * names are not here: they are set by the upload routes (PR S.2), never by a
 * client naming a file.
 *
 * `lead`, `takeover` and `palette` can be null, or left out, to use the
 * scene's. That also keeps the bodies S.1 took valid: they set all three.
 */
export const specialDayInputSchema = z.strictObject({
  name: nameField,
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
  /** The scene it uses, or null for none. Whether the scene exists is checked where the scenes are (the server). */
  scene_id: z.string('must be a string or null').nullable().default(null),
  /** Fills `{who}`. Blank is stored as null. */
  who: z.string().trim().max(MAX_SPECIAL_DAY_WHO, `must be at most ${MAX_SPECIAL_DAY_WHO} characters`).nullish().transform(value => value || null),
  /** Fills `{years}` and `{nth}`, and hides the day in that year and before. Only for a yearly day. */
  since_year: z.number()
    .int('must be a whole number')
    .min(MIN_SPECIAL_DAY_SINCE_YEAR, `must be from ${MIN_SPECIAL_DAY_SINCE_YEAR} to ${MAX_SPECIAL_DAY_YEAR}`)
    .max(MAX_SPECIAL_DAY_YEAR, `must be from ${MIN_SPECIAL_DAY_SINCE_YEAR} to ${MAX_SPECIAL_DAY_YEAR}`)
    .nullable()
    .default(null),
  lead: leadField.nullable().default(null),
  lead_days: leadDaysField,
  takeover: takeoverField.nullable().default(null),
  greeting: greetingField,
  palette: paletteField.nullable().default(null),
}).superRefine((input, context) => {
  checkLeadDays(input, context)
  if (input.repeat === 'yearly') {
    if (input.year !== null) context.addIssue({ code: 'custom', path: ['year'], message: 'must be left out for a yearly day' })
    // 29 February is allowed: it falls on 28 February in years that are not leap years.
    else if (input.day > daysInMonth(2024, input.month)) context.addIssue({ code: 'custom', path: ['day'], message: 'must be a day that exists in that month' })
    return
  }
  if (input.since_year !== null) context.addIssue({ code: 'custom', path: ['since_year'], message: 'must be left out for a day that happens once' })
  if (input.year === null) context.addIssue({ code: 'custom', path: ['year'], message: 'is required for a day that happens once' })
  else if (input.day > daysInMonth(input.year, input.month)) context.addIssue({ code: 'custom', path: ['day'], message: `must be a day that exists in that month of ${input.year}` })
})
export type SpecialDayInput = z.output<typeof specialDayInputSchema>

/**
 * What `POST /api/special-day-scenes` and `PUT /api/special-day-scenes/:id`
 * take. A scene is a whole look, so unlike a day it has no null `lead`,
 * `takeover` or `palette`. Art file names are not here, as with a day.
 */
export const specialDaySceneInputSchema = z.strictObject({
  name: nameField,
  lead: leadField,
  lead_days: leadDaysField,
  takeover: takeoverField,
  greeting: greetingField,
  palette: paletteField,
}).superRefine(checkLeadDays)
export type SpecialDaySceneInput = z.output<typeof specialDaySceneInputSchema>

/**
 * The parts of a look. Each is null on a day to use its scene's. `lead_days`
 * goes with `lead` and is not a field of its own: the two come from the same place.
 */
export const LOOK_FIELDS = ['lead', 'tile_art', 'takeover', 'full_art', 'greeting', 'palette'] as const
export type LookField = (typeof LOOK_FIELDS)[number]

/** A scene as the API returns it and the socket carries it. */
export const specialDaySceneSchema = z.object({
  /** A slug made from the name when it was created, such as `birthday`. It stays the same when the scene is renamed. */
  id: z.string(),
  name: z.string(),
  lead: z.enum(SPECIAL_DAY_LEADS),
  /** How many days before a `days` lead starts, or null for the other leads. */
  lead_days: z.number().int().min(1).max(MAX_SPECIAL_DAY_LEAD_DAYS).nullable(),
  /** File name in `/data/special-days/`, or null. */
  tile_art: z.string().nullable(),
  takeover: z.boolean(),
  /** File name in `/data/special-days/`, or null. */
  full_art: z.string().nullable(),
  /** May use `{who}`, `{years}` and `{nth}`. */
  greeting: z.string().nullable(),
  palette: z.enum(SPECIAL_DAY_PALETTES),
  /** When it was last edited, as an ISO 8601 instant. Editing a scene never changes its days' own (architecture §6.3). */
  updated_at: z.iso.datetime(),
})
export type SpecialDayScene = z.output<typeof specialDaySceneSchema>

/** A special day as the API returns it and the socket carries it. */
export const specialDaySchema = z.object({
  /** A slug made from the name when it was created, such as `christmas`. It stays the same when the day is renamed. */
  id: z.string(),
  name: z.string(),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  year: z.number().int().nullable(),
  repeat: z.enum(SPECIAL_DAY_REPEATS),
  /** The id of the scene it uses, or null. */
  scene_id: z.string().nullable(),
  /** Fills `{who}` in the greeting. */
  who: z.string().nullable(),
  /** Fills `{years}` and `{nth}`. The day doesn't show in this year or before it. Yearly days only. */
  since_year: z.number().int().nullable(),
  // From here to `palette`, a null is "use the scene's" (see `effectiveLook`).
  lead: z.enum(SPECIAL_DAY_LEADS).nullable(),
  /** How many days before the day a `days` lead starts, or null for the other leads. */
  lead_days: z.number().int().min(1).max(MAX_SPECIAL_DAY_LEAD_DAYS).nullable(),
  /** File name in `/data/special-days/`, or null. */
  tile_art: z.string().nullable(),
  takeover: z.boolean().nullable(),
  /** File name in `/data/special-days/`, or null. */
  full_art: z.string().nullable(),
  greeting: z.string().nullable(),
  palette: z.enum(SPECIAL_DAY_PALETTES).nullable(),
  /** A layer drawn over the full art for this day only, such as a "7" balloon: a file name in `/data/special-days/`, or null. The day's own; scenes have none. */
  extra_art: z.string().nullable(),
  /** When it was last edited, as an ISO 8601 instant. The newer edit wins a tie (architecture §6.3). */
  updated_at: z.iso.datetime(),
})
export type SpecialDay = z.output<typeof specialDaySchema>

/** The look a day really has, once its scene and the defaults are applied. Nothing in it is "use the scene's" any more. */
export interface SpecialDayLook {
  lead: SpecialDayLead
  lead_days: number | null
  tile_art: string | null
  takeover: boolean
  full_art: string | null
  greeting: string | null
  palette: SpecialDayPalette
}

/** What a day falls back to for a part of its look that neither it nor its scene sets. */
export const DEFAULT_LOOK: Readonly<SpecialDayLook> = {
  lead: 'day',
  lead_days: null,
  tile_art: null,
  takeover: false,
  full_art: null,
  greeting: null,
  palette: 'warm',
}

/** The parts of a day or a scene that make up a look. A scene fits this too, so a scene that hasn't been saved yet can be checked. */
export type LookSource = Pick<SpecialDay, LookField | 'lead_days'>

/**
 * The look a day uses, one field at a time (architecture §6.1): its own value
 * if it has one, otherwise its scene's, otherwise the default. `lead` and
 * `lead_days` are one field, taken together from the day if it has a `lead`,
 * otherwise from the scene. A day with no scene (or one that no longer exists)
 * has only its own values and the defaults.
 */
export function effectiveLook(day: LookSource, scene?: LookSource | null): SpecialDayLook {
  const leadFrom = day.lead !== null ? day : scene && scene.lead !== null ? scene : null
  return {
    lead: leadFrom?.lead ?? DEFAULT_LOOK.lead,
    lead_days: leadFrom ? leadFrom.lead_days : DEFAULT_LOOK.lead_days,
    tile_art: day.tile_art ?? scene?.tile_art ?? DEFAULT_LOOK.tile_art,
    takeover: day.takeover ?? scene?.takeover ?? DEFAULT_LOOK.takeover,
    full_art: day.full_art ?? scene?.full_art ?? DEFAULT_LOOK.full_art,
    greeting: day.greeting ?? scene?.greeting ?? DEFAULT_LOOK.greeting,
    palette: day.palette ?? scene?.palette ?? DEFAULT_LOOK.palette,
  }
}

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
  /** With its placeholders filled in for today's year. */
  greeting: string | null
  palette: SpecialDayPalette
  full_art: string | null
  /** The day's own layer over the full art, or null. Scenes have none. */
  extra_art: string | null
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
  /**
   * The art files the wall will need tomorrow that it may not have loaded yet:
   * tomorrow's takeover's `full_art` and `extra_art`, and the `tile_art` of every
   * tile that is decorated tomorrow in the range. Each once, no order promised.
   * The display preloads them in the evening (architecture §6.5).
   */
  tomorrow_art: string[]
}

const paletteSchema = z.enum(SPECIAL_DAY_PALETTES)
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** A `SpecialDaysResolution` as the display reads it off the socket, the preview route and its cache. Anything else is ignored. */
export const specialDaysResolutionSchema: z.ZodType<SpecialDaysResolution> = z.object({
  today: isoDay,
  from: isoDay,
  to: isoDay,
  tiles: z.array(z.object({
    date: isoDay,
    days: z.array(z.object({ id: z.string(), name: z.string(), palette: paletteSchema, tile_art: z.string().nullable() })),
  })),
  current: z.object({ id: z.string(), name: z.string() }).nullable(),
  takeover: z.object({
    id: z.string(),
    name: z.string(),
    date: isoDay,
    greeting: z.string().nullable(),
    palette: paletteSchema,
    full_art: z.string().nullable(),
    extra_art: z.string().nullable(),
  }).nullable(),
  // An answer from before PR S.3 has none.
  tomorrow_art: z.array(z.string()).default([]),
})

export interface ResolveOptions {
  /** The first date to cover, `YYYY-MM-DD`. */
  from: string
  /** The last date to cover, `YYYY-MM-DD`, inclusive. */
  to: string
  /** Today on the wall, `YYYY-MM-DD`. A tile's art shows once its lead window has started by this date. */
  today: string
}

/** A day with the look it really has, which is all the date rules need. */
interface ResolvedDay {
  day: SpecialDay
  look: SpecialDayLook
}

/**
 * Works out the tile decorations for `from`…`to` and today's special day and
 * takeover from the stored special days and scenes. Pure: the same days,
 * scenes, range and today give the same answer.
 *
 * Each day's look is worked out first (`effectiveLook`, with the scene whose id
 * it names; one that doesn't exist counts as no scene), and the rules below
 * use that look.
 *
 * - A `yearly` day falls on its month and day in every year; a `once` day on its one date.
 * - A 29 February `yearly` day falls on 28 February in years that are not leap years.
 * - A day with a `since_year` has no occurrence in that year or before it.
 * - A day's tile is decorated once its lead window has started by `today`:
 *   `day` from the day itself, `week` from 7 days before, `month` from the 1st
 *   of its month, `days` from `lead_days` days before. It stays decorated after the day has passed (the view dims past days).
 * - Several special days on one date are all listed, in precedence order. That
 *   uses the day's own `updated_at` only, so editing a scene never reorders them.
 * - The takeover's greeting is filled in for today's year.
 * - `tomorrow_art` is the art tomorrow's answer needs: the same rules with
 *   tomorrow as today (a lead window that starts tomorrow decorates its tile
 *   then), so the wall can have it loaded before midnight.
 */
export function resolveSpecialDays(days: readonly SpecialDay[], scenes: readonly SpecialDayScene[], options: ResolveOptions): SpecialDaysResolution {
  const tomorrow = resolveOn(days, scenes, { ...options, today: addDays(options.today, 1) })
  const art = [
    tomorrow.takeover?.full_art,
    tomorrow.takeover?.extra_art,
    ...tomorrow.tiles.flatMap(({ days: onDate }) => onDate.map(({ tile_art }) => tile_art)),
  ]
  return { ...resolveOn(days, scenes, options), tomorrow_art: [...new Set(art.filter((name): name is string => typeof name === 'string'))] }
}

/** `resolveSpecialDays` for one `today`, without the art for tomorrow, which is what asks it again for tomorrow. */
function resolveOn(days: readonly SpecialDay[], scenes: readonly SpecialDayScene[], options: ResolveOptions): SpecialDaysResolution {
  const { from, to, today } = options
  // Dates are `YYYY-MM-DD`, so comparing them as strings compares them as dates.
  const fromYear = Number(from.slice(0, 4))
  const toYear = Number(to.slice(0, 4))
  const todayYear = Number(today.slice(0, 4))

  const sceneById = new Map(scenes.map(scene => [scene.id, scene]))
  const resolved: ResolvedDay[] = days.map(day => ({ day, look: effectiveLook(day, day.scene_id === null ? null : sceneById.get(day.scene_id)) }))

  const byDate = new Map<string, ResolvedDay[]>()
  for (const entry of resolved) {
    for (let year = fromYear; year <= toYear; year++) {
      const date = occurrenceIn(entry.day, year)
      if (date === null || date < from || date > to || today < leadStart(entry.look, date)) continue
      const sameDate = byDate.get(date)
      if (sameDate) sameDate.push(entry)
      else byDate.set(date, [entry])
    }
  }

  const tiles = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, onDate]) => ({ date, days: onDate.sort(byPrecedence).map(decoration) }))

  // Today's own day is found apart from the range, so it is right even if the range were to miss today.
  const onToday = resolved
    .filter(({ day }) => occurrenceIn(day, todayYear) === today)
    .sort(byPrecedence)
  const taking = onToday.find(({ look }) => look.takeover)

  return {
    today,
    from,
    to,
    tiles,
    current: onToday[0] ? { id: onToday[0].day.id, name: onToday[0].day.name } : null,
    takeover: taking
      ? {
          id: taking.day.id,
          name: taking.day.name,
          date: today,
          greeting: taking.look.greeting === null ? null : fillGreeting(taking.look.greeting, taking.day, todayYear),
          palette: taking.look.palette,
          full_art: taking.look.full_art,
          extra_art: taking.day.extra_art,
        }
      : null,
    tomorrow_art: [],
  }
}

/** The date `day` falls on in `year`, or null if it has none (a one-off day in another year, a date that does not exist, or a year the day hasn't started yet). */
function occurrenceIn(day: SpecialDay, year: number): string | null {
  if (day.repeat === 'once') {
    if (day.year !== year || day.day > daysInMonth(year, day.month)) return null
    return isoDate(year, day.month, day.day)
  }
  // Hidden in the `since_year` itself too: that is the year it counts from (a birth), so it has no age to show.
  if (day.since_year !== null && year <= day.since_year) return null
  // 29 February is kept on 28 February when the year has no 29th.
  const last = daysInMonth(year, day.month)
  if (day.day > last && !(day.month === 2 && day.day === 29)) return null
  return isoDate(year, day.month, Math.min(day.day, last))
}

/** The first date the day's tile is decorated on, for the occurrence on `date`. */
function leadStart(look: SpecialDayLook, date: string): string {
  if (look.lead === 'day') return date
  if (look.lead === 'week') return addDays(date, -7)
  if (look.lead === 'days') return addDays(date, -(look.lead_days ?? 0))
  return `${date.slice(0, 7)}-01`
}

/** `once` before `yearly`, then the most recently edited, then by id so the order never depends on the order they were stored in. */
function byPrecedence(a: ResolvedDay, b: ResolvedDay): number {
  if (a.day.repeat !== b.day.repeat) return a.day.repeat === 'once' ? -1 : 1
  const edited = Date.parse(b.day.updated_at) - Date.parse(a.day.updated_at)
  if (edited !== 0) return edited
  return a.day.id < b.day.id ? -1 : a.day.id > b.day.id ? 1 : 0
}

function decoration({ day, look }: ResolvedDay): TileDecoration {
  return { id: day.id, name: day.name, palette: look.palette, tile_art: look.tile_art }
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

/** What a preview shows: a special day by its id, or a scene by its id (shown through the first day that uses it). */
export type PreviewTarget = { special_day: string } | { scene: string }

/**
 * The first date on or after `today` that `day` falls on. A `once` day is on its
 * own date, even if that has passed. A day that never falls on a date (one that
 * does not exist) is shown on `today`.
 */
function previewDate(day: SpecialDay, today: string): string {
  if (day.repeat === 'once') return (day.year === null ? null : occurrenceIn(day, day.year)) ?? today
  // A `since_year` in the future skips the years before it; after that the next occurrence is this year's or next year's.
  const first = Math.max(Number(today.slice(0, 4)), (day.since_year ?? 0) + 1)
  for (const year of [first, first + 1]) {
    const date = occurrenceIn(day, year)
    if (date !== null && date >= today) return date
  }
  return today
}

/**
 * What the wall shows while a special day or scene is being previewed
 * (architecture §6.5): the answer for the date it next falls on, as if that
 * were today. Null if there is no such day or scene.
 *
 * A scene is shown through the first of `days` that uses it (so pass them in the
 * order the store lists them). If no day does, it is shown as a one-off day on
 * `today` with no `who` or `since_year`, so a greeting's placeholders stay as typed.
 *
 * The answer covers the month grid of that date, with every day resolved as
 * usual, so the other tiles on it are there. `current` and `takeover` are the
 * target's own: another day on the same date can't take the preview.
 */
export function resolvePreview(days: readonly SpecialDay[], scenes: readonly SpecialDayScene[], target: PreviewTarget, today: string): SpecialDaysResolution | null {
  let shown: SpecialDay | undefined
  let all = days
  if ('special_day' in target) {
    shown = days.find(day => day.id === target.special_day)
  } else {
    const scene = scenes.find(candidate => candidate.id === target.scene)
    if (!scene) return null
    shown = days.find(day => day.scene_id === scene.id)
    if (!shown) {
      shown = {
        id: `scene:${scene.id}`,
        name: scene.name,
        month: Number(today.slice(5, 7)),
        day: Number(today.slice(8, 10)),
        year: Number(today.slice(0, 4)),
        repeat: 'once',
        scene_id: scene.id,
        who: null,
        since_year: null,
        lead: null,
        lead_days: null,
        tile_art: null,
        takeover: null,
        full_art: null,
        greeting: null,
        palette: null,
        extra_art: null,
        updated_at: scene.updated_at,
      }
      all = [...days, shown]
    }
  }
  if (!shown) return null

  const date = previewDate(shown, today)
  const first = `${date.slice(0, 7)}-01`
  // Day 0 of the month after is the last day of this one.
  const last = isoDate(Number(date.slice(0, 4)), Number(date.slice(5, 7)) + 1, 0)
  const options = { from: addDays(first, -14), to: addDays(last, 14), today: date }
  return {
    ...resolveOn(all, scenes, options),
    current: { id: shown.id, name: shown.name },
    takeover: resolveOn([shown], scenes, options).takeover,
    tomorrow_art: [],
  }
}

/** What `GET /api/special-days/resolved` returns, as the socket sends it in `special_days.updated`. Null only before the special days service has started. */
export interface SpecialDaysResponse {
  special_days: SpecialDaysResolution | null
}
