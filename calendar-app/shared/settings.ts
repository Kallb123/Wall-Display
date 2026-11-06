import type { DisplayState, NightText, Orientation, PhotoSource, SocketRole, Theme, WeekHours } from './display'

// What the settings pages (architecture §7.6) and the server agree on. Pure
// types: no I/O, and no imports from server/, so the pages can use them too.
// Nothing here carries a secret: no feed URL, token, password or PIN. Times
// are ISO 8601 strings, or null for "never".

/** A person as the settings pages show them. */
export interface SettingsPerson {
  id: string
  name: string
  initial: string
  colour: string
}

/**
 * An event that fell through to its calendar's default person: no name, alias
 * or rule matched it. One entry per event (a recurring event's instances are
 * grouped), so a missing rule or alias is easy to spot.
 */
export interface FallbackEvent {
  title: string
  /** The occurrence nearest to now within the window. A UTC instant. */
  start: string
  all_day: boolean
  /** All-day events only: `YYYY-MM-DD`. */
  start_date: string | null
  /** How many occurrences in the window fell through. 1 for a one-off event. */
  occurrences: number
}

/** `GET /api/settings/calendars`: one entry per calendar in the config, in config order. */
export interface CalendarStatus {
  id: string
  name: string
  /** The calendar's default person. */
  person: SettingsPerson
  detect_people: boolean | 'anywhere'
  detect_in: ('title' | 'description')[]
  source_type: 'ics' | 'homeassistant'
  poll_seconds: number
  /** False when the source type can't be synced (yet), so it is never polled. */
  syncing: boolean
  last_attempt_at: string | null
  last_success_at: string | null
  /** The last failure's safe message (never a URL), or null after a success. */
  last_error: string | null
  event_count: number
  /** Recent events that fell back to the default person. Always empty when detection is off. */
  fallbacks: FallbackEvent[]
}

/** How a display's MQTT connection is doing. `off` when there is no `mqtt` block in the config. */
export type MqttLinkState = 'off' | 'connecting' | 'connected' | 'disconnected'

/** `GET /api/settings/displays`: one entry per display in the config, in config order. */
export interface DisplayStatus {
  id: string
  name: string
  theme: Theme
  month_style: 'soft' | 'classic'
  /** What the display is showing now. */
  state: DisplayState
  /** Open WebSocket connections for this display, by role: the wall's page and any remotes. */
  sockets: Record<SocketRole, number>
  mqtt: MqttLinkState
  /** The MQTT connection's last error, without secrets. Null when connected or off. */
  mqtt_error: string | null
}

/** `GET /api/settings/connections`: the app's links to MQTT and Home Assistant. */
export interface ConnectionsStatus {
  mqtt: {
    configured: boolean
    /** The broker's scheme, host and port, such as `mqtt://mosquitto:1883`. Null when not configured. */
    broker: string | null
    discovery: boolean
    /** How many displays are connected, out of how many. */
    connected: number
    total: number
  }
  homeassistant: {
    configured: boolean
    /** `ok` when Home Assistant answered with the token, `error` when it didn't, `off` when not configured. */
    state: 'ok' | 'error' | 'off'
    /** Why it failed, without the URL or the token. Null unless `state` is `error`. */
    error: string | null
    /** When it was last checked. Null when not configured. */
    checked_at: string | null
  }
}

/** `POST /api/settings/discovery`: which displays had their discovery configs published again. */
export interface DiscoveryResult {
  republished: string[]
}

/** How an Immich source picks its photos (`photos.immich.mode`). */
export type ImmichMode = 'albums' | 'random' | 'memories'

/** One photo source that is set up and running, as the Photos tab shows it. */
export interface PhotoProviderSettings {
  id: PhotoSource
  /** Immich only: how its photos are picked. Null for the others. */
  mode: ImmichMode | null
  /**
   * Where it is: Immich's host and port (no scheme, path or credentials), or the
   * local folder's path. The API key never appears.
   */
  where: string | null
  /** Photos in the pool, as last listed. */
  photos: number
  /** How many of them are rendered and in the cache now. */
  cached: number
  last_success_at: string | null
  /** The last failure's safe message (never a URL or a key), or null after a success. */
  last_error: string | null
}

/**
 * `GET /api/settings/photos` (and the answer to `POST …/refresh`): the photo
 * sources, the cache against its cap and the rotation settings. `configured`
 * is false when the config has no `photos` block, and then nothing else is
 * there. Nothing here carries a secret.
 */
export type PhotosSettingsStatus =
  | { configured: false }
  | {
      configured: true
      /** How long each photo stays while a display is on the photo frame. */
      interval_seconds: number
      landscape_only: boolean
      /** Bytes of rendered photos on disk, and the cap (`cache_max_mb`) they are kept under. */
      cache_bytes: number
      cache_max_bytes: number
      /** In config order of preference: Immich, Google, then the folder. A source that is not built (Google) is not listed. */
      providers: PhotoProviderSettings[]
      /** The config has a `google` block, which is accepted and ignored for now. */
      google_ignored: boolean
    }

// Preferences (PR 5.6): the settings the Displays tab edits. Each is a value
// from config.yaml that can be changed while the app runs, and the change is
// stored in SQLite on top of the config (the YAML is never written). Sources,
// secrets, ids, schedules and the rest stay in YAML only.

/** One display's preferences, as they are in force. */
export interface DisplayPreferences {
  theme: Theme
  month_style: 'soft' | 'classic'
  week_start: 'monday' | 'sunday'
  /** Minutes before a pinned month goes back to the current one, 1 to 1440. */
  month_return_minutes: number
  /** Whole hours: `from` 0 to 23, `to` 1 to 24, `from` before `to`. */
  week_hours: WeekHours
  burn_in: boolean
  /** `next_alarm` needs the config's `alarm` block. */
  night_text: NightText
  /** Which way up the display is laid out; `auto` follows the window's shape. */
  orientation: Orientation
}

export const DISPLAY_PREFERENCE_KEYS = ['theme', 'month_style', 'week_start', 'month_return_minutes', 'week_hours', 'burn_in', 'night_text', 'orientation'] as const satisfies readonly (keyof DisplayPreferences)[]
export type DisplayPreferenceKey = (typeof DISPLAY_PREFERENCE_KEYS)[number]

/** A quiet hours window: `HH:MM` times in the config's time zone, which must differ and may wrap midnight. */
export interface QuietHours {
  from: string
  to: string
}

/** What the auto brightness policy does when the room gets dark (`policies.auto_brightness.night_action`). */
export type NightAction = 'none' | 'night_view' | 'screen_off'

/** The preferences every display shares: the photo frame's interval and the policies' thresholds. */
export interface SharedPreferences {
  /** `photos.interval_seconds`, at least 5. Only set when the config has a `photos` block. */
  photo_interval_seconds: number
  /** `policies.auto_presence.off_after_minutes`, at least 1. */
  off_after_minutes: number
  /** `policies.auto_presence.quiet_hours`, or null for none. */
  quiet_hours: QuietHours | null
  night_action: NightAction
  /** The room is dark below this many lux. Null for no threshold, which only goes with `night_action: none`. Positive. */
  night_below_lux: number | null
  /** Light again from here. Null means twice `night_below_lux`. More than `night_below_lux`, and null when that is. */
  night_above_lux: number | null
  /** `policies.auto_brightness.min_step`, 1 to 50. */
  min_step: number
  /** `policies.auto_brightness.smoothing_seconds`, 0 to 600. */
  smoothing_seconds: number
}

export const SHARED_PREFERENCE_KEYS = ['photo_interval_seconds', 'off_after_minutes', 'quiet_hours', 'night_action', 'night_below_lux', 'night_above_lux', 'min_step', 'smoothing_seconds'] as const satisfies readonly (keyof SharedPreferences)[]
export type SharedPreferenceKey = (typeof SHARED_PREFERENCE_KEYS)[number]

/** A set of preferences: what is in force, what config.yaml says, and which have a saved change. */
export interface PreferencesEntry<T> {
  /** In force: the config with the saved changes on top. */
  values: T
  /** What config.yaml says (with its defaults filled in), which Reset goes back to. */
  config: T
  /** The keys with a saved change, in key order. A saved change may happen to equal the config's value. */
  changed: (keyof T & string)[]
}

export interface DisplayPreferencesEntry extends PreferencesEntry<DisplayPreferences> {
  id: string
  name: string
}

/** `GET /api/settings/preferences`, and the answer to both writes. */
export interface PreferencesStatus {
  /** One entry per display in the config, in config order. */
  displays: DisplayPreferencesEntry[]
  shared: PreferencesEntry<SharedPreferences>
  /** Whether the config has a `photos` block. Without one, `photo_interval_seconds` can't be set. */
  photos_configured: boolean
  /** Whether the config has an `alarm` block. Without one, `night_text` can't be `next_alarm`. */
  alarm_configured: boolean
  /** Whether the config has an `mqtt` block. The policies only run with one, as the sensors report over MQTT. */
  mqtt_configured: boolean
}

/**
 * The body of `PUT /api/settings/preferences/displays/:id` (with
 * `DisplayPreferences`) and `PUT /api/settings/preferences/shared` (with
 * `SharedPreferences`). `set` saves values; `reset` drops the saved change for
 * each key, so it goes back to the config's. A key may not be in both. Keys
 * left out of both keep what they have.
 */
export interface PreferencesUpdate<T> {
  set?: Partial<T>
  reset?: (keyof T & string)[]
}

/**
 * The `data` of a 400 answer to either write: a message per key that was
 * refused, such as `{ night_below_lux: "is needed when night_action is night_view" }`.
 * Nothing is saved when any key is refused.
 */
export interface PreferencesRefusal {
  fields: Partial<Record<string, string>>
}
