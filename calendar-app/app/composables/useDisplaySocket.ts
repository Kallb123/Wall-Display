import { displayStateSchema } from '../../shared/display'
import type { DisplayState, SocketRole } from '../../shared/display'
import { weatherSnapshotSchema } from '../../shared/weather'
import type { WeatherSnapshot } from '../../shared/weather'
import { reconnectDelay } from '~/utils/backoff'

export type SocketStatus = 'connecting' | 'open' | 'closed'

export interface DisplaySocketOptions {
  /** Who is connecting: the wall (the default) or the phone's remote page. */
  role?: SocketRole
  /** Every time the socket opens, including after a reconnect (events may have changed while it was down). */
  onOpen?: () => void
  /** The server has synced calendars. The page decides whether it cares. */
  onEventsUpdated?: () => void
}

/**
 * A display's socket (`/_ws?display=<id>&role=display`, or `role=remote` for
 * the phone). The server sends the whole state when it connects and again
 * whenever it changes, so `state` is null only until the first message. The
 * weather follows the state, and is `undefined` until it has been heard (a
 * null is the server saying there is none). If
 * the socket closes or errors it is opened again after a growing wait (see
 * `reconnectDelay`), for as long as the scope lives. `displayId` may be null
 * (nothing to connect to yet) and may change.
 */
export function useDisplaySocket(displayId: MaybeRefOrGetter<string | null>, options: DisplaySocketOptions = {}) {
  const status = ref<SocketStatus>('connecting')
  const state = ref<DisplayState | null>(null)
  const weather = ref<WeatherSnapshot | null | undefined>(undefined)

  let socket: WebSocket | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let attempt = 0

  function close() {
    clearTimeout(timer)
    timer = undefined
    if (socket) {
      // Detach first, so closing it on purpose doesn't schedule a reconnect.
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
      socket.close()
      socket = null
    }
  }

  function connect(id: string) {
    status.value = 'connecting'
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    const current = new WebSocket(`${scheme}://${location.host}/_ws?display=${encodeURIComponent(id)}&role=${options.role ?? 'display'}`)
    socket = current

    current.onopen = () => {
      attempt = 0
      status.value = 'open'
      options.onOpen?.()
    }

    current.onmessage = (event) => {
      handleMessage(id, event.data)
    }

    // An error is followed by a close, so only the close reconnects.
    current.onclose = () => {
      if (socket !== current) return
      socket = null
      status.value = 'closed'
      timer = setTimeout(() => connect(id), reconnectDelay(attempt++))
    }
  }

  function handleMessage(id: string, data: unknown) {
    let message: unknown
    try {
      message = JSON.parse(String(data))
    } catch {
      return
    }
    if (typeof message !== 'object' || message === null) return
    const { type, display_id: from, state: next, weather: nextWeather } = message as Record<string, unknown>

    if (type === 'state.updated' && from === id) {
      const parsed = displayStateSchema.safeParse(next)
      if (parsed.success) state.value = parsed.data
    } else if (type === 'events.updated') {
      options.onEventsUpdated?.()
    } else if (type === 'weather.updated') {
      // Not tied to a display: it is the same weather for every wall. A bad one is ignored, so the last good one stays.
      const parsed = weatherSnapshotSchema.nullable().safeParse(nextWeather)
      if (parsed.success) weather.value = parsed.data
    }
    // Anything else (photo.next, for now) is not for this page yet.
  }

  watch(() => toValue(displayId), (id) => {
    close()
    attempt = 0
    state.value = null
    weather.value = undefined
    if (id) connect(id)
    else status.value = 'closed'
  }, { immediate: true })

  onScopeDispose(close)

  return { status, state, weather }
}
