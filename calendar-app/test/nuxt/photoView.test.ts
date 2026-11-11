import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import PhotoView from '~/components/views/PhotoView.vue'
import { NO_SPECIAL_DAYS } from '~/utils/views'
import type { ViewProps } from '~/utils/views'
import { DEFAULT_PANE_OPTIONS } from '../../shared/layouts'
import type { ResolvedPaneOptions } from '../../shared/layouts'
import type { PhotoInfo } from '../../shared/photos'
import type { CalendarEvent } from '../../shared/types/events'
import type { WeatherSnapshot } from '../../shared/weather'

// The photo frame view with the server pretended: `$fetch` answers
// /api/photos/next from a queue the test controls, and `Image` is a stand-in
// whose decode() the test can hold back. The looks are in test/visual/photo.spec.ts.

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

class FakeImage {
  static all: FakeImage[] = []
  /** Called with each image as decode() starts, to hold it back or fail it. */
  static onDecode: (image: FakeImage) => Promise<void> = () => Promise.resolve()
  src = ''
  constructor() {
    FakeImage.all.push(this)
  }

  decode() {
    return FakeImage.onDecode(this)
  }
}

const NOW = new Date('2026-10-28T09:41:00Z')

const photo = (name: string, changes: Partial<PhotoInfo> = {}): PhotoInfo => ({
  id: `local:${name}.jpg`, url: `/photos/${name.padEnd(64, '0')}.webp`, width: 1280, height: 720, orientation: 'landscape', taken_at: null, provider: 'local', ...changes,
})
const A = photo('a')
const B = photo('b')
const C = photo('c')

const weather: WeatherSnapshot = {
  current: { condition: 'rainy', temperature: 12.4 },
  daily: [{ date: '2026-10-28', condition: 'rainy', high: 14, low: 8 }],
  temperature_unit: '°C',
  updated_at: NOW.toISOString(),
}

function event(changes: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 1, calendar_id: 'family', title: 'Swimming', display_title: 'Swimming', icon: null, location: null,
    start: '2026-10-28T15:30:00Z', end: '2026-10-28T16:30:00Z', all_day: false, start_date: null, end_date: null,
    people: [{ id: 'theo', name: 'Theo', initial: 'T', colour: '#5F94C4' }], ...changes,
  }
}

const props = (overrides: Partial<ViewProps> = {}): ViewProps => ({
  view: 'photo', stage: { width: 2560, height: 1440, orientation: 'landscape' }, events: [], now: NOW, timezone: 'Europe/London', month: '2026-10', weekStart: 'monday', weekOf: '2026-10-28', weekHours: { from: 7, to: 21 }, dayParts: { afternoon: 12, evening: 17 }, weather: null, specialDays: NO_SPECIAL_DAYS,
  displayId: 'hallway', photoNext: 0, socketOpens: 0, ...overrides,
})

/** What /api/photos/next answers, one per request in order; a function answers for itself. */
let answers: (() => unknown | Promise<unknown>)[]
let requests: { url: string, query: unknown }[]

const mounted: { unmount: () => void }[] = []

async function open(overrides: Partial<ViewProps> = {}) {
  const wrapper = await mountSuspended(PhotoView, { props: props(overrides) })
  mounted.push(wrapper)
  await settle()
  const update = async (changes: Partial<ViewProps>) => {
    await wrapper.setProps(props({ ...overrides, ...changes }))
    await settle()
  }
  const layer = (index: 0 | 1) => wrapper.find(`[data-testid="photo-layer-${index}"]`)
  return {
    wrapper,
    update,
    layer,
    /** The layers' urls: what each is showing. */
    srcs: () => [layer(0).attributes('src') ?? null, layer(1).attributes('src') ?? null],
    top: () => [0, 1].filter(i => layer(i as 0 | 1).classes().includes('top')),
    empty: () => wrapper.find('[data-testid="photo-empty"]').exists(),
  }
}

async function settle() {
  await flushPromises()
  await vi.advanceTimersByTimeAsync(0)
  await flushPromises()
}

const fade = async () => {
  await vi.advanceTimersByTimeAsync(1500)
  await flushPromises()
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
  answers = []
  requests = []
  FakeImage.all = []
  FakeImage.onDecode = () => Promise.resolve()
  fetchMock.mockImplementation(async (url: string, options?: { query?: unknown }) => {
    requests.push({ url, query: options?.query })
    const answer = answers.shift()
    if (!answer) throw new Error('no answer queued')
    return answer()
  })
  vi.stubGlobal('Image', FakeImage)
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const gives = (photo: PhotoInfo | null) => () => ({ photo })

describe('fetching photos', () => {
  it('asks for the display\'s next photo when it opens, and shows it after it is decoded', async () => {
    answers = [gives(A)]
    const view = await open()

    expect(requests).toEqual([{ url: '/api/photos/next', query: { display: 'hallway', orientation: 'landscape', width: 2560, height: 1440 } }])
    expect(FakeImage.all.map(image => image.src)).toEqual([A.url])
    expect(view.srcs()).toEqual([A.url, null])
    expect(view.top()).toEqual([0])
    expect(view.empty()).toBe(false)
  })

  it('does not show a photo until its image has been decoded', async () => {
    let finish!: () => void
    FakeImage.onDecode = () => new Promise<void>((resolve) => { finish = resolve })
    answers = [gives(A)]
    const view = await open()

    expect(view.srcs()).toEqual([null, null])
    expect(view.empty()).toBe(true)

    finish()
    await settle()

    expect(view.srcs()).toEqual([A.url, null])
    expect(view.empty()).toBe(false)
  })

  it('asks for nothing without a display id', async () => {
    const view = await open({ displayId: null })

    expect(requests).toEqual([])
    expect(view.empty()).toBe(true)
  })

  it('does not ask for anything again by itself while a photo is showing', async () => {
    answers = [gives(A)]
    await open()

    await vi.advanceTimersByTimeAsync(10 * 60_000)

    expect(requests).toHaveLength(1)
  })

  it('asks for the next photo on every photo.next the socket hears', async () => {
    answers = [gives(A), gives(B), gives(C)]
    const view = await open()

    await view.update({ photoNext: 1 })
    expect(requests).toHaveLength(2)

    await view.update({ photoNext: 2 })
    expect(requests).toHaveLength(3)
  })

  it('leaves it be when the count has not risen', async () => {
    answers = [gives(A), gives(B)]
    const view = await open({ photoNext: 3 })

    await view.update({ photoNext: 3, now: new Date(NOW.getTime() + 1000) })

    expect(requests).toHaveLength(1)
  })
})

describe('the stage\'s orientation', () => {
  const portrait = { width: 1440, height: 2560, orientation: 'portrait' as const }

  it('says which shape of photo it wants', async () => {
    answers = [gives(A)]
    await open({ stage: portrait })

    expect(requests).toEqual([{ url: '/api/photos/next', query: { display: 'hallway', orientation: 'portrait', width: 1440, height: 2560 } }])
  })

  it('asks again at once when the orientation changes, since the photo on show is the wrong shape', async () => {
    answers = [gives(A), gives(B)]
    const view = await open()

    await view.update({ stage: portrait })

    expect(requests.map(request => request.query)).toEqual([
      { display: 'hallway', orientation: 'landscape', width: 2560, height: 1440 },
      { display: 'hallway', orientation: 'portrait', width: 1440, height: 2560 },
    ])
    expect(view.srcs()).toEqual([A.url, B.url])
    expect(view.top()).toEqual([1])
  })

  it('ignores the answer to a question asked for the other orientation', async () => {
    let finish!: () => void
    answers = [() => new Promise((resolve) => { finish = () => resolve({ photo: A }) }), gives(B)]
    const view = await open()

    await view.update({ stage: portrait })
    finish()
    await settle()

    expect(view.srcs()).toEqual([B.url, null])
  })
})

describe('the crossfade', () => {
  it('puts the next photo on the other layer, on top, with the old one solid beneath it', async () => {
    answers = [gives(A), gives(B)]
    const view = await open()

    await view.update({ photoNext: 1 })

    expect(view.srcs()).toEqual([A.url, B.url])
    expect(view.top()).toEqual([1])
    expect(view.layer(0).classes()).toContain('under')
    expect(view.layer(1).classes()).not.toContain('under')
  })

  it('lets go of the old photo once the fade is over', async () => {
    answers = [gives(A), gives(B)]
    const view = await open()
    await view.update({ photoNext: 1 })

    await fade()

    expect(view.srcs()).toEqual([null, B.url])
    expect(view.layer(0).classes()).not.toContain('under')
    expect(view.top()).toEqual([1])
  })

  it('goes back to the first layer for the one after, and so on', async () => {
    answers = [gives(A), gives(B), gives(C)]
    const view = await open()
    await view.update({ photoNext: 1 })
    await fade()

    await view.update({ photoNext: 2 })

    expect(view.srcs()).toEqual([C.url, B.url])
    expect(view.top()).toEqual([0])
    expect(view.layer(1).classes()).toContain('under')
  })

  it('waits for a fade to end before starting the next, so a quick run of skips each fades', async () => {
    answers = [gives(A), gives(B), gives(C)]
    const view = await open()
    await view.update({ photoNext: 1 })
    expect(view.srcs()).toEqual([A.url, B.url])

    // The answer comes mid-fade.
    await vi.advanceTimersByTimeAsync(500)
    await view.update({ photoNext: 2 })
    expect(view.srcs()).toEqual([A.url, B.url])
    expect(view.top()).toEqual([1])

    await fade()
    expect(view.srcs()).toEqual([C.url, B.url])
    expect(view.top()).toEqual([0])
  })

  it('does not fade to the photo it is already showing', async () => {
    answers = [gives(A), gives(A)]
    const view = await open()

    await view.update({ photoNext: 1 })

    expect(requests).toHaveLength(2)
    expect(view.srcs()).toEqual([A.url, null])
    expect(view.top()).toEqual([0])
  })
})

describe('the slow drift', () => {
  /** What a layer's drift is, read from its classes and style: undefined for a still layer. */
  const driftOf = (view: Awaited<ReturnType<typeof open>>, index: 0 | 1) => {
    const layer = view.layer(index)
    const name = layer.classes().find(name => name.startsWith('drift-'))
    const style = (layer.element as HTMLElement).style
    return name === undefined
      ? undefined
      : { name, from: style.getPropertyValue('--drift-from'), to: style.getPropertyValue('--drift-to'), seconds: style.getPropertyValue('--drift-seconds'), state: style.getPropertyValue('animation-play-state') }
  }

  it('has none at all while motion is left out: no class, no style', async () => {
    answers = [gives(A), gives(B)]
    const view = await open()
    await view.update({ photoNext: 1 })

    for (const index of [0, 1] as const) {
      expect(view.layer(index).classes().some(name => name.startsWith('drift'))).toBe(false)
      expect(view.layer(index).attributes('style')).toBeUndefined()
    }
  })

  it('gives a photo shown with motion on a drift, for the interval and the crossfade, running', async () => {
    fetchMock.mockImplementation(async () => ({ photo: A, interval_seconds: 60 }))
    const view = await open({ motion: true })

    expect(driftOf(view, 0)).toEqual({ name: 'drift-a', from: 'scale(1)', to: 'scale(1.04) translate(-1%, -1%)', seconds: '61.5s', state: '' })
    expect(driftOf(view, 1)).toBeUndefined()
  })

  it('falls back to a minute when the server gives no interval', async () => {
    answers = [gives(A)]
    const view = await open({ motion: true })

    expect(driftOf(view, 0)!.seconds).toBe('60s')
  })

  it('gives the next photo a different drift, and the layer beneath keeps its own through the fade', async () => {
    answers = [gives(A), gives(B)]
    const view = await open({ motion: true })
    const first = driftOf(view, 0)

    await view.update({ photoNext: 1 })

    expect(view.layer(0).classes()).toContain('under')
    expect(driftOf(view, 0)).toEqual(first)
    expect(driftOf(view, 1)).toBeDefined()
    expect(driftOf(view, 1)!.from).not.toBe(first!.from)

    await fade()

    expect(view.srcs()).toEqual([null, B.url])
    expect(driftOf(view, 0)).toBeUndefined()
    expect(driftOf(view, 1)).toBeDefined()
  })

  it('restarts a reused layer by giving it the other keyframes', async () => {
    answers = [gives(A), gives(B), gives(C)]
    const view = await open({ motion: true })
    await view.update({ photoNext: 1 })
    await fade()
    await view.update({ photoNext: 2 })

    // The first layer had `a` for the first photo and has `b` for the third.
    expect(driftOf(view, 0)!.name).toBe('drift-b')
    expect(driftOf(view, 1)!.name).toBe('drift-a')
    expect(driftOf(view, 0)!.from).not.toBe(driftOf(view, 1)!.from)
  })

  it('pauses where it is when motion goes off, and carries on when it comes back', async () => {
    answers = [gives(A)]
    const view = await open({ motion: true })
    const running = driftOf(view, 0)!

    await view.update({ motion: false })
    expect(driftOf(view, 0)).toEqual({ ...running, state: 'paused' })

    await view.update({ motion: true })
    expect(driftOf(view, 0)).toEqual(running)
  })

  it('begins from rest when motion comes on with a photo on show that has none', async () => {
    answers = [gives(A), gives(B)]
    const view = await open()
    expect(driftOf(view, 0)).toBeUndefined()

    await view.update({ motion: true })
    expect(driftOf(view, 0)).toBeDefined()

    // And the next photo after it has one of its own.
    await view.update({ motion: true, photoNext: 1 })
    expect(driftOf(view, 1)).toBeDefined()
  })

  it('does not drift a photo shown with motion off, and leaves the pill out of it', async () => {
    answers = [gives(A)]
    const view = await open({ motion: false })

    expect(driftOf(view, 0)).toBeUndefined()
    expect(view.wrapper.find('[data-testid="photo-pill"]').attributes('style')).toBeUndefined()
  })
})

describe('answers that are late, empty or wrong', () => {
  it('ignores a slower answer to an earlier request', async () => {
    let late!: (value: unknown) => void
    answers = [gives(A), () => new Promise(resolve => (late = resolve)), gives(C)]
    const view = await open()

    await view.update({ photoNext: 1 }) // Request 2: slow.
    await view.update({ photoNext: 2 }) // Request 3: quick.
    expect(view.srcs()).toEqual([A.url, C.url])

    late({ photo: B })
    await settle()
    await fade()

    expect(view.srcs()).toEqual([null, C.url])
    expect(FakeImage.all.map(image => image.src)).not.toContain(B.url)
  })

  it('ignores an earlier answer that arrives while a newer request is still out', async () => {
    let slow!: (value: unknown) => void
    let slower!: (value: unknown) => void
    answers = [gives(A), () => new Promise(resolve => (slow = resolve)), () => new Promise(resolve => (slower = resolve))]
    const view = await open()
    await view.update({ photoNext: 1 })
    await view.update({ photoNext: 2 })

    slow({ photo: B })
    await settle()
    expect(view.srcs()).toEqual([A.url, null])

    slower({ photo: C })
    await settle()
    expect(view.srcs()).toEqual([A.url, C.url])
  })

  it('keeps the current photo when the answer is null', async () => {
    answers = [gives(A), gives(null)]
    const view = await open()

    await view.update({ photoNext: 1 })
    await fade()

    expect(view.srcs()).toEqual([A.url, null])
    expect(view.top()).toEqual([0])
    expect(view.empty()).toBe(false)
  })

  it('keeps the current photo when the request fails, or the answer is not a photo response', async () => {
    answers = [gives(A), () => { throw new Error('offline') }, () => ({ photo: { id: 'x' } }), () => ({})]
    const view = await open()

    for (const count of [1, 2, 3]) await view.update({ photoNext: count })

    expect(requests).toHaveLength(4)
    expect(view.srcs()).toEqual([A.url, null])
    expect(view.empty()).toBe(false)
  })

  it('keeps the current photo when the new one can not be decoded', async () => {
    answers = [gives(A), gives(B)]
    const view = await open()
    FakeImage.onDecode = () => Promise.reject(new Error('broken'))

    await view.update({ photoNext: 1 })
    await fade()

    expect(view.srcs()).toEqual([A.url, null])
    expect(view.top()).toEqual([0])
  })
})

describe('with nothing to show', () => {
  it('says so calmly and still has the pill', async () => {
    answers = [gives(null)]
    const view = await open()

    expect(view.empty()).toBe(true)
    expect(view.wrapper.find('[data-testid="photo-empty"]').text()).toBe('No photos yet')
    expect(view.wrapper.find('[data-testid="photo-pill"]').exists()).toBe(true)
    expect(view.wrapper.find('[data-testid="photo-clock"]').text()).toBe('09:41')
  })

  it('tries again after a while, and shows the photo when one comes', async () => {
    answers = [gives(null), () => { throw new Error('offline') }, gives(A)]
    const view = await open()
    expect(requests).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(15_000)
    await settle()
    expect(requests).toHaveLength(2)
    expect(view.empty()).toBe(true)

    await vi.advanceTimersByTimeAsync(15_000)
    await settle()
    expect(requests).toHaveLength(3)
    expect(view.srcs()).toEqual([A.url, null])
    expect(view.empty()).toBe(false)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(requests).toHaveLength(3)
  })

  it('tries again when the socket opens', async () => {
    answers = [() => { throw new Error('offline') }, gives(A)]
    const view = await open()
    expect(view.empty()).toBe(true)

    await view.update({ socketOpens: 1 })

    expect(requests).toHaveLength(2)
    expect(view.srcs()).toEqual([A.url, null])
  })

  it('does not ask again when the socket opens while a photo is showing', async () => {
    answers = [gives(A)]
    const view = await open()

    await view.update({ socketOpens: 1 })

    expect(requests).toHaveLength(1)
  })

  it('does not ask again when the socket opens while a request is already out', async () => {
    answers = [() => new Promise(() => {})]
    const view = await open()

    await view.update({ socketOpens: 1 })

    expect(requests).toHaveLength(1)
  })

  it('stops asking once it is gone', async () => {
    answers = [gives(null)]
    const view = await open()

    view.wrapper.unmount()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(requests).toHaveLength(1)
  })
})

describe('the pill', () => {
  it('is in the top-left corner unless told otherwise', async () => {
    answers = [gives(A)]
    const view = await open()

    const pill = view.wrapper.find('[data-testid="photo-pill"]')
    expect(pill.attributes('data-corner')).toBe('top-left')
    expect(pill.classes()).toContain('corner-top-left')
  })

  it('moves to the corner it is given, and keeps showing the clock there', async () => {
    answers = [gives(A)]
    const view = await open({ photoCorner: 'bottom-right' })
    expect(view.wrapper.find('[data-testid="photo-pill"]').classes()).toContain('corner-bottom-right')

    await view.update({ photoCorner: 'top-right' })

    const pill = view.wrapper.find('[data-testid="photo-pill"]')
    expect(pill.attributes('data-corner')).toBe('top-right')
    expect(pill.classes()).toContain('corner-top-right')
    expect(view.wrapper.findAll('[data-testid="photo-pill"]')).toHaveLength(1)
    expect(pill.find('[data-testid="photo-clock"]').text()).toBe('09:41')
  })

  it('shows the clock in the display\'s zone, in 24 hours', async () => {
    answers = [gives(A)]
    const view = await open({ now: new Date('2026-07-01T13:05:00Z') })

    // British summer time.
    expect(view.wrapper.find('[data-testid="photo-clock"]').text()).toBe('14:05')
  })

  it('shows the weather icon and temperature, and leaves them out with no weather', async () => {
    answers = [gives(A), gives(A)]
    const without = await open()
    expect(without.wrapper.find('[data-testid="photo-weather"]').exists()).toBe(false)

    const withWeather = await open({ weather })
    const line = withWeather.wrapper.find('[data-testid="photo-weather"]')
    expect(line.text()).toBe('12°')
    expect(line.find('svg').classes()).toContain('lucide-cloud-rain-icon')
    expect(line.attributes('title')).toBe('Rain')
  })

  it('leaves out weather that is too old to claim', async () => {
    answers = [gives(A)]
    const view = await open({ weather: { ...weather, updated_at: '2026-10-28T04:00:00.000Z' } })

    expect(view.wrapper.find('[data-testid="photo-weather"]').exists()).toBe(false)
  })

  it('shows just the icon when there is no temperature', async () => {
    answers = [gives(A)]
    const view = await open({ weather: { ...weather, current: { condition: 'sunny', temperature: null } } })

    const line = view.wrapper.find('[data-testid="photo-weather"]')
    expect(line.text()).toBe('')
    expect(line.find('svg').exists()).toBe(true)
  })

  it('shows the next event with its person\'s colour, time and title', async () => {
    answers = [gives(A)]
    const view = await open({ events: [event()] })

    const chip = view.wrapper.find('[data-testid="photo-next-event"]')
    expect(chip.find('[data-testid="photo-next-time"]').text()).toBe('15:30')
    expect(chip.find('[data-testid="photo-next-title"]').text()).toBe('Swimming')
    expect(chip.find('.marker').attributes('style')).toContain('#5F94C4')
  })

  it('says "Tomorrow" for one tomorrow, and "Until" for one that is on', async () => {
    answers = [gives(A), gives(A)]
    const tomorrow = await open({ events: [event({ start: '2026-10-29T08:00:00Z', end: '2026-10-29T09:00:00Z' })] })
    expect(tomorrow.wrapper.find('[data-testid="photo-next-time"]').text()).toBe('Tomorrow 08:00')

    const ongoing = await open({ events: [event({ start: '2026-10-28T09:00:00Z', end: '2026-10-28T10:30:00Z' })] })
    expect(ongoing.wrapper.find('[data-testid="photo-next-time"]').text()).toBe('Until 10:30')
  })

  it('uses a neutral marker for an event with nobody on it', async () => {
    answers = [gives(A)]
    const view = await open({ events: [event({ people: [] })] })

    expect(view.wrapper.find('.marker').attributes('style')).toContain('rgba(255, 255, 255, 0.6)')
  })

  it('leaves the chip out when there is no event to come', async () => {
    answers = [gives(A)]
    const view = await open({ events: [event({ start: '2026-10-28T07:00:00Z', end: '2026-10-28T08:00:00Z' }), event({ id: 2, all_day: true, start_date: '2026-10-28', end_date: '2026-10-29' })] })

    expect(view.wrapper.find('[data-testid="photo-next-event"]').exists()).toBe(false)
    expect(view.wrapper.find('[data-testid="photo-clock"]').exists()).toBe(true)
  })

  it('moves on to the next event as time passes', async () => {
    answers = [gives(A)]
    const events = [event({ id: 1, display_title: 'First', start: '2026-10-28T10:00:00Z', end: '2026-10-28T10:30:00Z' }), event({ id: 2, display_title: 'Second', start: '2026-10-28T12:00:00Z', end: '2026-10-28T13:00:00Z' })]
    const view = await open({ events })
    expect(view.wrapper.find('[data-testid="photo-next-title"]').text()).toBe('First')

    await view.update({ now: new Date('2026-10-28T10:31:00Z') })

    expect(view.wrapper.find('[data-testid="photo-next-title"]').text()).toBe('Second')
    expect(view.wrapper.find('[data-testid="photo-clock"]').text()).toBe('10:31')
  })
})

describe('as a pane of the week and photo view', () => {
  const pane = (overrides: Partial<ViewProps> = {}): Partial<ViewProps> => ({ view: 'week_photo', stage: { width: 1440, height: 1000, orientation: 'landscape' }, pane: true, ...overrides })

  it('asks for the rendition the pane\'s shape wants', async () => {
    answers = [gives(A), gives(B)]
    const view = await open(pane())
    expect(requests.map(request => request.query)).toEqual([{ display: 'hallway', orientation: 'landscape', width: 1440, height: 1000 }])

    await view.update(pane({ stage: { width: 1100, height: 1440, orientation: 'portrait' } }))
    expect(requests.map(request => request.query).at(-1)).toEqual({ display: 'hallway', orientation: 'portrait', width: 1100, height: 1440 })
  })

  it('has the compact pill, and leaves the next event to the week', async () => {
    answers = [gives(A)]
    const view = await open(pane({ events: [event()], weather }))

    expect(view.wrapper.find('[data-testid="photo-pill"]').classes()).toContain('compact')
    expect(view.wrapper.find('[data-testid="photo-clock"]').text()).toBe('09:41')
    expect(view.wrapper.find('[data-testid="photo-weather"]').exists()).toBe(true)
    expect(view.wrapper.find('[data-testid="photo-next-event"]').exists()).toBe(false)
  })

  it('has the ordinary pill when it is not a pane', async () => {
    answers = [gives(A)]
    const view = await open({ events: [event()] })

    expect(view.wrapper.find('[data-testid="photo-pill"]').classes()).not.toContain('compact')
    expect(view.wrapper.find('[data-testid="photo-next-event"]').exists()).toBe(true)
  })
})

describe('the overlays a layout chooses', () => {
  const overlays = (options: Partial<ResolvedPaneOptions>, overrides: Partial<ViewProps> = {}): Partial<ViewProps> => ({
    pane: true, weather, paneOptions: { ...DEFAULT_PANE_OPTIONS, ...options }, ...overrides,
  })
  const pills = (view: Awaited<ReturnType<typeof open>>) => view.wrapper.findAll('[data-testid="photo-pill"]')

  it('shows the time and the weather and no date by default', async () => {
    answers = [gives(A)]
    const view = await open(overlays({}))

    expect(pills(view)).toHaveLength(1)
    expect(view.wrapper.find('[data-testid="photo-clock"]').exists()).toBe(true)
    expect(view.wrapper.find('[data-testid="photo-weather"]').exists()).toBe(true)
    expect(view.wrapper.find('[data-testid="photo-date"]').exists()).toBe(false)
  })

  it('shows the date in the display\'s zone, in the time\'s pill when they share a corner', async () => {
    answers = [gives(A)]
    const view = await open(overlays({ show_date: true }, { photoCorner: 'top-right' }))

    expect(pills(view)).toHaveLength(1)
    const pill = pills(view)[0]!
    expect(pill.attributes('data-corner')).toBe('top-right')
    expect(pill.find('[data-testid="photo-clock"]').exists()).toBe(true)
    expect(pill.find('[data-testid="photo-date"]').text()).toBe('Wednesday 28 October')
  })

  it('puts the time and the date in pills of their own in the corners chosen', async () => {
    answers = [gives(A)]
    const view = await open(overlays({ show_date: true, time_corner: 'bottom-left', date_corner: 'top-right' }, { photoCorner: 'top-left' }))

    expect(pills(view).map(pill => pill.attributes('data-corner'))).toEqual(['top-right', 'bottom-left'])
    expect(pills(view)[0]!.find('[data-testid="photo-date"]').exists()).toBe(true)
    expect(pills(view)[0]!.find('[data-testid="photo-clock"]').exists()).toBe(false)
    expect(pills(view)[1]!.find('[data-testid="photo-clock"]').exists()).toBe(true)
    expect(pills(view)[1]!.find('[data-testid="photo-weather"]').exists()).toBe(true)
  })

  it('keeps a chosen corner still while the walking one moves', async () => {
    answers = [gives(A)]
    const view = await open(overlays({ show_date: true, date_corner: 'bottom-left' }, { photoCorner: 'top-left' }))
    await view.update(overlays({ show_date: true, date_corner: 'bottom-left' }, { photoCorner: 'top-right' }))

    expect(pills(view).map(pill => pill.attributes('data-corner'))).toEqual(['top-right', 'bottom-left'])
  })

  it('takes a chosen bottom corner to the top on its side while the overlay banner shows', async () => {
    answers = [gives(A)]
    const view = await open(overlays({ time_corner: 'bottom-right' }, { overlayShowing: true }))

    expect(pills(view).map(pill => pill.attributes('data-corner'))).toEqual(['top-right'])
  })

  it('leaves the weather off when asked, and the time when asked', async () => {
    answers = [gives(A), gives(A)]
    const noWeather = await open(overlays({ show_weather: false }))
    expect(noWeather.wrapper.find('[data-testid="photo-clock"]').exists()).toBe(true)
    expect(noWeather.wrapper.find('[data-testid="photo-weather"]').exists()).toBe(false)

    const weatherOnly = await open(overlays({ show_time: false }))
    expect(pills(weatherOnly)).toHaveLength(1)
    expect(weatherOnly.wrapper.find('[data-testid="photo-clock"]').exists()).toBe(false)
    expect(weatherOnly.wrapper.find('[data-testid="photo-weather"]').exists()).toBe(true)
  })

  it('draws no pill with the time off and no weather to show, or with everything off', async () => {
    answers = [gives(A), gives(A)]
    const noData = await open(overlays({ show_time: false }, { weather: null }))
    expect(pills(noData)).toHaveLength(0)

    const allOff = await open(overlays({ show_time: false, show_weather: false, show_date: false }))
    expect(pills(allOff)).toHaveLength(0)
  })

  it('shows the next event under the clock on a full-screen frame, and not without the clock', async () => {
    answers = [gives(A), gives(A)]
    const withClock = await open(overlays({ show_date: true, date_corner: 'bottom-left' }, { pane: false, events: [event()] }))
    const clockPill = withClock.wrapper.find('[data-corner="top-left"]')
    expect(clockPill.find('[data-testid="photo-next-event"]').exists()).toBe(true)
    expect(withClock.wrapper.find('[data-corner="bottom-left"] [data-testid="photo-next-event"]').exists()).toBe(false)

    const noClock = await open(overlays({ show_time: false }, { pane: false, events: [event()] }))
    expect(noClock.wrapper.find('[data-testid="photo-next-event"]').exists()).toBe(false)
  })
})

describe('the box the photo is drawn in', () => {
  const pane = { width: 1000, height: 1440, orientation: 'portrait' as const }

  it('sends the size of its own box, a pane\'s and not the stage\'s', async () => {
    answers = [gives(A)]
    await open({ stage: { width: 1920, height: 1080, orientation: 'landscape' } })

    expect(requests.map(request => request.query)).toEqual([{ display: 'hallway', orientation: 'landscape', width: 1920, height: 1080 }])
  })

  it('asks again when a new size turns the photo on show from not close to close', async () => {
    // 4:3 photo: not close to a 2:1 pane of 2000 x 1000? 2.0/1.333 = 1.5, so far; a 16:9 pane is close.
    const fourThree = photo('d', { width: 4032, height: 3024 })
    answers = [gives(fourThree), gives(B)]
    const view = await open({ stage: { width: 2000, height: 1000, orientation: 'landscape' } })

    await view.update({ stage: { width: 1920, height: 1080, orientation: 'landscape' } })

    expect(requests.map(request => request.query)).toEqual([
      { display: 'hallway', orientation: 'landscape', width: 2000, height: 1000 },
      { display: 'hallway', orientation: 'landscape', width: 1920, height: 1080 },
    ])
  })

  it('does not ask again for a new size that leaves the verdict as it was', async () => {
    answers = [gives(photo('d', { width: 4032, height: 3024 })), gives(B)]
    const view = await open({ stage: { width: 1920, height: 1080, orientation: 'landscape' } })

    await view.update({ stage: { width: 1600, height: 1000, orientation: 'landscape' } })

    expect(requests).toHaveLength(1)
  })

  it('checks the answer to a question in flight against the size the box has become', async () => {
    let finish!: () => void
    const fourThree = photo('d', { width: 4032, height: 3024 })
    answers = [() => new Promise((resolve) => { finish = () => resolve({ photo: fourThree }) }), gives(B)]
    const view = await open({ stage: { width: 2000, height: 1000, orientation: 'landscape' } })

    // Resized, with nothing on show yet and the first question still unanswered.
    await view.update({ stage: { width: 1920, height: 1080, orientation: 'landscape' } })
    finish()
    await settle()

    expect(requests.map(request => request.query)).toEqual([
      { display: 'hallway', orientation: 'landscape', width: 2000, height: 1000 },
      { display: 'hallway', orientation: 'landscape', width: 1920, height: 1080 },
    ])
  })

  it('asks for a box of at least one pixel, whatever the stage says', async () => {
    answers = [gives(A)]
    await open({ stage: { width: 0, height: 0, orientation: 'landscape' } })

    expect(requests.map(request => request.query)).toEqual([{ display: 'hallway', orientation: 'landscape', width: 1, height: 1 }])
  })

  it('keeps a pane\'s size apart from the stage\'s', async () => {
    answers = [gives(A)]
    await open({ stage: pane })

    expect(requests.map(request => request.query)).toEqual([{ display: 'hallway', orientation: 'portrait', width: 1000, height: 1440 }])
  })
})

describe('the next event\'s calendar icon', () => {
  it('goes before the title in the chip, and an event without one stays bare', async () => {
    answers = [gives(A)]
    const view = await open({ events: [event({ display_title: 'Dinner', icon: '🍽️' })] })
    expect(view.wrapper.find('[data-testid="photo-next-title"]').text()).toBe('🍽️ Dinner')

    await view.update({ events: [event({ display_title: 'Dinner', icon: null })] })

    expect(view.wrapper.find('[data-testid="photo-next-title"]').text()).toBe('Dinner')
  })
})
