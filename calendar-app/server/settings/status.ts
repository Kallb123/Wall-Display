import type { DisplayState, SocketRole } from '../../shared/display'
import { PHOTO_SOURCES } from '../../shared/display'
import type { CalendarStatus, ConnectionsStatus, DisplayStatus, MqttLinkState, PhotoProviderSettings, PhotosSettingsStatus, SettingsPerson } from '../../shared/settings'
import type { AppConfig, CalendarConfig, DisplayConfig, MqttConfig, PhotosConfig } from '../config/schema'
import type { Db } from '../db/client'
import { syncStatus } from '../db/schema'
import type { MqttBridgeStatus } from '../mqtt/client'
import { brokerName } from '../mqtt/client'
import type { PhotoService } from '../photos/service'
import { recentFallbacks } from '../sources/fallbacks'
import type { HaStatus } from '../sources/homeassistant/status'

// Shapes what the settings pages show (architecture §7.6) from the config, the
// database and the running services. The route handlers only gather those and
// call these, which take everything they read as arguments so they can be
// tested without a server. Nothing here passes on a secret: an ICS address, the
// Home Assistant URL and token, the MQTT credentials and the PIN stay in the
// config, and only fields chosen by name are copied out.

const toIso = (date: Date | null | undefined): string | null => date ? date.toISOString() : null

export interface CalendarStatusArgs {
  db: Db
  config: Pick<AppConfig, 'calendars' | 'people'>
  now: Date
  /** Whether a source type has a sync function (`canSyncCalendar`). */
  canSync: (calendar: CalendarConfig) => boolean
}

/** One entry per calendar in the config, in config order. A calendar that has not been tried yet has no sync status, and shows nulls and 0. */
export function calendarStatuses({ db, config, now, canSync }: CalendarStatusArgs): CalendarStatus[] {
  const rows = new Map(db.select().from(syncStatus).all().map(row => [row.calendarId, row]))
  const people = new Map<string, SettingsPerson>(config.people.map(({ id, name, initial, colour }) => [id, { id, name, initial, colour }]))

  return config.calendars.map((calendar) => {
    const row = rows.get(calendar.id)
    return {
      id: calendar.id,
      name: calendar.name ?? calendar.id,
      // The config check makes sure the default person exists.
      person: people.get(calendar.person)!,
      detect_people: calendar.detect_people,
      detect_in: [...calendar.detect_in],
      source_type: calendar.source.type,
      poll_seconds: calendar.source.poll_seconds,
      syncing: canSync(calendar),
      last_attempt_at: toIso(row?.lastAttemptAt),
      last_success_at: toIso(row?.lastSuccessAt),
      last_error: row?.lastError ?? null,
      event_count: row?.eventCount ?? 0,
      fallbacks: recentFallbacks(db, calendar, config.people, now),
    }
  })
}

export interface DisplayStatusArgs {
  displays: readonly Pick<DisplayConfig, 'id' | 'name' | 'theme' | 'month_style'>[]
  getState: (displayId: string) => DisplayState
  counts: (displayId: string) => Record<SocketRole, number>
  /** The MQTT bridge's status, or undefined when there is no bridge (no `mqtt` block). */
  mqtt: readonly MqttBridgeStatus[] | undefined
}

/** One entry per display in the config, in config order. */
export function displayStatuses({ displays, getState, counts, mqtt }: DisplayStatusArgs): DisplayStatus[] {
  return displays.map(({ id, name, theme, month_style }) => {
    const link = mqtt?.find(candidate => candidate.displayId === id)
    const mqttState: MqttLinkState = link?.state ?? 'off'
    return {
      id,
      name,
      theme,
      month_style,
      state: getState(id),
      sockets: counts(id),
      mqtt: mqttState,
      mqtt_error: link?.lastError ?? null,
    }
  })
}

export interface ConnectionsStatusArgs {
  mqtt: Pick<MqttConfig, 'url' | 'discovery'> | undefined
  /** The bridge's status, or undefined when there is no bridge. */
  bridge: readonly MqttBridgeStatus[] | undefined
  /** How many displays are in the config, for `total` when the bridge isn't there to say. */
  displayCount: number
  /** The latest Home Assistant check, or undefined when the config has no `homeassistant` block. */
  homeassistant: HaStatus | undefined
}

export function connectionsStatus({ mqtt, bridge, displayCount, homeassistant }: ConnectionsStatusArgs): ConnectionsStatus {
  return {
    mqtt: {
      configured: mqtt !== undefined,
      broker: mqtt ? brokerName(mqtt.url) : null,
      discovery: mqtt?.discovery ?? false,
      connected: bridge?.filter(link => link.state === 'connected').length ?? 0,
      total: mqtt ? bridge?.length ?? displayCount : 0,
    },
    homeassistant: homeassistant
      ? {
          configured: true,
          state: homeassistant.ok ? 'ok' : 'error',
          error: homeassistant.ok ? null : homeassistant.error,
          checked_at: homeassistant.checkedAt.toISOString(),
        }
      : { configured: false, state: 'off', error: null, checked_at: null },
  }
}

/**
 * Why discovery can't be republished, in a sentence for the page, or null when
 * it can. Both reasons are the user's configuration, not a fault, so the route
 * answers 409 rather than a 5xx.
 */
export function discoveryProblem(mqtt: Pick<MqttConfig, 'discovery'> | undefined): string | null {
  if (!mqtt) return 'MQTT is not set up, so there is nothing to publish to'
  if (!mqtt.discovery) return 'Home Assistant discovery is turned off (discovery: false in the mqtt block)'
  return null
}

export interface PhotosStatusArgs {
  /** The `photos` block, or undefined when the config has none. */
  config: Pick<PhotosConfig, 'interval_seconds' | 'landscape_only' | 'cache_max_mb' | 'immich' | 'google' | 'local'> | undefined
  /** The photo service's status, or undefined when it isn't running. */
  status: ReturnType<PhotoService['status']> | undefined
}

/** `host:port` of an address, and nothing else: no scheme, path, query or credentials. Null for something that isn't an address. */
function hostOf(address: string): string | null {
  try {
    return new URL(address).host || null
  } catch {
    return null
  }
}

/**
 * The Photos tab: each running photo source with its pool, what is cached and
 * how its last listing went, the cache against its cap, and the rotation
 * settings. A source is described by the fields chosen here (Immich's mode and
 * host, the folder's path), so the API key and any other part of the Immich
 * address stay in the config. A source with no status yet (the service starts
 * after the config is read) shows zeros.
 */
export function photosStatus({ config, status }: PhotosStatusArgs): PhotosSettingsStatus {
  if (!config) return { configured: false }

  const running = new Map((status?.providers ?? []).map(provider => [provider.id, provider]))
  const providers: PhotoProviderSettings[] = []
  for (const id of PHOTO_SOURCES) {
    if (id === 'google') continue
    const set = id === 'immich' ? config.immich : config.local
    if (!set) continue
    const live = running.get(id)
    providers.push({
      id,
      mode: id === 'immich' ? config.immich?.mode ?? null : null,
      where: id === 'immich' ? hostOf(config.immich!.url) : config.local!.path,
      photos: live?.photos ?? 0,
      cached: live?.cached ?? 0,
      last_success_at: live?.last_success_at ?? null,
      last_error: live?.last_error ?? null,
    })
  }

  return {
    configured: true,
    interval_seconds: config.interval_seconds,
    landscape_only: config.landscape_only,
    cache_bytes: status?.cache_bytes ?? 0,
    cache_max_bytes: config.cache_max_mb * 1024 * 1024,
    providers,
    google_ignored: config.google !== undefined,
  }
}
