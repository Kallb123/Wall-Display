import type { HomeAssistantConfig } from '../config/schema'

// A connection to Home Assistant's WebSocket API (`/api/websocket`) that
// subscribes to triggers and says when one fires. Home Assistant does the
// matching (`subscribe_trigger` takes a trigger written as in an automation), so
// nothing but the triggers we asked for comes down the socket. It logs in with
// the long-lived access token from the `homeassistant` block, pings to notice a
// connection that has died quietly, and connects again after a failure, waiting
// longer each time. No message it logs or keeps holds the URL or the token.
// The socket is made by an injected factory, so a test drives it with a fake.

/** The part of a WebSocket this uses: the browser's (and Node's) `WebSocket` has it. */
export interface HaSocket {
  send: (data: string) => void
  close: () => void
  addEventListener: ((type: 'open' | 'close' | 'error', listener: () => void) => void)
    & ((type: 'message', listener: (event: { data: unknown }) => void) => void)
}

/** One trigger to subscribe to: our id for it, and the trigger as Home Assistant reads it. */
export interface HaTriggerSubscription {
  id: string
  trigger: Record<string, unknown>
}

export type HaSocketState = 'connecting' | 'connected' | 'disconnected' | 'stopped'

export interface HaTriggerSocketOptions {
  homeassistant: Pick<HomeAssistantConfig, 'url' | 'token'>
  subscriptions: readonly HaTriggerSubscription[]
  /** Called with the subscription's id and the trigger's variables (`variables.trigger` describes what happened) each time one fires. */
  onTrigger: (id: string, variables: unknown) => void
  /** For tests. Default: the global `WebSocket`. */
  connect?: (url: string) => HaSocket
  /** How often to ping a connection that is up. Default 30 s. */
  pingIntervalMs?: number
  /** How long to wait for a pong, or for the login to finish, before giving up on the connection. Default 10 s. */
  replyTimeoutMs?: number
  /** The first wait before connecting again. It doubles with each failure in a row. Default 2 s. */
  retryMs?: number
  /** The longest wait before connecting again. Default 5 minutes. */
  maxRetryMs?: number
  /** For tests. Default: the console. */
  log?: Pick<Console, 'info' | 'warn' | 'error'>
}

export interface HaTriggerSocket {
  /** Connects, and keeps connecting until `stop`. */
  start: () => void
  /** Closes the connection and cancels every timer. Nothing fires after it. */
  stop: () => void
  /** Where the connection is, and the last thing that went wrong (a safe message), if anything has. */
  status: () => { state: HaSocketState, last_error: string | null }
}

const DEFAULT_PING_INTERVAL_MS = 30_000
const DEFAULT_REPLY_TIMEOUT_MS = 10_000
const DEFAULT_RETRY_MS = 2_000
const DEFAULT_MAX_RETRY_MS = 5 * 60_000

/** `ws://<host>/api/websocket` for `http://<host>`, `wss://` for `https://`, keeping a path the base has of its own. Null for a URL that isn't one. */
export function websocketUrl(base: string): string | null {
  let url: URL
  try {
    url = new URL(base)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/api/websocket`
  url.search = ''
  url.hash = ''
  return url.href
}

/** A message from Home Assistant, as far as this reads it. */
interface HaMessage {
  type?: unknown
  id?: unknown
  success?: unknown
  error?: { message?: unknown }
  event?: { variables?: unknown }
}

export function createHaTriggerSocket(options: HaTriggerSocketOptions): HaTriggerSocket {
  const {
    homeassistant,
    subscriptions,
    onTrigger,
    connect = (url: string) => new WebSocket(url) as unknown as HaSocket,
    pingIntervalMs = DEFAULT_PING_INTERVAL_MS,
    replyTimeoutMs = DEFAULT_REPLY_TIMEOUT_MS,
    retryMs = DEFAULT_RETRY_MS,
    maxRetryMs = DEFAULT_MAX_RETRY_MS,
    log = console,
  } = options

  let state: HaSocketState = 'disconnected'
  let lastError: string | null = null
  /** The error last logged, so a Home Assistant that stays down is logged once and not at every attempt. */
  let loggedError: string | null = null
  let failures = 0
  let started = false
  let stopped = false

  let socket: HaSocket | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let pingTimer: ReturnType<typeof setInterval> | undefined
  let replyTimer: ReturnType<typeof setTimeout> | undefined

  /** Message ids are per connection and must go up. */
  let nextId = 1
  /** Our subscription id for each `subscribe_trigger` message id on this connection. */
  let pending = new Map<number, string>()
  let subscribed = new Map<number, string>()
  /** Whether the login was refused: trying again at once is no use, so the wait is the longest. */
  let refused = false

  function fail(message: string, delayMs: number): void {
    lastError = message
    if (message !== loggedError) {
      loggedError = message
      log.warn(`[triggers] ${message}; trying again in ${Math.round(delayMs / 1000)} s`)
    }
  }

  function clearTimers(): void {
    clearInterval(pingTimer)
    pingTimer = undefined
    clearTimeout(replyTimer)
    replyTimer = undefined
  }

  /** Drops the connection, if there is one, and plans the next. */
  function drop(message: string): void {
    const current = socket
    socket = undefined
    clearTimers()
    if (current) {
      try {
        current.close()
      } catch {
        // Already closed.
      }
    }
    if (stopped) return
    state = 'disconnected'
    failures++
    const delay = refused ? maxRetryMs : Math.min(retryMs * 2 ** (failures - 1), maxRetryMs)
    refused = false
    fail(message, delay)
    clearTimeout(retryTimer)
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      open()
    }, delay)
  }

  /** Gives up on the connection unless something arrives in time. */
  function expectReply(what: string): void {
    clearTimeout(replyTimer)
    replyTimer = setTimeout(() => {
      replyTimer = undefined
      drop(`Home Assistant did not answer ${what} in ${Math.round(replyTimeoutMs / 1000)} s`)
    }, replyTimeoutMs)
  }

  function send(message: Record<string, unknown>): void {
    try {
      socket?.send(JSON.stringify(message))
    } catch {
      drop('the connection to Home Assistant broke')
    }
  }

  function open(): void {
    if (stopped) return
    const url = websocketUrl(homeassistant.url)
    if (url === null) {
      // The config schema checks the URL, so this is a mistake, and trying again won't mend it.
      state = 'disconnected'
      lastError = 'the Home Assistant URL is not valid'
      log.error(`[triggers] ${lastError}`)
      return
    }
    state = 'connecting'
    nextId = 1
    pending = new Map()
    subscribed = new Map()
    let current: HaSocket
    try {
      current = connect(url)
    } catch {
      // Not the error's message, which can quote the address.
      socket = undefined
      drop('could not connect to Home Assistant')
      return
    }
    socket = current
    const mine = (handler: () => void) => () => {
      if (socket === current) handler()
    }
    current.addEventListener('message', (event) => {
      if (socket === current) receive(event.data)
    })
    current.addEventListener('close', mine(() => drop(state === 'connected' ? 'the connection to Home Assistant closed' : 'could not connect to Home Assistant')))
    current.addEventListener('error', mine(() => drop(state === 'connected' ? 'the connection to Home Assistant broke' : 'could not connect to Home Assistant')))
    expectReply('the connection')
  }

  function receive(data: unknown): void {
    if (typeof data !== 'string') return
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      return
    }
    // Home Assistant may send several messages as one array.
    for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
      if (typeof message === 'object' && message !== null) handle(message as HaMessage)
      if (!socket) return
    }
  }

  function handle(message: HaMessage): void {
    switch (message.type) {
      case 'auth_required':
        send({ type: 'auth', access_token: homeassistant.token })
        expectReply('the login')
        return
      case 'auth_invalid':
        refused = true
        drop('Home Assistant refused the access token')
        return
      case 'auth_ok':
        loggedIn()
        return
      case 'pong':
        clearTimeout(replyTimer)
        replyTimer = undefined
        return
      case 'result':
        result(message)
        return
      case 'event': {
        const id = typeof message.id === 'number' ? subscribed.get(message.id) : undefined
        if (id === undefined) return
        try {
          onTrigger(id, message.event?.variables)
        } catch (error) {
          log.error(`[triggers] acting on "${id}" failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
  }

  function loggedIn(): void {
    clearTimeout(replyTimer)
    replyTimer = undefined
    state = 'connected'
    if (loggedError !== null) log.info(`[triggers] connected to Home Assistant again after ${failures} failed ${failures === 1 ? 'attempt' : 'attempts'}`)
    else log.info(`[triggers] connected to Home Assistant, listening for ${subscriptions.length} ${subscriptions.length === 1 ? 'trigger' : 'triggers'}`)
    failures = 0
    loggedError = null
    lastError = null
    for (const subscription of subscriptions) {
      const id = nextId++
      pending.set(id, subscription.id)
      send({ id, type: 'subscribe_trigger', trigger: subscription.trigger })
    }
    pingTimer = setInterval(() => {
      send({ id: nextId++, type: 'ping' })
      expectReply('a ping')
    }, pingIntervalMs)
  }

  function result(message: HaMessage): void {
    if (typeof message.id !== 'number') return
    const id = pending.get(message.id)
    if (id === undefined) return
    pending.delete(message.id)
    if (message.success === true) {
      subscribed.set(message.id, id)
      return
    }
    // Home Assistant's own words, such as "Unauthorized" for a user who isn't an administrator. They hold neither the URL nor the token.
    const reason = typeof message.error?.message === 'string' ? message.error.message.slice(0, 200) : 'no reason given'
    lastError = `Home Assistant refused trigger "${id}": ${reason}`
    log.warn(`[triggers] ${lastError}`)
  }

  return {
    start() {
      if (started || stopped) return
      started = true
      open()
    },
    stop() {
      stopped = true
      state = 'stopped'
      clearTimeout(retryTimer)
      retryTimer = undefined
      clearTimers()
      const current = socket
      socket = undefined
      try {
        current?.close()
      } catch {
        // Already closed.
      }
    },
    status: () => ({ state, last_error: lastError }),
  }
}
