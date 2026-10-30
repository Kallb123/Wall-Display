import { connect as mqttConnect } from 'mqtt'
import type { IClientOptions } from 'mqtt'
import type { DisplayState } from '../../shared/display'
import type { MqttConfig } from '../config/schema'
import type { DisplayControl } from '../control/service'
import type { EventBus } from '../events/bus'
import { BIRTH_ONLINE, birthTopic, discoveryMessages } from './discovery'
import { AVAILABILITY_TOPIC, COMMAND_TOPICS, LAST_SYNC_TOPIC, lastSyncPayload, OFFLINE, ONLINE, parseCommandPayload, parseCommandTopic, SPECIAL_DAY_TOPIC, specialDayPayload, statePayloads, topicFor } from './topics'
import type { StateTopic } from './topics'

// Keeps each display's state on an MQTT broker and takes commands from it
// (architecture §7.3, contracts/mqtt.json). MQTT allows one last will per
// connection and availability is per display, so each display gets its own
// connection. With discovery on, it also publishes Home Assistant's entity
// configs for the display on every connect, and again when Home Assistant
// says it has restarted. This file decides when to connect, retry and publish;
// the topics and payloads are in topics.ts and discovery.ts, and the MQTT
// client itself is injected, so a test drives it with a fake and fake timers.
// A broker that is missing or down never stops the app: nothing here throws
// or waits for it.

/** The part of an MQTT.js client the bridge uses, so a test can pass a fake. */
export interface MqttLink {
  readonly connected: boolean
  /** The socket, when there is one. Only used to cut off a connection that will not close. */
  readonly stream?: { destroy: () => unknown }
  on: <Name extends keyof MqttLinkEvents>(event: Name, listener: MqttLinkEvents[Name]) => unknown
  publish: (topic: string, payload: string, options: { qos: 0 | 1 | 2, retain: boolean }, callback?: (error?: Error | null) => void) => unknown
  subscribe: (topics: string[], options: { qos: 0 | 1 | 2 }, callback?: (error: Error | null, granted?: { topic: string, qos: number }[]) => void) => unknown
  /** Opens the connection again after a `close`. */
  reconnect: () => unknown
  end: (force: boolean, callback?: () => void) => unknown
}

export interface MqttLinkEvents {
  connect: () => void
  close: () => void
  error: (error: Error) => void
  message: (topic: string, payload: Buffer, packet: { retain: boolean }) => void
}

// MqttClient has more events than the bridge listens for, so TypeScript can't see it fits MqttLink. It does.
const connectWithMqttJs = (url: string, options: IClientOptions): MqttLink => mqttConnect(url, options) as unknown as MqttLink

export interface MqttBridgeOptions {
  config: MqttConfig
  /** The displays in the config: each one gets a connection. The name is what Home Assistant calls the device when there is more than one display. */
  displays: readonly { id: string, name: string }[]
  /** When the last calendar sync succeeded, for `last_sync/state`. Called on every check, so it should be cheap. Default: never synced. */
  lastSync?: () => Date | null
  /** Today's special day name, for `special_day/state`: `null` when there is none (published as empty) and `undefined` while that isn't known yet (not published). Called on every check, so it should be cheap. Default: not known. */
  specialDay?: () => string | null | undefined
  /** The display time zone, which decides what the current month is. */
  timeZone: string
  control: Pick<DisplayControl, 'getState' | 'applyCommand'>
  bus: EventBus
  /** For tests. Default: `connect` from MQTT.js. */
  connect?: (url: string, options: IClientOptions) => MqttLink
  /** For tests. Default: the real time. */
  now?: () => Date
  /** For tests. Default: `Math.random`. */
  random?: () => number
  /** For tests. Default: the console. */
  log?: Pick<Console, 'info' | 'warn' | 'error'>
}

export interface MqttBridgeStatus {
  displayId: string
  state: 'connecting' | 'connected' | 'disconnected'
  /** The last connection error, without any secret. Null once connected. */
  lastError: string | null
}

export interface MqttBridge {
  status: () => MqttBridgeStatus[]
  /**
   * Publishes the discovery configs again on every connection that is up, for
   * the settings page's "Republish discovery". A display that is down gets them
   * when it connects, so it is left out. Returns the ids of the displays it
   * published for, and none when discovery is off.
   */
  republishDiscovery: () => string[]
  /** Publishes `offline`, ends every connection and cancels the timers. Resolves within a few seconds even if the broker is gone. */
  stop: () => Promise<void>
}

/** The first retry comes after this long, and each one after takes twice as long. */
export const MIN_RECONNECT_MS = 1000
/** A retry never waits longer than this. */
export const MAX_RECONNECT_MS = 60_000
/** `month/state` follows the calendar when nothing else changes, so every connection is checked this often. */
export const RECHECK_MS = 60_000
/** A connection has to stay up this long before the backoff starts again from a second. A broker that accepts and then drops at once (two apps with the same client id, which it keeps swapping) still backs off. */
export const STABLE_MS = 30_000
/** `stop()` waits this long for the broker to take `offline`, and again for it to close the connection. */
export const STOP_WAIT_MS = 1500

const CONNECT_TIMEOUT_MS = 10_000
const JITTER = 0.2

/** How long to wait before the retry after `failures` failures in a row (at least 1): 1 s, 2 s, 4 s and so on up to a minute, give or take 20 % so a room full of displays doesn't retry in step. `random` is a number from 0 up to 1. */
export function reconnectDelayMs(failures: number, random: number): number {
  const base = Math.min(MIN_RECONNECT_MS * 2 ** (Math.max(failures, 1) - 1), MAX_RECONNECT_MS)
  return Math.min(Math.round(base * (1 - JITTER + 2 * JITTER * random)), MAX_RECONNECT_MS)
}

/** The broker as a log line or the settings page names it: the scheme, host and port, such as `mqtt://mosquitto:1883`. The credentials are in the config, not the URL, and never in this. */
export function brokerName(url: string): string {
  const broker = new URL(url)
  return `${broker.protocol}//${broker.host}`
}

interface Link {
  displayId: string
  displayName: string
  client: MqttLink | undefined
  state: MqttBridgeStatus['state']
  lastError: string | null
  /** What this connection last published on each state topic (and on `last_sync/state` and `special_day/state`). Emptied on every connect, so a connect publishes everything. */
  published: Map<StateTopic | typeof LAST_SYNC_TOPIC | typeof SPECIAL_DAY_TOPIC, string>
  /** Connections that failed or dropped since the last one that lasted `STABLE_MS`. */
  failures: number
  /** When the current connection came up, in ms. */
  connectedAt: number
  /** Whether this run of failures has been logged yet. Only the first of a run is. */
  reported: boolean
  retry: ReturnType<typeof setTimeout> | undefined
}

export function createMqttBridge(options: MqttBridgeOptions): MqttBridge {
  const { config, timeZone, control, bus, connect = connectWithMqttJs, now = () => new Date(), random = Math.random, log = console, lastSync = () => null, specialDay = () => undefined } = options
  const broker = brokerName(config.url)
  let stopped = false
  let stopping: Promise<void> | undefined

  /** The message of an error, with the password cut out in case a broker or a library echoes it. */
  function describe(error: unknown): string {
    // An AggregateError (a host that resolves to several addresses) has no message of its own.
    const code = (error as { code?: unknown } | null)?.code
    let message = error instanceof Error && error.message !== '' ? error.message : typeof code === 'string' ? code : String(error)
    if (config.password) message = message.replaceAll(config.password, '***')
    return message
  }

  const links: Link[] = options.displays.map(({ id, name }) => ({
    displayId: id,
    displayName: name,
    client: undefined,
    state: 'connecting',
    lastError: null,
    published: new Map(),
    failures: 0,
    connectedAt: 0,
    reported: false,
    retry: undefined,
  }))

  /** Publishes retained at QoS 1 on `topic`, which is the whole topic. `name` is what a warning calls it. */
  function send(link: Link, topic: string, name: string, payload: string, onError?: () => void): void {
    link.client!.publish(topic, payload, { qos: 1, retain: true }, (error) => {
      if (!error) return
      // A publish that was still waiting when the connection dropped. The reconnect publishes everything again.
      onError?.()
      if (link.state === 'connected') log.warn(`[mqtt] ${link.displayId}: could not publish ${name}: ${describe(error)}`)
    })
  }

  /** Publishes on one of the display's own topics, such as `view/state`: `suffix` goes after `wallcal/<display id>/`. */
  function publish(link: Link, suffix: string, payload: string, onError?: () => void): void {
    send(link, topicFor(link.displayId, suffix), suffix, payload, onError)
  }

  /** Publishes Home Assistant's config for each of the display's entities. Their topics are under the discovery prefix, not the display's. */
  function publishDiscovery(link: Link): void {
    const messages = discoveryMessages({
      prefix: config.discovery_prefix,
      display: { id: link.displayId, name: link.displayName },
      displayCount: links.length,
    })
    for (const { topic, payload } of messages) send(link, topic, topic, payload)
  }

  /** `last_sync/state`'s payload, or nothing before the first sync. A getter that fails is logged and skipped, so the state topics still go out. */
  function lastSyncEntry(link: Link): [typeof LAST_SYNC_TOPIC, string][] {
    try {
      const at = lastSync()
      return at ? [[LAST_SYNC_TOPIC, lastSyncPayload(at)]] : []
    } catch (error) {
      log.error(`[mqtt] ${link.displayId}: could not read the last sync time: ${describe(error)}`)
      return []
    }
  }

  /** `special_day/state`'s payload, or nothing while today's special day isn't known. A getter that fails is logged and skipped, like the last sync's. */
  function specialDayEntry(link: Link): [typeof SPECIAL_DAY_TOPIC, string][] {
    try {
      const name = specialDay()
      return name === undefined ? [] : [[SPECIAL_DAY_TOPIC, specialDayPayload(name)]]
    } catch (error) {
      log.error(`[mqtt] ${link.displayId}: could not read today's special day: ${describe(error)}`)
      return []
    }
  }

  /** Publishes the state topics whose payload is not what this connection last published. */
  function publishState(link: Link): void {
    if (link.state !== 'connected') return
    let state: DisplayState
    try {
      state = control.getState(link.displayId)
    } catch (error) {
      log.error(`[mqtt] ${link.displayId}: could not read the state: ${describe(error)}`)
      return
    }
    const entries = [...Object.entries(statePayloads(state, now(), timeZone)) as [StateTopic, string][], ...lastSyncEntry(link), ...specialDayEntry(link)]
    for (const [topic, payload] of entries) {
      if (link.published.get(topic) === payload) continue
      link.published.set(topic, payload)
      // Forget a payload that didn't get through, so the next check sends it again.
      publish(link, topic, payload, () => link.published.delete(topic))
    }
  }

  function onConnect(link: Link): void {
    if (stopped) return
    const client = link.client!
    link.state = 'connected'
    link.lastError = null
    log.info(`[mqtt] ${link.displayId}: connected to ${broker}${link.failures > 0 ? ` (after ${link.failures} failed attempt(s))` : ''}`)
    link.connectedAt = now().getTime()
    link.reported = false
    link.published.clear()

    publish(link, AVAILABILITY_TOPIC, ONLINE)
    if (config.discovery) publishDiscovery(link)
    const topics = COMMAND_TOPICS.map(suffix => topicFor(link.displayId, suffix))
    // Home Assistant's birth message is how it asks for the configs again after a restart.
    if (config.discovery) topics.push(birthTopic(config.discovery_prefix))
    client.subscribe(topics, { qos: 1 }, (error, granted) => {
      if (error) {
        if (!stopped) log.warn(`[mqtt] ${link.displayId}: could not subscribe to the command topics: ${describe(error)}`)
        return
      }
      // A broker that refuses a topic (its access rules) grants QoS 128 for it.
      const refused = (granted ?? []).filter(grant => grant.qos === 128).map(grant => grant.topic)
      if (refused.length > 0) log.warn(`[mqtt] ${link.displayId}: the broker refused the subscription to ${refused.join(', ')}`)
    })
    publishState(link)
  }

  function onClose(link: Link): void {
    if (stopped) return
    const wasConnected = link.state === 'connected'
    link.state = 'disconnected'
    if (wasConnected && now().getTime() - link.connectedAt >= STABLE_MS) link.failures = 0
    link.failures++
    if (!link.reported) {
      link.reported = true
      const reason = link.lastError ? ` (${link.lastError})` : ''
      log.warn(wasConnected
        ? `[mqtt] ${link.displayId}: lost the connection to ${broker}${reason}; trying again in the background`
        : `[mqtt] ${link.displayId}: cannot connect to ${broker}${reason}; trying again in the background`)
    }
    // A client can report `close` more than once for one connection.
    if (link.retry) return
    link.retry = setTimeout(() => {
      link.retry = undefined
      if (stopped) return
      link.state = 'connecting'
      try {
        link.client!.reconnect()
      } catch (error) {
        // Nothing is left that would schedule another try, so do it here.
        link.lastError = describe(error)
        onClose(link)
      }
    }, reconnectDelayMs(link.failures, random()))
  }

  function onMessage(link: Link, topic: string, payload: Buffer, retained: boolean): void {
    if (config.discovery && topic === birthTopic(config.discovery_prefix)) {
      // A retained `online` is old news: the connect that subscribed has just published every config.
      if (!retained && !stopped && link.state === 'connected' && payload.toString('utf8') === BIRTH_ONLINE) {
        log.info(`[mqtt] ${link.displayId}: Home Assistant says it is online, so the discovery configs are published again`)
        publishDiscovery(link)
      }
      return
    }
    const parsedTopic = parseCommandTopic(topic)
    if (!parsedTopic || parsedTopic.displayId !== link.displayId) return
    // A retained command would run again on every connect. Publish it empty to clear it from the broker.
    if (retained) {
      log.warn(`[mqtt] ${link.displayId}: ignored the retained message on ${topic} (publish an empty retained message there to remove it)`)
      return
    }

    const parsed = parseCommandPayload(parsedTopic.suffix, payload.toString('utf8'))
    if (!parsed.ok) {
      log.warn(`[mqtt] ${link.displayId}: ignored a message: ${parsed.reason}`)
      return
    }
    try {
      control.applyCommand(link.displayId, parsed.command)
    } catch (error) {
      log.error(`[mqtt] ${link.displayId}: could not apply the command from ${parsedTopic.suffix}: ${describe(error)}`)
    }
  }

  function open(link: Link): void {
    const clientOptions: IClientOptions = {
      clientId: `${config.client_id}-${link.displayId}`,
      clean: true,
      // MQTT.js would retry every second for ever. Backing off is ours to do (see onClose).
      reconnectPeriod: 0,
      connectTimeout: CONNECT_TIMEOUT_MS,
      // A reconnect starts from nothing: onConnect subscribes and publishes everything again.
      queueQoSZero: false,
      resubscribe: false,
      will: { topic: topicFor(link.displayId, AVAILABILITY_TOPIC), payload: OFFLINE, qos: 1, retain: true },
    }
    if (config.username !== undefined) clientOptions.username = config.username
    if (config.password !== undefined) clientOptions.password = config.password

    let client: MqttLink
    try {
      client = connect(config.url, clientOptions)
    } catch (error) {
      // The URL was validated, so this is not expected. The app runs on without MQTT for this display.
      link.state = 'disconnected'
      link.lastError = describe(error)
      log.error(`[mqtt] ${link.displayId}: could not start the connection: ${link.lastError}`)
      return
    }
    link.client = client

    // These stay attached after stop(): an `error` with no listener would crash the process.
    client.on('connect', () => onConnect(link))
    client.on('close', () => onClose(link))
    client.on('error', (error) => {
      link.lastError = describe(error)
      // Failing to connect is reported once, from `close`. One on a live connection may not close it.
      if (link.state === 'connected' && !stopped) log.warn(`[mqtt] ${link.displayId}: connection error: ${link.lastError}`)
    })
    client.on('message', (topic, payload, packet) => onMessage(link, topic, payload, packet.retain))
  }

  for (const link of links) open(link)

  const unsubscribe = bus.on('state.updated', ({ displayId }) => {
    const link = links.find(candidate => candidate.displayId === displayId)
    if (link) publishState(link)
  })
  // A sync changes `last_sync/state` and nothing else, so nothing else would tell the bridge.
  const unsubscribeSync = bus.on('sync.succeeded', () => links.forEach(publishState))
  // A new resolution, or midnight, changes `special_day/state` and nothing else.
  const unsubscribeSpecialDays = bus.on('special_days.updated', () => links.forEach(publishState))
  const recheck = setInterval(() => links.forEach(publishState), RECHECK_MS)
  recheck.unref()

  /** Resolves when `start`'s callback is called, or after `STOP_WAIT_MS`, whichever is first. */
  function within(start: (done: () => void) => void): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, STOP_WAIT_MS)
      start(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  async function close(link: Link): Promise<void> {
    clearTimeout(link.retry)
    link.retry = undefined
    const client = link.client
    link.state = 'disconnected'
    if (!client) return

    try {
      // A clean disconnect doesn't fire the last will, so say it ourselves.
      if (client.connected) await within(done => client.publish(topicFor(link.displayId, AVAILABILITY_TOPIC), OFFLINE, { qos: 1, retain: true }, done))
      // With no connection there is nothing to say goodbye to.
      await within(done => client.end(!client.connected, done))
    } catch (error) {
      log.error(`[mqtt] ${link.displayId}: could not disconnect cleanly: ${describe(error)}`)
    }
    // Whatever is left (a broker that stopped answering) must not keep the process alive.
    client.stream?.destroy()
  }

  return {
    status: () => links.map(({ displayId, state, lastError }) => ({ displayId, state, lastError })),

    republishDiscovery() {
      if (!config.discovery || stopped) return []
      const connected = links.filter(link => link.state === 'connected')
      for (const link of connected) publishDiscovery(link)
      log.info(connected.length > 0
        ? `[mqtt] the discovery configs were published again for ${connected.map(link => link.displayId).join(', ')}, as asked`
        : '[mqtt] asked to publish the discovery configs again, but no display is connected')
      return connected.map(link => link.displayId)
    },

    stop() {
      stopping ??= (async () => {
        // Before anything is awaited, so nothing new is published or retried.
        stopped = true
        unsubscribe()
        unsubscribeSync()
        unsubscribeSpecialDays()
        clearInterval(recheck)
        await Promise.all(links.map(close))
      })()
      return stopping
    },
  }
}
