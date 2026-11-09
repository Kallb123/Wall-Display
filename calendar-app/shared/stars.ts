import { z } from 'zod'
import { addDays, dayOfWeek } from './dates'

// The star chart (PR 5.20): stars earned by the people in the config, one count
// per person per day. A person has a chart only when it is switched on for them
// (none is, to start with), and then a period, `day` or `week`, which is what
// their goal and the total on the wall count over. This is the model shared by
// the server, the wall, the remote and the settings page. Pure: no I/O, no Vue,
// and no use of the process's local time. Dates are `YYYY-MM-DD` strings in the
// config's (and the wall's) time zone.

/** What a person's goal and the wall's total count over: today, or this week (from the display's `week_start`). */
export const STAR_PERIODS = ['day', 'week'] as const
export type StarPeriod = (typeof STAR_PERIODS)[number]

/** The most stars one person can have on one day. A count is clamped to 0..this. */
export const MAX_STARS_PER_DAY = 99
/** The largest goal, per day or per week. */
export const MAX_STAR_GOAL = 99
/** The most stars one adjustment adds or takes away. */
export const MAX_STAR_DELTA = 10
/**
 * How many days of counts the wall is sent, ending today: enough for any week
 * the wall can show, whichever day it starts on, and for a correction on the
 * settings page. An adjustment to a day older than this is refused.
 */
export const STAR_HISTORY_DAYS = 14

/** A person's star chart settings as stored. A person with no stored settings has `DEFAULT_STAR_SETTINGS`. */
export interface StarSettings {
  enabled: boolean
  period: StarPeriod
  /** Stars per period that count as a good day or week. Null for no goal. */
  goal: number | null
}

export const DEFAULT_STAR_SETTINGS: StarSettings = { enabled: false, period: 'week', goal: null }

/** A person with a chart, as the wall draws them. */
export interface StarChartPerson {
  /** The person's id in the config. */
  id: string
  name: string
  /** One character, as the event badges use. */
  initial: string
  /** `#RRGGBB`. */
  colour: string
  period: StarPeriod
  goal: number | null
}

/**
 * What the wall and the remote are sent (`GET /api/stars`, and `stars.updated`
 * on the socket): the people with a chart switched on, in config order, and
 * their counts for the last `STAR_HISTORY_DAYS` days. A day without stars is
 * left out, so a missing date or person reads as 0.
 */
export interface StarChart {
  people: StarChartPerson[]
  /** Stars by person id, then by date. */
  counts: Record<string, Record<string, number>>
}

/** A person as the settings Stars tab lists them: every person in the config, in config order, with their settings. */
export interface StarSettingsEntry extends StarSettings {
  id: string
  name: string
  initial: string
  colour: string
}

const STAR_DATE = /^[1-9]\d{3}-\d{2}-\d{2}$/

/** `YYYY-MM-DD` that is a real date (not 2026-02-30). */
export const starDateSchema = z.string()
  .regex(STAR_DATE, 'must be a date like 2026-11-09')
  .refine(value => STAR_DATE.test(value) && addDays(value, 0) === value, 'must be a real date like 2026-11-09')

/** The body of `POST /api/stars/:personId`: add (or with a negative `delta`, take away) stars on a day, today when `date` is left out. */
export const starAdjustBodySchema = z.strictObject({
  delta: z.number({ error: 'must be a whole number' })
    .int('must be a whole number')
    .min(-MAX_STAR_DELTA, `must be from -${MAX_STAR_DELTA} to ${MAX_STAR_DELTA}`)
    .max(MAX_STAR_DELTA, `must be from -${MAX_STAR_DELTA} to ${MAX_STAR_DELTA}`)
    .refine(value => value !== 0, 'must not be 0'),
  date: starDateSchema.optional(),
})
export type StarAdjustBody = z.infer<typeof starAdjustBodySchema>

/** The body of `PUT /api/settings/stars/:personId`: the whole of a person's settings. */
export const starSettingsBodySchema = z.strictObject({
  enabled: z.boolean({ error: 'must be true or false' }),
  period: z.enum(STAR_PERIODS, { error: `must be ${STAR_PERIODS.join(' or ')}` }),
  goal: z.number({ error: 'must be a whole number or null' })
    .int('must be a whole number')
    .min(1, `must be from 1 to ${MAX_STAR_GOAL}`)
    .max(MAX_STAR_GOAL, `must be from 1 to ${MAX_STAR_GOAL}`)
    .nullable(),
})
export type StarSettingsBody = z.infer<typeof starSettingsBodySchema>

const starPersonSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  initial: z.string(),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  period: z.enum(STAR_PERIODS),
  goal: z.number().int().min(1).max(MAX_STAR_GOAL).nullable(),
})

/**
 * A `StarChart` as the clients check it when it comes off the socket or out of
 * the display's cache. Not strict, so a server that sends more than this
 * client knows of is still understood.
 */
export const starChartSchema = z.object({
  people: z.array(starPersonSchema),
  counts: z.record(z.string(), z.record(starDateSchema, z.number().int().min(0).max(MAX_STARS_PER_DAY))),
})

/** `count` kept to 0..`MAX_STARS_PER_DAY`, as a whole number. */
export function clampStars(count: number): number {
  return Math.min(MAX_STARS_PER_DAY, Math.max(0, Math.round(count)))
}

/** The stars `personId` has on `date`: 0 when the chart has none. */
export function starsOn(chart: Pick<StarChart, 'counts'>, personId: string, date: string): number {
  return chart.counts[personId]?.[date] ?? 0
}

/** The first day of the week `date` is in: a Monday or a Sunday, by `weekStart`. */
export function starWeekStart(date: string, weekStart: 'monday' | 'sunday'): string {
  return addDays(date, -((dayOfWeek(date) - (weekStart === 'monday' ? 1 : 0) + 7) % 7))
}

/** The seven dates of the week `date` is in, in order. */
export function starWeek(date: string, weekStart: 'monday' | 'sunday'): string[] {
  const first = starWeekStart(date, weekStart)
  return Array.from({ length: 7 }, (_, index) => addDays(first, index))
}

/** A person's total for their period: today's stars for `day`, the stars of the week `today` is in for `week`. */
export function starTotal(chart: Pick<StarChart, 'counts'>, person: Pick<StarChartPerson, 'id' | 'period'>, today: string, weekStart: 'monday' | 'sunday'): number {
  if (person.period === 'day') return starsOn(chart, person.id, today)
  return starWeek(today, weekStart).reduce((sum, date) => sum + starsOn(chart, person.id, date), 0)
}

/** The dates from `STAR_HISTORY_DAYS - 1` days before `today` to `today`: the ones the wall is sent and an adjustment may change. */
export function starHistory(today: string): { first: string, last: string } {
  return { first: addDays(today, -(STAR_HISTORY_DAYS - 1)), last: today }
}
