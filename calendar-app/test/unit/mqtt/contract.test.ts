import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020'
import type { ValidateFunction } from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
import type { DisplayState } from '../../../shared/display'
import { defaultDisplayState } from '../../../server/control/commands'
import {
  AVAILABILITY_TOPIC,
  COMMAND_TOPICS,
  LAST_SYNC_TOPIC,
  lastSyncPayload,
  OFFLINE,
  ONLINE,
  parseCommandPayload,
  STATE_TOPICS,
  statePayloads,
} from '../../../server/mqtt/topics'
import type { CommandTopic, StateTopic } from '../../../server/mqtt/topics'

// The app against contracts/mqtt.json, the file the pi agent's tests check too.
// The topics must match, and so must the payloads: whatever the contract calls
// valid, the app parses, and whatever it calls invalid, the app rejects.

type Direction = 'to_app' | 'from_app' | 'to_pi' | 'from_pi'

interface ContractTopic {
  direction: Direction
  retained: boolean
  description: string
  payload: { encoding: 'text' | 'json' | 'any', schema?: object, empty?: 'clear' }
  examples: string[]
  invalid_examples: string[]
}

interface Contract {
  $comment: string
  version: number
  base: string
  topics: Record<string, ContractTopic>
}

const contract = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../contracts/mqtt.json', import.meta.url)), 'utf8')) as Contract
const names = Object.keys(contract.topics)
const entries = Object.entries(contract.topics)

// Topics the contract has and the app does not carry out yet. Each comes off its list when its PR lands
// and the app has it in STATE_TOPICS, or publishes it.
/** The app publishes these, in a later PR. */
const PUBLISHED_LATER: readonly string[] = ['special_day/state'] // PR S.1
/** The app publishes these to the pi agent, in a later PR. */
const TO_PI_LATER: readonly string[] = ['pi/screen/set'] // PR 3.2

const ajv = new Ajv2020({ strict: true })
const validators = new Map<string, ValidateFunction>()
for (const [name, topic] of entries) {
  if (topic.payload.schema) validators.set(name, ajv.compile(topic.payload.schema))
}

/** Whether the contract calls `payload` valid for `name`. Empty means clear where the topic allows it. */
function contractAccepts(name: string, payload: string): boolean {
  const { payload: spec } = contract.topics[name]!
  if (spec.encoding === 'any') return true
  if (spec.empty === 'clear' && payload.trim() === '') return true
  const validate = validators.get(name)!
  if (spec.encoding === 'text') return validate(payload)
  let json: unknown
  try {
    json = JSON.parse(payload)
  } catch {
    return false
  }
  return validate(json)
}

const sorted = (list: readonly string[]): string[] => [...list].sort()
const namesWhere = (test: (topic: ContractTopic, name: string) => boolean): string[] =>
  sorted(entries.filter(([name, topic]) => test(topic, name)).map(([name]) => name))

describe('the contract file', () => {
  it('says what it is, its version and its base', () => {
    expect(contract.$comment).toMatch(/Vitest.*pytest/)
    expect(contract.version).toBe(1)
    expect(contract.base).toBe('wallcal/{display_id}')
  })

  it.each(names)('%s is described fully', (name) => {
    const topic = contract.topics[name]!

    expect(['to_app', 'from_app', 'to_pi', 'from_pi']).toContain(topic.direction)
    expect(typeof topic.retained).toBe('boolean')
    expect(topic.description.length).toBeGreaterThan(10)
    expect(['text', 'json', 'any']).toContain(topic.payload.encoding)
    expect(topic.examples.length).toBeGreaterThan(0)
    expect(Array.isArray(topic.invalid_examples)).toBe(true)
  })

  it('has a schema for every topic that takes a particular payload', () => {
    for (const [name, topic] of entries) {
      expect(Boolean(topic.payload.schema), name).toBe(topic.payload.encoding !== 'any')
    }
  })

  it('allows an empty payload to clear only on overlay/set', () => {
    expect(namesWhere(topic => topic.payload.empty !== undefined)).toEqual(['overlay/set'])
    expect(contract.topics['overlay/set']!.payload.empty).toBe('clear')
  })

  it('gives invalid examples to every topic that has a closed set of payloads', () => {
    // special_day/state is a free name, and photo/next and refresh take anything.
    const open = ['special_day/state', 'photo/next', 'refresh']

    for (const [name, topic] of entries) {
      if (!open.includes(name)) expect(topic.invalid_examples.length, name).toBeGreaterThan(0)
    }
  })

  it.each(entries.filter(([, topic]) => topic.payload.encoding !== 'any').map(([name]) => name))('%s: every example passes its schema and no invalid example does', (name) => {
    const topic = contract.topics[name]!

    for (const payload of topic.examples) expect(contractAccepts(name, payload), `example ${JSON.stringify(payload)}`).toBe(true)
    for (const payload of topic.invalid_examples) expect(contractAccepts(name, payload), `invalid example ${JSON.stringify(payload)}`).toBe(false)
  })
})

describe('the topics', () => {
  it('has the app\'s command topics, and only those, going to the app', () => {
    expect(namesWhere(topic => topic.direction === 'to_app')).toEqual(sorted(COMMAND_TOPICS))
  })

  it('has the app\'s state, availability and last sync topics going out of the app, apart from those a later PR adds', () => {
    const published = [...STATE_TOPICS, AVAILABILITY_TOPIC, LAST_SYNC_TOPIC, ...PUBLISHED_LATER]

    expect(namesWhere(topic => topic.direction === 'from_app')).toEqual(sorted(published))
  })

  it('has pi/screen/set as the only topic for the app to publish to the pi agent, and it is for a later PR', () => {
    expect(namesWhere(topic => topic.direction === 'to_pi')).toEqual(sorted(TO_PI_LATER))
    expect(TO_PI_LATER).toEqual(['pi/screen/set'])
  })

  it('has the pi agent\'s topics under pi/', () => {
    expect(namesWhere(topic => topic.direction === 'from_pi' || topic.direction === 'to_pi')).toEqual(namesWhere((_, name) => name.startsWith('pi/')))
  })

  it('has a state topic for each setting the app takes a command for, and the other way round', () => {
    const settings = COMMAND_TOPICS.filter(topic => topic.endsWith('/set')).map(topic => topic.replace(/\/set$/, ''))
    const states = STATE_TOPICS.map(topic => topic.replace(/\/state$/, ''))

    expect(sorted(states)).toEqual(sorted(settings))
  })

  it('retains state, availability and last sync, and does not retain commands', () => {
    for (const name of [...STATE_TOPICS, AVAILABILITY_TOPIC, LAST_SYNC_TOPIC]) expect(contract.topics[name]!.retained, name).toBe(true)
    for (const name of COMMAND_TOPICS) expect(contract.topics[name]!.retained, name).toBe(false)
  })
})

describe('command payloads', () => {
  const commandTopics = (COMMAND_TOPICS as readonly CommandTopic[]).map(name => [name, contract.topics[name]!] as const)

  it.each(commandTopics.map(([name]) => name))('%s: the app parses every example and rejects every invalid example', (name) => {
    const topic = contract.topics[name as CommandTopic]!

    for (const payload of topic.examples) {
      expect(parseCommandPayload(name as CommandTopic, payload), `example ${JSON.stringify(payload)}`).toMatchObject({ ok: true })
    }
    for (const payload of topic.invalid_examples) {
      expect(parseCommandPayload(name as CommandTopic, payload), `invalid example ${JSON.stringify(payload)}`).toMatchObject({ ok: false })
    }
  })

  // Payloads that are not in the contract's examples, to catch the app and the schema drifting apart.
  const extra: Record<CommandTopic, string[]> = {
    'view/set': ['week', 'photo', 'MONTH', 'next ', ' next', 'm'],
    'month/set': ['2026-01', '2026-12', '1999-12', '0000-01', '9999-12', '2026-10-01', '2026-ab', ' 2026-10', 'PREV'],
    'screen/set': ['on', 'off', 'On', 'OFF', 'standby', '0'],
    'photo_source/set': ['immich', 'google', 'local', 'LOCAL', 'photos'],
    'brightness/set': ['0', '1', '9', '10', '99', '100', '0.0', '100.0', '99.00', '100.1', '101.0', '0100', '1000', '-0', '1.', '1.05', ' 5', '5 ', '٥'],
    'auto_presence/set': ['ON', 'OFF', 'On', 'oFF', 'yes', 'ON\n'],
    'auto_brightness/set': ['ON', 'OFF', 'On', 'oFF', 'yes', 'ON\n'],
    'overlay/set': [
      '{"text":"a"}',
      '{"text":"a","icon":"b","ttl":1}',
      '{"text":"a","ttl":604800}',
      '{"text":"a","ttl":604801}',
      `{"text":"${'x'.repeat(200)}"}`,
      `{"text":"${'x'.repeat(201)}"}`,
      `{"text":"a","icon":"${'i'.repeat(50)}"}`,
      `{"text":"a","icon":"${'i'.repeat(51)}"}`,
      '{"text":"a","ttl":null}',
      '{"text":"a","icon":null}',
      '{"text":null}',
      '{"text":"a","ttl":60.0}',
      '{"text":"a","extra":1}',
      '{"ttl":60}',
      '[{"text":"a"}]',
      '0',
      'true',
      '   ',
      '{',
    ],
    'photo/next': ['', 'anything'],
    'refresh': ['', 'anything'],
  }

  it.each(Object.keys(extra))('%s: the app and the contract agree on every other payload', (name) => {
    for (const payload of extra[name as CommandTopic]) {
      const accepted = parseCommandPayload(name as CommandTopic, payload).ok
      expect(accepted, `${name} ${JSON.stringify(payload)}`).toBe(contractAccepts(name, payload))
    }
  })
})

describe('state payloads', () => {
  const NOW = new Date('2026-10-28T12:00:00Z')
  const states: [string, DisplayState][] = [
    ['the default', defaultDisplayState()],
    ...(['month', 'week', 'agenda', 'photo', 'night'] as const).map(view => [`the ${view} view`, { ...defaultDisplayState(), view }] as [string, DisplayState]),
    ['the screen off', { ...defaultDisplayState(), screen: 'off' }],
    ['google photos', { ...defaultDisplayState(), photo_source: 'google' }],
    ['local photos', { ...defaultDisplayState(), photo_source: 'local' }],
    ['brightness 0', { ...defaultDisplayState(), brightness: 0 }],
    ['brightness 7', { ...defaultDisplayState(), brightness: 7 }],
    ['brightness 100', { ...defaultDisplayState(), brightness: 100 }],
    ['a pinned month', { ...defaultDisplayState(), month: '2027-10', month_set_at: NOW.toISOString() }],
    ['both policies off', { ...defaultDisplayState(), auto_presence: false, auto_brightness: false }],
    ['only presence off', { ...defaultDisplayState(), auto_presence: false }],
    ['only brightness off', { ...defaultDisplayState(), auto_brightness: false }],
    ['an overlay', { ...defaultDisplayState(), overlay: { text: 'Bins out tonight', icon: 'trash', until: '2026-10-28T13:00:00.000Z' } }],
    ['the longest overlay', { ...defaultDisplayState(), overlay: { text: 'x'.repeat(200), icon: null, until: null } }],
  ]

  it.each(states)('%s: every payload passes its topic\'s schema', (_, state) => {
    for (const timeZone of ['Europe/London', 'Pacific/Auckland']) {
      const payloads = statePayloads(state, NOW, timeZone)

      for (const topic of STATE_TOPICS as readonly StateTopic[]) {
        expect(contractAccepts(topic, payloads[topic]), `${topic} ${JSON.stringify(payloads[topic])}`).toBe(true)
      }
    }
  })

  it('has a payload for exactly the state topics', () => {
    expect(sorted(Object.keys(statePayloads(defaultDisplayState(), NOW, 'Europe/London')))).toEqual(sorted(STATE_TOPICS))
  })

  it('says online and offline as the contract does', () => {
    expect(contractAccepts(AVAILABILITY_TOPIC, ONLINE)).toBe(true)
    expect(contractAccepts(AVAILABILITY_TOPIC, OFFLINE)).toBe(true)
  })

  it('shows the overlay\'s text, and nothing once there is no overlay', () => {
    const shown = { ...defaultDisplayState(), overlay: { text: 'Back at 6', icon: null, until: null } }

    expect(statePayloads(shown, NOW, 'Europe/London')['overlay/state']).toBe('Back at 6')
    expect(statePayloads(defaultDisplayState(), NOW, 'Europe/London')['overlay/state']).toBe('')
    expect(contractAccepts('overlay/state', '')).toBe(true)
  })

  it('shows the same settings that the matching command sets', () => {
    // A set followed by the state it publishes, as a round trip through the contract's own examples.
    expect(statePayloads({ ...defaultDisplayState(), brightness: 50 }, NOW, 'Europe/London')['brightness/state']).toBe('50')
    expect(parseCommandPayload('brightness/set', '50.0')).toMatchObject({ ok: true, command: { brightness: 50 } })
  })
})

describe('last sync', () => {
  it.each([
    '2026-10-28T12:00:00.000Z',
    '2026-01-05T07:03:09.123Z',
    '1999-12-31T23:59:59.999Z',
    '2026-03-29T00:30:00.000Z',
  ])('%s: the payload passes the topic\'s schema', (iso) => {
    const payload = lastSyncPayload(new Date(iso))

    expect(payload).toBe(iso)
    expect(contractAccepts(LAST_SYNC_TOPIC, payload)).toBe(true)
  })
})
