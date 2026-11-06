import { z } from 'zod'
import { NIGHT_TEXTS, ORIENTATIONS, scheduleIdSchema, VIEWS } from '../../shared/display'

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

const rule = z.strictObject({
  match: rulePattern,
  people: z.array(text).min(1, 'must list at least one person or group id'),
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
  detect_people: z.union([z.boolean(), z.literal('anywhere')], { error: 'must be true, false or "anywhere"' }).default(true),
  detect_in: z.array(z.enum(['title', 'description'])).min(1, 'must list "title", "description" or both').default(['title', 'description']),
  strip_names: z.boolean().default(false),
  rules: z.array(rule).default([]),
  source: z.discriminatedUnion('type', [icsSource(baseDir), homeassistantSource], { error: 'type must be "ics" or "homeassistant"' }),
})

/** The days a schedule rule's window can start on, Monday first. A rule's `days` is normalised to these. */
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

// One window of a built-in schedule (PR 5.4): the wall shows `view` from `from` until `to`, in the config's time zone,
// on the days listed. A window with `from` after `to` runs past midnight, and `days` names the day it starts.
const scheduleRule = z.strictObject({
  view: z.enum(VIEWS, { error: `must be one of ${VIEWS.join(', ')}` }),
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
}

const display = z.strictObject({
  id: slug,
  name: text,
  theme: displayFields.theme.default('light'),
  month_style: displayFields.month_style.default('soft'),
  month_return_minutes: displayFields.month_return_minutes.default(15),
  week_start: displayFields.week_start.default('monday'),
  burn_in: displayFields.burn_in.default(true),
  night_text: displayFields.night_text.default('none'),
  orientation: displayFields.orientation.default('auto'),
  week_hours: displayFields.week_hours.default({ from: 7, to: 21 }),
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
    photos: photos(baseDir).optional(),
  }).superRefine(crossChecks)
}

type RawConfig = {
  people: { id: string, name: string, aliases: string[] }[]
  groups: { id: string, name: string, aliases: string[], people: string[] }[]
  calendars: { id: string, person: string, rules: { people: string[] }[], source: { type: string } }[]
  displays: { id: string, night_text: string, schedules: { id: string, rules: { view: string }[] }[] }[]
  homeassistant?: unknown
  photos?: unknown
  weather?: unknown
  alarm?: unknown
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
  config.displays.forEach((display, index) => {
    if (display.night_text === 'next_alarm' && !config.alarm) {
      issue(['displays', index, 'night_text'], 'is next_alarm, but there is no "alarm" block (it needs the entity_id of the Home Assistant entity that holds the next alarm)')
    }
    // Schedule ids name MQTT topics and Home Assistant switches, so they must be unique within the display.
    unique(display.schedules, ['displays', index, 'schedules'])
    display.schedules.forEach((schedule, scheduleIndex) => {
      schedule.rules.forEach((rule, ruleIndex) => {
        if (rule.view === 'photo' && !config.photos) {
          issue(['displays', index, 'schedules', scheduleIndex, 'rules', ruleIndex, 'view'], 'is photo, but there is no "photos" block (the photo frame would have nothing to show)')
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
export type PhotosConfig = NonNullable<AppConfig['photos']>
export type ImmichConfig = NonNullable<PhotosConfig['immich']>
export type HomeAssistantConfig = NonNullable<AppConfig['homeassistant']>
