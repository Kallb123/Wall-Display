import { z } from 'zod'
import { isSingleEmoji } from '../../shared/emoji'
import { CAMERA_KINDS, commandSchema, layoutIdSchema, MOTIONS, NIGHT_TEXTS, ORIENTATIONS, scheduleIdSchema, TAKEOVER_ART_PLACES, VIEWS } from '../../shared/display'
import type { CameraKind } from '../../shared/display'
import { photoFeedIdSchema } from '../../shared/photos'
import { isSourceName, photoFeedIdsOf, resolveImmich } from '../photos/feeds'

// The shape of config.yaml. Keys stay snake_case, as written in the YAML.
// Pure: no file access. The one environment-specific part is where a relative
// `file:` URL starts from, so the schema is built by a function.

const slug = z.string().regex(
  /^[a-z0-9][a-z0-9-]*$/,
  'must be lowercase letters, digits and hyphens, starting with a letter or digit',
)

const text = z.string().trim().min(1, 'must not be empty')

const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a colour like "#C67139" (quote it, as # starts a YAML comment)')

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a 24-hour time like "22:30" (quote it)')

const httpUrl = z.string().check((ctx) => {
  if (!isHttpUrl(ctx.value)) {
    ctx.issues.push({ code: 'custom', message: 'must be an http:// or https:// URL', input: ctx.value, continue: true })
  }
})

const timezone = z.string().check((ctx) => {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: ctx.value })
  } catch {
    ctx.issues.push({ code: 'custom', message: 'must be an IANA time zone such as "Europe/London"', input: ctx.value, continue: true })
  }
})

// Matches case-insensitively, as person detection does. The reason is
// reported without the pattern, which V8 repeats in its message.
const rulePattern = z.string().min(1, 'must not be empty').check((ctx) => {
  try {
    new RegExp(ctx.value, 'i')
  } catch (error) {
    const reason = error instanceof Error
      ? error.message.replace(/^Invalid regular expression: \/[\s\S]*\/[a-z]*: /, '')
      : 'cannot be compiled'
    ctx.issues.push({ code: 'custom', message: `invalid regular expression: ${reason}`, input: ctx.value, continue: true })
  }
})

// The broker's address. Credentials go in `username` and `password`, never in
// the URL, so nothing secret reaches a log line that prints the address.
const mqttUrl = z.string().check((ctx) => {
  const problem = mqttUrlProblem(ctx.value)
  if (problem) ctx.issues.push({ code: 'custom', message: problem, input: ctx.value, continue: true })
})

function mqttUrlProblem(value: string): string | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'must be an mqtt:// or mqtts:// URL such as mqtt://mosquitto:1883'
  }
  if (url.protocol !== 'mqtt:' && url.protocol !== 'mqtts:') return 'must be an mqtt:// or mqtts:// URL such as mqtt://mosquitto:1883'
  if (url.hostname === '') return 'must include the broker\'s host name, as in mqtt://mosquitto:1883'
  if (url.username !== '' || url.password !== '') return 'must not contain a username or password (use the username and password settings instead)'
  if ((url.pathname !== '' && url.pathname !== '/') || url.search !== '' || url.hash !== '') return 'must be just the broker\'s host and optional port, with no path'
  return undefined
}

export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

const person = z.strictObject({
  id: slug,
  name: text,
  colour,
  initial: z.string().refine(value => [...value].length === 1, 'must be a single character').optional(),
  aliases: z.array(text).default([]),
}).transform(value => ({
  ...value,
  initial: value.initial ?? [...value.name][0]!.toUpperCase(),
}))

// A named set of people ("the kids"). An event for the group is for each member.
const group = z.strictObject({
  id: slug,
  name: text,
  aliases: z.array(text).default([]),
  people: z.array(text).min(1, 'must list at least one person id'),
})

/** The days a schedule rule's window, or a calendar rule's event, can start on, Monday first. A rule's `days` is normalised to these. */
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type Weekday = (typeof WEEKDAYS)[number]

const DAY_SETS: Record<'every_day' | 'weekdays' | 'weekends', Weekday[]> = {
  every_day: [...WEEKDAYS],
  weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  weekends: ['sat', 'sun'],
}

// `every_day`, `weekdays`, `weekends`, or a list of day names. Always comes out as a list in week order with no repeats.
const days = z.union([
  z.enum(['every_day', 'weekdays', 'weekends']).transform(value => DAY_SETS[value]),
  z.array(z.enum(WEEKDAYS, { error: 'must be mon, tue, wed, thu, fri, sat or sun' })).min(1, 'must list at least one day'),
], { error: 'must be every_day, weekdays, weekends, or a list of days such as [mon, wed, fri]' })
  .transform(list => WEEKDAYS.filter(day => list.includes(day)))

const emoji = z.string().check((ctx) => {
  if (!isSingleEmoji(ctx.value)) {
    ctx.issues.push({ code: 'custom', message: 'must be a single emoji like "🍽️" (quote it)', input: ctx.value, continue: true })
  }
})

// A rule gives matching events people, an icon, or both. It matches on the
// event's text (`match`), on when it starts (`from` and `to`, `days`), or on
// both, so a meal calendar can tell lunch from dinner when the titles are
// only the dishes. `from` and `to` are wall-clock times in the config's time
// zone: a timed event matches if it starts at or after `from` and before `to`
// (`from` after `to` runs past midnight). All-day events have no start time,
// so a rule with `from` and `to` never matches them. `days` is the day the
// event starts, and left out means any day.
const rule = z.strictObject({
  match: rulePattern.optional(),
  people: z.array(text).min(1, 'must list at least one person or group id (or leave people out of a rule that only sets an icon)').default([]),
  icon: emoji.optional(),
  from: time.optional(),
  to: time.optional(),
  days: days.optional(),
}).superRefine((value, ctx) => {
  const issue = (message: string, path: string[] = []) => ctx.addIssue({ code: 'custom', message, path })
  if (value.people.length === 0 && value.icon === undefined) issue('must set people, an icon, or both')
  if (value.from !== undefined && value.to === undefined) issue('is missing: a rule with from needs to as well', ['to'])
  if (value.to !== undefined && value.from === undefined) issue('is missing: a rule with to needs from as well', ['from'])
  if (value.from !== undefined && value.from === value.to) issue('from and to must differ (leave both out to match at any time)', ['to'])
  if (value.match === undefined && value.from === undefined && value.to === undefined && value.days === undefined) {
    issue('must set match, a time (from and to), days, or a mix of them')
  }
})

const icsSource = (baseDir: string) => z.strictObject({
  type: z.literal('ics'),
  url: icsUrl(baseDir),
  poll_seconds: z.number().int().min(30).default(120),
})

const homeassistantSource = z.strictObject({
  type: z.literal('homeassistant'),
  entity_id: z.string().regex(/^calendar\.\w+$/, 'must be a calendar entity id like "calendar.bin_collection"'),
  poll_seconds: z.number().int().min(30).default(300),
})

const calendar = (baseDir: string) => z.strictObject({
  id: slug,
  name: text.optional(),
  person: text,
  icon: emoji.optional(),
  detect_people: z.union([z.boolean(), z.literal('anywhere')], { error: 'must be true, false or "anywhere"' }).default(true),
  detect_in: z.array(z.enum(['title', 'description'])).min(1, 'must list "title", "description" or both').default(['title', 'description']),
  strip_names: z.boolean().default(false),
  rules: z.array(rule).default([]),
  source: z.discriminatedUnion('type', [icsSource(baseDir), homeassistantSource], { error: 'type must be "ics" or "homeassistant"' }),
})

// One window of a built-in schedule (PR 5.4): the wall shows `view` from `from` until `to`, in the config's time zone,
// on the days listed (the custom view needs the `layout` it shows). A window with `from` after `to` runs past midnight, and `days` names the day it starts.
const scheduleRule = z.strictObject({
  view: z.enum(VIEWS, { error: `must be one of ${VIEWS.join(', ')}` }),
  /** The id of the custom layout (PR 5.17) when `view` is custom. The layouts live in the database, so whether it exists is checked when the window starts. */
  layout: layoutIdSchema.optional(),
  /** The photo feed shown while the window is in charge (a source such as unsplash, or a `photos.feeds` id). Left out, the display's own. */
  photo_feed: photoFeedIdSchema.optional(),
  from: time,
  to: time,
  days: days.default([...WEEKDAYS]),
}).refine(value => value.from !== value.to, {
  message: 'from and to must differ (a window from a time to the same time would be all day or never)',
  path: ['to'],
})

// A named set of rules that Home Assistant can turn off as one (a switch per schedule).
const schedule = z.strictObject({
  id: scheduleIdSchema,
  /** What Home Assistant calls the schedule's switch. Left out, the id. */
  name: text.optional(),
  rules: z.array(scheduleRule).min(1, 'must have at least one rule'),
}).transform(value => ({ ...value, name: value.name ?? value.id }))

// A camera the wall can show over its view (a doorbell, say), by the address of
// a feed the wall's browser loads itself, such as one from go2rtc. `kind` says
// how to show it; left as `auto` it is read from the address (see
// `cameraKindFor`). The address goes to the displays, so it must be one the
// wall can reach, and should hold no password.
const camera = z.strictObject({
  id: slug,
  name: text.optional(),
  url: httpUrl,
  kind: z.enum(['auto', ...CAMERA_KINDS], { error: `must be auto, ${CAMERA_KINDS.join(', ')}` }).default('auto'),
}).transform(value => ({
  id: value.id,
  name: value.name ?? value.id,
  url: value.url,
  kind: value.kind === 'auto' ? cameraKindFor(value.url) : value.kind,
}))

/**
 * How to show a feed, read from its address: go2rtc's `stream.mp4` (or any
 * `.mp4` or `.webm`) is a video, `stream.mjpeg` and `frame.jpeg` (or any
 * picture) are an image, and anything else, go2rtc's `stream.html` included,
 * is a page in a frame.
 */
export function cameraKindFor(url: string): CameraKind {
  let path: string
  try {
    path = new URL(url).pathname.toLowerCase()
  } catch {
    return 'page'
  }
  if (/\.(mp4|webm)$/.test(path)) return 'video'
  if (/\.(mjpeg|mjpg|jpe?g|png|webp|gif)$/.test(path)) return 'image'
  return 'page'
}

// A Home Assistant state as a trigger names it. States are text, so a number is
// taken as its text; true and false are refused, as `on` and `off` are meant.
const haState = z.union([
  z.string().min(1, 'must not be empty'),
  z.number().transform(String),
], { error: 'must be a state such as "on" (quote it)' })
const haStates = z.union([haState.transform(value => [value]), z.array(haState).min(1, 'must list at least one state')], { error: 'must be a state such as "on", or a list of states (quote them)' })
const entityId = z.string().regex(/^[a-z0-9_]+\.[a-z0-9_]+$/, 'must be an entity id like "binary_sensor.front_doorbell"')

/**
 * What a trigger listens for: an entity changing state (`entity_id`, with
 * optional `from` and `to`), or an event on Home Assistant's bus (`event_type`,
 * with optional `event_data` that the event's data must contain).
 */
const triggerWhen = z.strictObject({
  entity_id: z.union([entityId.transform(value => [value]), z.array(entityId).min(1, 'must list at least one entity id')]).optional(),
  from: haStates.optional(),
  to: haStates.optional(),
  event_type: z.string().regex(/^[A-Za-z0-9_.-]+$/, 'must be an event type like "doorbell_pressed"').optional(),
  event_data: z.record(z.string(), z.unknown()).optional(),
}).superRefine((value, ctx) => {
  const issue = (message: string, path: string[] = []) => ctx.addIssue({ code: 'custom', message, path })
  if ((value.entity_id === undefined) === (value.event_type === undefined)) issue('must set either entity_id (a state change) or event_type (an event), not both')
  if (value.event_type !== undefined) {
    if (value.from !== undefined) issue('is only for a state change (entity_id)', ['from'])
    if (value.to !== undefined) issue('is only for a state change (entity_id)', ['to'])
  }
  if (value.entity_id !== undefined && value.event_data !== undefined) issue('is only for an event (event_type)', ['event_data'])
}).transform((value): TriggerWhen => value.entity_id !== undefined
  ? { kind: 'state', entity_ids: value.entity_id, from: value.from ?? null, to: value.to ?? null }
  : { kind: 'event', event_type: value.event_type!, event_data: value.event_data ?? null })

export type TriggerWhen =
  | { kind: 'state', entity_ids: string[], from: string[] | null, to: string[] | null }
  | { kind: 'event', event_type: string, event_data: Record<string, unknown> | null }

// Something in Home Assistant that the wall acts on (a doorbell ringing): when
// it happens, each of `actions`, which are the commands `POST /api/displays/:id/commands`
// takes, is applied to each display in `displays` (every display if left out).
const trigger = z.strictObject({
  id: slug,
  when: triggerWhen,
  displays: z.array(slug).min(1, 'must list at least one display id (or leave displays out for every display)').optional(),
  actions: z.array(commandSchema).min(1, 'must have at least one action'),
})

// The fields of a display that can also be changed on the settings page (PR 5.6),
// without their defaults. The page checks a saved change with these same
// schemas, so the ranges and messages are the config's.
export const displayFields = {
  theme: z.enum(['light', 'dark']),
  month_style: z.enum(['soft', 'classic']),
  month_return_minutes: z.number().int().min(1).max(1440),
  week_start: z.enum(['monday', 'sunday']),
  /** Shift the content in a slow orbit and move the photo frame's pill between corners, against burn-in (PR 5.3). */
  burn_in: z.boolean(),
  /** Slow ambient motion on the wall (the photo frame's pan and zoom): `off` or `subtle`. */
  motion: z.enum(MOTIONS),
  /** Where a special day's takeover art is drawn: `behind` the view, `over` it, or `over_in_portrait` (over on the portrait stage only). */
  takeover_art: z.enum(TAKEOVER_ART_PLACES),
  /** What the night view shows under its clock (PR 5.2). `next_alarm` needs the top-level `alarm` block. */
  night_text: z.enum(NIGHT_TEXTS),
  /**
   * Which way up the display is laid out (PR 5.10): `auto` follows the shape of
   * the window (portrait when it is taller than it is wide), the others fix it.
   * `?orientation=` on the display's URL overrides this for one device.
   */
  orientation: z.enum(ORIENTATIONS),
  /**
   * The hours the week view draws in full, `from` to `to` (PR 5.1). The hours
   * before `from` and from `to` on are folded into a thin band at the top and
   * bottom of each day, so a quiet night does not use up the screen. Whole
   * hours only: `from` is 0 to 23 and `to` is 1 to 24 (24 is midnight at the end of the day).
   */
  week_hours: z.strictObject({
    from: z.number().int('must be a whole number').min(0, 'must be from 0 to 23').max(23, 'must be from 0 to 23'),
    to: z.number().int('must be a whole number').min(1, 'must be from 1 to 24').max(24, 'must be from 1 to 24'),
  }).refine(hours => hours.from < hours.to, { message: 'week_hours.from must be before week_hours.to' }),
  /**
   * Where the week by part of day view splits a day (PR 5.16): morning is from
   * midnight to `afternoon`, afternoon to `evening`, evening to midnight. Whole
   * hours, `afternoon` 1 to 22 and `evening` 2 to 23, `afternoon` before `evening`.
   */
  day_parts: z.strictObject({
    afternoon: z.number().int('must be a whole number').min(1, 'must be from 1 to 22').max(22, 'must be from 1 to 22'),
    evening: z.number().int('must be a whole number').min(2, 'must be from 2 to 23').max(23, 'must be from 2 to 23'),
  }).refine(parts => parts.afternoon < parts.evening, { message: 'day_parts.afternoon must be before day_parts.evening' }),
  /**
   * Which views draw the day's forecast next to their dates: the month's day
   * cells, the week's column headings, the week by part of day's row heads and
   * the agenda's day headings. Each key is optional and on when left out, so a
   * config can switch off just one view.
   */
  weather_on_dates: z.strictObject({
    month: z.boolean({ error: 'must be true or false' }).default(true),
    week: z.boolean({ error: 'must be true or false' }).default(true),
    week_parts: z.boolean({ error: 'must be true or false' }).default(true),
    agenda: z.boolean({ error: 'must be true or false' }).default(true),
  }),
  /**
   * Whether the views show an event's location as a quieter second line under
   * its title, where there is room left over once every title has what it needs.
   */
  show_locations: z.boolean(),
}

const display = z.strictObject({
  id: slug,
  name: text,
  theme: displayFields.theme.default('light'),
  month_style: displayFields.month_style.default('soft'),
  month_return_minutes: displayFields.month_return_minutes.default(15),
  week_start: displayFields.week_start.default('monday'),
  burn_in: displayFields.burn_in.default(true),
  motion: displayFields.motion.default('off'),
  takeover_art: displayFields.takeover_art.default('behind'),
  night_text: displayFields.night_text.default('none'),
  orientation: displayFields.orientation.default('auto'),
  week_hours: displayFields.week_hours.default({ from: 7, to: 21 }),
  day_parts: displayFields.day_parts.default({ afternoon: 12, evening: 17 }),
  weather_on_dates: displayFields.weather_on_dates.default({ month: true, week: true, week_parts: true, agenda: true }),
  show_locations: displayFields.show_locations.default(true),
  /** Built-in schedules (PR 5.4): rules that change the view at set times. Each can be turned off from Home Assistant. */
  schedules: z.array(schedule).default([]),
})

/** What a gesture of the button can be set to (`button.single`, `double`, `long`). server/control/button.ts says what each does. */
export const BUTTON_ACTIONS = [
  'next_view',
  'toggle_photo',
  'next_photo',
  'toggle_screen',
  'next_month',
  'prev_month',
  'this_month',
  'next_week',
  'prev_week',
  'this_week',
  'refresh',
  'ha', // the app ignores the gesture; Home Assistant decides
  'none',
] as const

const buttonAction = z.enum(BUTTON_ACTIONS)

const button = z.strictObject({
  single: buttonAction.default('next_view'),
  double: buttonAction.default('toggle_photo'),
  long: buttonAction.default('ha'),
})

/** What the button does when the config has no `button` block, or leaves a gesture out. */
export const DEFAULT_BUTTON = button.parse({})

const curveBrightness = z.number().int('must be a whole number').min(0, 'must be from 0 to 100').max(100, 'must be from 0 to 100')

// The policy and photo fields that can also be changed on the settings page (PR 5.6), without their defaults.
export const sharedFields = {
  photo_interval_seconds: z.number().int().min(5),
  off_after_minutes: z.number().int().min(1),
  // A window from a time to the same time is either all day or never, and the two readings are opposite, so say which is meant by leaving the block out.
  quiet_hours: z.strictObject({ from: time, to: time }).refine(value => value.from !== value.to, {
    message: 'from and to must differ (leave quiet_hours out for no quiet hours)',
    path: ['to'],
  }),
  // The brightness only moves once the curve says it should by this much, so a reading that hovers on a step doesn't make it flicker. Reaching either end of the curve is always allowed.
  min_step: z.number().int().min(1).max(50),
  // The time constant of the smoothing: how quickly the lux reading is followed. 0 follows each reading at once.
  smoothing_seconds: z.number().min(0).max(600),
  night_below_lux: z.number().positive(),
  // Light again from here up. Left out, twice night_below_lux, so a room hovering around the threshold doesn't flip in and out of the night action.
  night_above_lux: z.number().positive(),
  night_action: z.enum(['none', 'night_view', 'screen_off']),
}

const policies = z.strictObject({
  auto_presence: z.strictObject({
    off_after_minutes: sharedFields.off_after_minutes.default(10),
    quiet_hours: sharedFields.quiet_hours.optional(),
  }).prefault({}),
  auto_brightness: z.strictObject({
    // Lux to brightness. It is read on a log scale between the points and flat beyond the ends, so two points are the least that make a curve.
    curve: z.array(z.strictObject({ lux: z.number().min(0), brightness: curveBrightness }))
      .min(2, 'must have at least two points (a lux and a brightness each)')
      .refine(points => points.every((point, index) => index === 0 || point.lux > points[index - 1]!.lux), {
        message: 'lux must go up from each point to the next',
      })
      .default([{ lux: 0, brightness: 30 }, { lux: 20, brightness: 60 }, { lux: 200, brightness: 100 }]),
    min_step: sharedFields.min_step.default(5),
    smoothing_seconds: sharedFields.smoothing_seconds.default(30),
    night_below_lux: sharedFields.night_below_lux.optional(),
    night_above_lux: sharedFields.night_above_lux.optional(),
    night_action: sharedFields.night_action.default('none'),
  }).superRefine((value, ctx) => {
    if (value.night_action !== 'none' && value.night_below_lux === undefined) {
      ctx.addIssue({ code: 'custom', message: `is needed when night_action is ${value.night_action} (the room counts as dark below it)`, path: ['night_below_lux'] })
    }
    if (value.night_above_lux === undefined) return
    if (value.night_below_lux === undefined) {
      ctx.addIssue({ code: 'custom', message: 'needs night_below_lux as well (the room counts as dark below that, and light again from here)', path: ['night_above_lux'] })
    } else if (value.night_above_lux <= value.night_below_lux) {
      ctx.addIssue({ code: 'custom', message: 'must be more than night_below_lux (the room counts as light again from here)', path: ['night_above_lux'] })
    }
  }).prefault({}),
})

// One or more `/`-separated segments. No `+` or `#`, which are wildcards in a topic filter, and no leading or trailing slash.
const discoveryPrefix = z.string().regex(
  /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/,
  'must be one or more topic levels of letters, digits, hyphens and underscores, such as homeassistant (no wildcards, no leading or trailing slash)',
)

// Left out, MQTT is off. Each display connects as `<client_id>-<display id>`.
// `discovery` publishes Home Assistant's discovery configs, under `discovery_prefix`, which is the prefix Home Assistant listens on.
const mqtt = z.strictObject({
  url: mqttUrl,
  username: text.optional(),
  password: z.string().min(1, 'must not be empty').optional(),
  client_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'must be 1 to 64 letters, digits, hyphens and underscores').default('wallcal'),
  discovery: z.boolean().default(true),
  discovery_prefix: discoveryPrefix.default('homeassistant'),
}).refine(value => value.password === undefined || value.username !== undefined, {
  message: 'needs a username as well (a password on its own is not sent)',
  path: ['password'],
})

// The rolling window of events kept in the database, in whole months around
// the current month. The remote's month picker reaches 12 months either side.
const sync = z.strictObject({
  months_back: z.number().int().min(0).max(60).default(12),
  months_ahead: z.number().int().min(0).max(60).default(12),
})

// The Home Assistant `weather` entity to show on the wall (PR 2.7). Left out,
// the wall shows no weather. It is read through the `homeassistant` block, and
// the entity must be able to give a daily forecast.
const weather = z.strictObject({
  entity_id: z.string().regex(/^weather\.\w+$/, 'must be a weather entity id like "weather.home"'),
  poll_seconds: z.number().int().min(60).default(600),
})

// The Home Assistant entity that holds the next alarm (PR 5.2), for a display
// whose night view has `night_text: next_alarm`: a timestamp sensor (such as
// the companion app's `sensor.<phone>_next_alarm`) or an `input_datetime` with
// a date. Read through the `homeassistant` block, like the weather.
const alarm = z.strictObject({
  entity_id: z.string().regex(/^(sensor|input_datetime)\.\w+$/, 'must be a sensor or input_datetime entity id like "sensor.phone_next_alarm"'),
  poll_seconds: z.number().int().min(30).default(300),
})

// The Home Assistant entities that hold kitchen timers: a speaker's timers
// sensor from the ha-google-home integration (`sensor.<speaker>_timers`) or a
// `timer.*` helper. Each shows on the listed displays, or on every display if
// `displays` is left out. They are read through the `homeassistant` block, by
// polling every `poll_seconds` and, when the token allows it, as Home Assistant
// reports changes. `done_seconds` is how long a timer that ran out stays up,
// saying Done.
const timerEntity = z.strictObject({
  entity_id: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/, 'must be an entity id like "sensor.kitchen_speaker_timers" or "timer.pasta"'),
  displays: z.array(slug).min(1, 'must list at least one display id (or leave displays out for every display)').optional(),
})
const timers = z.strictObject({
  entities: z.array(timerEntity).min(1, 'must list at least one entity'),
  poll_seconds: z.number().int().min(5).default(30),
  done_seconds: z.number().int().min(0).max(600).default(60),
})

// Immich (architecture §5.2). `mode` says which photos make the pool: the
// albums in `album_ids`, a random pick from the whole library (narrowed by the
// `random` filters), or today's memories. Left out, it is `albums` when there
// are album ids and `random` when there are none, which is what a config from
// before the modes meant. The URL may have a path (Immich behind a reverse
// proxy) but not credentials: the API key is its own setting and must never
// end up in an address that is logged.
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'must be an id like "2f1c5a0e-3b7d-4c1a-9e57-6a1d2b8c4f90"')

// A day (2024-01-31) or a time (2024-01-31T09:30:00Z). Written out in full
// for Immich: a bare day is the start of that day in UTC for `taken_after`, and
// the end of it for `taken_before`, so "before 2024-12-31" includes the 31st.
const isoDate = (edge: 'start' | 'end') => z.string().trim().transform((value, ctx) => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const full = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value)
  const date = day ? new Date(`${value}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`) : full ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime()) || (day && date.toISOString().slice(0, 10) !== value)) {
    ctx.issues.push({ code: 'custom', message: 'must be a date like "2024-01-31" or a time like "2024-01-31T09:30:00Z" (quote it)', input: value })
    return z.NEVER
  }
  return date.toISOString()
})

const immichRandom = z.strictObject({
  count: z.number().int().min(1).max(1000).default(200),
  person_ids: z.array(uuid).default([]),
  taken_after: isoDate('start').optional(),
  taken_before: isoDate('end').optional(),
}).refine(value => value.taken_after === undefined || value.taken_before === undefined || value.taken_after < value.taken_before, {
  message: 'taken_after must be earlier than taken_before',
  path: ['taken_after'],
})

// The same filters for a feed, none of them required: what is left out is the block's.
function immichRandomFeed() {
  return z.strictObject({
    count: z.number().int().min(1).max(1000).optional(),
    person_ids: z.array(uuid).optional(),
    taken_after: isoDate('start').optional(),
    taken_before: isoDate('end').optional(),
  }).refine(value => value.taken_after === undefined || value.taken_before === undefined || value.taken_after < value.taken_before, {
    message: 'taken_after must be earlier than taken_before',
    path: ['taken_after'],
  })
}

const immich = z.strictObject({
  url: httpUrl.check((ctx) => {
    if (!isHttpUrl(ctx.value)) return
    const { username, password } = new URL(ctx.value)
    if (username !== '' || password !== '') {
      ctx.issues.push({ code: 'custom', message: 'must not contain a username or password (the API key is the api_key setting)', input: ctx.value, continue: true })
    }
  }),
  api_key: text,
  mode: z.enum(['albums', 'random', 'memories']).optional(),
  album_ids: z.array(text).default([]),
  random: immichRandom.prefault({}),
}).superRefine((value, ctx) => {
  if (value.mode === 'albums' && value.album_ids.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'mode "albums" needs at least one album id in album_ids', path: ['album_ids'] })
  }
}).transform(value => ({ ...value, mode: value.mode ?? (value.album_ids.length > 0 ? 'albums' as const : 'random' as const) }))

// Unsplash. The access key goes in the `Authorization: Client-ID` header of
// requests to api.unsplash.com and nowhere else. The pool is one of three
// things (a search `query`, some `collections`, or some `topics`), and at most
// one may be given: left out altogether, it is a search for "landscape". An
// id is quoted text, but a number is accepted for a collection, as in
// `collections: [317099]`, and turned into text. The ids end up in a request
// path, so they are limited to the characters a collection id or a topic slug has.
const unsplashId = z.union([z.string(), z.number().int().nonnegative()])
  .transform(String)
  .pipe(z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, 'must be a collection id like "317099" or a topic slug like "nature"'))

// Everything about the pool that a feed may also say. All of it is optional
// here: the top-level block gives the defaults, and a feed's own settings are laid
// over the block's (see `resolveUnsplash`).
const unsplashPool = {
  query: text.optional(),
  collections: z.array(unsplashId).min(1, 'must list at least one collection id').optional(),
  topics: z.array(unsplashId).min(1, 'must list at least one topic').optional(),
  orientation: z.enum(['landscape', 'portrait', 'squarish']).optional(),
  content_filter: z.enum(['low', 'high']).optional(),
  count: z.number().int().min(1).max(300).optional(),
  // `random` brings new photos at every refresh; `fixed` pages through the same
  // search, collections or topics, which gives the same photos until they
  // change on Unsplash (see server/photos/unsplash.ts).
  pick: z.enum(['random', 'fixed']).optional(),
  // How often the pool is listed again. The photo service wakes every 10
  // minutes, so a refresh is never sooner than that: less than 10 would mean
  // nothing, and is refused. At most a week.
  refresh_minutes: z.number().int().min(10).max(10080).optional(),
}

type UnsplashChoice = { query?: string | undefined, collections?: string[] | undefined, topics?: string[] | undefined }

/** At most one of `query`, `collections` and `topics`. */
function oneUnsplashChoice(value: UnsplashChoice, ctx: z.RefinementCtx): void {
  const named = (['query', 'collections', 'topics'] as const).filter(key => value[key] !== undefined)
  if (named.length > 1) ctx.addIssue({ code: 'custom', message: `${named.join(' and ')} can't be used together: choose one of query, collections or topics`, path: [named[1]!] })
}

const unsplash = z.strictObject({
  access_key: text,
  ...unsplashPool,
  content_filter: unsplashPool.content_filter.default('high'),
  // The pool is listed in pages (or random picks) of 30, and a demo key may make 50 requests an hour.
  count: unsplashPool.count.default(60),
  pick: unsplashPool.pick.default('random'),
  refresh_minutes: unsplashPool.refresh_minutes.default(60),
}).superRefine(oneUnsplashChoice).transform(value => (
  value.query === undefined && value.collections === undefined && value.topics === undefined ? { ...value, query: 'landscape' } : value
))

const unsplashFeed = z.strictObject(unsplashPool).superRefine(oneUnsplashChoice)

// A feed that uses Immich: the address and key come from `photos.immich`, and
// what is set here is laid over its `mode`, `album_ids` and `random`.
const immichFeed = z.strictObject({
  mode: z.enum(['albums', 'random', 'memories']).optional(),
  album_ids: z.array(text).optional(),
  random: immichRandomFeed().optional(),
})

// `photos.feeds`: named pools of photos, each from one source. A layout or a
// schedule rule shows one by its id. A feed's id may not be the name of a
// source (`immich`, `google`, `local`, `unsplash`), because the sources set up
// at the top level are feeds under those names already.
const photoFeed = (baseDir: string) => z.strictObject({
  id: photoFeedIdSchema,
  /** What the pickers and the settings page call it. Left out, the id. */
  name: text.optional(),
  unsplash: unsplashFeed.optional(),
  immich: immichFeed.optional(),
  local: z.strictObject({ path: text.transform(value => folderPath(value, baseDir)) }).optional(),
}).superRefine((feed, ctx) => {
  const given = (['unsplash', 'immich', 'local'] as const).filter(source => feed[source] !== undefined)
  if (given.length !== 1) ctx.addIssue({ code: 'custom', message: 'needs exactly one of unsplash, immich or local to say where its photos come from', path: [given[1] ?? 'id'] })
})

// `local.path` is a folder: absolute, or relative to the config file's folder
// like a `file:` URL for an ICS source. A folder that doesn't exist is not a
// config error (a mount may come up later); the photo service logs it.
const photos = (baseDir: string) => z.strictObject({
  interval_seconds: sharedFields.photo_interval_seconds.default(60),
  /** Show each display only photos of its own shape: portrait photos on a landscape display, landscape ones on a portrait one. */
  match_orientation: z.boolean().default(false),
  /** The older name of `match_orientation`, which it still means (on a landscape display it is exactly what it did). */
  landscape_only: z.boolean().default(false),
  cache_max_mb: z.number().int().min(1).default(2048),
  immich: immich.optional(),
  google: z.strictObject({
    client_id: text,
    client_secret: text,
  }).optional(),
  local: z.strictObject({
    path: text.transform(value => folderPath(value, baseDir)),
  }).optional(),
  unsplash: unsplash.optional(),
  feeds: z.array(photoFeed(baseDir)).default([]),
}).superRefine((value, ctx) => {
  const seen = new Set<string>()
  value.feeds.forEach((feed, index) => {
    const at = (field: string, message: string): void => ctx.addIssue({ code: 'custom', message, path: ['feeds', index, field] })
    if (isSourceName(feed.id)) at('id', `"${feed.id}" is the name of a photo source, so a feed can't have it as its id`)
    else if (seen.has(feed.id)) at('id', `duplicate id "${feed.id}" (feed ids must be unique)`)
    seen.add(feed.id)
    // The key, address and credentials are kept once, in the source's own block.
    if (feed.unsplash && !value.unsplash) at('unsplash', 'needs the photos.unsplash block for the access key (put access_key there)')
    if (feed.immich) {
      if (!value.immich) at('immich', 'needs the photos.immich block for the address and API key (put url and api_key there)')
      else if (resolveImmich(value.immich, feed.immich).mode === 'albums' && resolveImmich(value.immich, feed.immich).album_ids.length === 0) {
        at('immich', 'mode "albums" needs at least one album id in album_ids')
      }
    }
  })
})

// `file:` URLs for ICS sources. `file:///abs/path.ics` is a normal URL. Anything
// else after `file:` is a path: absolute (`file:/srv/a.ics`) or relative to the
// config file's folder (`file:./a.ics`). Both end up as an absolute file:// URL.
function icsUrl(baseDir: string) {
  return z.string().transform((value, ctx) => {
    if (/^https?:/i.test(value)) {
      if (isHttpUrl(value)) return value
    } else if (/^file:/i.test(value)) {
      const rest = value.slice('file:'.length)
      if (rest.startsWith('//')) {
        try {
          const url = new URL(value)
          if (url.protocol === 'file:' && url.pathname !== '/') return url.href
        } catch {
          // reported below
        }
      } else if (rest !== '') {
        return pathToFileUrl(rest, baseDir)
      }
    }
    ctx.issues.push({
      code: 'custom',
      message: 'must be an http:// or https:// URL, or a file: URL such as file:./family.ics',
      input: value,
      continue: true,
    })
    return z.NEVER
  })
}

/** An absolute, tidied folder path: `value` as it is if it starts with `/`, otherwise from `baseDir`. */
function folderPath(value: string, baseDir: string): string {
  const absolute = value.startsWith('/') ? value : `${baseDir.replace(/\/+$/, '')}/${value}`
  const parts: string[] = []
  for (const part of absolute.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

function pathToFileUrl(path: string, baseDir: string): string {
  const absolute = path.startsWith('/') ? path : `${baseDir.replace(/\/+$/, '')}/${path}`
  // Let URL do the "." / ".." tidying and percent-encoding.
  const url = new URL('file://')
  url.pathname = absolute
  return url.href
}

export function createConfigSchema(baseDir: string) {
  return z.strictObject({
    timezone: timezone.default('Europe/London'),
    people: z.array(person).min(1, 'at least one person is required'),
    groups: z.array(group).default([]),
    calendars: z.array(calendar(baseDir)).default([]),
    homeassistant: z.strictObject({ url: httpUrl, token: text }).optional(),
    displays: z.array(display).min(1, 'at least one display is required'),
    button: button.prefault({}),
    remote: z.strictObject({
      pin: z.string('must be 4 to 12 digits, in quotes (for example "0123")').regex(/^\d{4,12}$/, 'must be 4 to 12 digits (quote it)').optional(),
    }).optional(),
    policies: policies.prefault({}),
    sync: sync.prefault({}),
    mqtt: mqtt.optional(),
    weather: weather.optional(),
    alarm: alarm.optional(),
    timers: timers.optional(),
    photos: photos(baseDir).optional(),
    cameras: z.array(camera).default([]),
    triggers: z.array(trigger).default([]),
  }).superRefine(crossChecks)
}

type RawConfig = {
  people: { id: string, name: string, aliases: string[] }[]
  groups: { id: string, name: string, aliases: string[], people: string[] }[]
  calendars: { id: string, person: string, rules: { people: string[] }[], source: { type: string } }[]
  displays: { id: string, night_text: string, schedules: { id: string, rules: { view: string, layout?: string | undefined, photo_feed?: string | undefined }[] }[] }[]
  homeassistant?: unknown
  photos?: { immich?: unknown, local?: unknown, unsplash?: unknown, feeds: { id: string }[] } | undefined
  weather?: unknown
  alarm?: unknown
  timers?: { entities: { entity_id: string, displays?: string[] | undefined }[] } | undefined
  cameras: { id: string }[]
  triggers: { id: string, displays?: string[] | undefined, actions: { type: string, camera?: string | null, schedule?: string }[] }[]
}

// Checks that look across the whole file: unique ids, references that must
// resolve, and the Home Assistant block.
function crossChecks(config: RawConfig, ctx: z.RefinementCtx) {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', message, path })

  const unique = (list: { id: string }[], path: (string | number)[]) => {
    const seen = new Map<string, number>()
    const where = path.map((part, i) => typeof part === 'number' ? `[${part}]` : i === 0 ? part : `.${part}`).join('')
    list.forEach((item, index) => {
      const first = seen.get(item.id)
      if (first === undefined) seen.set(item.id, index)
      else issue([...path, index, 'id'], `duplicate id "${item.id}" (also used by ${where}[${first}])`)
    })
  }
  unique(config.people, ['people'])
  unique(config.groups, ['groups'])
  unique(config.calendars, ['calendars'])
  unique(config.displays, ['displays'])
  unique(config.cameras, ['cameras'])
  unique(config.triggers, ['triggers'])

  // Detection could not tell two people (or a person and a group) apart if they share a name or alias.
  const owners = new Map<string, string>()
  const claimTerms = (kind: 'person' | 'group', section: 'people' | 'groups', list: { id: string, name: string, aliases: string[] }[]) => {
    list.forEach((item, index) => {
      const terms: [string, (string | number)[]][] = [
        [item.name, [section, index, 'name']],
        ...item.aliases.map((alias, i): [string, (string | number)[]] => [alias, [section, index, 'aliases', i]]),
      ]
      for (const [term, path] of terms) {
        const key = term.toLowerCase()
        const owner = owners.get(key)
        if (owner === undefined) owners.set(key, `${kind} "${item.id}"`)
        else if (owner !== `${kind} "${item.id}"`) {
          issue(path, `"${term}" is already a name or alias of ${owner} (names and aliases must be unique, ignoring case, so events can be matched to one person or group)`)
        }
      }
    })
  }
  claimTerms('person', 'people', config.people)

  const personIds = new Set(config.people.map(person => person.id))
  config.groups.forEach((group, index) => {
    if (personIds.has(group.id)) {
      issue(['groups', index, 'id'], `"${group.id}" is already the id of a person (person and group ids must differ, as a rule can list either)`)
    }
    group.people.forEach((id, i) => {
      if (!personIds.has(id)) {
        issue(['groups', index, 'people', i], `unknown person "${id}" (must be the id of an entry in people)`)
      }
    })
  })
  claimTerms('group', 'groups', config.groups)

  const groupIds = new Set(config.groups.map(group => group.id))
  config.calendars.forEach((calendar, index) => {
    if (!personIds.has(calendar.person)) {
      issue(['calendars', index, 'person'], `unknown person "${calendar.person}" (must be the id of an entry in people)`)
    }
    calendar.rules.forEach((rule, ruleIndex) => {
      rule.people.forEach((id, i) => {
        if (!personIds.has(id) && !groupIds.has(id)) {
          issue(['calendars', index, 'rules', ruleIndex, 'people', i], `unknown person "${id}" (must be the id of an entry in people or groups)`)
        }
      })
    })
    if (calendar.source.type === 'homeassistant' && !config.homeassistant) {
      issue(['calendars', index, 'source'], 'uses a homeassistant source, but there is no "homeassistant" block (it needs a url and token)')
    }
  })

  if (config.weather && !config.homeassistant) {
    issue(['weather'], 'reads a Home Assistant weather entity, but there is no "homeassistant" block (it needs a url and token)')
  }
  if (config.alarm && !config.homeassistant) {
    issue(['alarm'], 'reads a Home Assistant alarm entity, but there is no "homeassistant" block (it needs a url and token)')
  }
  const displayIds = new Set(config.displays.map(display => display.id))
  if (config.timers) {
    if (!config.homeassistant) {
      issue(['timers'], 'reads Home Assistant timer entities, but there is no "homeassistant" block (it needs a url and token)')
    }
    const seenEntities = new Map<string, number>()
    config.timers.entities.forEach((entity, index) => {
      const first = seenEntities.get(entity.entity_id)
      if (first === undefined) seenEntities.set(entity.entity_id, index)
      else issue(['timers', 'entities', index, 'entity_id'], `duplicate entity "${entity.entity_id}" (also listed at timers.entities[${first}])`)
      entity.displays?.forEach((id, i) => {
        if (!displayIds.has(id)) issue(['timers', 'entities', index, 'displays', i], `unknown display "${id}" (must be the id of an entry in displays)`)
      })
    })
  }
  const cameraIds = new Set(config.cameras.map(camera => camera.id))
  config.triggers.forEach((trigger, index) => {
    if (!config.homeassistant) {
      issue(['triggers', index], 'listens to Home Assistant, but there is no "homeassistant" block (it needs a url and token)')
    }
    trigger.displays?.forEach((id, i) => {
      if (!displayIds.has(id)) issue(['triggers', index, 'displays', i], `unknown display "${id}" (must be the id of an entry in displays)`)
    })
    const targets = config.displays.filter(display => trigger.displays === undefined || trigger.displays.includes(display.id))
    trigger.actions.forEach((action, i) => {
      if (action.type === 'set_camera' && typeof action.camera === 'string' && !cameraIds.has(action.camera)) {
        issue(['triggers', index, 'actions', i, 'camera'], `unknown camera "${action.camera}" (must be the id of an entry in cameras)`)
      }
      if (action.type === 'set_schedule' && action.schedule !== undefined) {
        const without = targets.filter(display => !display.schedules.some(schedule => schedule.id === action.schedule))
        if (without.length > 0) issue(['triggers', index, 'actions', i, 'schedule'], `display "${without[0]!.id}" has no schedule "${action.schedule}"`)
      }
    })
  })

  config.displays.forEach((display, index) => {
    if (display.night_text === 'next_alarm' && !config.alarm) {
      issue(['displays', index, 'night_text'], 'is next_alarm, but there is no "alarm" block (it needs the entity_id of the Home Assistant entity that holds the next alarm)')
    }
    // Schedule ids name MQTT topics and Home Assistant switches, so they must be unique within the display.
    unique(display.schedules, ['displays', index, 'schedules'])
    display.schedules.forEach((schedule, scheduleIndex) => {
      schedule.rules.forEach((rule, ruleIndex) => {
        const ruleIssue = (field: string, message: string): void => issue(['displays', index, 'schedules', scheduleIndex, 'rules', ruleIndex, field], message)
        if (rule.view === 'custom' && rule.layout === undefined) ruleIssue('layout', 'is missing: a custom view needs the id of the layout it shows')
        if (rule.view !== 'custom' && rule.layout !== undefined) ruleIssue('layout', `is set, but the view is ${rule.view}: only a custom view shows a layout`)
        if ((rule.view === 'photo' || rule.view === 'week_photo') && !config.photos) {
          const why = rule.view === 'photo' ? 'the photo frame would have nothing to show' : "the week and photo view's photo pane would have nothing to show"
          issue(['displays', index, 'schedules', scheduleIndex, 'rules', ruleIndex, 'view'], `is ${rule.view}, but there is no "photos" block (${why})`)
        }
        // A window can only show a feed that is set up (a source's own block, or an entry of photos.feeds).
        if (rule.photo_feed !== undefined) {
          const feeds = config.photos ? photoFeedIdsOf(config.photos) : []
          if (!feeds.includes(rule.photo_feed)) {
            ruleIssue('photo_feed', feeds.length > 0
              ? `unknown photo feed "${rule.photo_feed}" (must be one of ${feeds.join(', ')})`
              : `unknown photo feed "${rule.photo_feed}" (there is no "photos" block with a source or feeds)`)
          }
        }
      })
    })
  })
}

export type AppConfig = z.output<ReturnType<typeof createConfigSchema>>
export type Person = AppConfig['people'][number]
export type Group = AppConfig['groups'][number]
export type CalendarConfig = AppConfig['calendars'][number]
export type CalendarSource = CalendarConfig['source']
export type CalendarRule = CalendarConfig['rules'][number]
export type DisplayConfig = AppConfig['displays'][number]
export type ScheduleConfig = DisplayConfig['schedules'][number]
export type ScheduleRule = ScheduleConfig['rules'][number]
export type ButtonConfig = AppConfig['button']
export type ButtonAction = ButtonConfig['single']
export type PoliciesConfig = AppConfig['policies']
export type SyncConfig = AppConfig['sync']
export type MqttConfig = NonNullable<AppConfig['mqtt']>
export type WeatherConfig = NonNullable<AppConfig['weather']>
export type AlarmConfig = NonNullable<AppConfig['alarm']>
export type TimersConfig = NonNullable<AppConfig['timers']>
export type TimerEntityConfig = TimersConfig['entities'][number]
export type PhotosConfig = NonNullable<AppConfig['photos']>
export type ImmichConfig = NonNullable<PhotosConfig['immich']>
export type UnsplashConfig = NonNullable<PhotosConfig['unsplash']>
export type PhotoFeedConfig = PhotosConfig['feeds'][number]
export type HomeAssistantConfig = NonNullable<AppConfig['homeassistant']>
export type CameraConfig = AppConfig['cameras'][number]
export type TriggerConfig = AppConfig['triggers'][number]
