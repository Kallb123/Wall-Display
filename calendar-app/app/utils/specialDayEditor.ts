import { LOOK_FIELDS, SPECIAL_DAY_PALETTES, effectiveLook, fillGreeting, specialDayInputSchema, specialDaySceneInputSchema, unfillablePlaceholders } from '../../shared/special-days'
import type { GreetingPlaceholder, SpecialDay, SpecialDayLead, SpecialDayLook, SpecialDayPalette, SpecialDayRepeat, SpecialDayScene } from '../../shared/special-days'
import { requestFailure } from './remote'
import { SERVER_UNREACHABLE } from './settings'

// What the special days editor works out from what it holds (architecture
// §7.6): the drafts the forms edit, the request bodies they make, the checks
// that run before anything is sent, how a day's look is marked as the scene's
// or its own, the greeting filled in for the next time it shows, and the words
// the list and the choices use. The server sends plain data, and every label is
// decided here so it can be tested. Text inputs are kept as typed (a half-typed
// number is still text), and only `dayBody` and `sceneBody` turn them into
// numbers. Pure: no Nuxt or Vue imports, and today's date is passed in.

// Drafts

/** What the day form edits. A look field of `null` is "use the scene's" (or the default, with no scene). */
export interface DayDraft {
  name: string
  /** 1 to 12. */
  month: number
  /** 1 to 31. */
  day: number
  /** Text; only used when `repeat` is `once`. */
  year: string
  repeat: SpecialDayRepeat
  scene_id: string | null
  who: string
  /** Text; blank is none. Only used when `repeat` is `yearly`. */
  since_year: string
  lead: SpecialDayLead | null
  /** Text; only used when `lead` is `days`. */
  lead_days: string
  takeover: boolean | null
  /** Null is the scene's. Blank, typed by the user, is saved as null too (the server does the same). */
  greeting: string | null
  palette: SpecialDayPalette | null
}

/** What the scene form edits. A scene is a whole look, so nothing in it is null. */
export interface SceneDraft {
  name: string
  lead: SpecialDayLead
  /** Text; only used when `lead` is `days`. */
  lead_days: string
  takeover: boolean
  /** Blank is none. */
  greeting: string
  palette: SpecialDayPalette
}

const text = (value: number | null): string => value === null ? '' : String(value)

/** A new yearly day on `today`'s month and day, with nothing of its look set. */
export function newDayDraft(today: string): DayDraft {
  return {
    name: '',
    month: Number(today.slice(5, 7)),
    day: Number(today.slice(8, 10)),
    year: '',
    repeat: 'yearly',
    scene_id: null,
    who: '',
    since_year: '',
    lead: null,
    lead_days: '',
    takeover: null,
    greeting: null,
    palette: null,
  }
}

/** The draft that edits `day`. */
export function dayDraftFrom(day: SpecialDay): DayDraft {
  return {
    name: day.name,
    month: day.month,
    day: day.day,
    year: text(day.year),
    repeat: day.repeat,
    scene_id: day.scene_id,
    who: day.who ?? '',
    since_year: text(day.since_year),
    lead: day.lead,
    lead_days: text(day.lead_days),
    takeover: day.takeover,
    greeting: day.greeting,
    palette: day.palette,
  }
}

/** A new scene: on the day, no takeover, the warm palette and no greeting. */
export function newSceneDraft(): SceneDraft {
  return { name: '', lead: 'day', lead_days: '', takeover: false, greeting: '', palette: 'warm' }
}

/** The draft that edits `scene`. */
export function sceneDraftFrom(scene: SpecialDayScene): SceneDraft {
  return {
    name: scene.name,
    lead: scene.lead,
    lead_days: text(scene.lead_days),
    takeover: scene.takeover,
    greeting: scene.greeting ?? '',
    palette: scene.palette,
  }
}

/**
 * A number typed in a field. Blank is null (nothing typed). Anything that isn't
 * a number is passed on as typed, so the schema refuses it and the message can
 * say so, rather than a quiet NaN.
 */
function typedNumber(value: string): number | string | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const number = Number(trimmed)
  return Number.isFinite(number) ? number : trimmed
}

/** The number typed in a field when it is a whole number, otherwise null. For showing, where a half-typed value is just not there yet. */
function wholeOrNull(value: string): number | null {
  const number = typedNumber(value)
  return typeof number === 'number' && Number.isInteger(number) ? number : null
}

const isBlank = (value: string | null): boolean => value === null || value.trim() === ''

/** The trimmed text, or null when there is none. */
const textOrNull = (value: string | null): string | null => isBlank(value) ? null : value!.trim()

/**
 * The request body for `POST` and `PUT /api/special-days`, from the draft:
 * trimmed, the numbers parsed, `year` null unless the day happens once,
 * `since_year` null unless it is yearly, `lead_days` null unless `lead` is
 * `days`, and a blank `who` or greeting null. Not validated: `validateDay` does that.
 */
export function dayBody(draft: DayDraft): Record<string, unknown> {
  return {
    name: draft.name.trim(),
    month: draft.month,
    day: draft.day,
    year: draft.repeat === 'once' ? typedNumber(draft.year) : null,
    repeat: draft.repeat,
    scene_id: draft.scene_id,
    who: textOrNull(draft.who),
    since_year: draft.repeat === 'yearly' ? typedNumber(draft.since_year) : null,
    lead: draft.lead,
    lead_days: draft.lead === 'days' ? typedNumber(draft.lead_days) : null,
    takeover: draft.takeover,
    greeting: textOrNull(draft.greeting),
    palette: draft.palette,
  }
}

/** The request body for `POST` and `PUT /api/special-day-scenes`, from the draft. Not validated: `validateScene` does that. */
export function sceneBody(draft: SceneDraft): Record<string, unknown> {
  return {
    name: draft.name.trim(),
    lead: draft.lead,
    lead_days: draft.lead === 'days' ? typedNumber(draft.lead_days) : null,
    takeover: draft.takeover,
    greeting: textOrNull(draft.greeting),
    palette: draft.palette,
  }
}

// Validation

/** What the form shows under a field, by field. `form` is a problem that belongs to no field. No keys means the draft is fine. */
export type FieldErrors = Partial<Record<keyof DayDraft | 'form', string>>
export type SceneFieldErrors = Partial<Record<keyof SceneDraft | 'form', string>>

/** How a field is named at the start of its message. */
const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  month: 'Month',
  day: 'Day',
  year: 'Year',
  repeat: 'Repeats',
  scene_id: 'Scene',
  who: 'Who',
  since_year: 'Since',
  lead: 'Show on the calendar from',
  lead_days: 'Days before',
  takeover: 'Full-screen takeover',
  greeting: 'Greeting',
  palette: 'Palette',
}

/** The fields that are numbers, which are told "must be a whole number" when they aren't. */
const NUMBER_FIELDS: ReadonlySet<string> = new Set(['month', 'day', 'year', 'since_year', 'lead_days'])

interface Issue {
  path: readonly PropertyKey[]
  code: string
  message: string
}

/**
 * The first problem for each field, worded with the field's label first. The
 * schema's messages are written to follow the field name ("must not be empty"),
 * the way the API words them.
 */
function fieldErrors(issues: readonly Issue[], fields: ReadonlySet<string>): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const issue of issues) {
    const first = issue.path[0]
    const key = typeof first === 'string' && fields.has(first) ? first : 'form'
    if (key in errors) continue
    if (key === 'form') errors[key] = upperFirst(issue.message)
    else if (issue.code === 'invalid_type' && NUMBER_FIELDS.has(key)) errors[key] = `${FIELD_LABELS[key]} must be a whole number`
    else if (key === 'lead_days' && issue.message.startsWith('is required')) errors[key] = `${FIELD_LABELS[key]} is required`
    else errors[key] = `${FIELD_LABELS[key]} ${issue.message}`
  }
  return errors
}

const DAY_FIELDS: ReadonlySet<string> = new Set(Object.keys(dayBody(newDayDraft('2000-01-01'))))
const SCENE_FIELDS: ReadonlySet<string> = new Set(Object.keys(sceneBody(newSceneDraft())))

/**
 * What is wrong with the day, by field, in words for under the field (such as
 * `Since must be from 1900 to 2100`), or no keys if it is fine. It is the
 * schema the server checks the body with, so the form and the server agree.
 * What only the server can know (that the scene exists, that the greeting can
 * be filled) is left to it.
 */
export function validateDay(draft: DayDraft): FieldErrors {
  const parsed = specialDayInputSchema.safeParse(dayBody(draft))
  return parsed.success ? {} : fieldErrors(parsed.error.issues, DAY_FIELDS)
}

/** `validateDay` for a scene. */
export function validateScene(draft: SceneDraft): SceneFieldErrors {
  const parsed = specialDaySceneInputSchema.safeParse(sceneBody(draft))
  return parsed.success ? {} : fieldErrors(parsed.error.issues, SCENE_FIELDS)
}

/** The draft's body as text, so two drafts that would save the same thing compare equal. */
const same = (a: Record<string, unknown>, b: Record<string, unknown>): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Whether saving the draft would change anything. A new day (`saved` null) is compared with a blank one, so it is dirty once anything has been typed. */
export function dayIsDirty(draft: DayDraft, saved: SpecialDay | null, today: string): boolean {
  return !same(dayBody(draft), dayBody(saved ? dayDraftFrom(saved) : newDayDraft(today)))
}

/** `dayIsDirty` for a scene; a new one (`saved` null) is compared with a blank one. */
export function sceneIsDirty(draft: SceneDraft, saved: SpecialDayScene | null): boolean {
  return !same(sceneBody(draft), sceneBody(saved ? sceneDraftFrom(saved) : newSceneDraft()))
}

// Scene or own

/** The parts of a look the editor marks. `lead` is `lead` and `lead_days` together; the art is `tile_art` and `full_art` (a day's `extra_art` is always its own). */
export type MarkedField = 'lead' | 'tile_art' | 'takeover' | 'full_art' | 'greeting' | 'palette'

/**
 * How a part of a day's look is marked: `scene` ("From Birthday") when it
 * follows the scene, `own` ("Changed", with Reset) when the day sets it, or null
 * when the day has no scene, so there is nothing to mark. The art isn't in the
 * draft, so for `tile_art` and `full_art` it is the saved day that says: own
 * when the day has art of its own.
 */
export function fieldOrigin(draft: DayDraft, saved: SpecialDay | null, field: MarkedField): 'scene' | 'own' | null {
  if (draft.scene_id === null) return null
  if (field === 'tile_art' || field === 'full_art') return (saved?.[field] ?? null) !== null ? 'own' : 'scene'
  const own = field === 'greeting' ? !isBlank(draft.greeting) : draft[field] !== null
  return own ? 'own' : 'scene'
}

/** The draft with a part of the look back to the scene's: null, and for `lead` the lead days cleared with it. The art is cleared with a `DELETE`, not here. */
export function resetField(draft: DayDraft, field: Exclude<MarkedField, 'tile_art' | 'full_art'>): DayDraft {
  if (field === 'lead') return { ...draft, lead: null, lead_days: '' }
  return { ...draft, [field]: null }
}

/**
 * The draft after choosing a scene, or null for None. Choosing a scene keeps
 * what the day sets (still marked Changed). Choosing None from a scene copies
 * the scene's values into every part of the look the day left to it, so the
 * day keeps the look it showed rather than falling back to the defaults.
 */
export function withScene(draft: DayDraft, sceneId: string | null, scenes: readonly SpecialDayScene[]): DayDraft {
  if (sceneId !== null) return { ...draft, scene_id: sceneId }
  const scene = scenes.find(candidate => candidate.id === draft.scene_id)
  if (!scene) return { ...draft, scene_id: null }
  return {
    ...draft,
    scene_id: null,
    lead: draft.lead ?? scene.lead,
    lead_days: draft.lead === null ? text(scene.lead_days) : draft.lead_days,
    takeover: draft.takeover ?? scene.takeover,
    greeting: isBlank(draft.greeting) ? scene.greeting : draft.greeting,
    palette: draft.palette ?? scene.palette,
  }
}

/** The look the form shows for the draft: its own values over the scene's, with the art the saved day has (the art isn't in the draft). */
export function draftLook(draft: DayDraft, saved: SpecialDay | null, scene: SpecialDayScene | null): SpecialDayLook {
  return effectiveLook({
    lead: draft.lead,
    lead_days: draft.lead === 'days' ? wholeOrNull(draft.lead_days) : null,
    tile_art: saved?.tile_art ?? null,
    takeover: draft.takeover,
    full_art: saved?.full_art ?? null,
    greeting: textOrNull(draft.greeting),
    palette: draft.palette,
  }, scene)
}

// Dates and greetings

const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate()

const isoDate = (year: number, month: number, day: number): string => new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10)

/** The day-of-month and month of a day, when they are a real date at all. */
function validMonthDay(month: number, day: number): boolean {
  return Number.isInteger(month) && Number.isInteger(day) && month >= 1 && month <= 12 && day >= 1 && day <= 31
}

/**
 * The date `month` and `day` fall on in `year`, or null if they don't. Like the
 * wall, a 29 February that is not in the year falls on 28 February.
 */
function dateIn(year: number, month: number, day: number, yearly: boolean): string | null {
  if (!validMonthDay(month, day)) return null
  const last = daysInMonth(year, month)
  if (day > last && !(yearly && month === 2 && day === 29)) return null
  return isoDate(year, month, Math.min(day, last))
}

/**
 * The next date, `YYYY-MM-DD`, on or after `today` that the draft falls on, or
 * null if there is none: a day that happens once and has passed (or has no
 * year yet), or a date that doesn't exist. A yearly day with a `since_year`
 * has no occurrence in that year or before it.
 */
export function nextOccurrence(draft: DayDraft, today: string): string | null {
  if (draft.repeat === 'once') {
    const year = wholeOrNull(draft.year)
    if (year === null) return null
    const date = dateIn(year, draft.month, draft.day, false)
    return date !== null && date >= today ? date : null
  }
  const since = wholeOrNull(draft.since_year)
  const first = Math.max(Number(today.slice(0, 4)), since === null ? 0 : since + 1)
  // This year's, or next year's if this year's has gone by.
  for (const year of [first, first + 1]) {
    const date = dateIn(year, draft.month, draft.day, true)
    if (date !== null && date >= today) return date
  }
  return null
}

/** What fills a greeting's placeholders for a draft: its `who`, and its `since_year` if it is yearly. */
function greetingFacts(draft: DayDraft): Pick<SpecialDay, 'who' | 'since_year'> {
  return { who: textOrNull(draft.who), since_year: draft.repeat === 'yearly' ? wholeOrNull(draft.since_year) : null }
}

/**
 * The line under the greeting field: the greeting the day shows, filled in for
 * the next time it falls (`Happy 7th birthday, Isla!` on `2027-03-14`), or
 * null when there is no greeting. The day's own greeting wins over its scene's.
 * `missing` lists the placeholders the day has nothing to fill, which stay as
 * typed in `text`. A day with no next occurrence is filled for today's year.
 */
export function greetingPreview(draft: DayDraft, scene: SpecialDayScene | null, today: string): { text: string, date: string | null, missing: GreetingPlaceholder[] } | null {
  const greeting = textOrNull(draft.greeting) ?? textOrNull(scene?.greeting ?? null)
  if (greeting === null) return null
  const facts = greetingFacts(draft)
  const date = nextOccurrence(draft, today)
  const year = Number((date ?? today).slice(0, 4))
  return { text: fillGreeting(greeting, facts, year), date, missing: unfillablePlaceholders(facts, { greeting }) }
}

/**
 * A scene's greeting filled in through the first of `days` that uses the scene,
 * as the wall's preview does, with that day's name and the date it next falls
 * on. Null when the greeting is blank or no day uses the scene.
 */
export function sceneGreetingPreview(draft: SceneDraft, days: readonly SpecialDay[], sceneId: string | null, today: string): { text: string, day: string, date: string | null, missing: GreetingPlaceholder[] } | null {
  const greeting = textOrNull(draft.greeting)
  const day = sceneId === null ? undefined : days.find(candidate => candidate.scene_id === sceneId)
  if (greeting === null || !day) return null
  const date = nextOccurrence(dayDraftFrom(day), today)
  const year = Number((date ?? today).slice(0, 4))
  return { text: fillGreeting(greeting, day, year), day: day.name, date, missing: unfillablePlaceholders(day, { greeting }) }
}

// List rows

/** The long month names, January first. */
const monthFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long' })
const MONTH_NAMES = Array.from({ length: 12 }, (_, i) => monthFormat.format(new Date(Date.UTC(2000, i, 1))))

/** `{ day: '14', month: 'Mar' }`: the date chip in the list. The month is cut to three letters, as en-GB spells September "Sept". */
export function dateChip(day: Pick<SpecialDay, 'month' | 'day'>): { day: string, month: string } {
  return { day: String(day.day), month: (MONTH_NAMES[day.month - 1] ?? '').slice(0, 3) }
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

/**
 * The line under a day's name in the list. On a scene: `Birthday scene`, with
 * ` · 1 change` or ` · 2 changes` for the parts of the look the day sets itself
 * and ` · extra layer` if it has one. Without a scene (or with one that has
 * since been deleted): `Every year` or `Once in 2027`, then `tile art` and
 * `full screen` if its look has them.
 */
export function daySummary(day: SpecialDay, scenes: readonly SpecialDayScene[]): string {
  const scene = day.scene_id === null ? undefined : scenes.find(candidate => candidate.id === day.scene_id)
  if (scene) {
    const changes = LOOK_FIELDS.filter(field => day[field] !== null).length
    return [`${scene.name} scene`, changes > 0 ? plural(changes, 'change', 'changes') : null, day.extra_art === null ? null : 'extra layer']
      .filter(part => part !== null)
      .join(' · ')
  }
  const look = effectiveLook(day)
  return [
    day.repeat === 'once' ? (day.year === null ? 'Once' : `Once in ${day.year}`) : 'Every year',
    look.tile_art === null ? null : 'tile art',
    look.takeover ? 'full screen' : null,
  ].filter(part => part !== null).join(' · ')
}

/** `Not used yet`, `Used by 1 day`, `Used by 4 days`. */
export function usedByLabel(count: number): string {
  return count === 0 ? 'Not used yet' : `Used by ${plural(count, 'day', 'days')}`
}

/** The days that use the scene, in the order given. */
export function daysUsing(sceneId: string, days: readonly SpecialDay[]): SpecialDay[] {
  return days.filter(day => day.scene_id === sceneId)
}

/** What the page says after a scene is saved, which changes every day that uses it. */
export function sceneSavedMessage(count: number): string {
  return count === 0 ? 'Saved. No days use this scene yet.' : `Saved. This changes ${plural(count, 'day', 'days')}.`
}

// Choices

export const LEAD_OPTIONS: readonly { value: SpecialDayLead, label: string }[] = [
  { value: 'day', label: 'On the day' },
  { value: 'week', label: 'A week before' },
  { value: 'month', label: 'All month' },
  { value: 'days', label: 'Days before' },
]

/** `On the day`, `A week before`, `All month`, `10 days before`, `1 day before`. */
export function leadLabel(lead: SpecialDayLead, leadDays: number | null): string {
  if (lead === 'days' && leadDays !== null) return `${plural(leadDays, 'day', 'days')} before`
  return LEAD_OPTIONS.find(option => option.value === lead)?.label ?? lead
}

const PALETTE_LABELS: Record<SpecialDayPalette, string> = { warm: 'Warm', night: 'Night', frost: 'Frost', sage: 'Sage' }

export const PALETTE_OPTIONS: readonly { value: SpecialDayPalette, label: string }[] = SPECIAL_DAY_PALETTES.map(value => ({ value, label: PALETTE_LABELS[value] }))

export const REPEAT_OPTIONS: readonly { value: SpecialDayRepeat, label: string }[] = [
  { value: 'yearly', label: 'Every year' },
  { value: 'once', label: 'Once' },
]

/** The months, 1 to 12, named in full. */
export const MONTH_OPTIONS: readonly { value: number, label: string }[] = MONTH_NAMES.map((label, i) => ({ value: i + 1, label }))

/**
 * The days to choose from, 1 up to the last of the month. A yearly day can be
 * 29 February. A day that happens once uses the year, if it has one typed.
 */
export function dayOptions(month: number, repeat: SpecialDayRepeat, year: string): number[] {
  if (!Number.isInteger(month) || month < 1 || month > 12) return Array.from({ length: 31 }, (_, i) => i + 1)
  const typed = repeat === 'once' ? wholeOrNull(year) : null
  // 2024 is a leap year; so is the year to use when there is none to go by.
  const last = daysInMonth(typed !== null && typed >= 1 && typed <= 9999 ? typed : 2024, month)
  return Array.from({ length: last }, (_, i) => i + 1)
}

// Errors

/** `isla` as `Isla`. */
export function upperFirst(message: string): string {
  return message.charAt(0).toUpperCase() + message.slice(1)
}

/**
 * Words a write that failed. No answer is "Couldn't reach the server". A 400
 * or 409 is the server's own message, which names the field or says what is in
 * the way, with a capital letter. Anything else is `fallback`.
 */
export function writeFailure(error: unknown, fallback: string): string {
  const { status, message } = requestFailure(error)
  if (status === null) return SERVER_UNREACHABLE
  if ((status === 400 || status === 409) && message) return upperFirst(message)
  return fallback
}
