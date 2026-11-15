import type { SetupStatus } from '../../shared/settings'
import type { AppConfig } from '../config/schema'
import { brokerName } from '../mqtt/client'

// Shapes the Setup tab (GET /api/settings/setup): the parts of config.yaml that
// no other settings tab shows, so the page lists every option even where it
// can only be changed in the YAML. Like status.ts, only fields chosen by name
// are copied out: the Home Assistant URL's path and its token, the MQTT
// username and password and the PIN never leave the config.

export type SetupConfig = Pick<AppConfig,
  'timezone' | 'sync' | 'remote' | 'displays' | 'people' | 'groups' | 'homeassistant' | 'mqtt'
  | 'button' | 'policies' | 'weather' | 'alarm' | 'timers' | 'cameras' | 'triggers'>

/** `host:port` of an address, or null for something that isn't one. */
function hostOf(address: string): string | null {
  try {
    return new URL(address).host || null
  } catch {
    return null
  }
}

/** `host:port/path` of an address: no scheme, credentials, query or fragment, which is where a token would be. */
function hostAndPath(address: string): string | null {
  try {
    const url = new URL(address)
    if (!url.host) return null
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return null
  }
}

export function setupStatus(config: SetupConfig): SetupStatus {
  return {
    timezone: config.timezone,
    sync: { months_back: config.sync.months_back, months_ahead: config.sync.months_ahead },
    remote_pin: config.remote?.pin !== undefined,
    displays: config.displays.map(({ id, name }) => ({ id, name })),
    people: config.people.map(({ id, name, initial, colour, aliases }) => ({ id, name, initial, colour, aliases: [...aliases] })),
    groups: config.groups.map(({ id, name, aliases, people }) => ({ id, name, aliases: [...aliases], people: [...people] })),
    homeassistant: config.homeassistant ? { host: hostOf(config.homeassistant.url) } : null,
    mqtt: config.mqtt
      ? {
          broker: brokerName(config.mqtt.url),
          client_id: config.mqtt.client_id,
          signs_in: config.mqtt.username !== undefined,
          discovery: config.mqtt.discovery,
          discovery_prefix: config.mqtt.discovery_prefix,
        }
      : null,
    button: { single: config.button.single, double: config.button.double, long: config.button.long },
    brightness_curve: config.policies.auto_brightness.curve.map(({ lux, brightness }) => ({ lux, brightness })),
    schedules: config.displays.map(display => ({
      display_id: display.id,
      schedules: display.schedules.map(schedule => ({
        id: schedule.id,
        name: schedule.name,
        rules: schedule.rules.map(rule => ({
          view: rule.view,
          layout: rule.layout ?? null,
          photo_feed: rule.photo_feed ?? null,
          from: rule.from,
          to: rule.to,
          days: [...rule.days],
        })),
      })),
    })),
    weather: config.weather ? { entity_id: config.weather.entity_id, poll_seconds: config.weather.poll_seconds } : null,
    alarm: config.alarm ? { entity_id: config.alarm.entity_id, poll_seconds: config.alarm.poll_seconds } : null,
    timers: config.timers
      ? {
          poll_seconds: config.timers.poll_seconds,
          done_seconds: config.timers.done_seconds,
          entities: config.timers.entities.map(({ entity_id, displays }) => ({ entity_id, displays: displays ? [...displays] : null })),
        }
      : null,
    cameras: config.cameras.map(({ id, name, kind, url }) => ({ id, name, kind, where: hostAndPath(url) })),
    triggers: config.triggers.map(({ id, when, displays, actions }) => ({
      id,
      when: when.kind === 'state'
        ? { kind: 'state', entity_ids: [...when.entity_ids], from: when.from ? [...when.from] : null, to: when.to ? [...when.to] : null }
        : { kind: 'event', event_type: when.event_type, event_data: when.event_data },
      displays: displays ? [...displays] : null,
      actions: actions.map(action => ({ ...action })),
    })),
  }
}
