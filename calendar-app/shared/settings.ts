import type { DisplayState, SocketRole, Theme } from './display'

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
