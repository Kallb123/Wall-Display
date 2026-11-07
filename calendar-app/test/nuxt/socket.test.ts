import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useDisplaySocket } from '~/composables/useDisplaySocket'
import type { SpecialDaysResolution } from '../../shared/special-days'
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

const specialDays: SpecialDaysResolution = {
  today: '2026-10-31',
  from: '2026-09-17',
  to: '2026-11-14',
  tiles: [{ date: '2026-10-31', days: [{ id: 'halloween', name: 'Halloween', palette: 'night', tile_art: 'pumpkin.svg' }] }],
  current: { id: 'halloween', name: 'Halloween' },
  takeover: { id: 'halloween', name: 'Halloween', date: '2026-10-31', greeting: 'Happy Halloween', palette: 'night', full_art: 'wall.webp', extra_art: null, full_art_portrait: null, extra_art_portrait: null },
  tomorrow_art: [],
}

describe('useDisplaySocket special days', () => {
  beforeEach(() => {
    FakeSocket.all = []
    vi.stubGlobal('WebSocket', FakeSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('has not heard any until the server sends them', () => {
    const { socket, scope } = open()

    expect(socket.specialDays.value).toBeUndefined()
    scope.stop()
  })

  it('keeps a resolution, and then a null as the server saying there is none', () => {
    const { socket, scope, fake } = open()

    fake.push({ type: 'special_days.updated', special_days: specialDays })
    expect(socket.specialDays.value).toEqual(specialDays)

    fake.push({ type: 'special_days.updated', special_days: null })
    expect(socket.specialDays.value).toBeNull()
    scope.stop()
  })

  it('fills in tomorrow\'s art for a server that does not send it', () => {
    const { socket, scope, fake } = open()
    const { tomorrow_art: _none, ...older } = specialDays

    fake.push({ type: 'special_days.updated', special_days: older })

    expect(socket.specialDays.value?.tomorrow_art).toEqual([])
    scope.stop()
  })

  it('ignores a payload that is the wrong shape, and keeps the last good one', () => {
    const { socket, scope, fake } = open()
    fake.push({ type: 'special_days.updated', special_days: specialDays })

    fake.push({ type: 'special_days.updated', special_days: { today: 'tomorrow' } })
    fake.push({ type: 'special_days.updated' })
    fake.push({ type: 'special_days.updated', special_days: { ...specialDays, takeover: { ...specialDays.takeover, palette: 'neon' } } })

    expect(socket.specialDays.value).toEqual(specialDays)
    scope.stop()
  })

  it('does not let them touch the state or the weather', () => {
    const { socket, scope, fake } = open()

    fake.push({ type: 'special_days.updated', special_days: specialDays })

    expect(socket.state.value).toBeNull()
    expect(socket.weather.value).toBeUndefined()
    scope.stop()
  })
})

describe('useDisplaySocket next alarm', () => {
  beforeEach(() => {
    FakeSocket.all = []
    vi.stubGlobal('WebSocket', FakeSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('has not heard any until the server sends it', () => {
    const { socket, scope } = open()

    expect(socket.alarm.value).toBeUndefined()
    scope.stop()
  })

  it('keeps an alarm, and then a null as the server saying there is none', () => {
    const { socket, scope, fake } = open()

    fake.push({ type: 'alarm.updated', alarm: '2026-10-29T06:45:00.000Z' })
    expect(socket.alarm.value).toBe('2026-10-29T06:45:00.000Z')

    fake.push({ type: 'alarm.updated', alarm: null })
    expect(socket.alarm.value).toBeNull()
    scope.stop()
  })

  it('takes a time with an offset', () => {
    const { socket, scope, fake } = open()

    fake.push({ type: 'alarm.updated', alarm: '2026-10-29T07:45:00+01:00' })

    expect(socket.alarm.value).toBe('2026-10-29T07:45:00+01:00')
    scope.stop()
  })

  it('ignores a payload that is not a time, and keeps the last good one', () => {
    const { socket, scope, fake } = open()
    fake.push({ type: 'alarm.updated', alarm: '2026-10-29T06:45:00.000Z' })

    fake.push({ type: 'alarm.updated', alarm: 'half past six' })
    fake.push({ type: 'alarm.updated', alarm: 645 })
    fake.push({ type: 'alarm.updated' })

    expect(socket.alarm.value).toBe('2026-10-29T06:45:00.000Z')
    scope.stop()
  })

  it('does not let it touch the state, the weather or the special days', () => {
    const { socket, scope, fake } = open()

    fake.push({ type: 'alarm.updated', alarm: '2026-10-29T06:45:00.000Z' })

    expect(socket.state.value).toBeNull()
    expect(socket.weather.value).toBeUndefined()
    expect(socket.specialDays.value).toBeUndefined()
    scope.stop()
  })
})

describe('useDisplaySocket photo.next and opens', () => {
  beforeEach(() => {
    FakeSocket.all = []
    vi.stubGlobal('WebSocket', FakeSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('counts a photo.next for its own display, and nothing else', () => {
    const { socket, scope, fake } = open()
    expect(socket.photoNext.value).toBe(0)

    fake.push({ type: 'photo.next', display_id: 'hallway' })
    fake.push({ type: 'photo.next', display_id: 'hallway' })
    fake.push({ type: 'photo.next', display_id: 'kitchen' })
    fake.push({ type: 'photo.next' })

    expect(socket.photoNext.value).toBe(2)
    expect(socket.state.value).toBeNull()
    scope.stop()
  })

  it('counts each time the socket opens, a reconnect included', () => {
    const { socket, scope, fake } = open()
    expect(socket.opens.value).toBe(0)

    fake.onopen?.()
    expect(socket.opens.value).toBe(1)

    fake.onopen?.()
    expect(socket.opens.value).toBe(2)
    scope.stop()
  })
})

describe('useDisplaySocket settings', () => {
  const settings = {
    id: 'hallway',
    name: 'Hallway',
    theme: 'dark',
    month_style: 'soft',
    week_start: 'sunday',
    timezone: 'Europe/London',
    burn_in: false,
    orientation: 'auto',
    night_text: 'first_event',
    week_hours: { from: 6, to: 22 },
    day_parts: { afternoon: 11, evening: 18 },
    photo_sources: ['local'],
  }

  beforeEach(() => {
    FakeSocket.all = []
    vi.stubGlobal('WebSocket', FakeSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('has not heard any until the server sends them', () => {
    const { socket, scope } = open()

    expect(socket.settings.value).toBeUndefined()
    scope.stop()
  })

  it('keeps the settings sent for its own display, and the newest after a change', () => {
    const { socket, scope, fake } = open()

    fake.push({ type: 'settings.updated', display_id: 'hallway', settings })
    expect(socket.settings.value).toEqual(settings)

    fake.push({ type: 'settings.updated', display_id: 'hallway', settings: { ...settings, theme: 'light' } })
    expect(socket.settings.value?.theme).toBe('light')
    scope.stop()
  })

  it('ignores another display\'s, and a payload that is the wrong shape', () => {
    const { socket, scope, fake } = open()
    fake.push({ type: 'settings.updated', display_id: 'hallway', settings })

    fake.push({ type: 'settings.updated', display_id: 'kitchen', settings: { ...settings, id: 'kitchen', theme: 'light' } })
    fake.push({ type: 'settings.updated', display_id: 'hallway', settings: { ...settings, theme: 'purple' } })
    fake.push({ type: 'settings.updated', display_id: 'hallway', settings: { ...settings, id: 'kitchen' } })
    fake.push({ type: 'settings.updated', display_id: 'hallway', settings: null })

    expect(socket.settings.value).toEqual(settings)
    scope.stop()
  })

  it('forgets them when the display changes', async () => {
    const id = ref<string | null>('hallway')
    const scope = effectScope()
    const socket = scope.run(() => useDisplaySocket(id))!
    FakeSocket.all.at(-1)!.push({ type: 'settings.updated', display_id: 'hallway', settings })

    id.value = 'kitchen'
    await nextTick()

    expect(socket.settings.value).toBeUndefined()
    scope.stop()
  })
})
