import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020'
import type { ValidateFunction } from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
import { BIRTH_ONLINE, birthTopic, discoveryMessages } from '../../../server/mqtt/discovery'
import type { DiscoveryMessage } from '../../../server/mqtt/discovery'
import { displayBase } from '../../../server/mqtt/topics'

// The Home Assistant discovery configs (server/mqtt/discovery.ts). A file
// snapshot shows every config as a reviewer would read it, and the rest holds
// each one to contracts/mqtt.json: a command topic must be one the app takes,
// and a payload a button or switch sends must be one the app accepts.

interface ContractTopic {
  direction: 'to_app' | 'from_app' | 'to_pi' | 'from_pi'
  payload: { encoding: 'text' | 'json' | 'any', schema?: { enum?: string[], maxLength?: number, properties?: { text: { maxLength: number } } } }
}

const contract = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../contracts/mqtt.json', import.meta.url)), 'utf8')) as { topics: Record<string, ContractTopic> }

const ajv = new Ajv2020({ strict: true })
const validators = new Map<string, ValidateFunction>()
for (const [name, topic] of Object.entries(contract.topics)) {
  if (topic.payload.schema) validators.set(name, ajv.compile(topic.payload.schema))
}

/** Whether the contract calls `payload` valid for the topic `name` (relative to the display's base). Topics that take anything accept anything. */
function accepts(name: string, payload: string): boolean {
  const spec = contract.topics[name]!.payload
  return spec.encoding === 'any' || validators.get(name)!(payload)
}

interface Config {
  name: string
  unique_id: string
  icon?: string
  command_topic?: string
  state_topic?: string
  availability_topic: string
  payload_available: string
  payload_not_available: string
  device: { identifiers: string[], name: string, manufacturer: string, model: string }
  origin: { name: string, url: string }
  qos: number
  [key: string]: unknown
}

interface Parsed {
  topic: string
  config: Config
}

const hallway = { id: 'hallway', name: 'Hallway' }

function parse(messages: DiscoveryMessage[]): Parsed[] {
  return messages.map(message => ({ topic: message.topic, config: JSON.parse(message.payload) as Config }))
}

/** `view/set` from `wallcal/hallway/view/set`. */
function suffixOf(topic: string, displayId: string): string {
  const base = `${displayBase(displayId)}/`
  expect(topic.startsWith(base), topic).toBe(true)
  return topic.slice(base.length)
}

const messages = discoveryMessages({ prefix: 'homeassistant', display: hallway, displayCount: 1 })
const parsed = parse(messages)
const config = (objectId: string): Config => {
  const found = parsed.find(message => message.topic.split('/')[3] === objectId)
  if (!found) throw new Error(`no ${objectId} entity`)
  return found.config
}

describe('discoveryMessages', () => {
  it('matches the snapshot for one display', async () => {
    const readable = parsed.map(({ topic, config }) => ({ topic, payload: config }))

    await expect(`${JSON.stringify(readable, null, 2)}\n`).toMatchFileSnapshot('./__snapshots__/discovery.hallway.json')
  })

  it('gives the payload as JSON text', () => {
    for (const message of messages) expect(typeof JSON.parse(message.payload)).toBe('object')
  })

  it('makes the same messages every time, in the same order', () => {
    expect(discoveryMessages({ prefix: 'homeassistant', display: hallway, displayCount: 1 })).toEqual(messages)
    expect(parsed.map(message => message.topic.split('/')[3])).toEqual([
      'view', 'month', 'previous_month', 'next_month', 'this_month', 'screen', 'photo_source',
      'brightness', 'auto_presence', 'auto_brightness', 'message', 'next_photo', 'refresh', 'last_sync', 'special_day',
    ])
  })

  it('names the device "Wall Calendar" when there is one display', () => {
    for (const { config } of parsed) {
      expect(config.device).toEqual({ identifiers: ['wallcal_hallway'], name: 'Wall Calendar', manufacturer: 'Wall Display', model: 'Wall Calendar' })
    }
  })

  it('adds the display name to the device when there are several, and keeps every id to the display', () => {
    const kitchen = parse(discoveryMessages({ prefix: 'homeassistant', display: { id: 'kitchen', name: 'Kitchen' }, displayCount: 2 }))

    expect(kitchen).toHaveLength(parsed.length)
    for (const { topic, config } of kitchen) {
      expect(config.device.name).toBe('Wall Calendar Kitchen')
      expect(config.device.identifiers).toEqual(['wallcal_kitchen'])
      expect(topic).toContain('/wallcal_kitchen/')
      expect(config.unique_id).toMatch(/^wallcal_kitchen_/)
      expect(config.availability_topic).toBe('wallcal/kitchen/availability')
      for (const key of ['command_topic', 'state_topic'] as const) {
        if (config[key]) expect(config[key]).toMatch(/^wallcal\/kitchen\//)
      }
    }
  })

  it('does not share a unique id or a topic between displays', () => {
    const both = [
      ...discoveryMessages({ prefix: 'homeassistant', display: hallway, displayCount: 2 }),
      ...discoveryMessages({ prefix: 'homeassistant', display: { id: 'kitchen', name: 'Kitchen' }, displayCount: 2 }),
    ]

    expect(new Set(both.map(message => message.topic)).size).toBe(both.length)
    expect(new Set(parse(both).map(message => message.config.unique_id)).size).toBe(both.length)
  })

  it('goes under the discovery prefix it is given', () => {
    const custom = discoveryMessages({ prefix: 'ha/discovery', display: hallway, displayCount: 1 })

    expect(custom).toHaveLength(messages.length)
    for (const message of custom) expect(message.topic).toMatch(/^ha\/discovery\/(select|sensor|button|switch|number|text)\/wallcal_hallway\/[a-z_]+\/config$/)
    // Only the topic changes: the configs say the same.
    expect(custom.map(message => message.payload)).toEqual(messages.map(message => message.payload))
  })

  it('does not use the abbreviated key names', () => {
    for (const { config } of parsed) {
      for (const key of ['cmd_t', 'stat_t', 'avty_t', 'uniq_id', 'dev', 'o', 'pl_on', 'pl_off', 'pl_prs', 'stat_on', 'stat_off', 'ent_cat', 'unit_of_meas', 'cmd_tpl', 'ic', 'opt', 'dev_cla']) {
        expect(config, key).not.toHaveProperty(key)
      }
    }
  })
})

describe('every config', () => {
  it('is published on <prefix>/<component>/wallcal_<display id>/<object id>/config', () => {
    for (const { topic } of parsed) {
      expect(topic).toMatch(/^homeassistant\/(select|sensor|button|switch|number|text)\/wallcal_hallway\/[a-z_]+\/config$/)
    }
  })

  it('has a unique id made of the display id and the object id in its topic, and no two the same', () => {
    for (const { topic, config } of parsed) {
      expect(config.unique_id).toBe(`wallcal_hallway_${topic.split('/')[3]}`)
    }
    expect(new Set(parsed.map(message => message.config.unique_id)).size).toBe(parsed.length)
    expect(new Set(parsed.map(message => message.topic)).size).toBe(parsed.length)
  })

  it('has a name that is the entity\'s own, not the device\'s', () => {
    for (const { config } of parsed) {
      expect(config.name.length).toBeGreaterThan(0)
      expect(config.name).not.toMatch(/wall calendar/i)
    }
  })

  it('goes offline with the app, on the availability topic with the contract\'s payloads', () => {
    const availability = contract.topics.availability!

    expect(availability.direction).toBe('from_app')
    for (const { config } of parsed) {
      expect(config.availability_topic).toBe('wallcal/hallway/availability')
      expect(accepts('availability', config.payload_available)).toBe(true)
      expect(accepts('availability', config.payload_not_available)).toBe(true)
      expect(config.payload_available).not.toBe(config.payload_not_available)
    }
  })

  it('belongs to the display\'s device and says where it comes from', () => {
    for (const { config } of parsed) {
      expect(config.device.identifiers).toEqual(['wallcal_hallway'])
      expect(config.origin.name).toBe('Wall Calendar')
      expect(config.origin.url).toMatch(/^https:\/\//)
      expect(config.qos).toBe(1)
    }
  })

  it('sends commands only to topics the app takes, and reads state only from topics it publishes', () => {
    for (const { config } of parsed) {
      if (config.command_topic) expect(contract.topics[suffixOf(config.command_topic, 'hallway')]?.direction, config.command_topic).toBe('to_app')
      if (config.state_topic) expect(contract.topics[suffixOf(config.state_topic, 'hallway')]?.direction, config.state_topic).toBe('from_app')
    }
  })
})

describe('the entities', () => {
  it('has a select for the view that offers the views the contract has for it', () => {
    const view = config('view')

    expect(view.options).toEqual(contract.topics['view/state']!.payload.schema!.enum)
    // "next" is a command that steps on, not a view to show.
    expect(view.options).not.toContain('next')
    for (const option of view.options as string[]) expect(accepts('view/set', option)).toBe(true)
  })

  it('has a select for the photo source that offers the sources the contract has', () => {
    const source = config('photo_source')

    expect(source.options).toEqual(contract.topics['photo_source/state']!.payload.schema!.enum)
    expect(source.command_topic).toBe('wallcal/hallway/photo_source/set')
    expect(source.state_topic).toBe('wallcal/hallway/photo_source/state')
  })

  it('has buttons whose press is a payload the app accepts', () => {
    const buttons = parsed.filter(message => message.topic.includes('/button/'))

    expect(buttons.map(message => message.config.name)).toEqual(['Previous month', 'Next month', 'This month', 'Next photo', 'Refresh calendars'])
    for (const { config } of buttons) {
      // Home Assistant sends PRESS when the config does not say.
      const press = (config.payload_press as string | undefined) ?? 'PRESS'

      expect(config).not.toHaveProperty('state_topic')
      expect(accepts(suffixOf(config.command_topic!, 'hallway'), press), `${config.name} sends ${press}`).toBe(true)
    }
  })

  it('steps the month with prev, next and current', () => {
    expect(config('previous_month').payload_press).toBe('prev')
    expect(config('next_month').payload_press).toBe('next')
    expect(config('this_month').payload_press).toBe('current')
    // The press has to mean something to the month command, and PRESS does not.
    expect(accepts('month/set', 'PRESS')).toBe(false)
  })

  it('has switches that send and read the payloads their topics use', () => {
    const switches = parsed.filter(message => message.topic.includes('/switch/'))

    expect(switches.map(message => message.config.name)).toEqual(['Screen', 'Auto presence', 'Auto brightness'])
    for (const { config } of switches) {
      const setName = suffixOf(config.command_topic!, 'hallway')
      const stateName = suffixOf(config.state_topic!, 'hallway')

      for (const key of ['payload_on', 'payload_off']) expect(accepts(setName, config[key] as string), `${config.name} ${key}`).toBe(true)
      for (const key of ['state_on', 'state_off']) expect(accepts(stateName, config[key] as string), `${config.name} ${key}`).toBe(true)
      expect(config.payload_on).not.toBe(config.payload_off)
      expect(config.state_on).toBe(config.payload_on)
      expect(config.state_off).toBe(config.payload_off)
    }
  })

  it('has a screen switch that follows on and off, and policy switches that follow ON and OFF', () => {
    expect(config('screen')).toMatchObject({ payload_on: 'on', payload_off: 'off' })
    expect(config('auto_presence')).toMatchObject({ payload_on: 'ON', payload_off: 'OFF' })
    expect(config('auto_brightness')).toMatchObject({ payload_on: 'ON', payload_off: 'OFF' })
  })

  it('has a brightness slider from 0 to 100 that the contract allows at both ends and not beyond', () => {
    const brightness = config('brightness')
    const min = brightness.min as number
    const max = brightness.max as number

    expect(brightness).toMatchObject({ step: 1, mode: 'slider', unit_of_measurement: '%' })
    for (const value of [min, max]) {
      expect(accepts('brightness/set', String(value))).toBe(true)
      expect(accepts('brightness/state', String(value))).toBe(true)
    }
    for (const value of [min - 1, max + 1]) {
      expect(accepts('brightness/set', String(value))).toBe(false)
      expect(accepts('brightness/state', String(value))).toBe(false)
    }
  })

  it('has a message box that follows the overlay, is as long as an overlay and clears the overlay when empty', () => {
    const message = config('message')

    expect(message.command_topic).toBe('wallcal/hallway/overlay/set')
    expect(message.state_topic).toBe('wallcal/hallway/overlay/state')
    expect(message).toMatchObject({ min: 0, mode: 'text', max: contract.topics['overlay/set']!.payload.schema!.properties.text.maxLength })
    // The state topic must never carry more than the box takes.
    expect(contract.topics['overlay/state']!.payload.schema!.maxLength).toBe(message.max)
    expect(accepts('overlay/state', '')).toBe(true)
    expect(message.command_template).toBe('{{ {\'text\': value} | to_json if value | trim else \'\' }}')
  })

  it('has sensors for the month, the last sync and the special day, which only read', () => {
    const sensors = parsed.filter(message => message.topic.includes('/sensor/'))

    expect(sensors.map(message => message.config.name)).toEqual(['Month shown', 'Last sync', 'Special day'])
    for (const { config } of sensors) expect(config).not.toHaveProperty('command_topic')
    expect(config('month').state_topic).toBe('wallcal/hallway/month/state')
    expect(config('last_sync')).toMatchObject({ state_topic: 'wallcal/hallway/last_sync/state', device_class: 'timestamp', entity_category: 'diagnostic' })
    expect(config('special_day')).toMatchObject({ state_topic: 'wallcal/hallway/special_day/state', icon: 'mdi:party-popper' })
  })

  it('keeps the settings that are rarely changed out of the main controls', () => {
    const configuration = parsed.filter(message => message.config.entity_category === 'config').map(message => message.config.name)

    expect(configuration).toEqual(['Photo source', 'Auto presence', 'Auto brightness'])
  })
})

describe('the birth topic', () => {
  it('is status under the discovery prefix', () => {
    expect(birthTopic('homeassistant')).toBe('homeassistant/status')
    expect(birthTopic('ha/discovery')).toBe('ha/discovery/status')
  })

  it('carries online when Home Assistant has started', () => {
    expect(BIRTH_ONLINE).toBe('online')
  })
})
