import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHaTriggerSocket, websocketUrl } from '../../../server/triggers/socket'
import type { HaSocket, HaTriggerSocket, HaTriggerSocketOptions } from '../../../server/triggers/socket'

// The Home Assistant WebSocket client against a fake socket, with fake timers:
// it logs in, subscribes, says when a trigger fires, pings, and connects again
// after a failure. Nothing it logs holds the URL or the token.

const TOKEN = 'long-lived-secret'
const HA = { url: 'https://ha.example.com:8123/', token: TOKEN }

class FakeSocket implements HaSocket {
  sent: Record<string, unknown>[] = []
  closed = false
  private listeners = new Map<string, ((event: { data: unknown }) => void)[]>()

  constructor(readonly url: string) {}

  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>)
  }

  close() {
    this.closed = true
  }

  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  emit(type: 'open' | 'close' | 'error') {
    for (const listener of this.listeners.get(type) ?? []) listener({ data: undefined })
  }

  receive(message: unknown) {
    for (const listener of this.listeners.get('message') ?? []) listener({ data: JSON.stringify(message) })
  }

  /** Home Assistant's side of a good login. */
  login() {
    this.emit('open')
    this.receive({ type: 'auth_required', ha_version: '2026.11.0' })
    this.receive({ type: 'auth_ok', ha_version: '2026.11.0' })
  }

  /** The `subscribe_trigger` messages sent, as `[message id, trigger]`. */
  subscriptions() {
    return this.sent.filter(message => message.type === 'subscribe_trigger').map(message => [message.id, message.trigger] as const)
  }
}

const DOORBELL = { platform: 'state', entity_id: ['binary_sensor.front_doorbell'], to: ['on'] }
const PARCEL = { platform: 'event', event_type: 'parcel_delivered' }

let sockets: FakeSocket[]
let running: HaTriggerSocket[]

beforeEach(() => {
  vi.useFakeTimers()
  sockets = []
  running = []
})

afterEach(() => {
  for (const socket of running) socket.stop()
  vi.useRealTimers()
})

function setup(overrides: Partial<HaTriggerSocketOptions> = {}) {
  const onTrigger = vi.fn()
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const socket = createHaTriggerSocket({
    homeassistant: HA,
    subscriptions: [{ id: 'doorbell', trigger: DOORBELL }, { id: 'parcel', trigger: PARCEL }],
    onTrigger,
    connect: (url) => {
      const fake = new FakeSocket(url)
      sockets.push(fake)
      return fake
    },
    log,
    ...overrides,
  })
  running.push(socket)
  socket.start()
  const latest = () => sockets.at(-1)!
  /** Everything logged, so a test can check no secret is in it. */
  const logged = () => [...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls].flat().join('\n')
  return { socket, onTrigger, log, latest, logged }
}

describe('websocketUrl', () => {
  it.each([
    ['http://homeassistant.local:8123', 'ws://homeassistant.local:8123/api/websocket'],
    ['https://ha.example.com/', 'wss://ha.example.com/api/websocket'],
    ['https://example.com/ha/?x=1#y', 'wss://example.com/ha/api/websocket'],
  ])('%s becomes %s', (base, url) => {
    expect(websocketUrl(base)).toBe(url)
  })

  it('is null for an address that is not http or https', () => {
    expect(websocketUrl('not a url')).toBeNull()
    expect(websocketUrl('ftp://ha.local')).toBeNull()
  })
})

describe('connecting', () => {
  it('logs in with the token and subscribes to every trigger', () => {
    const { latest, socket } = setup()

    expect(latest().url).toBe('wss://ha.example.com:8123/api/websocket')
    expect(socket.status().state).toBe('connecting')

    latest().login()

    expect(latest().sent[0]).toEqual({ type: 'auth', access_token: TOKEN })
    expect(latest().subscriptions()).toEqual([[1, DOORBELL], [2, PARCEL]])
    expect(socket.status()).toEqual({ state: 'connected', last_error: null })
  })

  it('says which trigger fired, with its variables', () => {
    const { latest, onTrigger } = setup()
    latest().login()
    latest().receive({ id: 1, type: 'result', success: true, result: null })
    latest().receive({ id: 2, type: 'result', success: true, result: null })

    const variables = { trigger: { platform: 'state', entity_id: 'binary_sensor.front_doorbell', to_state: { state: 'on' } } }
    latest().receive({ id: 1, type: 'event', event: { variables, context: {} } })
    latest().receive({ id: 2, type: 'event', event: { variables: { trigger: { platform: 'event' } } } })

    expect(onTrigger.mock.calls).toEqual([['doorbell', variables], ['parcel', { trigger: { platform: 'event' } }]])
  })

  it('reads messages Home Assistant sends together as one array', () => {
    const { latest, onTrigger } = setup()
    latest().login()
    latest().receive([{ id: 1, type: 'result', success: true }, { id: 1, type: 'event', event: { variables: {} } }])

    expect(onTrigger).toHaveBeenCalledWith('doorbell', {})
  })

  it('ignores events for a subscription that was refused, and logs the refusal', () => {
    const { latest, onTrigger, log, socket } = setup()
    latest().login()
    latest().receive({ id: 1, type: 'result', success: false, error: { code: 'unauthorized', message: 'Unauthorized' } })
    latest().receive({ id: 1, type: 'event', event: { variables: {} } })

    expect(onTrigger).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledWith('[triggers] Home Assistant refused trigger "doorbell": Unauthorized')
    expect(socket.status().last_error).toBe('Home Assistant refused trigger "doorbell": Unauthorized')
  })

  it('ignores what it cannot read', () => {
    const { latest, onTrigger } = setup()
    latest().login()
    for (const listener of [() => latest().receive('nonsense'), () => latest().receive({ id: 99, type: 'event', event: {} })]) listener()

    expect(onTrigger).not.toHaveBeenCalled()
    expect(latest().closed).toBe(false)
  })

  it('keeps going when acting on a trigger throws', () => {
    const { latest, log } = setup({ onTrigger: () => { throw new Error('boom') } })
    latest().login()
    latest().receive({ id: 1, type: 'result', success: true })
    latest().receive({ id: 1, type: 'event', event: { variables: {} } })

    expect(log.error).toHaveBeenCalledWith('[triggers] acting on "doorbell" failed: boom')
    expect(latest().closed).toBe(false)
  })
})

describe('failures', () => {
  it('connects again after a close, waiting longer each time, and subscribes afresh', () => {
    const { latest, log, socket } = setup({ retryMs: 1000 })
    latest().login()
    latest().emit('close')

    expect(socket.status()).toEqual({ state: 'disconnected', last_error: 'the connection to Home Assistant closed' })
    expect(sockets).toHaveLength(1)
    vi.advanceTimersByTime(1000)
    expect(sockets).toHaveLength(2)

    // Down for good: 2 s, then 4 s.
    latest().emit('error')
    vi.advanceTimersByTime(1999)
    expect(sockets).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(sockets).toHaveLength(3)
    latest().emit('close')
    vi.advanceTimersByTime(3999)
    expect(sockets).toHaveLength(3)
    vi.advanceTimersByTime(1)
    expect(sockets).toHaveLength(4)

    // Logged once per reason, not at every attempt.
    expect(log.warn.mock.calls.map(call => call[0])).toEqual([
      '[triggers] the connection to Home Assistant closed; trying again in 1 s',
      '[triggers] could not connect to Home Assistant; trying again in 2 s',
    ])

    latest().login()
    expect(latest().subscriptions()).toEqual([[1, DOORBELL], [2, PARCEL]])
    expect(log.info).toHaveBeenLastCalledWith('[triggers] connected to Home Assistant again after 3 failed attempts')
    expect(socket.status()).toEqual({ state: 'connected', last_error: null })
  })

  it('never waits longer than the longest wait', () => {
    setup({ retryMs: 1000, maxRetryMs: 5000 })
    for (let attempt = 0; attempt < 6; attempt++) {
      sockets.at(-1)!.emit('error')
      vi.advanceTimersByTime(5000)
    }

    expect(sockets).toHaveLength(7)
  })

  it('waits the longest after the token is refused, and never logs it', () => {
    const { latest, log, logged } = setup({ retryMs: 1000, maxRetryMs: 60_000 })
    latest().emit('open')
    latest().receive({ type: 'auth_required' })
    latest().receive({ type: 'auth_invalid', message: 'Invalid access token or password' })

    expect(latest().closed).toBe(true)
    expect(log.warn).toHaveBeenCalledWith('[triggers] Home Assistant refused the access token; trying again in 60 s')
    vi.advanceTimersByTime(59_999)
    expect(sockets).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(sockets).toHaveLength(2)
    expect(logged()).not.toContain(TOKEN)
    expect(logged()).not.toContain('ha.example.com')
  })

  it('gives up on a connection that does not answer the login', () => {
    const { latest, socket } = setup({ replyTimeoutMs: 5000 })
    latest().emit('open')

    vi.advanceTimersByTime(5000)

    expect(latest().closed).toBe(true)
    expect(socket.status().last_error).toBe('Home Assistant did not answer the connection in 5 s')
  })

  it('pings, and connects again when a pong does not come', () => {
    const { latest, socket } = setup({ pingIntervalMs: 30_000, replyTimeoutMs: 10_000, retryMs: 1000 })
    latest().login()

    vi.advanceTimersByTime(30_000)
    const ping = latest().sent.at(-1)!
    expect(ping).toEqual({ id: 3, type: 'ping' })
    latest().receive({ id: 3, type: 'pong' })
    vi.advanceTimersByTime(10_000)
    expect(latest().closed).toBe(false)

    vi.advanceTimersByTime(20_000)
    vi.advanceTimersByTime(10_000)
    expect(sockets[0]!.closed).toBe(true)
    expect(socket.status().last_error).toBe('Home Assistant did not answer a ping in 10 s')
    vi.advanceTimersByTime(1000)
    expect(sockets).toHaveLength(2)
  })

  it('treats a socket that cannot be made as a failed connection, without its message', () => {
    const { log, logged, socket } = setup({ connect: () => { throw new Error(`bad url ${HA.url}`) } })

    expect(socket.status().state).toBe('disconnected')
    expect(log.warn).toHaveBeenCalledWith('[triggers] could not connect to Home Assistant; trying again in 2 s')
    expect(logged()).not.toContain('ha.example.com')
  })
})

describe('logPrefix', () => {
  it('starts every line of the log with the prefix it is given, and adds the note when a subscription is refused', () => {
    const { latest, log } = setup({ logPrefix: '[timers]', refusedNote: 'polling still works' })
    latest().login()
    latest().receive({ id: 1, type: 'result', success: false, error: { code: 'unauthorized', message: 'Unauthorized' } })
    latest().emit('close')

    const lines = [...log.info.mock.calls, ...log.warn.mock.calls].map(call => call[0] as string)
    expect(lines).toHaveLength(3)
    expect(lines.every(line => line.startsWith('[timers] '))).toBe(true)
    expect(log.warn).toHaveBeenCalledWith('[timers] Home Assistant refused trigger "doorbell": Unauthorized; polling still works')
  })
})

describe('stop', () => {
  it('closes the connection, and nothing fires or reconnects after it', () => {
    const { latest, onTrigger, socket } = setup()
    latest().login()
    latest().receive({ id: 1, type: 'result', success: true })

    socket.stop()
    latest().receive({ id: 1, type: 'event', event: { variables: {} } })
    latest().emit('close')
    vi.advanceTimersByTime(10 * 60_000)

    expect(latest().closed).toBe(true)
    expect(onTrigger).not.toHaveBeenCalled()
    expect(sockets).toHaveLength(1)
    expect(socket.status().state).toBe('stopped')
  })
})
