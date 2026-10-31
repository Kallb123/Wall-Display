import type { PhotoSource, ScreenState, View } from '../../shared/display'
import type { CalendarStatus, ConnectionsStatus, FallbackEvent, ImmichMode, MqttLinkState, PhotoProviderSettings } from '../../shared/settings'
import { addDays, todayIn } from '../../shared/dates'
import { monthLabel } from './remote'

// The words the settings pages use for what the server reports (architecture
// §7.6): detection, sync times, the connection chips and a display's live
// state. The server sends plain data, and every label is decided here so it
// can be tested. Pure: no Nuxt or Vue imports, and the time zone and the
// current time are passed in.

/** What a settings page says when a request gets no answer (a poll that fails, or a write). */
export const SERVER_UNREACHABLE = 'Couldn\'t reach the server'

/** How the two kinds of calendar source are named on the page. */
const SOURCE_LABELS: Record<CalendarStatus['source_type'], string> = {
  ics: 'ICS feed',
  homeassistant: 'Home Assistant',
}

export function sourceLabel(type: CalendarStatus['source_type']): string {
  return SOURCE_LABELS[type]
}

/** Which parts of an event are searched for a name: "title and description", "title" or "description". Empty if neither. */
function searchedIn(detectIn: CalendarStatus['detect_in']): string {
  const title = detectIn.includes('title')
  const description = detectIn.includes('description')
  if (title && description) return 'title and description'
  return title ? 'title' : description ? 'description' : ''
}

/**
 * What name detection does on a calendar. `true` matches a name at the start of
 * the title or of a description line, `'anywhere'` matches it anywhere in the
 * text (architecture §3.3). Off means every event goes to the default person,
 * and so does detection with nowhere to look.
 */
export function detectionLabel(detectPeople: CalendarStatus['detect_people'], detectIn: CalendarStatus['detect_in']): string {
  const where = searchedIn(detectIn)
  if (detectPeople === false || where === '') return 'Off'
  if (detectPeople === 'anywhere') return `Anywhere in ${where}`
  const label = where.charAt(0).toUpperCase() + where.slice(1)
  return where.includes(' and ') ? label : `${label} only`
}

/** Whether name detection can find anyone on this calendar, so a fallback list means something. */
export function detectionIsOff(calendar: Pick<CalendarStatus, 'detect_people' | 'detect_in'>): boolean {
  return detectionLabel(calendar.detect_people, calendar.detect_in) === 'Off'
}

/** `Every 15 minutes`, `Every hour`, `Every 90 seconds`. */
export function pollLabel(seconds: number): string {
  const unit = (count: number, name: string) => count === 1 ? `Every ${name}` : `Every ${count} ${name}s`
  if (seconds >= 3600 && seconds % 3600 === 0) return unit(seconds / 3600, 'hour')
  if (seconds >= 60 && seconds % 60 === 0) return unit(seconds / 60, 'minute')
  return unit(seconds, 'second')
}

const relative = new Intl.RelativeTimeFormat('en-GB', { numeric: 'always' })

/** How long before `now` an instant was: `Just now`, `2 minutes ago`, `3 hours ago`, `5 days ago`. */
export function relativeTime(iso: string, now: Date): string {
  const seconds = Math.floor((now.getTime() - new Date(iso).getTime()) / 1000)
  // A clock a little ahead of the server's is not "in 3 seconds".
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return relative.format(-minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return relative.format(-hours, 'hour')
  return relative.format(-Math.floor(hours / 24), 'day')
}

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>()

/** `Wed 28 Oct 2026, 09:39`, in `timeZone`. Built from its parts, so it reads the same whichever ICU version draws it. */
export function fullDateTime(iso: string, timeZone: string): string {
  let formatter = dateTimeFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone, calendar: 'gregory', numberingSystem: 'latn',
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
    dateTimeFormatters.set(timeZone, formatter)
  }
  const fields: Record<string, string> = {}
  for (const part of formatter.formatToParts(new Date(iso))) fields[part.type] = part.value
  return `${fields.weekday} ${fields.day} ${fields.month} ${fields.year}, ${fields.hour}:${fields.minute}`
}

/** The last sync as the calendar card says it: how long ago, "Never", or why it doesn't sync. */
export function lastSyncLabel(calendar: Pick<CalendarStatus, 'syncing' | 'last_success_at'>, now: Date): string {
  if (!calendar.syncing) return 'Not synced: this source type has no sync yet'
  return calendar.last_success_at ? relativeTime(calendar.last_success_at, now) : 'Never'
}

const dayFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })

/**
 * The day a fallback event is on: `Today`, `Tomorrow`, `Yesterday` or `Sat 31 Oct`.
 * An all-day event has its date; a timed one's date is where its start falls
 * in `timeZone`, which is the wall's, not the browser's.
 */
export function fallbackDateLabel(event: Pick<FallbackEvent, 'start' | 'all_day' | 'start_date'>, now: Date, timeZone: string): string {
  const date = event.all_day && event.start_date ? event.start_date : todayIn(new Date(event.start), timeZone)
  const today = todayIn(now, timeZone)
  if (date === today) return 'Today'
  if (date === addDays(today, 1)) return 'Tomorrow'
  if (date === addDays(today, -1)) return 'Yesterday'
  const fields: Record<string, string> = {}
  for (const part of dayFormatter.formatToParts(new Date(`${date}T00:00:00Z`))) fields[part.type] = part.value
  return `${fields.weekday} ${fields.day} ${fields.month}`
}

/** `· 4 times` for an event that fell through more than once (a recurring one), else nothing. */
export function occurrencesLabel(occurrences: number): string {
  return occurrences > 1 ? `· ${occurrences} times` : ''
}

/** How a status chip is drawn: a healthy link, a partly working one, a broken one, or one that is not in use. */
export type ChipTone = 'ok' | 'warn' | 'bad' | 'off'

export interface ChipStatus {
  label: string
  tone: ChipTone
  /** Why, when there is something to say (a connection error). */
  detail: string | null
}

/** The MQTT chip in the header: all the displays connected, some, none, or no MQTT in the config. */
export function mqttChip(mqtt: ConnectionsStatus['mqtt']): ChipStatus {
  if (!mqtt.configured) return { label: 'Off', tone: 'off', detail: null }
  if (mqtt.connected === 0) return { label: 'Disconnected', tone: 'bad', detail: null }
  if (mqtt.connected < mqtt.total) return { label: `${mqtt.connected} of ${mqtt.total} connected`, tone: 'warn', detail: null }
  return { label: 'Connected', tone: 'ok', detail: null }
}

/** The Home Assistant chip: it answered, it didn't (and why), or it isn't set up. */
export function homeAssistantChip(homeassistant: ConnectionsStatus['homeassistant']): ChipStatus {
  if (!homeassistant.configured || homeassistant.state === 'off') return { label: 'Not set up', tone: 'off', detail: null }
  if (homeassistant.state === 'error') return { label: 'Unreachable', tone: 'bad', detail: homeassistant.error }
  return { label: 'Connected', tone: 'ok', detail: null }
}

const LINK_LABELS: Record<MqttLinkState, string> = {
  off: 'Off',
  connecting: 'Connecting',
  connected: 'Connected',
  disconnected: 'Disconnected',
}

const LINK_TONES: Record<MqttLinkState, ChipTone> = {
  off: 'off',
  connecting: 'warn',
  connected: 'ok',
  disconnected: 'bad',
}

/** A display's own MQTT link, as a chip. */
export function mqttLinkChip(state: MqttLinkState, error: string | null): ChipStatus {
  return { label: LINK_LABELS[state], tone: LINK_TONES[state], detail: error }
}

const VIEW_LABELS: Record<View, string> = {
  month: 'Month',
  week: 'Week',
  agenda: 'Agenda',
  photo: 'Photo frame',
  night: 'Night',
}

export function viewLabel(view: View): string {
  return VIEW_LABELS[view]
}

const PHOTO_SOURCE_LABELS: Record<PhotoSource, string> = {
  immich: 'Immich',
  google: 'Google Photos',
  local: 'Local folder',
}

export function photoSourceLabel(source: PhotoSource): string {
  return PHOTO_SOURCE_LABELS[source]
}

/** `On`, or `Off (standby)`: an off panel is asleep, not unplugged. */
export function screenLabel(screen: ScreenState): string {
  return screen === 'on' ? 'On' : 'Off (standby)'
}

/** The month a display shows: `This month` while it follows the calendar, or the one pinned, like `November 2026`. */
export function shownMonthLabel(month: string | null): string {
  return month === null ? 'This month' : monthLabel(month)
}

/** Whether the wall's own page has a socket open: `Connected`, `Not connected`, or the count if (oddly) there are several. */
export function wallPageChip(sockets: number): ChipStatus {
  if (sockets === 0) return { label: 'Not connected', tone: 'bad', detail: null }
  return { label: sockets === 1 ? 'Connected' : `${sockets} connected`, tone: 'ok', detail: null }
}

/** How many phones have the remote open. None is normal, so it is not a warning. */
export function remotesChip(sockets: number): ChipStatus {
  return { label: sockets === 0 ? 'None connected' : `${sockets} connected`, tone: sockets === 0 ? 'off' : 'ok', detail: null }
}

/** `Hallway`, `Hallway and Kitchen`, `Hallway, Kitchen and Attic`. */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/**
 * Why "Republish discovery" can't be used, or null when it can. Nothing is
 * known until the connections have loaded, and then the server has the last
 * word (it answers 409 if it can't), so only what the config already says is
 * ruled out here.
 */
export function discoveryBlockedReason(connections: ConnectionsStatus | null): string | null {
  if (!connections) return null
  if (!connections.mqtt.configured) return 'MQTT is off: add an mqtt block to the config to use it.'
  if (!connections.mqtt.discovery) return 'Discovery is off: set discovery to true under mqtt in the config.'
  return null
}

/** `0 B`, `640 KB`, `1.2 GB`: a size in bytes in the largest unit it fills. Binary units, written as the usual short names. */
export function bytesLabel(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  // Whole numbers below ten would be too coarse ("1 GB" for 1.4 GB), and a decimal on a big number is noise.
  const text = unit === 0 || value >= 100 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, '')
  return `${text} ${units[unit]}`
}

/** How full the cache is, as a whole percentage kept within 0 to 100 so a bar never overflows. A cap of 0 is full. */
export function cachePercent(bytes: number, max: number): number {
  if (max <= 0) return 100
  return Math.min(100, Math.max(0, Math.round(bytes / max * 100)))
}

/** `3 photos`, `1 photo`, `1,240 photos`. */
export function photoCount(count: number): string {
  return `${count.toLocaleString('en-GB')} ${count === 1 ? 'photo' : 'photos'}`
}

const IMMICH_MODE_LABELS: Record<ImmichMode, string> = {
  albums: 'Albums',
  random: 'Random from the library',
  memories: 'Memories (on this day)',
}

/** What a provider card says under its name: Immich's mode and host, or the folder. */
export function providerDetail(provider: Pick<PhotoProviderSettings, 'id' | 'mode' | 'where'>): string {
  const mode = provider.mode ? IMMICH_MODE_LABELS[provider.mode] : null
  return [mode, provider.where].filter(Boolean).join(' · ')
}

/** A provider's listing as a chip: it has listed, it has not yet, or it is failing (and why). */
export function providerChip(provider: Pick<PhotoProviderSettings, 'last_success_at' | 'last_error'>): ChipStatus {
  if (provider.last_error) return { label: provider.last_success_at ? 'Out of reach' : 'Not working', tone: 'bad', detail: null }
  if (provider.last_success_at) return { label: 'Working', tone: 'ok', detail: null }
  return { label: 'Not listed yet', tone: 'warn', detail: null }
}
