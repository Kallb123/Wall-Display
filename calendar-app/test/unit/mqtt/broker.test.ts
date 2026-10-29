import { createServer } from 'node:net'
import type { AddressInfo, Server, Socket } from 'node:net'
import { Aedes } from 'aedes'
import type { Client as BrokerClient } from 'aedes'
import { connectAsync } from 'mqtt'
import type { MqttClient } from 'mqtt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Command, DisplayState } from '../../../shared/display'
import type { MqttConfig } from '../../../server/config/schema'
import { defaultDisplayState, reduceCommand } from '../../../server/control/commands'
import { createEventBus } from '../../../server/events/bus'
import { createMqttBridge } from '../../../server/mqtt/client'
import type { MqttBridge } from '../../../server/mqtt/client'
import { discoveryMessages } from '../../../server/mqtt/discovery'
import { STATE_TOPICS } from '../../../server/mqtt/topics'

// The real MQTT.js client against a real broker (aedes, in this process) on a
// port the system picks. Real timers, so waits poll for what they expect
// rather than sleep. client.test.ts covers the same logic without a network.

const DEADLINE_MS = 10_000

interface TestBroker {
  port: number
  url: string
  /** The broker's side of a connected client, by client id. */
  clients: Map<string, BrokerClient>
  /** Every topic published by a client id, in order. */
  published: { clientId: string, topic: string }[]
  stop: () => Promise<void>
}

const brokers: TestBroker[] = []
const probes: MqttClient[] = []
const bridges: MqttBridge[] = []

/** Starts a broker, on `port` if given (to bring one back where the last one was). */
async function startBroker(port = 0): Promise<TestBroker> {
  const aedes = await Aedes.createBroker()
  const sockets = new Set<Socket>()
  const server: Server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    aedes.handle(socket)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })

  const clients = new Map<string, BrokerClient>()
  const published: TestBroker['published'] = []
  aedes.on('clientReady', client => clients.set(client.id, client))
  aedes.on('publish', (packet, client) => {
    if (client) published.push({ clientId: client.id, topic: packet.topic })
  })

  const actualPort = (server.address() as AddressInfo).port
  const broker: TestBroker = {
    port: actualPort,
    url: `mqtt://127.0.0.1:${actualPort}`,
    clients,
    published,
    async stop() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await new Promise<void>(resolve => aedes.close(() => resolve()))
    },
  }
  brokers.push(broker)
  return broker
}

/** A port nothing listens on. */
async function closedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}

interface Received {
  topic: string
  payload: string
  retain: boolean
}

/** A plain client, as Home Assistant would be: it records what it is sent. */
async function probe(broker: TestBroker, ...topics: string[]) {
  const client = await connectAsync(broker.url, { reconnectPeriod: 0 })
  probes.push(client)
  const received: Received[] = []
  client.on('message', (topic, payload, packet) => received.push({ topic, payload: payload.toString(), retain: packet.retain }))
  if (topics.length > 0) await client.subscribeAsync(topics, { qos: 1 })
  return { client, received, on: (topic: string) => received.filter(message => message.topic === topic) }
}

/** Polls until `check` is true, so a test waits exactly as long as the broker takes. */
async function until(what: string, check: () => boolean, deadlineMs = DEADLINE_MS): Promise<void> {
  const deadline = Date.now() + deadlineMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

function setup(url: string, options: { displays?: string[], config?: Partial<MqttConfig> } = {}) {
  const displays = options.displays ?? ['hallway']
  const bus = createEventBus()
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const states = new Map(displays.map(id => [id, defaultDisplayState()]))
  const control = {
    getState: (displayId: string): DisplayState => states.get(displayId)!,
    applyCommand: vi.fn((displayId: string, command: Command): DisplayState => {
      const next = reduceCommand(states.get(displayId)!, command, { now: new Date(), timeZone: 'Europe/London', monthReturnMinutes: 15 })
      states.set(displayId, next)
      bus.emit('state.updated', { displayId, state: next })
      return next
    }),
  }
  const bridge = createMqttBridge({
    config: { url, client_id: 'wallcal', discovery: true, discovery_prefix: 'homeassistant', ...options.config },
    displays: displays.map(id => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1) })),
    timeZone: 'Europe/London',
    control,
    bus,
    // The shortest wait the jitter allows, to keep the reconnect tests quick.
    random: () => 0,
    log,
  })
  bridges.push(bridge)
  const connected = (id = 'hallway') => bridge.status().find(entry => entry.displayId === id)?.state === 'connected'
  return { bridge, control, log, states, connected }
}

afterEach(async () => {
  await Promise.all(bridges.splice(0).map(bridge => bridge.stop()))
  await Promise.all(probes.splice(0).map(client => client.endAsync(true)))
  await Promise.all(brokers.splice(0).map(broker => broker.stop().catch(() => undefined)))
})

const STATE_COUNT = STATE_TOPICS.length

/** Waits until the broker has seen the bridge's availability and every state topic, so what is stored is complete. The discovery configs are under another prefix, so they don't count. */
function allPublished(broker: TestBroker, clientId = 'wallcal-hallway'): boolean {
  const topics = new Set(broker.published.filter(message => message.clientId === clientId && message.topic.startsWith('wallcal/')).map(message => message.topic))
  return topics.size >= STATE_COUNT + 1
}

describe('the bridge and a broker', () => {
  it('keeps the state on the broker, retained, for a subscriber that joins later', async () => {
    const broker = await startBroker()
    const { control } = setup(broker.url)
    await until('the state to be published', () => allPublished(broker))

    control.applyCommand('hallway', { type: 'set_view', view: 'agenda' })
    control.applyCommand('hallway', { type: 'set_brightness', brightness: 35 })
    await until('the changes to be published', () => broker.published.filter(message => message.topic === 'wallcal/hallway/brightness/state').length === 2)

    const late = await probe(broker, 'wallcal/hallway/#')
    await until('the retained messages', () => late.received.length >= STATE_COUNT + 1)

    expect(late.received.every(message => message.retain)).toBe(true)
    expect(Object.fromEntries(late.received.map(message => [message.topic.replace('wallcal/hallway/', ''), message.payload]))).toMatchObject({
      'availability': 'online',
      'view/state': 'agenda',
      'brightness/state': '35',
      'screen/state': 'on',
      'photo_source/state': 'immich',
      'auto_presence/state': 'ON',
      'auto_brightness/state': 'ON',
    })
    expect(late.on('wallcal/hallway/month/state')[0]!.payload).toMatch(/^\d{4}-\d{2}$/)
  })

  it('sends a change to a subscriber that is already there, as it happens', async () => {
    const broker = await startBroker()
    const { control } = setup(broker.url)
    await until('the state to be published', () => allPublished(broker))
    const watcher = await probe(broker, 'wallcal/hallway/screen/state')
    await until('the current screen', () => watcher.received.length === 1)

    control.applyCommand('hallway', { type: 'set_screen', screen: 'off' })

    await until('the change', () => watcher.received.length === 2)
    expect(watcher.received).toEqual([
      { topic: 'wallcal/hallway/screen/state', payload: 'on', retain: true },
      { topic: 'wallcal/hallway/screen/state', payload: 'off', retain: false },
    ])
  })

  it('applies a command another client publishes, and publishes the new state', async () => {
    const broker = await startBroker()
    const { control, states } = setup(broker.url)
    await until('the state to be published', () => allPublished(broker))
    const ha = await probe(broker, 'wallcal/hallway/view/state')
    await until('the current view', () => ha.received.length === 1)

    await ha.client.publishAsync('wallcal/hallway/view/set', 'agenda', { qos: 1 })

    await until('the command', () => control.applyCommand.mock.calls.length === 1)
    expect(control.applyCommand).toHaveBeenCalledWith('hallway', { type: 'set_view', view: 'agenda' })
    expect(states.get('hallway')!.view).toBe('agenda')
    await until('the new state', () => ha.received.length === 2)
    expect(ha.received[1]).toEqual({ topic: 'wallcal/hallway/view/state', payload: 'agenda', retain: false })
  })

  it('answers a command for each display on its own connection, and no other display\'s', async () => {
    const broker = await startBroker()
    const { control, connected } = setup(broker.url, { displays: ['hallway', 'kitchen'] })
    await until('both displays to connect', () => connected('hallway') && connected('kitchen'))
    expect([...broker.clients.keys()].sort()).toEqual(['wallcal-hallway', 'wallcal-kitchen'])
    const ha = await probe(broker)

    await ha.client.publishAsync('wallcal/kitchen/screen/set', 'off', { qos: 1 })

    await until('the command', () => control.applyCommand.mock.calls.length === 1)
    expect(control.applyCommand).toHaveBeenCalledWith('kitchen', { type: 'set_screen', screen: 'off' })
  })

  it('ignores a retained command left on the broker, and warns once', async () => {
    const broker = await startBroker()
    const ha = await probe(broker)
    await ha.client.publishAsync('wallcal/hallway/screen/set', 'off', { qos: 1, retain: true })
    const { control, log, connected } = setup(broker.url)
    await until('the bridge to connect', connected)

    // Sent after the retained one, so once this has been applied the retained one has been seen.
    await ha.client.publishAsync('wallcal/hallway/view/set', 'agenda', { qos: 1 })
    await until('the later command', () => control.applyCommand.mock.calls.length === 1)

    expect(control.applyCommand).toHaveBeenCalledTimes(1)
    expect(control.applyCommand).toHaveBeenCalledWith('hallway', { type: 'set_view', view: 'agenda' })
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0]![0]).toContain('ignored the retained message on wallcal/hallway/screen/set')
  })

  it('has the broker publish the last will when the connection dies, then comes back and says online again', async () => {
    const broker = await startBroker()
    const { connected } = setup(broker.url)
    await until('the state to be published', () => allPublished(broker))
    const watcher = await probe(broker, 'wallcal/hallway/availability')
    await until('the current availability', () => watcher.received.length === 1)
    expect(watcher.received[0]!.payload).toBe('online')

    // Cut the socket with no DISCONNECT, as a crash or a lost network would.
    broker.clients.get('wallcal-hallway')!.conn.destroy()

    await until('the will', () => watcher.received.some(message => message.payload === 'offline'))
    await until('online again', () => watcher.received.filter(message => message.payload === 'online').length === 2)
    expect(connected()).toBe(true)

    // The will was retained, and online replaced it.
    const late = await probe(broker, 'wallcal/hallway/availability')
    await until('the retained availability', () => late.received.length === 1)
    expect(late.received[0]).toEqual({ topic: 'wallcal/hallway/availability', payload: 'online', retain: true })
  })

  it('reconnects and publishes everything again when the broker comes back', async () => {
    const first = await startBroker()
    const { bridge, connected, control } = setup(first.url)
    await until('the state to be published', () => allPublished(first))
    control.applyCommand('hallway', { type: 'set_view', view: 'photo' })

    await first.stop()
    await until('the bridge to notice', () => !connected())
    expect(bridge.status()[0]!.state).not.toBe('connected')

    // A new broker has forgotten everything that was retained.
    const second = await startBroker(first.port)
    await until('the bridge to reconnect', connected)
    expect(bridge.status()[0]!.lastError).toBeNull()
    await until('the state to be published again', () => allPublished(second))

    const late = await probe(second, 'wallcal/hallway/#')
    await until('the retained messages', () => late.received.length >= STATE_COUNT + 1)
    expect(late.on('wallcal/hallway/availability')[0]!.payload).toBe('online')
    expect(late.on('wallcal/hallway/view/state')[0]!.payload).toBe('photo')
  })

  it('subscribes again after a reconnect, so commands still arrive', async () => {
    const broker = await startBroker()
    const { connected, control } = setup(broker.url)
    await until('the bridge to connect', connected)
    broker.clients.get('wallcal-hallway')!.conn.destroy()
    await until('the bridge to notice', () => !connected())
    await until('the bridge to reconnect', connected)
    const ha = await probe(broker)

    await ha.client.publishAsync('wallcal/hallway/brightness/set', '20.0', { qos: 1 })

    await until('the command', () => control.applyCommand.mock.calls.length === 1)
    expect(control.applyCommand).toHaveBeenCalledWith('hallway', { type: 'set_brightness', brightness: 20 })
  })

  it('stop() leaves offline retained, and ends the connection without the broker needing the will', async () => {
    const broker = await startBroker()
    const { bridge, connected } = setup(broker.url)
    await until('the state to be published', () => allPublished(broker))
    const watcher = await probe(broker, 'wallcal/hallway/availability')
    await until('the current availability', () => watcher.received.length === 1)

    await bridge.stop()

    await until('offline', () => watcher.received.some(message => message.payload === 'offline'))
    await until('the connection to close', () => !broker.clients.get('wallcal-hallway')!.connected)
    expect(connected()).toBe(false)
    // Offline came once: from stop(), not also from the will.
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(watcher.received.map(message => message.payload)).toEqual(['online', 'offline'])
    const late = await probe(broker, 'wallcal/hallway/availability')
    await until('the retained availability', () => late.received.length === 1)
    expect(late.received[0]!.payload).toBe('offline')
  })

  it('stop() returns promptly when the broker has already gone', async () => {
    const broker = await startBroker()
    const { bridge, connected } = setup(broker.url)
    await until('the bridge to connect', connected)
    await broker.stop()
    await until('the bridge to notice', () => !connected())

    const started = Date.now()
    await bridge.stop()

    expect(Date.now() - started).toBeLessThan(4000)
  })
})

describe('Home Assistant discovery', () => {
  const configs = discoveryMessages({ prefix: 'homeassistant', display: { id: 'hallway', name: 'Hallway' }, displayCount: 1 })

  it('keeps the configs on the broker, and publishes them again when Home Assistant says it is online', async () => {
    const broker = await startBroker()
    setup(broker.url)
    await until('the state to be published', () => allPublished(broker))

    // Home Assistant starting after the app: the retained configs are all it needs.
    const ha = await probe(broker, 'homeassistant/#')
    await until('the retained configs', () => ha.received.length >= configs.length)
    expect(ha.received.every(message => message.retain)).toBe(true)
    expect(ha.received.map(({ topic, payload }) => ({ topic, payload }))).toEqual(expect.arrayContaining(configs))
    expect(ha.received).toHaveLength(configs.length)
    ha.received.length = 0

    // Home Assistant restarting while the app runs: its birth message asks for them again.
    await ha.client.publishAsync('homeassistant/status', 'online', { qos: 1 })

    await until('the configs again', () => ha.received.filter(message => message.topic !== 'homeassistant/status').length >= configs.length)
    const again = ha.received.filter(message => message.topic !== 'homeassistant/status')
    expect(again.map(({ topic, payload }) => ({ topic, payload }))).toEqual(configs)
  })
})

describe('with no broker', () => {
  it('starts, keeps retrying in the background, says why in status(), and stops at once', async () => {
    const port = await closedPort()
    const { bridge, log } = setup(`mqtt://127.0.0.1:${port}`)

    await until('the first failure', () => bridge.status()[0]!.lastError !== null)
    await until('the connection to be given up on', () => bridge.status()[0]!.state === 'disconnected')

    expect(bridge.status()[0]!.lastError).toMatch(/ECONNREFUSED/)
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0]![0]).toContain(`cannot connect to mqtt://127.0.0.1:${port}`)
    expect(log.error).not.toHaveBeenCalled()

    const started = Date.now()
    await bridge.stop()
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('connects once a broker appears on that address', async () => {
    const port = await closedPort()
    const { connected, bridge } = setup(`mqtt://127.0.0.1:${port}`)
    await until('the first failure', () => bridge.status()[0]!.lastError !== null)

    await startBroker(port)

    await until('the bridge to connect', connected)
  })
})

describe('credentials', () => {
  it('sends the username and password the config gives, and no secret reaches the log', async () => {
    const aedes = await Aedes.createBroker({
      authenticate: (_client, username, password, done) => {
        done(null, username === 'wallcal' && password?.toString() === 'correct-horse')
      },
    })
    const server = createServer(aedes.handle)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    brokers.push({
      port,
      url: '',
      clients: new Map(),
      published: [],
      stop: async () => {
        server.closeAllConnections()
        await new Promise<void>(resolve => server.close(() => resolve()))
        await new Promise<void>(resolve => aedes.close(() => resolve()))
      },
    })

    const wrong = setup(`mqtt://127.0.0.1:${port}`, { config: { username: 'wallcal', password: 'wrong-password' } })
    await until('the refusal', () => wrong.bridge.status()[0]!.lastError !== null)
    const right = setup(`mqtt://127.0.0.1:${port}`, { config: { username: 'wallcal', password: 'correct-horse' } })
    await until('the bridge to connect', right.connected)

    expect(wrong.bridge.status()[0]!.lastError).toMatch(/Bad username or password|not authorized/i)
    expect(wrong.connected()).toBe(false)
    const logged = JSON.stringify([wrong.log, right.log].map(({ info, warn, error }) => [info.mock.calls, warn.mock.calls, error.mock.calls]))
    expect(logged).not.toContain('wrong-password')
    expect(logged).not.toContain('correct-horse')
  })
})
