// Small helpers for the text a source says about a photo (architecture §5.1).
// What a provider sends is shown on the remote as plain text, so it is cleaned
// on the way in: no control characters or line breaks, runs of spaces
// collapsed, and a ceiling on the length so one odd description can't fill the
// page. Pure.

/** The longest piece of text kept about a photo (a description, a place, a file name). */
export const MAX_DETAIL_TEXT = 300

/** `value` with anything unprintable turned into a space, whitespace collapsed, trimmed and cut to `max` characters; null if nothing is left or it isn't text. */
export function cleanText(value: unknown, max = MAX_DETAIL_TEXT): string | null {
  if (typeof value !== 'string') return null
  const clean = value.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim()
  return clean === '' ? null : clean
}

/** The cleaned, non-empty parts of `values` joined with `separator` (for a place: city, state, country), or null if none is left. */
export function joinText(values: readonly unknown[], separator: string): string | null {
  const parts = values.map(value => cleanText(value)).filter((part): part is string => part !== null)
  return parts.length === 0 ? null : parts.join(separator)
}

/** The details object with the fields that have nothing in them left out, or null if none is left at all. */
export function compactDetails<T extends Record<string, unknown>>(details: T): T | null {
  const kept = Object.entries(details).filter(([, value]) => value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0))
  return kept.length === 0 ? null : Object.fromEntries(kept) as T
}
