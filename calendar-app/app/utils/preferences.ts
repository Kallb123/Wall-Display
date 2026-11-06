import type { NightText, Orientation, Theme, WeekHours } from '../../shared/display'
import type { NightAction, PreferencesUpdate, QuietHours } from '../../shared/settings'
import { requestFailure } from './remote'

// The Displays tab's editable preferences (PR 5.6): the helpers the two forms
// share. A form keeps a draft, a copy of the values in force that the person
// edits. Saving sends only the keys they changed, and Reset sends the key in
// `reset`, so the server drops its saved change and the config's value is back.

export const THEME_LABELS: Record<Theme, string> = { light: 'Light', dark: 'Dark' }
export const MONTH_STYLE_LABELS = { soft: 'Soft', classic: 'Classic' } as const
export const WEEK_START_LABELS = { monday: 'Monday', sunday: 'Sunday' } as const
export const NIGHT_TEXT_LABELS: Record<NightText, string> = { none: 'None', first_event: 'First event', next_alarm: 'Next alarm' }
export const ORIENTATION_LABELS: Record<Orientation, string> = { auto: 'Auto', landscape: 'Landscape', portrait: 'Portrait' }
export const NIGHT_ACTION_LABELS: Record<NightAction, string> = { none: 'Nothing', night_view: 'Night view', screen_off: 'Screen off' }

/** `07:00`, for a whole hour of the day (24 is the end of it). */
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

/** A saved or config value in words, for "Reset to …". */
export function preferenceText(key: string, value: unknown): string {
  if (value === null || value === undefined) return key === 'night_above_lux' ? 'twice the dark level' : 'none'
  switch (key) {
    case 'theme': return THEME_LABELS[value as Theme] ?? String(value)
    case 'month_style': return MONTH_STYLE_LABELS[value as keyof typeof MONTH_STYLE_LABELS] ?? String(value)
    case 'week_start': return WEEK_START_LABELS[value as keyof typeof WEEK_START_LABELS] ?? String(value)
    case 'night_text': return NIGHT_TEXT_LABELS[value as NightText] ?? String(value)
    case 'orientation': return ORIENTATION_LABELS[value as Orientation] ?? String(value)
    case 'night_action': return NIGHT_ACTION_LABELS[value as NightAction] ?? String(value)
    case 'burn_in': return value ? 'on' : 'off'
    case 'month_return_minutes': case 'off_after_minutes': return `${value} min`
    case 'photo_interval_seconds': case 'smoothing_seconds': return `${value} s`
    case 'night_below_lux': case 'night_above_lux': return `${value} lux`
    case 'week_hours': {
      const { from, to } = value as WeekHours
      return `${hourLabel(from)} to ${hourLabel(to)}`
    }
    case 'quiet_hours': {
      const { from, to } = value as QuietHours
      return `${from} to ${to}`
    }
    default: return String(value)
  }
}

/** Whether two preference values are the same, looking inside week hours and quiet hours. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  const keys = Object.keys(x)
  return keys.length === Object.keys(y).length && keys.every(key => sameValue(x[key], y[key]))
}

/** A copy of a set of values to edit, which may be a reactive object (so not `structuredClone`). */
export function draftOf<T extends object>(values: T): T {
  return JSON.parse(JSON.stringify(values)) as T
}

/** The keys whose draft differs from what is in force, in key order. */
export function editedKeys<T extends object>(draft: T, values: T, keys: readonly (keyof T & string)[]): (keyof T & string)[] {
  return keys.filter(key => !sameValue(draft[key], values[key]))
}

/** What to PUT to save the draft: only the edited keys, or null when nothing was edited. */
export function saveUpdate<T extends object>(draft: T, values: T, keys: readonly (keyof T & string)[]): PreferencesUpdate<T> | null {
  const edited = editedKeys(draft, values, keys)
  if (edited.length === 0) return null
  const set: Partial<T> = {}
  for (const key of edited) set[key] = draft[key]
  return { set }
}

/** What to PUT to drop one saved change. */
export function resetUpdate<T extends object>(key: keyof T & string): PreferencesUpdate<T> {
  return { reset: [key] }
}

/**
 * The draft once the server has answered with new values: a key takes the new
 * value if it was just sent (saved or reset) or if the person hadn't edited it;
 * a key they edited and didn't send (a Reset beside it was pressed) is kept.
 */
export function refreshedDraft<T extends object>(draft: T, before: T, after: T, keys: readonly (keyof T & string)[], sent: readonly string[]): T {
  const next = draftOf(after)
  for (const key of keys) {
    if (!sent.includes(key) && !sameValue(draft[key], before[key])) next[key] = draft[key]
  }
  return next
}

/** A number box's text as a number, or null when it is blank or isn't one. */
export function numberOrNull(text: string): number | null {
  if (text.trim() === '') return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

/** What a failed save came to: the status, the server's message and, for a 400, a message per refused key. */
export interface PreferenceFailure {
  status: number | null
  message: string | null
  fields: Record<string, string>
}

/** Reads a failed `$fetch` of a preferences write. A 400's `data.fields` is kept as the server worded it. */
export function preferenceFailure(error: unknown): PreferenceFailure {
  const { status, message } = requestFailure(error)
  const fields: Record<string, string> = {}
  const body = typeof error === 'object' && error !== null ? (error as { data?: { data?: { fields?: unknown }, fields?: unknown } | null }).data : null
  const raw = body?.data?.fields ?? body?.fields
  if (status === 400 && typeof raw === 'object' && raw !== null) {
    for (const [key, text] of Object.entries(raw)) {
      if (typeof text === 'string') fields[key] = text
    }
  }
  return { status, message, fields }
}
