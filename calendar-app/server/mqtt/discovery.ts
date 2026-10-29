import { PHOTO_SOURCES, SCREEN_STATES, VIEWS } from '../../shared/display'
import { AVAILABILITY_TOPIC, LAST_SYNC_TOPIC, OFFLINE, ONLINE, onOffPayload, topicFor } from './topics'
import type { CommandTopic, StateTopic } from './topics'

// What Home Assistant needs to show a display as a device (MQTT discovery,
// architecture §7.3): one config message per entity. Pure: no I/O. client.ts
// publishes these retained with QoS 1, and again when Home Assistant says it
// has restarted, so neither side has to start first.
// test/unit/mqtt/discovery.test.ts holds every config to contracts/mqtt.json,
// so a button can't send a payload the app would reject. Keys are written out
// in full (`command_topic`, not `cmd_t`), which any Home Assistant reads.

/** One message to publish: the topic and the JSON of a config. */
export interface DiscoveryMessage {
  topic: string
  payload: string
}

export interface DiscoveryOptions {
  /** Home Assistant's discovery prefix, `homeassistant` unless the config says otherwise. */
  prefix: string
  display: { id: string, name: string }
  /** How many displays the config has. With one the device is "Wall Calendar", and with more it is "Wall Calendar <display name>", so they can be told apart. */
  displayCount: number
}

type Component = 'select' | 'sensor' | 'button' | 'switch' | 'number' | 'text'

/** The topics that have a name in topics.ts, so renaming one stops this file building. */
type KnownTopic = CommandTopic | StateTopic | typeof LAST_SYNC_TOPIC

interface Entity {
  component: Component
  /** The last part of the unique id and of the discovery topic. */
  objectId: string
  /** Relative to the device, so Home Assistant makes `select.wall_calendar_view` from "View". */
  name: string
  /** Left out where the device class already gives a fitting one. */
  icon?: string
  /** What is particular to the component, with the topics from `topic`. */
  config: Record<string, unknown>
}

const ORIGIN = { name: 'Wall Calendar', url: 'https://github.com/kallb123/wall-display' }

/** Left alone, Home Assistant offers a text entity 255 characters. An overlay takes 200 (contracts/mqtt.json). */
const MESSAGE_MAX_LENGTH = 200

/** `homeassistant/status`, where Home Assistant says it has started. */
export function birthTopic(prefix: string): string {
  return `${prefix}/status`
}

/** What Home Assistant publishes on the birth topic when it is up and wants the configs again. */
export const BIRTH_ONLINE = 'online'

/** A switch whose command and state topics use the same two payloads (`on`/`off` for the screen, `ON`/`OFF` for the policies), so it needs no template. */
function switchPayloads(on: string, off: string): Record<string, string> {
  return { payload_on: on, payload_off: off, state_on: on, state_off: off }
}

function entitiesFor(topic: (suffix: KnownTopic) => string): Entity[] {
  const [screenOn, screenOff] = SCREEN_STATES
  const [on, off] = [onOffPayload(true), onOffPayload(false)]

  return [
    {
      component: 'select',
      objectId: 'view',
      name: 'View',
      icon: 'mdi:view-dashboard',
      config: { command_topic: topic('view/set'), state_topic: topic('view/state'), options: [...VIEWS] },
    },
    {
      component: 'sensor',
      objectId: 'month',
      name: 'Month shown',
      icon: 'mdi:calendar-month',
      config: { state_topic: topic('month/state') },
    },
    {
      component: 'button',
      objectId: 'previous_month',
      name: 'Previous month',
      icon: 'mdi:chevron-left',
      config: { command_topic: topic('month/set'), payload_press: 'prev' },
    },
    {
      component: 'button',
      objectId: 'next_month',
      name: 'Next month',
      icon: 'mdi:chevron-right',
      config: { command_topic: topic('month/set'), payload_press: 'next' },
    },
    {
      component: 'button',
      objectId: 'this_month',
      name: 'This month',
      icon: 'mdi:calendar-today',
      config: { command_topic: topic('month/set'), payload_press: 'current' },
    },
    {
      component: 'switch',
      objectId: 'screen',
      name: 'Screen',
      icon: 'mdi:monitor',
      config: { command_topic: topic('screen/set'), state_topic: topic('screen/state'), ...switchPayloads(screenOn, screenOff) },
    },
    {
      component: 'select',
      objectId: 'photo_source',
      name: 'Photo source',
      icon: 'mdi:image-multiple',
      config: { command_topic: topic('photo_source/set'), state_topic: topic('photo_source/state'), options: [...PHOTO_SOURCES], entity_category: 'config' },
    },
    {
      component: 'number',
      objectId: 'brightness',
      name: 'Brightness',
      icon: 'mdi:brightness-6',
      config: { command_topic: topic('brightness/set'), state_topic: topic('brightness/state'), min: 0, max: 100, step: 1, mode: 'slider', unit_of_measurement: '%' },
    },
    {
      component: 'switch',
      objectId: 'auto_presence',
      name: 'Auto presence',
      icon: 'mdi:motion-sensor',
      config: { command_topic: topic('auto_presence/set'), state_topic: topic('auto_presence/state'), ...switchPayloads(on, off), entity_category: 'config' },
    },
    {
      component: 'switch',
      objectId: 'auto_brightness',
      name: 'Auto brightness',
      icon: 'mdi:brightness-auto',
      config: { command_topic: topic('auto_brightness/set'), state_topic: topic('auto_brightness/state'), ...switchPayloads(on, off), entity_category: 'config' },
    },
    {
      component: 'text',
      objectId: 'message',
      name: 'Message',
      icon: 'mdi:message-text',
      // The state topic carries the overlay's text, or nothing once it has gone, so the box empties when the message
      // runs out as well as when it is cleared. The template wraps the text as the overlay command wants it, and an
      // empty (or blank) value goes out as an empty payload, which clears it.
      config: {
        command_topic: topic('overlay/set'),
        state_topic: topic('overlay/state'),
        command_template: '{{ {\'text\': value} | to_json if value | trim else \'\' }}',
        min: 0,
        max: MESSAGE_MAX_LENGTH,
        mode: 'text',
      },
    },
    {
      component: 'button',
      objectId: 'next_photo',
      name: 'Next photo',
      icon: 'mdi:skip-next',
      config: { command_topic: topic('photo/next') },
    },
    {
      component: 'button',
      objectId: 'refresh',
      name: 'Refresh calendars',
      icon: 'mdi:calendar-sync',
      config: { command_topic: topic('refresh') },
    },
    {
      component: 'sensor',
      objectId: 'last_sync',
      name: 'Last sync',
      config: { state_topic: topic(LAST_SYNC_TOPIC), device_class: 'timestamp', entity_category: 'diagnostic' },
    },
  ]
}

/**
 * Every discovery message for one display, in a fixed order: `<prefix>/<component>/wallcal_<display id>/<object id>/config`
 * with the config as JSON. Publish them retained, so Home Assistant has them even if it starts after the app.
 * Each entity goes offline with the app (the availability topic and its last will), and all share one device.
 */
export function discoveryMessages(options: DiscoveryOptions): DiscoveryMessage[] {
  const { prefix, display, displayCount } = options
  const node = `wallcal_${display.id}`
  const topic = (suffix: KnownTopic): string => topicFor(display.id, suffix)

  const device = {
    identifiers: [node],
    name: displayCount > 1 ? `Wall Calendar ${display.name}` : 'Wall Calendar',
    manufacturer: 'Wall Display',
    model: 'Wall Calendar',
  }

  return entitiesFor(topic).map((entity) => {
    const config = {
      name: entity.name,
      unique_id: `${node}_${entity.objectId}`,
      ...(entity.icon && { icon: entity.icon }),
      ...entity.config,
      availability_topic: topicFor(display.id, AVAILABILITY_TOPIC),
      payload_available: ONLINE,
      payload_not_available: OFFLINE,
      device,
      origin: ORIGIN,
      qos: 1,
    }
    return { topic: `${prefix}/${entity.component}/${node}/${entity.objectId}/config`, payload: JSON.stringify(config) }
  })
}
