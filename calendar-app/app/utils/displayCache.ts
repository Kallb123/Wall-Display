import { displayStateSchema } from '../../shared/display'
import type { DisplaySettings, DisplayState } from '../../shared/display'
import type { CalendarEvent } from '../../shared/types/events'
import { specialDaysResolutionSchema } from '../../shared/special-days'
import type { SpecialDaysResolution } from '../../shared/special-days'
import { weatherSnapshotSchema } from '../../shared/weather'
import type { WeatherSnapshot } from '../../shared/weather'

// What the display keeps in `localStorage` so a reload while the server is
// unreachable still shows the last-known wall (architecture §4.2). Storage can
// be missing, full, blocked or hold something an older version wrote, so every
// access is guarded and a bad entry is the same as no entry. Pure: the storage
// is passed in.

export interface DisplayCache {
  settings: DisplaySettings
  state: DisplayState
  events: CalendarEvent[]
  /** The last weather the server sent, or null for none. An entry from before PR 2.7 has none. */
  weather: WeatherSnapshot | null
  /** The last special days the server sent (never a preview's), or null for none. An entry from before PR S.3 has none. */
  special_days: SpecialDaysResolution | null
  /** When it was saved, as an ISO 8601 instant. */
  saved_at: string
}

const key = (displayId: string) => `wallcal:display:${displayId}`
const LAST_KEY = 'wallcal:last-display'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function loadCache(storage: Storage | null | undefined, displayId: string): DisplayCache | null {
  try {
    const raw = storage?.getItem(key(displayId))
    if (!raw) return null
    const data: unknown = JSON.parse(raw)
    if (!isRecord(data) || !isRecord(data.settings) || !Array.isArray(data.events) || typeof data.saved_at !== 'string') return null
    // The state is parsed, so a document from an older version gets its defaults.
    const state = displayStateSchema.safeParse(data.state)
    if (!state.success) return null
    // Weather and special days the same way: anything wrong with one costs it, not the wall.
    const weather = weatherSnapshotSchema.safeParse(data.weather)
    const specialDays = specialDaysResolutionSchema.safeParse(data.special_days)
    return {
      settings: data.settings as unknown as DisplaySettings,
      state: state.data,
      events: data.events as CalendarEvent[],
      weather: weather.success ? weather.data : null,
      special_days: specialDays.success ? specialDays.data : null,
      saved_at: data.saved_at,
    }
  } catch {
    return null
  }
}

/** Returns whether it was saved: a full or blocked store is not an error for the wall. */
export function saveCache(storage: Storage | null | undefined, displayId: string, data: DisplayCache): boolean {
  try {
    storage?.setItem(key(displayId), JSON.stringify(data))
    return storage != null
  } catch {
    return false
  }
}

/** The display this browser showed last, for `/display` with no `?id=` while the server is out of reach. */
export function loadLastDisplayId(storage: Storage | null | undefined): string | null {
  try {
    return storage?.getItem(LAST_KEY) || null
  } catch {
    return null
  }
}

export function saveLastDisplayId(storage: Storage | null | undefined, displayId: string): void {
  try {
    storage?.setItem(LAST_KEY, displayId)
  } catch {
    // Nothing to do: the wall works without it.
  }
}

/** The browser's `localStorage`, or null where it is missing or blocked (even asking can throw). */
export function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}
