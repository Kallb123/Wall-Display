import type { z } from 'zod'
import { DISPLAY_PREFERENCE_KEYS, SHARED_PREFERENCE_KEYS } from '../../shared/settings'
import type { DisplayPreferenceKey, DisplayPreferences, SharedPreferenceKey, SharedPreferences } from '../../shared/settings'
import { displayFields, sharedFields } from '../config/schema'
import type { AppConfig, DisplayConfig } from '../config/schema'

// The preferences the settings page can change (PR 5.6), kept apart from the
// store so every rule is testable on its own. Pure: nothing here reads a file
// or the database. A preference is a value that config.yaml already has, so
// reading one pulls it out of the config, checking one uses the config's own
// field schemas, and merging one builds a new config with the saved values on
// top. The YAML config itself is never touched.

/** What a save changed, key by key. Every key is optional: a display or the shared set only holds the ones it has overridden. */
export type DisplayOverrides = Partial<DisplayPreferences>
export type SharedOverrides = Partial<SharedPreferences>

/** Every saved change: per display id, and the shared ones. */
export interface Overrides {
  displays: Readonly<Record<string, DisplayOverrides>>
  shared: SharedOverrides
}

/** A message per key that is refused. `_` stands for a problem with the body as a whole. */
export type Fields = Record<string, string>

/** The photo interval shown when the config has no `photos` block (the schema's default), so the page has something to show. */
export const DEFAULT_PHOTO_INTERVAL_SECONDS = 60

// Reading ---------------------------------------------------------------------

export function readDisplayPreferences(display: DisplayConfig): DisplayPreferences {
  return {
    theme: display.theme,
    month_style: display.month_style,
    week_start: display.week_start,
    month_return_minutes: display.month_return_minutes,
    week_hours: { from: display.week_hours.from, to: display.week_hours.to },
    day_parts: { afternoon: display.day_parts.afternoon, evening: display.day_parts.evening },
    weather_on_dates: { month: display.weather_on_dates.month, week: display.weather_on_dates.week, week_parts: display.weather_on_dates.week_parts, agenda: display.weather_on_dates.agenda },
    show_locations: display.show_locations,
    burn_in: display.burn_in,
    motion: display.motion,
    takeover_art: display.takeover_art,
    night_text: display.night_text,
    orientation: display.orientation,
  }
}

export function readSharedPreferences(config: AppConfig): SharedPreferences {
  const { auto_presence: presence, auto_brightness: brightness } = config.policies
  return {
    photo_interval_seconds: config.photos?.interval_seconds ?? DEFAULT_PHOTO_INTERVAL_SECONDS,
    off_after_minutes: presence.off_after_minutes,
    quiet_hours: presence.quiet_hours ? { from: presence.quiet_hours.from, to: presence.quiet_hours.to } : null,
    night_action: brightness.night_action,
    night_below_lux: brightness.night_below_lux ?? null,
    night_above_lux: brightness.night_above_lux ?? null,
    min_step: brightness.min_step,
    smoothing_seconds: brightness.smoothing_seconds,
  }
}

// Checking one key ------------------------------------------------------------

// A key can also be set to null where the config can leave it out: no quiet hours, no threshold.
const displaySchemas: Record<DisplayPreferenceKey, z.ZodType> = {
  theme: displayFields.theme,
  month_style: displayFields.month_style,
  week_start: displayFields.week_start,
  month_return_minutes: displayFields.month_return_minutes,
  week_hours: displayFields.week_hours,
  day_parts: displayFields.day_parts,
  weather_on_dates: displayFields.weather_on_dates,
  show_locations: displayFields.show_locations,
  burn_in: displayFields.burn_in,
  motion: displayFields.motion,
  takeover_art: displayFields.takeover_art,
  night_text: displayFields.night_text,
  orientation: displayFields.orientation,
}

const sharedSchemas: Record<SharedPreferenceKey, z.ZodType> = {
  photo_interval_seconds: sharedFields.photo_interval_seconds,
  off_after_minutes: sharedFields.off_after_minutes,
  quiet_hours: sharedFields.quiet_hours.nullable(),
  night_action: sharedFields.night_action,
  night_below_lux: sharedFields.night_below_lux.nullable(),
  night_above_lux: sharedFields.night_above_lux.nullable(),
  min_step: sharedFields.min_step,
  smoothing_seconds: sharedFields.smoothing_seconds,
}

/** The first problem zod found, in a short phrase that reads after the key's name: "must be ...". */
function describeIssue(issue: z.core.$ZodIssue): string {
  const where = issue.path.length > 0 ? `${issue.path.join('.')} ` : ''
  switch (issue.code) {
    case 'invalid_type':
      return `${where}must be ${issue.expected === 'object' ? 'an object' : `a ${issue.expected}`}`
    case 'invalid_value':
      return `${where}must be one of ${issue.values.map(String).join(', ')}`
    case 'unrecognized_keys':
      return `${where}has no ${issue.keys.map(key => `"${key}"`).join(' or ')} setting`
    case 'custom':
      // Custom messages (the config's own) already say what they are about.
      return issue.message
    default:
      return `${where}${issue.message}`
  }
}

function checkValue(schemas: Record<string, z.ZodType>, key: string, value: unknown): { ok: true, value: unknown } | { ok: false, message: string } {
  const result = schemas[key]!.safeParse(value)
  return result.success ? { ok: true, value: result.data } : { ok: false, message: describeIssue(result.error.issues[0]!) }
}

// Reading a request body -----------------------------------------------------

export type ParsedUpdate<T> = { ok: true, set: Partial<T>, reset: (keyof T & string)[] } | { ok: false, fields: Fields }

function parseUpdate<T>(update: unknown, keys: readonly string[], schemas: Record<string, z.ZodType>): ParsedUpdate<T> {
  const fields: Fields = {}
  if (typeof update !== 'object' || update === null || Array.isArray(update)) {
    return { ok: false, fields: { _: 'the body must be an object with "set" and/or "reset"' } }
  }
  const body = update as Record<string, unknown>
  for (const key of Object.keys(body)) {
    if (key !== 'set' && key !== 'reset') fields[key] = 'is not part of the body (use "set" and "reset")'
  }

  const set: Record<string, unknown> = {}
  if (body.set !== undefined) {
    if (typeof body.set !== 'object' || body.set === null || Array.isArray(body.set)) {
      fields._ = '"set" must be an object of preferences to save'
    } else {
      for (const [key, value] of Object.entries(body.set)) {
        if (!keys.includes(key)) {
          fields[key] = 'is not a preference that can be changed here'
          continue
        }
        const checked = checkValue(schemas, key, value)
        if (checked.ok) set[key] = checked.value
        else fields[key] = checked.message
      }
    }
  }

  const reset: string[] = []
  if (body.reset !== undefined) {
    if (!Array.isArray(body.reset)) {
      fields._ = '"reset" must be a list of preference names'
    } else {
      for (const key of body.reset) {
        if (typeof key !== 'string' || !keys.includes(key)) {
          fields[typeof key === 'string' ? key : '_'] = 'is not a preference that can be changed here'
        } else if (key in set || (body.set && typeof body.set === 'object' && key in body.set)) {
          fields[key] = 'is in both "set" and "reset"'
        } else if (!reset.includes(key)) {
          reset.push(key)
        }
      }
    }
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields }
  return { ok: true, set: set as Partial<T>, reset: reset as (keyof T & string)[] }
}

export function parseDisplayUpdate(update: unknown): ParsedUpdate<DisplayPreferences> {
  return parseUpdate<DisplayPreferences>(update, DISPLAY_PREFERENCE_KEYS, displaySchemas)
}

export function parseSharedUpdate(update: unknown): ParsedUpdate<SharedPreferences> {
  return parseUpdate<SharedPreferences>(update, SHARED_PREFERENCE_KEYS, sharedSchemas)
}

// Rules across keys -----------------------------------------------------------

/** What the cross-field rules need to know about the config the preferences sit on. */
export interface Capabilities {
  /** The config has an `alarm` block. */
  alarm: boolean
  /** The config has a `photos` block. */
  photos: boolean
}

export function capabilitiesOf(config: Pick<AppConfig, 'alarm' | 'photos'>): Capabilities {
  return { alarm: config.alarm !== undefined, photos: config.photos !== undefined }
}

/**
 * The rules that look at more than one value, for one display's whole set.
 * Messages go under the key the page shows them against. (`week_hours.from`
 * before `to`, and `day_parts.afternoon` before `evening`, are part of the field's own schema, as both are in the one value.)
 */
export function checkDisplayValues(values: DisplayPreferences, capabilities: Pick<Capabilities, 'alarm'>): Fields {
  const fields: Fields = {}
  if (values.night_text === 'next_alarm' && !capabilities.alarm) {
    fields.night_text = 'is next_alarm, but there is no "alarm" block in the config (it needs the entity_id of the Home Assistant entity that holds the next alarm)'
  }
  return fields
}

/** The same for the shared set. `overridden` says which keys hold a saved change, as the photo interval only counts when there is one. */
export function checkSharedValues(values: SharedPreferences, capabilities: Pick<Capabilities, 'photos'>, overridden: readonly string[]): Fields {
  const fields: Fields = {}
  if (overridden.includes('photo_interval_seconds') && !capabilities.photos) {
    fields.photo_interval_seconds = 'can\'t be set, as the config has no "photos" block'
  }
  if (values.quiet_hours && values.quiet_hours.from === values.quiet_hours.to) {
    fields.quiet_hours = 'from and to must differ (turn quiet hours off for none)'
  }
  if (values.night_action !== 'none' && values.night_below_lux === null) {
    fields.night_below_lux = `is needed when night_action is ${values.night_action} (the room counts as dark below it)`
  }
  if (values.night_above_lux !== null) {
    if (values.night_below_lux === null) {
      fields.night_above_lux = 'needs night_below_lux as well (the room counts as dark below that, and light again from here)'
    } else if (values.night_above_lux <= values.night_below_lux) {
      fields.night_above_lux = 'must be more than night_below_lux (the room counts as light again from here)'
    }
  }
  return fields
}

/** `base` with `overrides` on top: the values in force. */
export function applyDisplayOverrides(base: DisplayPreferences, overrides: DisplayOverrides): DisplayPreferences {
  return { ...base, ...overrides }
}

export function applySharedOverrides(base: SharedPreferences, overrides: SharedOverrides): SharedPreferences {
  return { ...base, ...overrides }
}

/** The overrides for `keys` only, in key order, so what is stored and listed does not depend on the order they were saved in. */
export function inKeyOrder<T extends object>(overrides: T, keys: readonly string[]): T {
  return Object.fromEntries(keys.filter(key => key in overrides).map(key => [key, (overrides as Record<string, unknown>)[key]])) as T
}

export function validateDisplayOverrides(config: DisplayConfig, overrides: DisplayOverrides, capabilities: Pick<Capabilities, 'alarm'>): Fields {
  return checkDisplayValues(applyDisplayOverrides(readDisplayPreferences(config), overrides), capabilities)
}

export function validateSharedOverrides(config: AppConfig, overrides: SharedOverrides): Fields {
  return checkSharedValues(applySharedOverrides(readSharedPreferences(config), overrides), capabilitiesOf(config), Object.keys(overrides))
}

// Loading what was stored -----------------------------------------------------

/**
 * Keeps the stored keys that still fit the config. Each key is checked on its
 * own (is it a known key, is the value one the config's schema takes) and then
 * with the others (the cross-field rules). A key that fails is left out and
 * named in `ignored`, with why. A stored `night_action` that needs a
 * `night_below_lux` stored beside it is fine whichever was written first, so
 * keys are let in over as many passes as it takes.
 */
function keepWhatFits<T extends object>(
  stored: Record<string, unknown>,
  keys: readonly string[],
  schemas: Record<string, z.ZodType>,
  problemsWith: (accepted: Partial<T>) => Fields,
): { kept: Partial<T>, ignored: { key: string, reason: string }[] } {
  const ignored: { key: string, reason: string }[] = []
  const pending = new Map<string, unknown>()
  for (const [key, value] of Object.entries(stored)) {
    if (!keys.includes(key)) {
      ignored.push({ key, reason: 'is not a preference that can be changed' })
      continue
    }
    const checked = checkValue(schemas, key, value)
    if (checked.ok) pending.set(key, checked.value)
    else ignored.push({ key, reason: checked.message })
  }

  let kept: Record<string, unknown> = {}
  let progressed = true
  while (progressed && pending.size > 0) {
    progressed = false
    for (const [key, value] of [...pending]) {
      const trial = inKeyOrder({ ...kept, [key]: value }, keys)
      if (Object.keys(problemsWith(trial as Partial<T>)).length === 0) {
        kept = trial
        pending.delete(key)
        progressed = true
      }
    }
  }
  for (const key of pending.keys()) {
    const reason = Object.values(problemsWith(inKeyOrder({ ...kept, [key]: pending.get(key) }, keys) as Partial<T>))[0] ?? 'does not fit the config'
    ignored.push({ key, reason })
  }
  return { kept: kept as Partial<T>, ignored }
}

export function keepDisplayOverridesThatFit(stored: Record<string, unknown>, config: DisplayConfig, capabilities: Pick<Capabilities, 'alarm'>) {
  return keepWhatFits<DisplayPreferences>(stored, DISPLAY_PREFERENCE_KEYS, displaySchemas, accepted => validateDisplayOverrides(config, accepted, capabilities))
}

export function keepSharedOverridesThatFit(stored: Record<string, unknown>, config: AppConfig) {
  return keepWhatFits<SharedPreferences>(stored, SHARED_PREFERENCE_KEYS, sharedSchemas, accepted => validateSharedOverrides(config, accepted))
}

// Merging ---------------------------------------------------------------------

/**
 * The effective config: `config` with the saved preferences on top, as a new
 * frozen object. What is not touched is shared with `config` (which is frozen
 * already), and `config` itself is left alone.
 */
export function mergeOverrides(config: AppConfig, overrides: Overrides): AppConfig {
  const displays = config.displays.map((display) => {
    const own = overrides.displays[display.id]
    if (!own || Object.keys(own).length === 0) return display
    return Object.freeze({ ...display, ...own, ...(own.week_hours ? { week_hours: Object.freeze({ ...own.week_hours }) } : {}), ...(own.day_parts ? { day_parts: Object.freeze({ ...own.day_parts }) } : {}), ...(own.weather_on_dates ? { weather_on_dates: Object.freeze({ ...own.weather_on_dates }) } : {}) })
  })

  const shared = overrides.shared
  const hasShared = Object.keys(shared).length > 0
  if (!hasShared) return Object.freeze({ ...config, displays: Object.freeze(displays) as DisplayConfig[] })

  const presence = { ...config.policies.auto_presence }
  if (shared.off_after_minutes !== undefined) presence.off_after_minutes = shared.off_after_minutes
  if (shared.quiet_hours !== undefined) {
    if (shared.quiet_hours === null) delete presence.quiet_hours
    else presence.quiet_hours = Object.freeze({ ...shared.quiet_hours })
  }

  const brightness = { ...config.policies.auto_brightness }
  if (shared.night_action !== undefined) brightness.night_action = shared.night_action
  if (shared.min_step !== undefined) brightness.min_step = shared.min_step
  if (shared.smoothing_seconds !== undefined) brightness.smoothing_seconds = shared.smoothing_seconds
  // Null is "not set": the key goes, as it would be left out of the YAML.
  if (shared.night_below_lux !== undefined) {
    if (shared.night_below_lux === null) delete brightness.night_below_lux
    else brightness.night_below_lux = shared.night_below_lux
  }
  if (shared.night_above_lux !== undefined) {
    if (shared.night_above_lux === null) delete brightness.night_above_lux
    else brightness.night_above_lux = shared.night_above_lux
  }

  const photos = config.photos && shared.photo_interval_seconds !== undefined
    ? Object.freeze({ ...config.photos, interval_seconds: shared.photo_interval_seconds })
    : config.photos

  return Object.freeze({
    ...config,
    displays: Object.freeze(displays) as DisplayConfig[],
    policies: Object.freeze({
      ...config.policies,
      auto_presence: Object.freeze(presence),
      auto_brightness: Object.freeze(brightness),
    }),
    ...(photos ? { photos } : {}),
  })
}

/** For the bus event: whether two sets of values are the same. The values are plain JSON. */
export function sameValues(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** The refusal's message, in a sentence. */
export function refusalMessage(fields: Fields): string {
  const entries = Object.entries(fields)
  return `Preferences not saved: ${entries.map(([key, message]) => key === '_' || message.startsWith(key) ? message : `${key} ${message}`).join('; ')}`
}
