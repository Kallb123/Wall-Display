import { z } from 'zod'

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

// Matches case-insensitively, like person detection will. The reason is
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

const rule = z.strictObject({
  match: rulePattern,
  people: z.array(text).min(1, 'must list at least one person id'),
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

const display = z.strictObject({
  id: slug,
  name: text,
  theme: z.enum(['light', 'dark']).default('light'),
  month_style: z.enum(['soft', 'classic']).default('soft'),
  month_return_minutes: z.number().int().min(1).max(1440).default(15),
  week_start: z.enum(['monday', 'sunday']).default('monday'),
})

const buttonAction = z.enum([
  'next_view',
  'toggle_photo',
  'toggle_screen',
  'next_month',
  'prev_month',
  'this_month',
  'refresh',
  'ha', // the app ignores the gesture; Home Assistant decides
  'none',
])

const button = z.strictObject({
  single: buttonAction.default('next_view'),
  double: buttonAction.default('toggle_photo'),
  long: buttonAction.default('ha'),
})

const policies = z.strictObject({
  auto_presence: z.strictObject({
    off_after_minutes: z.number().int().min(1).default(10),
    quiet_hours: z.strictObject({ from: time, to: time }).optional(),
  }).prefault({}),
  auto_brightness: z.strictObject({
    night_below_lux: z.number().min(0).optional(),
    night_action: z.enum(['none', 'night_view', 'screen_off']).default('none'),
  }).prefault({}),
})

// The rolling window of events kept in the database, in whole months around
// the current month. The remote's month picker reaches 12 months either side.
const sync = z.strictObject({
  months_back: z.number().int().min(0).max(60).default(12),
  months_ahead: z.number().int().min(0).max(60).default(12),
})

const photos = z.strictObject({
  interval_seconds: z.number().int().min(5).default(60),
  landscape_only: z.boolean().default(false),
  cache_max_mb: z.number().int().min(1).default(2048),
  immich: z.strictObject({
    url: httpUrl,
    api_key: text,
    album_ids: z.array(text).default([]),
  }).optional(),
  google: z.strictObject({
    client_id: text,
    client_secret: text,
  }).optional(),
  local: z.strictObject({
    path: text,
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
    calendars: z.array(calendar(baseDir)).default([]),
    homeassistant: z.strictObject({ url: httpUrl, token: text }).optional(),
    displays: z.array(display).min(1, 'at least one display is required'),
    button: button.prefault({}),
    remote: z.strictObject({
      pin: z.string('must be 4 to 12 digits, in quotes (for example "0123")').regex(/^\d{4,12}$/, 'must be 4 to 12 digits (quote it)').optional(),
    }).optional(),
    policies: policies.prefault({}),
    sync: sync.prefault({}),
    photos: photos.optional(),
  }).superRefine(crossChecks)
}

type RawConfig = {
  people: { id: string, name: string, aliases: string[] }[]
  calendars: { id: string, person: string, rules: { people: string[] }[], source: { type: string } }[]
  displays: { id: string }[]
  homeassistant?: unknown
}

// Checks that look across the whole file: unique ids, references that must
// resolve, and the Home Assistant block.
function crossChecks(config: RawConfig, ctx: z.RefinementCtx) {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', message, path })

  const unique = (list: { id: string }[], key: 'people' | 'calendars' | 'displays') => {
    const seen = new Map<string, number>()
    list.forEach((item, index) => {
      const first = seen.get(item.id)
      if (first === undefined) seen.set(item.id, index)
      else issue([key, index, 'id'], `duplicate id "${item.id}" (also used by ${key}[${first}])`)
    })
  }
  unique(config.people, 'people')
  unique(config.calendars, 'calendars')
  unique(config.displays, 'displays')

  // Detection could not tell two people apart if they share a name or alias.
  const owners = new Map<string, string>()
  config.people.forEach((person, index) => {
    const terms: [string, (string | number)[]][] = [
      [person.name, ['people', index, 'name']],
      ...person.aliases.map((alias, i): [string, (string | number)[]] => [alias, ['people', index, 'aliases', i]]),
    ]
    for (const [term, path] of terms) {
      const key = term.toLowerCase()
      const owner = owners.get(key)
      if (owner === undefined) owners.set(key, person.id)
      else if (owner !== person.id) {
        issue(path, `"${term}" is already a name or alias of person "${owner}" (names and aliases must be unique, ignoring case, so events can be matched to one person)`)
      }
    }
  })

  const personIds = new Set(config.people.map(person => person.id))
  config.calendars.forEach((calendar, index) => {
    if (!personIds.has(calendar.person)) {
      issue(['calendars', index, 'person'], `unknown person "${calendar.person}" (must be the id of an entry in people)`)
    }
    calendar.rules.forEach((rule, ruleIndex) => {
      rule.people.forEach((id, i) => {
        if (!personIds.has(id)) {
          issue(['calendars', index, 'rules', ruleIndex, 'people', i], `unknown person "${id}" (must be the id of an entry in people)`)
        }
      })
    })
    if (calendar.source.type === 'homeassistant' && !config.homeassistant) {
      issue(['calendars', index, 'source'], 'uses a homeassistant source, but there is no "homeassistant" block (it needs a url and token)')
    }
  })
}

export type AppConfig = z.output<ReturnType<typeof createConfigSchema>>
export type Person = AppConfig['people'][number]
export type CalendarConfig = AppConfig['calendars'][number]
export type CalendarSource = CalendarConfig['source']
export type CalendarRule = CalendarConfig['rules'][number]
export type DisplayConfig = AppConfig['displays'][number]
export type ButtonConfig = AppConfig['button']
export type ButtonAction = ButtonConfig['single']
export type PoliciesConfig = AppConfig['policies']
export type SyncConfig = AppConfig['sync']
export type PhotosConfig = NonNullable<AppConfig['photos']>
export type HomeAssistantConfig = NonNullable<AppConfig['homeassistant']>
