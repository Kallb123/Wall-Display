import { PHOTO_SOURCE_NAMES } from '../../shared/photos'
import type { PhotoHistoryEntry } from '../../shared/photoHistory'
import { addDays, todayIn, wallClockIn } from '../../shared/dates'
import { formatTime } from '../../shared/format'

// What the remote's "Photo history" section (architecture §7.5) writes about
// an entry of the history (§5.1): its title, the time it was on the wall, and
// the rows of its details panel. Everything is read in the display's time zone,
// not the phone's, so "14:02" means what the wall's own clock said, and in
// British English with the 24-hour clock like the rest of the remote. Pure: no
// Nuxt or Vue imports, so it is unit tested on a fixed clock.

/** The separator in a time range: an en dash with a space either side. */
const TO = ' – '

/** A string from the details, or null when it is missing or only spaces. */
function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** The last part of a path, whichever way its slashes lean. */
function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function sourceName(entry: PhotoHistoryEntry): string {
  return PHOTO_SOURCE_NAMES[entry.provider]
}

/**
 * What to call a photo: its description if it has one, else where it was taken,
 * else who took it, else its file name, and failing all those "Photo from
 * Immich", so a row is never nameless.
 */
export function historyTitle(entry: PhotoHistoryEntry): string {
  const { details } = entry
  const fileName = text(details.file_name)
  return text(details.description)
    ?? text(details.location)
    ?? text(details.photographer)
    ?? (fileName ? baseName(fileName) : null)
    ?? `Photo from ${sourceName(entry)}`
}

/** A short second line: where it was taken (unless the title already says), then where it came from. */
export function historySubtitle(entry: PhotoHistoryEntry): string {
  const location = text(entry.details.location)
  const parts: string[] = []
  if (location && location !== historyTitle(entry)) parts.push(location)
  parts.push(sourceName(entry))
  return parts.join(' · ')
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>()

/** `Mon 3 Nov`, with the year when it isn't this one, from the three parts so it doesn't depend on how the engine punctuates them. */
function shortDate(instant: Date, timeZone: string, withYear: boolean): string {
  const key = `${timeZone}|${withYear}`
  let formatter = dayFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone, calendar: 'gregory', numberingSystem: 'latn', weekday: 'short', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) })
    dayFormatters.set(key, formatter)
  }
  const fields: Record<string, string> = {}
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') fields[part.type] = part.value
  }
  return [fields.weekday, fields.day, fields.month, fields.year].filter(Boolean).join(' ')
}

/** How a day reads next to a time: "Today", "Yesterday", or "Mon 3 Nov" (with the year for another year). */
function dayLabel(instant: Date, now: Date, timeZone: string): string {
  const date = wallClockIn(instant, timeZone).date
  const today = todayIn(now, timeZone)
  if (date === today) return 'Today'
  if (date === addDays(today, -1)) return 'Yesterday'
  return shortDate(instant, timeZone, date.slice(0, 4) !== today.slice(0, 4))
}

/**
 * When it was on the wall: "14:02 – 14:07" for today, "Yesterday 14:02 –
 * 14:07" or "Mon 3 Nov 14:02 – 14:07" for another day, "14:02 – now" while it
 * still is. One that began on an earlier day and ended on a later one names both
 * days ("Yesterday 23:58 – Today 00:03").
 */
export function onDisplayLabel(entry: PhotoHistoryEntry, now: Date, timeZone: string): string {
  const start = new Date(entry.shown_at)
  const startDay = dayLabel(start, now, timeZone)
  const startTime = formatTime(start, timeZone)
  // Today is the default, so a time on its own means today.
  const from = startDay === 'Today' ? startTime : `${startDay} ${startTime}`
  if (!entry.ended_at) return `${from}${TO}now`

  const end = new Date(entry.ended_at)
  const endTime = formatTime(end, timeZone)
  if (wallClockIn(start, timeZone).date === wallClockIn(end, timeZone).date) return `${from}${TO}${endTime}`
  return `${startDay} ${startTime}${TO}${dayLabel(end, now, timeZone)} ${endTime}`
}

/** How long it was (or has been) on the wall: "45 s", "5 min", "1 h 20 min". */
export function durationLabel(entry: PhotoHistoryEntry, now: Date): string {
  const end = entry.ended_at ? new Date(entry.ended_at) : now
  const seconds = Math.max(0, Math.round((end.getTime() - new Date(entry.shown_at).getTime()) / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

const takenFormatters = new Map<string, Intl.DateTimeFormat>()

/** When it was taken, as the wall's zone read it: "Saturday 14 June 2025, 16:41". Empty if the source doesn't know. */
export function takenLabel(entry: PhotoHistoryEntry, timeZone: string): string {
  if (!entry.taken_at) return ''
  const taken = new Date(entry.taken_at)
  if (Number.isNaN(taken.getTime())) return ''
  let formatter = takenFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone, calendar: 'gregory', numberingSystem: 'latn', hourCycle: 'h23', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    takenFormatters.set(timeZone, formatter)
  }
  const fields: Record<string, string> = {}
  for (const part of formatter.formatToParts(taken)) {
    if (part.type !== 'literal') fields[part.type] = part.value
  }
  return `${fields.weekday} ${fields.day} ${fields.month} ${fields.year}, ${fields.hour}:${fields.minute}`
}

/** One line of the details panel; `href` makes the value a link. */
export interface DetailRow {
  label: string
  value: string
  href?: string
}

/** The address if it is a web address (a link in the details is never anything else), else undefined. */
function webAddress(value: string | null | undefined): string | undefined {
  const trimmed = text(value)
  if (!trimmed) return undefined
  try {
    const { protocol } = new URL(trimmed)
    return protocol === 'https:' || protocol === 'http:' ? trimmed : undefined
  } catch {
    return undefined
  }
}

/** The words on the link to the photo's own page. */
function openLinkText(entry: PhotoHistoryEntry): string {
  if (entry.provider === 'unsplash') return 'View on Unsplash'
  if (entry.provider === 'immich') return 'Open in Immich'
  return `Open in ${sourceName(entry)}`
}

/**
 * The rows of the expanded view, in a fixed order, each only if there is
 * something to say: when it was taken, where, a caption, who took it, who is in
 * it, the camera, the file, which feed it came from, when and for how long it
 * was on the wall, and a link to the photo's page.
 */
export function detailRows(entry: PhotoHistoryEntry, now: Date, timeZone: string): DetailRow[] {
  const { details } = entry
  const rows: DetailRow[] = []
  const add = (label: string, value: string | null | undefined, href?: string) => {
    const shown = text(value)
    if (shown) rows.push(href ? { label, value: shown, href } : { label, value: shown })
  }
  add('Taken', takenLabel(entry, timeZone))
  add('Location', details.location)
  add('Description', details.description)
  add('Photographer', details.photographer, webAddress(details.photographer_url))
  add('People', (details.people ?? []).map(name => name.trim()).filter(Boolean).join(', '))
  add('Camera', details.camera)
  add('File', details.file_name)
  add('From', entry.feed_name ?? entry.feed)
  add('On display', `${onDisplayLabel(entry, now, timeZone)} (${durationLabel(entry, now)})`)
  const link = webAddress(details.source_url)
  if (link) rows.push({ label: 'Open', value: openLinkText(entry), href: link })
  return rows
}
