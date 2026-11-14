import type { DisplayState, SocketRole } from '../../shared/display'
import type { CalendarStatus, ConnectionsStatus, DisplayStatus, MqttLinkState, PhotoProviderSettings, PhotosSettingsStatus, SettingsPerson } from '../../shared/settings'
import type { AppConfig, CalendarConfig, DisplayConfig, MqttConfig, PhotosConfig, UnsplashConfig } from '../config/schema'
import type { Db } from '../db/client'
import { syncStatus } from '../db/schema'
import type { MqttBridgeStatus } from '../mqtt/client'
import { brokerName } from '../mqtt/client'
import { photoFeedsOf } from '../photos/feeds'
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
  config: Pick<AppConfig, 'calendars' | 'people' | 'groups' | 'timezone'>
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
      icon: calendar.icon ?? null,
      detect_people: calendar.detect_people,
      detect_in: [...calendar.detect_in],
      source_type: calendar.source.type,
      poll_seconds: calendar.source.poll_seconds,
      syncing: canSync(calendar),
      last_attempt_at: toIso(row?.lastAttemptAt),
      last_success_at: toIso(row?.lastSuccessAt),
      last_error: row?.lastError ?? null,
      event_count: row?.eventCount ?? 0,
      fallbacks: recentFallbacks(db, calendar, config.people, now, { groups: config.groups, timeZone: config.timezone }),
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
  config: Pick<PhotosConfig, 'interval_seconds' | 'match_orientation' | 'landscape_only' | 'cache_max_mb' | 'immich' | 'google' | 'local' | 'unsplash' | 'feeds'> | undefined
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

/** The longest search shown on a card; a long one is cut. */
const MAX_WHERE = 60

/**
 * What an Unsplash feed shows, in a few words, led by how it picks: `random`
 * (new photos at each refresh) or `top` (the same top photos of the search,
 * collections or topics every time, which is the `fixed` pick). Then its
 * search (`random: landscape`), its collections (`random: collections 317099`)
 * or its topics (`top: topics nature`). The access key is not part of it.
 */
function unsplashWhere(settings: Pick<UnsplashConfig, 'query' | 'collections' | 'topics' | 'pick'>): string {
  const what = settings.collections ? `collections ${settings.collections.join(', ')}` : settings.topics ? `topics ${settings.topics.join(', ')}` : settings.query ?? 'landscape'
  const text = `${settings.pick === 'random' ? 'random' : 'top'}: ${what}`
  return text.length > MAX_WHERE ? `${text.slice(0, MAX_WHERE - 1)}…` : text
}

/**
 * The Photos tab: each running photo feed (the sources set up, then
 * `photos.feeds`) with its pool, what is cached and how its last listing went,
 * the cache against its cap, and the rotation settings. A feed is described by
 * the fields chosen here (Immich's mode and host, the folder's path, what
 * Unsplash is asked for), so the API keys and any other part of the Immich
 * address stay in the config. A feed with no status yet (the service starts
 * after the config is read) shows zeros.
 */
export function photosStatus({ config, status }: PhotosStatusArgs): PhotosSettingsStatus {
  if (!config) return { configured: false }

  const running = new Map((status?.providers ?? []).map(provider => [provider.id, provider]))
  const feeds = photoFeedsOf(config)
  const providers: PhotoProviderSettings[] = feeds.map((feed) => {
    const live = running.get(feed.id)
    return {
      id: feed.id,
      source: feed.source,
      name: feed.name,
      mode: feed.source === 'immich' ? feed.settings.mode : null,
      where: feed.source === 'immich' ? hostOf(feed.settings.url) : feed.source === 'local' ? feed.settings.path : unsplashWhere(feed.settings),
      photos: live?.photos ?? 0,
      cached: live?.cached ?? 0,
      last_success_at: live?.last_success_at ?? null,
      last_error: live?.last_error ?? null,
    }
  })

  return {
    configured: true,
    feeds: feeds.map(({ id, name, source }) => ({ id, name, source })),
    interval_seconds: config.interval_seconds,
    // `landscape_only` is the older name of the same switch.
    match_orientation: config.match_orientation || config.landscape_only,
    cache_bytes: status?.cache_bytes ?? 0,
    cache_max_bytes: config.cache_max_mb * 1024 * 1024,
    providers,
    google_ignored: config.google !== undefined,
  }
}
