import type { WallTimer } from '../../shared/display'
import type { TimerEntityConfig } from '../config/schema'
import { safeErrorMessage } from '../sources/errors'
import { MAX_JITTER_MS, retryDelayMs } from '../sources/scheduler'
import { parseTimerEntity } from './parse'

// Keeps the kitchen timers up to date and works out what each display shows. It
// reads every configured entity in two ways: by polling (the same shape as the
// alarm service: a first poll soon after start, backing off while Home
// Assistant fails, one fetch at a time, the last good answer kept) and from
// states pushed in by the WebSocket (see the plugin), which are applied at once.
// A timer is an instant, so a display counts down on its own and nothing is
// sent each second: only a change in the list is. What a fetch does is
// injected, so this file holds no network code and a test drives it with fake
// timers.
//
// A timer that ends does not simply vanish. The source drops a timer as soon as
// it is over, so a running timer that disappears at (or just before) its end is
// kept for a while as `done`, which lets the wall say so. One that disappears
// well before its end was cancelled, and one that was ringing was dismissed:
// both go at once.

export interface TimersServiceOptions {
  /** The entities to read, in the config's order. */
  entities: readonly Pick<TimerEntityConfig, 'entity_id' | 'displays'>[]
  /** The ids of the displays in the config: where an entity with no `displays` shows. */
  displayIds: readonly string[]
  /** Fetches one entity's state object, unread (see parse.ts). May throw: the service backs off and tries again. */
  load: (entityId: string) => Promise<unknown>
  /** The time between polls of each entity, in milliseconds. */
  intervalMs: number
  /** How long a timer that ran out stays as `done`, in milliseconds. Zero keeps none. */
  doneMs: number
  /** Called with a display's timers when they changed, and the first time anything has been read for it, even if there are none. */
  onChange: (displayId: string, timers: WallTimer[]) => void
  /** For tests. Default: `Date.now`. */
  now?: () => number
  /** For tests. Default: `Math.random`. */
  random?: () => number
  /** For tests. Default: the console. */
  log?: Pick<Console, 'info' | 'warn' | 'error'>
}

/** How one entity's polls went. Neither field holds a URL or a token. */
export interface TimersEntityStatus {
  entity_id: string
  last_success_at: string | null
  last_error: string | null
}

/** How the last polls went, for anything that wants to say so. */
export interface TimersStatus {
  /** The most recent time any entity was read (polled or pushed), as an ISO 8601 instant, or null if none has been. */
  last_success_at: string | null
  /** The safe message of the first entity whose last poll failed, otherwise null. */
  last_error: string | null
  entities: TimersEntityStatus[]
}

export interface TimersService {
  /** Schedules the first poll of each entity, a little apart. */
  start: () => void
  /** Cancels everything that is waiting and ignores whatever is still in flight. */
  stop: () => void
  /** A display's timers now, in the order it shows them. Empty before anything has been read. */
  get: (displayId: string) => WallTimer[]
  /** A state from the WebSocket, applied at once: the entity's state object, or null for an entity that was removed. Entities that are not ours are ignored. */
  push: (entityId: string, state: unknown) => void
  status: () => TimersStatus
  /** Polls every entity now. Never rejects. An entity with a poll in flight is waited for rather than asked again. */
  refresh: () => Promise<void>
}

/** A timer that disappears this close before its end, or later, reached its end. A source may drop it a moment early, and the clocks of Home Assistant and this server differ a little. */
const REACHED_END_SLACK_MS = 3000

interface Tracked {
  entityId: string
  displays: readonly string[]
  /** What the entity says now (the last good answer). */
  timers: WallTimer[]
  /** Timers that reached their end and are being kept for a while, by id, with the timeout that drops each. */
  done: Map<string, { timer: WallTimer, timeout: ReturnType<typeof setTimeout> }>
  /** Whether anything has been read for the entity. */
  loaded: boolean
  /** Goes up with each pushed state, so a poll that started before one doesn't undo it. */
  version: number
  failures: number
  /** The failure last logged, so the same one is not logged at every poll. */
  loggedError: string | null
  lastError: string | null
  lastSuccessAt: string | null
  /** Whether the entity's odd shape was logged. */
  loggedShape: boolean
  timer: ReturnType<typeof setTimeout> | undefined
  running: Promise<void> | undefined
}

/** Ringing, then done, then running by when they end, then paused by time left. */
function byUrgency(a: WallTimer, b: WallTimer): number {
  const rank = (timer: WallTimer) => ({ ringing: 0, done: 1, running: 2, paused: 3 })[timer.status]
  if (rank(a) !== rank(b)) return rank(a) - rank(b)
  if (a.status === 'paused') return (a.remaining_seconds ?? 0) - (b.remaining_seconds ?? 0) || a.id.localeCompare(b.id)
  const aEnds = a.ends_at === null ? Infinity : Date.parse(a.ends_at)
  const bEnds = b.ends_at === null ? Infinity : Date.parse(b.ends_at)
  return (aEnds === bEnds ? 0 : aEnds < bEnds ? -1 : 1) || a.id.localeCompare(b.id)
}

export function createTimersService(options: TimersServiceOptions): TimersService {
  const { load, intervalMs, doneMs, onChange, now = Date.now, random = Math.random, log = console } = options
  let started = false
  let stopped = false

  const tracked: Tracked[] = options.entities.map(entity => ({
    entityId: entity.entity_id,
    displays: entity.displays ?? options.displayIds,
    timers: [],
    done: new Map(),
    loaded: false,
    version: 0,
    failures: 0,
    loggedError: null,
    lastError: null,
    lastSuccessAt: null,
    loggedShape: false,
    timer: undefined,
    running: undefined,
  }))
  const byEntity = new Map(tracked.map(entity => [entity.entityId, entity]))

  /** What each display was last sent, as JSON to compare by value. A display that is not here has been sent nothing. */
  const sent = new Map<string, string>()

  function timersFor(displayId: string): WallTimer[] {
    const list: WallTimer[] = []
    for (const entity of tracked) {
      if (!entity.displays.includes(displayId)) continue
      list.push(...entity.timers, ...[...entity.done.values()].map(held => held.timer))
    }
    return list.sort(byUrgency)
  }

  /** Tells the app about each display whose timers changed, and about each that has just got its first answer. */
  function publish(): void {
    if (stopped) return
    for (const displayId of options.displayIds) {
      const timers = timersFor(displayId)
      const json = JSON.stringify(timers)
      const before = sent.get(displayId)
      // The first answer for a display is sent even if it is no timers; after that only a change is.
      const answered = tracked.some(entity => entity.loaded && entity.displays.includes(displayId))
      if (before === undefined ? !answered : before === json) continue
      sent.set(displayId, json)
      try {
        onChange(displayId, timers)
      } catch (error) {
        log.error(`[timers] telling the app about the change failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  /** Takes what an entity says now: keeps the running timers that just ended as done, and drops the rest that are gone. */
  function apply(entity: Tracked, raw: unknown): void {
    const { timers, shape } = parseTimerEntity(entity.entityId, raw)
    if (shape === 'unknown' && !entity.loggedShape) {
      entity.loggedShape = true
      log.warn(`[timers] ${entity.entityId} is neither a timer helper nor has a "timers" attribute, so it shows no timers`)
    }
    const at = now()
    const present = new Set(timers.map(timer => timer.id))
    // A timer that is back (a helper started again) is no longer done.
    for (const [id, held] of entity.done) {
      if (!present.has(id)) continue
      clearTimeout(held.timeout)
      entity.done.delete(id)
    }
    for (const gone of entity.timers) {
      if (gone.status !== 'running' || gone.ends_at === null || present.has(gone.id)) continue
      const endsAt = Date.parse(gone.ends_at)
      const until = endsAt + doneMs
      if (doneMs <= 0 || at < endsAt - REACHED_END_SLACK_MS || at >= until) continue
      const timeout = setTimeout(() => {
        entity.done.delete(gone.id)
        publish()
      }, until - at)
      entity.done.set(gone.id, { timer: { ...gone, status: 'done', remaining_seconds: null }, timeout })
    }
    entity.timers = timers
    entity.loaded = true
    entity.lastSuccessAt = new Date(at).toISOString()
  }

  function schedule(entity: Tracked, delayMs: number): void {
    clearTimeout(entity.timer)
    // A refresh before start() fetches once and leaves the timing to start().
    if (stopped || !started) return
    entity.timer = setTimeout(() => {
      entity.timer = undefined
      void run(entity)
    }, delayMs)
  }

  function run(entity: Tracked): Promise<void> {
    const current = poll(entity).finally(() => {
      if (entity.running === current) entity.running = undefined
    })
    entity.running = current
    return current
  }

  /** One fetch of one entity, and its next one scheduled. Never rejects: a failing Home Assistant must not take the server down. */
  async function poll(entity: Tracked): Promise<void> {
    // A forced poll takes the place of the one that was waiting.
    clearTimeout(entity.timer)
    entity.timer = undefined
    const version = entity.version

    let raw: unknown
    try {
      raw = await load(entity.entityId)
    } catch (error) {
      const message = safeErrorMessage(error)
      if (stopped) return
      entity.failures++
      entity.lastError = message
      const delay = retryDelayMs(intervalMs, entity.failures)
      // The last good timers stay as they were. Only the safe message is logged: the URL is a secret.
      if (message !== entity.loggedError) {
        entity.loggedError = message
        log.warn(`[timers] ${entity.entityId}: ${message}; the last good timers are kept, trying again in ${Math.round(delay / 1000)} s`)
      }
      schedule(entity, delay)
      return
    }
    // After stop() the app may be shutting down. Say nothing, do nothing.
    if (stopped) return

    if (entity.loggedError !== null) log.info(`[timers] ${entity.entityId}: working again after ${entity.failures} failed ${entity.failures === 1 ? 'attempt' : 'attempts'}`)
    entity.failures = 0
    entity.lastError = null
    entity.loggedError = null
    schedule(entity, intervalMs)

    // A state pushed while this was in flight is newer than the answer, which is dropped.
    if (entity.version === version) apply(entity, raw)
    publish()
  }

  return {
    start() {
      if (started || stopped) return
      started = true
      for (const entity of tracked) schedule(entity, random() * Math.min(MAX_JITTER_MS, intervalMs))
    },

    stop() {
      stopped = true
      for (const entity of tracked) {
        clearTimeout(entity.timer)
        entity.timer = undefined
        for (const held of entity.done.values()) clearTimeout(held.timeout)
      }
    },

    get: displayId => timersFor(displayId),

    push(entityId, state) {
      const entity = byEntity.get(entityId)
      if (!entity || stopped) return
      entity.version++
      apply(entity, state)
      publish()
    },

    status() {
      const successes = tracked.map(entity => entity.lastSuccessAt).filter((at): at is string => at !== null).sort()
      return {
        last_success_at: successes.at(-1) ?? null,
        last_error: tracked.find(entity => entity.lastError !== null)?.lastError ?? null,
        entities: tracked.map(entity => ({ entity_id: entity.entityId, last_success_at: entity.lastSuccessAt, last_error: entity.lastError })),
      }
    },

    async refresh() {
      if (stopped) return
      await Promise.all(tracked.map(entity => entity.running ?? run(entity)))
    },
  }
}
