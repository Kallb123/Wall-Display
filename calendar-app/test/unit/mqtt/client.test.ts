import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IClientOptions } from 'mqtt'
import type { Command, DisplayState } from '../../../shared/display'
import type { MqttConfig } from '../../../server/config/schema'
import { defaultDisplayState, reduceCommand } from '../../../server/control/commands'
import { createEventBus } from '../../../server/events/bus'
import { createMqttBridge, MAX_RECONNECT_MS, RECHECK_MS, reconnectDelayMs, STABLE_MS, STOP_WAIT_MS } from '../../../server/mqtt/client'
import type { MqttBridge, MqttLink } from '../../../server/mqtt/client'
import { discoveryMessages } from '../../../server/mqtt/discovery'
import { COMMAND_TOPICS, lastSyncPayload, STATE_TOPICS } from '../../../server/mqtt/topics'

// The bridge with a fake MQTT client and fake timers: no network. The fake
// records what is published and subscribed, and the test plays the broker by
// emitting `connect`, `close` and `message`. broker.test.ts runs the real
// client against a real broker.

const SECOND = 1000
const START = new Date('2026-10-28T12:00:00Z')
const PASSWORD = 'hunter2-secret'
const CONFIG: MqttConfig = { url: 'mqtt://broker.local:1883', username: 'wallcal', password: PASSWORD, client_id: 'wallcal', discovery: true, discovery_prefix: 'homeassistant' }

interface Published {
  topic: string
  payload: string
  qos: number
  retain: boolean
}

class FakeClient extends EventEmitter implements MqttLink {
  connected = false
  published: Published[] = []
  subscribed: { topics: string[], qos: number }[] = []
  reconnects = 0
  ends: boolean[] = []
  stream = { destroy: vi.fn() }
  /** Whether the broker answers: acknowledges publishes and finishes `end`. */
  answering = true
  /** An error for the next publish's callback. */
  failNextPublish: Error | undefined
  /** What the broker grants for a subscribe, if not everything. */
  grant: ((topics: string[]) => { topic: string, qos: number }[]) | undefined

  constructor(readonly url: string, readonly options: IClientOptions) {
    super()
  }

  publish(topic: string, payload: string, options: { qos: 0 | 1 | 2, retain: boolean }, callback?: (error?: Error | null) => void) {
    this.published.push({ topic, payload, ...options })
    const error = this.failNextPublish
    this.failNextPublish = undefined
    if (error) callback?.(error)
    else if (this.answering) callback?.()
  }

  subscribe(topics: string[], options: { qos: 0 | 1 | 2 }, callback?: (error: Error | null, granted?: { topic: string, qos: number }[]) => void) {
    this.subscribed.push({ topics, qos: options.qos })
    callback?.(null, this.grant ? this.grant(topics) : topics.map(topic => ({ topic, qos: options.qos })))
  }

  reconnect() {
    this.reconnects++
  }

  end(force: boolean, callback?: () => void) {
    this.ends.push(force)
    this.connected = false
    if (this.answering) callback?.()
  }

  /** The broker accepts the connection. */
  up() {
    this.connected = true
    this.emit('connect')
  }

  /** The connection fails or drops. */
  down() {
    this.connected = false
    this.emit('close')
  }

  message(topic: string, payload: string, retain = false) {
    this.emit('message', topic, Buffer.from(payload), { retain })
  }

  /** What was published on `topic`, in order. */
  payloadsOn(topic: string): string[] {
    return this.published.filter(message => message.topic === topic).map(message => message.payload)
  }

  /** Forgets what was published so far, so a test sees only what follows. */
  clear() {
    this.published = []
  }
}

const bridges: MqttBridge[] = []

function setup(options: { displays?: string[], config?: MqttConfig, random?: () => number, lastSync?: () => Date | null } = {}) {
  const displays = options.displays ?? ['hallway']
  const bus = createEventBus()
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const states = new Map(displays.map(id => [id, defaultDisplayState()]))
  const clients = new Map<string, FakeClient>()

  const control = {
    getState: vi.fn((displayId: string): DisplayState => {
      const state = states.get(displayId)
      if (!state) throw new Error(`Unknown display "${displayId}"`)
      return state
    }),
    applyCommand: vi.fn((displayId: string, command: Command): DisplayState => {
      const next = reduceCommand(control.getState(displayId), command, { now: new Date(), timeZone: 'Europe/London', monthReturnMinutes: 15 })
      states.set(displayId, next)
      bus.emit('state.updated', { displayId, state: next })
      return next
    }),
  }
  const connect = vi.fn((url: string, clientOptions: IClientOptions) => {
    const client = new FakeClient(url, clientOptions)
    // The will's topic is wallcal/<display id>/availability.
    clients.set(clientOptions.will!.topic.split('/')[1]!, client)
    return client
  })

  const bridge = createMqttBridge({
    config: options.config ?? CONFIG,
    // The name is the id with a capital: hallway is "Hallway".
    displays: displays.map(id => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1) })),
    lastSync: options.lastSync,
    timeZone: 'Europe/London',
    control,
    bus,
    connect,
    random: options.random ?? (() => 0.5),
    log,
  })
  bridges.push(bridge)

  const client = (id = 'hallway') => clients.get(id)!
  /** Every logged line, to look for what must never be there. */
  const logged = () => JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls])
  return { bridge, bus, control, connect, log, client, logged, states }
}

beforeEach(() => {
  vi.useFakeTimers({ now: START })
})

afterEach(async () => {
  await Promise.all(bridges.splice(0).map(bridge => bridge.stop()))
  vi.useRealTimers()
})

describe('reconnectDelayMs', () => {
  it('doubles from a second up to a minute', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(failures => reconnectDelayMs(failures, 0.5) / SECOND)).toEqual([1, 2, 4, 8, 16, 32, 60, 60])
  })

  it('spreads each wait by 20 % either way, and never past the cap', () => {
    expect([reconnectDelayMs(1, 0), reconnectDelayMs(1, 1)]).toEqual([800, 1200])
    expect([reconnectDelayMs(4, 0), reconnectDelayMs(4, 1)]).toEqual([6400, 9600])
    expect([reconnectDelayMs(10, 0), reconnectDelayMs(10, 1)]).toEqual([48_000, MAX_RECONNECT_MS])
  })

  it('treats no failures like one', () => {
    expect(reconnectDelayMs(0, 0.5)).toBe(1000)
  })
})

describe('connecting', () => {
  it('opens one connection per display, named after the client id and the display, and sets the last will', () => {
    const { connect, client } = setup({ displays: ['hallway', 'kitchen'] })

    expect(connect).toHaveBeenCalledTimes(2)
    expect(client('hallway').url).toBe('mqtt://broker.local:1883')
    expect(client('hallway').options).toMatchObject({
      clientId: 'wallcal-hallway',
      username: 'wallcal',
      password: PASSWORD,
      clean: true,
      reconnectPeriod: 0,
      will: { topic: 'wallcal/hallway/availability', payload: 'offline', qos: 1, retain: true },
    })
    expect(client('kitchen').options).toMatchObject({
      clientId: 'wallcal-kitchen',
      will: { topic: 'wallcal/kitchen/availability', payload: 'offline', qos: 1, retain: true },
    })
  })

  it('sends no credentials when the config has none', () => {
    const { client } = setup({ config: { url: 'mqtts://broker.local', client_id: 'house', discovery: true, discovery_prefix: 'homeassistant' } })

    expect(client().options).toMatchObject({ clientId: 'house-hallway' })
    expect(client().options).not.toHaveProperty('username')
    expect(client().options).not.toHaveProperty('password')
  })

  it('reports each display as connecting, then connected', () => {
    const { bridge, client } = setup({ displays: ['hallway', 'kitchen'] })
    expect(bridge.status()).toEqual([
      { displayId: 'hallway', state: 'connecting', lastError: null },
      { displayId: 'kitchen', state: 'connecting', lastError: null },
    ])

    client('kitchen').up()

    expect(bridge.status().map(({ displayId, state }) => `${displayId} ${state}`)).toEqual(['hallway connecting', 'kitchen connected'])
  })

  it('says online first, then subscribes to every command topic at QoS 1, then publishes all of the state, retained at QoS 1', () => {
    const { client, log } = setup({ config: { ...CONFIG, discovery: false } })

    client().up()

    const [first, ...rest] = client().published
    expect(first).toEqual({ topic: 'wallcal/hallway/availability', payload: 'online', qos: 1, retain: true })
    expect(client().subscribed).toEqual([{ topics: COMMAND_TOPICS.map(suffix => `wallcal/hallway/${suffix}`), qos: 1 }])
    expect(rest.map(message => message.topic)).toEqual(STATE_TOPICS.map(suffix => `wallcal/hallway/${suffix}`))
    expect(rest.every(message => message.qos === 1 && message.retain)).toBe(true)
    expect(Object.fromEntries(rest.map(message => [message.topic.replace('wallcal/hallway/', ''), message.payload]))).toEqual({
      'view/state': 'month',
      'month/state': '2026-10',
      'screen/state': 'on',
      'photo_source/state': 'immich',
      'brightness/state': '100',
      'auto_presence/state': 'ON',
      'auto_brightness/state': 'ON',
    })
    expect(log.info).toHaveBeenCalledWith('[mqtt] hallway: connected to mqtt://broker.local:1883')
  })

  it('says online, then the discovery configs, then the state, in that order', () => {
    const { client } = setup()

    client().up()

    const topics = client().published.map(message => message.topic)
    const configs = discoveryMessages({ prefix: 'homeassistant', display: { id: 'hallway', name: 'Hallway' }, displayCount: 1 }).map(message => message.topic)
    expect(topics).toEqual([
      'wallcal/hallway/availability',
      ...configs,
      ...STATE_TOPICS.map(suffix => `wallcal/hallway/${suffix}`),
    ])
  })

  it('does not wait for a broker: a bridge with nothing answering has only started connecting', () => {
    const { bridge, client, log } = setup()

    expect(client().published).toEqual([])
    expect(bridge.status()[0]!.state).toBe('connecting')
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('warns about a subscription the broker refuses', () => {
    const { client, log } = setup()
    client().grant = topics => topics.map(topic => ({ topic, qos: topic.endsWith('/refresh') ? 128 : 1 }))

    client().up()

    expect(log.warn).toHaveBeenCalledWith('[mqtt] hallway: the broker refused the subscription to wallcal/hallway/refresh')
  })
})

describe('publishing the state', () => {
  it('publishes only the topics that changed', () => {
    const { client, control } = setup()
    client().up()
    client().clear()

    control.applyCommand('hallway', { type: 'set_view', view: 'agenda' })
    expect(client().published.map(({ topic, payload }) => [topic, payload])).toEqual([['wallcal/hallway/view/state', 'agenda']])

    client().clear()
    control.applyCommand('hallway', { type: 'set_brightness', brightness: 40 })
    control.applyCommand('hallway', { type: 'set_auto_presence', auto_presence: false })
    expect(client().published.map(({ topic, payload }) => [topic, payload])).toEqual([
      ['wallcal/hallway/brightness/state', '40'],
      ['wallcal/hallway/auto_presence/state', 'OFF'],
    ])
  })

  it('publishes nothing when the state did not change', () => {
    const { client, bus, states } = setup()
    client().up()
    client().clear()

    bus.emit('state.updated', { displayId: 'hallway', state: states.get('hallway')! })

    expect(client().published).toEqual([])
  })

  it('follows a display\'s own changes only', () => {
    const { client, control } = setup({ displays: ['hallway', 'kitchen'] })
    client('hallway').up()
    client('kitchen').up()
    client('hallway').clear()
    client('kitchen').clear()

    control.applyCommand('kitchen', { type: 'set_screen', screen: 'off' })

    expect(client('hallway').published).toEqual([])
    expect(client('kitchen').payloadsOn('wallcal/kitchen/screen/state')).toEqual(['off'])
  })

  it('publishes nothing while the connection is down, and everything once it is back', () => {
    const { client, control } = setup()
    client().up()
    client().down()
    client().clear()

    control.applyCommand('hallway', { type: 'set_view', view: 'photo' })
    expect(client().published).toEqual([])

    vi.advanceTimersByTime(SECOND)
    client().up()
    expect(client().payloadsOn('wallcal/hallway/availability')).toEqual(['online'])
    // Everything, not just the change: the broker may have lost it, and a new connection can't know.
    expect(client().published.filter(message => message.topic.endsWith('/state')).map(message => message.topic)).toEqual(STATE_TOPICS.map(suffix => `wallcal/hallway/${suffix}`))
    expect(client().payloadsOn('wallcal/hallway/view/state')).toEqual(['photo'])
  })

  it('sends a payload again that the broker never took', () => {
    const { client, control, log } = setup()
    client().up()
    client().clear()

    client().failNextPublish = new Error('Connection closed')
    control.applyCommand('hallway', { type: 'set_screen', screen: 'off' })
    expect(log.warn).toHaveBeenCalledWith('[mqtt] hallway: could not publish screen/state: Connection closed')

    // The next check finds the topic still different from what the broker has.
    vi.advanceTimersByTime(RECHECK_MS)
    expect(client().payloadsOn('wallcal/hallway/screen/state')).toEqual(['off', 'off'])
    vi.advanceTimersByTime(RECHECK_MS)
    expect(client().payloadsOn('wallcal/hallway/screen/state')).toEqual(['off', 'off'])
  })

  it('keeps going if the state cannot be read', () => {
    const { client, control, log, bus, states } = setup()
    client().up()
    client().clear()
    control.getState.mockImplementationOnce(() => { throw new Error('database closed') })

    bus.emit('state.updated', { displayId: 'hallway', state: states.get('hallway')! })

    expect(log.error).toHaveBeenCalledWith('[mqtt] hallway: could not read the state: database closed')
    expect(client().published).toEqual([])
  })

  it('republishes month/state when the month rolls over, and only that', () => {
    vi.setSystemTime(new Date('2026-10-31T23:59:30Z'))
    const { client } = setup()
    client().up()
    expect(client().payloadsOn('wallcal/hallway/month/state')).toEqual(['2026-10'])
    client().clear()

    vi.advanceTimersByTime(RECHECK_MS)

    expect(client().published.map(({ topic, payload }) => [topic, payload])).toEqual([['wallcal/hallway/month/state', '2026-11']])
    client().clear()
    vi.advanceTimersByTime(RECHECK_MS)
    expect(client().published).toEqual([])
  })

  it('leaves a month that is pinned where it is when the calendar moves on', () => {
    vi.setSystemTime(new Date('2026-10-31T23:59:30Z'))
    const { client, control } = setup()
    client().up()
    control.applyCommand('hallway', { type: 'set_month', month: '2027-02' })
    client().clear()

    vi.advanceTimersByTime(RECHECK_MS)

    expect(client().published).toEqual([])
  })
})

describe('commands', () => {
  it('applies a command from a command topic to that display', () => {
    const { client, control } = setup({ displays: ['hallway', 'kitchen'] })
    client('kitchen').up()

    client('kitchen').message('wallcal/kitchen/view/set', 'agenda')
    client('kitchen').message('wallcal/kitchen/brightness/set', '50.0')
    client('kitchen').message('wallcal/kitchen/overlay/set', '{"text":"Bins out tonight","ttl":600}')

    expect(control.applyCommand.mock.calls).toEqual([
      ['kitchen', { type: 'set_view', view: 'agenda' }],
      ['kitchen', { type: 'set_brightness', brightness: 50 }],
      ['kitchen', { type: 'set_overlay', overlay: { text: 'Bins out tonight', ttl: 600 } }],
    ])
    expect(client('kitchen').payloadsOn('wallcal/kitchen/view/state')).toEqual(['month', 'agenda'])
  })

  it('warns about a payload it cannot use, naming the display and topic, and applies nothing', () => {
    const { client, control, log } = setup()
    client().up()

    client().message('wallcal/hallway/brightness/set', '101')
    client().message('wallcal/hallway/view/set', 'Month')

    expect(control.applyCommand).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledTimes(2)
    expect(log.warn.mock.calls[0]![0]).toMatch(/^\[mqtt\] hallway: ignored a message: brightness\/set: .*101/)
    expect(log.warn.mock.calls[1]![0]).toMatch(/^\[mqtt\] hallway: ignored a message: view\/set: .*"Month"/)
  })

  it('ignores a retained message on a command topic, with a warning', () => {
    const { client, control, log } = setup()
    client().up()

    client().message('wallcal/hallway/view/set', 'agenda', true)

    expect(control.applyCommand).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0]![0]).toContain('ignored the retained message on wallcal/hallway/view/set')
  })

  it('ignores topics that are not its command topics, and other displays\' topics', () => {
    const { client, control, log } = setup()
    client().up()

    client().message('wallcal/hallway/view/state', 'agenda')
    client().message('wallcal/hallway/pi/button', 'single')
    client().message('wallcal/kitchen/view/set', 'agenda')
    client().message('other/hallway/view/set', 'agenda')

    expect(control.applyCommand).not.toHaveBeenCalled()
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('logs a command the control refuses, and carries on', () => {
    const { client, control, log } = setup()
    client().up()
    control.applyCommand.mockImplementationOnce(() => { throw new Error('database is locked') })

    expect(() => client().message('wallcal/hallway/screen/set', 'off')).not.toThrow()
    client().message('wallcal/hallway/screen/set', 'off')

    expect(log.error).toHaveBeenCalledWith('[mqtt] hallway: could not apply the command from screen/set: database is locked')
    expect(control.applyCommand).toHaveBeenCalledTimes(2)
  })
})

describe('Home Assistant discovery', () => {
  const messagesFor = (id: string, name: string, displayCount = 1, prefix = 'homeassistant') => discoveryMessages({ prefix, display: { id, name }, displayCount })
  /** What was published that is a discovery config, not a `wallcal/` topic. */
  const configsIn = (client: FakeClient) => client.published.filter(message => !message.topic.startsWith('wallcal/'))

  it('publishes every config on connect, retained at QoS 1', () => {
    const { client } = setup()

    client().up()

    const expected = messagesFor('hallway', 'Hallway')
    expect(expected.length).toBeGreaterThan(0)
    expect(configsIn(client())).toEqual(expected.map(message => ({ ...message, qos: 1, retain: true })))
  })

  it('publishes them again on a reconnect, for a broker that has forgotten them', () => {
    const { client } = setup()
    client().up()
    client().down()
    vi.advanceTimersByTime(SECOND)
    client().clear()

    client().up()

    expect(configsIn(client())).toEqual(messagesFor('hallway', 'Hallway').map(message => ({ ...message, qos: 1, retain: true })))
  })

  it('publishes each display\'s own configs on its own connection', () => {
    const { client } = setup({ displays: ['hallway', 'kitchen'] })

    client('hallway').up()
    client('kitchen').up()

    expect(configsIn(client('hallway')).map(({ topic, payload }) => ({ topic, payload }))).toEqual(messagesFor('hallway', 'Hallway', 2))
    expect(configsIn(client('kitchen')).map(({ topic, payload }) => ({ topic, payload }))).toEqual(messagesFor('kitchen', 'Kitchen', 2))
  })

  it('names the device "Wall Calendar" for one display, and "Wall Calendar <name>" for two or more', () => {
    const deviceNames = (client: FakeClient) => [...new Set(configsIn(client).map(message => (JSON.parse(message.payload) as { device: { name: string } }).device.name))]
    const one = setup()
    one.client().up()
    const two = setup({ displays: ['hallway', 'kitchen'] })
    two.client('hallway').up()
    two.client('kitchen').up()

    expect(deviceNames(one.client())).toEqual(['Wall Calendar'])
    expect(deviceNames(two.client('hallway'))).toEqual(['Wall Calendar Hallway'])
    expect(deviceNames(two.client('kitchen'))).toEqual(['Wall Calendar Kitchen'])
  })

  it('uses the discovery prefix from the config', () => {
    const { client } = setup({ config: { ...CONFIG, discovery_prefix: 'ha/discovery' } })

    client().up()

    expect(configsIn(client()).map(({ topic, payload }) => ({ topic, payload }))).toEqual(messagesFor('hallway', 'Hallway', 1, 'ha/discovery'))
    expect(client().subscribed[0]!.topics).toContain('ha/discovery/status')
    expect(client().subscribed[0]!.topics).not.toContain('homeassistant/status')

    client().clear()
    client().message('homeassistant/status', 'online')
    expect(client().published).toEqual([])
    client().message('ha/discovery/status', 'online')
    expect(configsIn(client())).toHaveLength(messagesFor('hallway', 'Hallway').length)
  })

  it('subscribes to Home Assistant\'s birth topic along with the command topics', () => {
    const { client } = setup()

    client().up()

    expect(client().subscribed).toEqual([{ topics: [...COMMAND_TOPICS.map(suffix => `wallcal/hallway/${suffix}`), 'homeassistant/status'], qos: 1 }])
  })

  it('publishes the configs again when Home Assistant says it is online', () => {
    const { client, log } = setup()
    client().up()
    client().clear()
    log.info.mockClear()

    client().message('homeassistant/status', 'online')

    expect(client().published).toEqual(messagesFor('hallway', 'Hallway').map(message => ({ ...message, qos: 1, retain: true })))
    expect(log.info).toHaveBeenCalledTimes(1)
    expect(log.info.mock.calls[0]![0]).toMatch(/^\[mqtt\] hallway: Home Assistant says it is online/)
  })

  it('answers the birth message on every display\'s connection', () => {
    const { client } = setup({ displays: ['hallway', 'kitchen'] })
    client('hallway').up()
    client('kitchen').up()
    client('hallway').clear()
    client('kitchen').clear()

    client('hallway').message('homeassistant/status', 'online')
    client('kitchen').message('homeassistant/status', 'online')

    expect(client('hallway').published.map(({ topic, payload }) => ({ topic, payload }))).toEqual(messagesFor('hallway', 'Hallway', 2))
    expect(client('kitchen').published.map(({ topic, payload }) => ({ topic, payload }))).toEqual(messagesFor('kitchen', 'Kitchen', 2))
  })

  it('ignores a retained birth message, an offline one, and one on another prefix, without a word', () => {
    const { client, log } = setup()
    client().up()
    client().clear()
    log.info.mockClear()

    client().message('homeassistant/status', 'online', true)
    client().message('homeassistant/status', 'offline')
    client().message('homeassistant/status', 'ONLINE')
    client().message('other/status', 'online')
    client().message('homeassistant/light/status', 'online')

    expect(client().published).toEqual([])
    expect(log.info).not.toHaveBeenCalled()
    expect(log.warn).not.toHaveBeenCalled()
    expect(log.error).not.toHaveBeenCalled()
  })

  it('publishes no config and has no birth subscription when discovery is off', () => {
    const { client, log } = setup({ config: { ...CONFIG, discovery: false } })

    client().up()

    expect(configsIn(client())).toEqual([])
    expect(client().subscribed).toEqual([{ topics: COMMAND_TOPICS.map(suffix => `wallcal/hallway/${suffix}`), qos: 1 }])

    client().clear()
    client().message('homeassistant/status', 'online')
    expect(client().published).toEqual([])
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('warns about a config the broker did not take, naming its topic', () => {
    const { client, log } = setup()
    client().up()
    const configTopic = messagesFor('hallway', 'Hallway')[0]!.topic
    client().failNextPublish = new Error('Connection closed')
    client().message('homeassistant/status', 'online')

    expect(log.warn).toHaveBeenCalledWith(`[mqtt] hallway: could not publish ${configTopic}: Connection closed`)
  })
})

describe('last sync', () => {
  const TOPIC = 'wallcal/hallway/last_sync/state'
  const SYNCED = new Date('2026-10-28T11:55:00Z')

  it('publishes when the last sync was, retained at QoS 1, once there has been one', () => {
    const { client } = setup({ lastSync: () => SYNCED })

    client().up()

    expect(client().published.filter(message => message.topic === TOPIC)).toEqual([
      { topic: TOPIC, payload: '2026-10-28T11:55:00.000Z', qos: 1, retain: true },
    ])
    expect(client().payloadsOn(TOPIC)).toEqual([lastSyncPayload(SYNCED)])
  })

  it('publishes nothing on it before the first sync', () => {
    const { client } = setup({ lastSync: () => null })

    client().up()

    expect(client().payloadsOn(TOPIC)).toEqual([])
  })

  it('publishes nothing on it when no getter is given', () => {
    const { client } = setup()

    client().up()

    expect(client().payloadsOn(TOPIC)).toEqual([])
  })

  it('follows each successful sync, and publishes only what changed', () => {
    let syncedAt: Date | null = null
    const { client, bus } = setup({ lastSync: () => syncedAt })
    client().up()
    client().clear()

    syncedAt = SYNCED
    bus.emit('sync.succeeded', { calendarId: 'family' })
    expect(client().published.map(({ topic, payload }) => [topic, payload])).toEqual([[TOPIC, '2026-10-28T11:55:00.000Z']])

    // A second calendar syncing earlier than the newest changes nothing.
    client().clear()
    bus.emit('sync.succeeded', { calendarId: 'bins' })
    expect(client().published).toEqual([])

    syncedAt = new Date('2026-10-28T11:57:00Z')
    bus.emit('sync.succeeded', { calendarId: 'bins' })
    expect(client().published.map(({ topic, payload }) => [topic, payload])).toEqual([[TOPIC, '2026-10-28T11:57:00.000Z']])
  })

  it('goes out on every display\'s connection', () => {
    let syncedAt: Date | null = null
    const { client, bus } = setup({ displays: ['hallway', 'kitchen'], lastSync: () => syncedAt })
    client('hallway').up()
    client('kitchen').up()
    client('hallway').clear()
    client('kitchen').clear()

    syncedAt = SYNCED
    bus.emit('sync.succeeded', { calendarId: 'family' })

    expect(client('hallway').payloadsOn(TOPIC)).toEqual(['2026-10-28T11:55:00.000Z'])
    expect(client('kitchen').payloadsOn('wallcal/kitchen/last_sync/state')).toEqual(['2026-10-28T11:55:00.000Z'])
  })

  it('sends it again after a reconnect', () => {
    const { client } = setup({ lastSync: () => SYNCED })
    client().up()
    client().down()
    vi.advanceTimersByTime(SECOND)

    client().up()

    expect(client().payloadsOn(TOPIC)).toEqual([lastSyncPayload(SYNCED), lastSyncPayload(SYNCED)])
  })

  it('sends it again if the broker never took it', () => {
    let syncedAt: Date | null = null
    const { client, bus, log } = setup({ lastSync: () => syncedAt })
    client().up()
    client().clear()

    syncedAt = SYNCED
    client().failNextPublish = new Error('Connection closed')
    bus.emit('sync.succeeded', { calendarId: 'family' })
    expect(log.warn).toHaveBeenCalledWith('[mqtt] hallway: could not publish last_sync/state: Connection closed')

    // The next check finds the topic still different from what the broker has.
    vi.advanceTimersByTime(RECHECK_MS)
    expect(client().payloadsOn(TOPIC)).toEqual([lastSyncPayload(SYNCED), lastSyncPayload(SYNCED)])
  })

  it('logs a getter that throws and still publishes the display state', () => {
    const { client, log, bus } = setup({
      lastSync: () => { throw new Error('database is locked') },
    })

    client().up()

    expect(log.error).toHaveBeenCalledWith('[mqtt] hallway: could not read the last sync time: database is locked')
    expect(client().payloadsOn(TOPIC)).toEqual([])
    expect(client().published.filter(message => message.topic.endsWith('/state')).map(message => message.topic)).toEqual(STATE_TOPICS.map(suffix => `wallcal/hallway/${suffix}`))

    expect(() => bus.emit('sync.succeeded', { calendarId: 'family' })).not.toThrow()
    expect(log.error).toHaveBeenCalledTimes(2)
  })

  it('keeps the password out of a getter\'s error', () => {
    const { client, logged } = setup({ lastSync: () => { throw new Error(`failed for ${PASSWORD}`) } })

    client().up()

    expect(logged()).not.toContain(PASSWORD)
    expect(logged()).toContain('***')
  })
})

describe('reconnecting', () => {
  it('asks the client to reconnect after 1 s, then 2 s, 4 s and so on while the broker stays away', () => {
    const { client, bridge } = setup()
    const attempt = (waitSeconds: number) => {
      client().down()
      vi.advanceTimersByTime(waitSeconds * SECOND - 1)
      const before = client().reconnects
      vi.advanceTimersByTime(1)
      return client().reconnects - before
    }

    expect([1, 2, 4, 8, 16, 32, 60, 60].map(attempt)).toEqual([1, 1, 1, 1, 1, 1, 1, 1])
    expect(client().reconnects).toBe(8)
    expect(bridge.status()[0]!.state).toBe('connecting')
  })

  it('does not reconnect before the wait is up', () => {
    const { client } = setup()

    client().down()
    vi.advanceTimersByTime(999)

    expect(client().reconnects).toBe(0)
  })

  it('applies the jitter from the random source', () => {
    const { client } = setup({ random: () => 0 })

    client().down()
    vi.advanceTimersByTime(799)
    expect(client().reconnects).toBe(0)
    vi.advanceTimersByTime(1)
    expect(client().reconnects).toBe(1)
  })

  it('starts again from a second after a connection that lasted', () => {
    const { client } = setup()
    client().down()
    vi.advanceTimersByTime(SECOND)
    client().down()
    vi.advanceTimersByTime(2 * SECOND)
    expect(client().reconnects).toBe(2)

    client().up()
    vi.advanceTimersByTime(STABLE_MS)
    client().down()
    vi.advanceTimersByTime(SECOND)

    expect(client().reconnects).toBe(3)
  })

  it('keeps backing off when each connection drops straight away', () => {
    const { client } = setup()
    client().down()
    vi.advanceTimersByTime(SECOND)
    client().up()
    client().down()
    vi.advanceTimersByTime(2 * SECOND - 1)
    expect(client().reconnects).toBe(1)
    vi.advanceTimersByTime(1)
    expect(client().reconnects).toBe(2)
  })

  it('sets one retry for one connection, even if the client reports the close twice', () => {
    const { client } = setup()

    client().down()
    client().down()
    vi.advanceTimersByTime(60 * SECOND)

    expect(client().reconnects).toBe(1)
  })

  it('keeps trying if reconnect() itself throws', () => {
    const { client, log } = setup()
    const reconnect = vi.spyOn(client(), 'reconnect').mockImplementationOnce(() => { throw new Error('boom') })

    client().down()
    vi.advanceTimersByTime(SECOND)
    expect(reconnect).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2 * SECOND)

    expect(reconnect).toHaveBeenCalledTimes(2)
    expect(log.error).not.toHaveBeenCalled()
  })

  it('logs the first failure of a run, then the way back with the number of attempts, and nothing in between', () => {
    const { client, log } = setup()
    client().emit('error', new Error('connect ECONNREFUSED 10.0.0.5:1883'))
    client().down()
    for (const wait of [1, 2, 4]) {
      vi.advanceTimersByTime(wait * SECOND)
      client().emit('error', new Error('connect ECONNREFUSED 10.0.0.5:1883'))
      client().down()
    }
    expect(log.warn.mock.calls).toEqual([['[mqtt] hallway: cannot connect to mqtt://broker.local:1883 (connect ECONNREFUSED 10.0.0.5:1883); trying again in the background']])

    vi.advanceTimersByTime(8 * SECOND)
    client().up()

    expect(log.info).toHaveBeenLastCalledWith('[mqtt] hallway: connected to mqtt://broker.local:1883 (after 4 failed attempt(s))')
    expect(log.warn).toHaveBeenCalledTimes(1)
  })

  it('logs losing an established connection once, and again for a later run of failures', () => {
    const { client, log } = setup()
    client().up()

    client().down()
    vi.advanceTimersByTime(SECOND)
    client().down()
    expect(log.warn.mock.calls).toEqual([['[mqtt] hallway: lost the connection to mqtt://broker.local:1883; trying again in the background']])

    vi.advanceTimersByTime(2 * SECOND)
    client().up()
    client().down()
    expect(log.warn).toHaveBeenCalledTimes(2)
  })
})

describe('errors', () => {
  it('handles every error event: it is kept for status() and does not throw', () => {
    const { bridge, client } = setup()

    expect(() => client().emit('error', new Error('connect ECONNREFUSED 127.0.0.1:1883'))).not.toThrow()

    expect(bridge.status()[0]).toEqual({ displayId: 'hallway', state: 'connecting', lastError: 'connect ECONNREFUSED 127.0.0.1:1883' })
    client().down()
    expect(bridge.status()[0]).toMatchObject({ state: 'disconnected', lastError: 'connect ECONNREFUSED 127.0.0.1:1883' })
    client().up()
    expect(bridge.status()[0]).toEqual({ displayId: 'hallway', state: 'connected', lastError: null })
  })

  it('names an error that has no message by its code', () => {
    const { bridge, client } = setup()

    client().emit('error', Object.assign(new Error(''), { code: 'ECONNREFUSED' }))

    expect(bridge.status()[0]!.lastError).toBe('ECONNREFUSED')
  })

  it('warns about an error on a live connection', () => {
    const { client, log } = setup()
    client().up()

    client().emit('error', new Error('Packet too large'))

    expect(log.warn).toHaveBeenCalledWith('[mqtt] hallway: connection error: Packet too large')
  })

  it('never logs or reports the password, even when an error repeats it', () => {
    const { bridge, client, control, logged } = setup()
    client().emit('error', new Error(`Connection refused: bad password ${PASSWORD}`))
    client().down()
    vi.advanceTimersByTime(SECOND)
    client().up()
    client().emit('error', new Error(`odd error with ${PASSWORD} in it`))
    client().message('wallcal/hallway/brightness/set', 'loud')
    control.applyCommand.mockImplementationOnce(() => { throw new Error(`failed for ${PASSWORD}`) })
    client().message('wallcal/hallway/screen/set', 'off')

    expect(logged()).not.toContain(PASSWORD)
    expect(logged()).toContain('***')
    expect(JSON.stringify(bridge.status())).not.toContain(PASSWORD)
  })

  it('leaves a display without MQTT when the client cannot even be created', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const bridge = createMqttBridge({
      config: CONFIG,
      displays: [{ id: 'hallway', name: 'Hallway' }],
      timeZone: 'Europe/London',
      control: { getState: () => defaultDisplayState(), applyCommand: () => defaultDisplayState() },
      bus: createEventBus(),
      connect: () => { throw new Error('bad url') },
      log,
    })
    bridges.push(bridge)

    expect(bridge.status()).toEqual([{ displayId: 'hallway', state: 'disconnected', lastError: 'bad url' }])
    expect(log.error).toHaveBeenCalledWith('[mqtt] hallway: could not start the connection: bad url')
  })
})

describe('stop', () => {
  it('publishes offline, retained at QoS 1, then ends each connection cleanly', async () => {
    const { bridge, client } = setup({ displays: ['hallway', 'kitchen'] })
    client('hallway').up()
    client('kitchen').up()
    client('hallway').clear()

    await bridge.stop()

    expect(client('hallway').published).toEqual([{ topic: 'wallcal/hallway/availability', payload: 'offline', qos: 1, retain: true }])
    expect(client('hallway').ends).toEqual([false])
    expect(client('kitchen').payloadsOn('wallcal/kitchen/availability')).toEqual(['online', 'offline'])
    expect(client('kitchen').ends).toEqual([false])
    expect(bridge.status().map(({ state }) => state)).toEqual(['disconnected', 'disconnected'])
  })

  it('cancels a pending retry and ends the connection that has none', async () => {
    const { bridge, client } = setup()
    client().down()

    await bridge.stop()
    vi.advanceTimersByTime(60 * SECOND)

    expect(client().reconnects).toBe(0)
    expect(client().published).toEqual([])
    expect(client().ends).toEqual([true])
  })

  it('stops publishing state and checking the month', async () => {
    const { bridge, client, control } = setup()
    client().up()
    await bridge.stop()
    client().clear()

    control.applyCommand('hallway', { type: 'set_view', view: 'agenda' })
    vi.advanceTimersByTime(2 * RECHECK_MS)

    expect(client().published).toEqual([])
  })

  it('stops following syncs', async () => {
    const { bridge, client, bus } = setup({ lastSync: () => new Date('2026-10-28T11:55:00Z') })
    client().up()
    await bridge.stop()
    client().clear()

    bus.emit('sync.succeeded', { calendarId: 'family' })

    expect(client().published).toEqual([])
  })

  it('ignores a close, a connect and an error that arrive after it', async () => {
    const { bridge, client, log } = setup()
    client().up()
    await bridge.stop()
    client().clear()

    client().emit('error', new Error('late'))
    client().down()
    client().up()
    vi.advanceTimersByTime(60 * SECOND)

    expect(client().published).toEqual([])
    expect(client().reconnects).toBe(0)
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('gives up within a few seconds when the broker has stopped answering, and cuts the socket', async () => {
    const { bridge, client } = setup()
    client().up()
    client().answering = false

    let done = false
    const stopping = bridge.stop().then(() => { done = true })
    await vi.advanceTimersByTimeAsync(STOP_WAIT_MS - 1)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(STOP_WAIT_MS + 1)
    await stopping

    expect(done).toBe(true)
    expect(client().stream.destroy).toHaveBeenCalledTimes(1)
  })

  it('can be called twice', async () => {
    const { bridge, client } = setup()
    client().up()

    await Promise.all([bridge.stop(), bridge.stop()])
    await bridge.stop()

    expect(client().payloadsOn('wallcal/hallway/availability')).toEqual(['online', 'offline'])
  })
})
