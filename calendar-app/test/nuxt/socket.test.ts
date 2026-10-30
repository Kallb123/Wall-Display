import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useDisplaySocket } from '~/composables/useDisplaySocket'
import type { WeatherSnapshot } from '../../shared/weather'

// What the socket composable does with the weather messages. The state and
// reconnect behaviour is covered through the pages that use it.

class FakeSocket {
  static all: FakeSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {
    FakeSocket.all.push(this)
  }

  close() {}
  push(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

const weather: WeatherSnapshot = {
  current: { condition: 'rainy', temperature: 12 },
  daily: [{ date: '2026-10-28', condition: 'rainy', high: 14, low: 8 }],
  temperature_unit: '°C',
  updated_at: '2026-10-28T09:00:00.000Z',
}

/** A socket for the hallway display, kept alive in a scope the test stops. */
function open() {
  const scope = effectScope()
  const socket = scope.run(() => useDisplaySocket('hallway'))!
  return { socket, scope, fake: FakeSocket.all.at(-1)! }
}

describe('useDisplaySocket weather', () => {
  beforeEach(() => {
    FakeSocket.all = []
    vi.stubGlobal('WebSocket', FakeSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('has not heard any until the server sends it', () => {
    const { socket, scope } = open()

    expect(socket.weather.value).toBeUndefined()
    scope.stop()
  })

  it('keeps a snapshot, and then a null as the server saying there is none', () => {
    const { socket, scope, fake } = open()

    fake.push({ type: 'weather.updated', weather })
    expect(socket.weather.value).toEqual(weather)

    fake.push({ type: 'weather.updated', weather: null })
    expect(socket.weather.value).toBeNull()
    scope.stop()
  })

  it('ignores a payload that is the wrong shape, and keeps the last good one', () => {
    const { socket, scope, fake } = open()
    fake.push({ type: 'weather.updated', weather })

    fake.push({ type: 'weather.updated', weather: { current: 'sunny' } })
    fake.push({ type: 'weather.updated' })
    fake.push({ type: 'weather.updated', weather: { ...weather, current: { condition: 'hot', temperature: 1 } } })

    expect(socket.weather.value).toEqual(weather)
    scope.stop()
  })

  it('does not let it touch the state', () => {
    const { socket, scope, fake } = open()

    fake.push({ type: 'weather.updated', weather })

    expect(socket.state.value).toBeNull()
    scope.stop()
  })
})
