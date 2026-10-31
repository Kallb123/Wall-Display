import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import PhotoView from '~/components/views/PhotoView.vue'
import { NO_SPECIAL_DAYS } from '~/utils/views'
import type { ViewProps } from '~/utils/views'
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
    id: 1, calendar_id: 'family', title: 'Swimming', display_title: 'Swimming', location: null,
    start: '2026-10-28T15:30:00Z', end: '2026-10-28T16:30:00Z', all_day: false, start_date: null, end_date: null,
    people: [{ id: 'theo', name: 'Theo', initial: 'T', colour: '#5F94C4' }], ...changes,
  }
}

const props = (overrides: Partial<ViewProps> = {}): ViewProps => ({
  view: 'photo', events: [], now: NOW, timezone: 'Europe/London', month: '2026-10', weekStart: 'monday', weather: null, specialDays: NO_SPECIAL_DAYS,
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

    expect(requests).toEqual([{ url: '/api/photos/next', query: { display: 'hallway' } }])
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
