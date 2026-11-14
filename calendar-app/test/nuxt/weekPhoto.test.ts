import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import WeekPhotoView from '~/components/views/WeekPhotoView.vue'
import { fixtureEvents } from '../helpers/fixtureEvents'
import { NO_SPECIAL_DAYS, stageFor } from '~/utils/views'
import type { ViewProps } from '~/utils/views'
import type { WeatherSnapshot } from '../../shared/weather'

// The week and photo hybrid on both stages, with the server pretended as in
// photoView.test.ts. The panes' sizes are tested in
// test/unit/display/views.test.ts; this is that each is drawn in the right box
// and told what it is. The looks are in test/visual.

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

class FakeImage {
  src = ''
  decode() {
    return Promise.resolve()
  }
}

const NOW = new Date('2026-10-28T09:41:00Z')

const weather: WeatherSnapshot = {
  current: { condition: 'rainy', temperature: 12.4 },
  daily: [{ date: '2026-10-28', condition: 'rainy', high: 14, low: 8 }],
  hourly: [],
  temperature_unit: '°C',
  updated_at: NOW.toISOString(),
}

const props = (device: 'portrait' | 'landscape', overrides: Partial<ViewProps> = {}): ViewProps => ({
  view: 'week_photo', stage: stageFor('week_photo', device), events: fixtureEvents(), now: NOW, timezone: 'Europe/London', month: '2026-10', weekOf: '2026-10-28', weekHours: { from: 7, to: 21 }, dayParts: { afternoon: 12, evening: 17 }, weekStart: 'monday', weather, specialDays: NO_SPECIAL_DAYS,
  displayId: 'hallway', photoNext: 0, socketOpens: 0, ...overrides,
})

let requests: { url: string, query: unknown }[]
const mounted: { unmount: () => void }[] = []

async function open(device: 'portrait' | 'landscape', overrides: Partial<ViewProps> = {}) {
  const wrapper = await mountSuspended(WeekPhotoView, { props: props(device, overrides) })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  requests = []
  fetchMock.mockImplementation(async (url: string, options?: { query?: unknown }) => {
    requests.push({ url, query: options?.query })
    return { photo: null }
  })
  vi.stubGlobal('Image', FakeImage)
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('WeekPhotoView on the portrait stage', () => {
  it('stacks a 1440 by 1000 photo pane over the week', async () => {
    const wrapper = await open('portrait')

    expect(wrapper.find('[data-testid="week-photo-view"]').classes()).toContain('portrait')
    expect(wrapper.find('[data-testid="week-photo-photo-pane"]').attributes('style')).toContain('width: 1440px; height: 1000px')
    expect(wrapper.find('[data-testid="week-photo-photo-pane"] [data-testid="photo-view"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="week-photo-week-pane"] [data-testid="week-view"]').exists()).toBe(true)
  })

  it('asks for the landscape rendition', async () => {
    await open('portrait')

    expect(requests).toEqual([{ url: '/api/photos/next', query: { display: 'hallway', orientation: 'landscape', width: expect.any(Number), height: expect.any(Number) } }])
  })
})

describe('WeekPhotoView on the landscape stage', () => {
  it('puts a 1100 by 1440 photo pane left of the week', async () => {
    const wrapper = await open('landscape')

    expect(wrapper.find('[data-testid="week-photo-view"]').classes()).toContain('landscape')
    expect(wrapper.find('[data-testid="week-photo-photo-pane"]').attributes('style')).toContain('width: 1100px; height: 1440px')
  })

  it('asks for the portrait rendition', async () => {
    await open('landscape')

    expect(requests).toEqual([{ url: '/api/photos/next', query: { display: 'hallway', orientation: 'portrait', width: expect.any(Number), height: expect.any(Number) } }])
  })
})

describe.each(['portrait', 'landscape'] as const)('the panes on the %s stage', (device) => {
  it('have the compact pill without the next event, and the narrow week with its short title', async () => {
    const wrapper = await open(device)

    expect(wrapper.find('[data-testid="photo-pill"]').classes()).toContain('compact')
    expect(wrapper.find('[data-testid="photo-clock"]').text()).toBe('09:41')
    expect(wrapper.find('[data-testid="photo-next-event"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="week-view"]').classes()).toContain('portrait')
    expect(wrapper.find('[data-testid="week-title"] .range').text()).toBe('26 Oct – 1 Nov')
    expect(wrapper.find('[data-testid="week-label"]').text()).toBe('This week')
    expect(wrapper.findAll('[data-testid="day-tile"]')).toHaveLength(7)
  })

  it('draw the week\'s forecast, unless the display\'s week preference is off', async () => {
    const on = await open(device)
    expect(on.find('[data-testid="week-photo-week-pane"] [data-testid="day-weather"]').exists()).toBe(true)

    const off = await open(device, { weatherOnDates: { month: true, week: false, week_parts: true, agenda: true } })
    expect(off.find('[data-testid="week-photo-week-pane"] [data-testid="day-weather"]').exists()).toBe(false)
  })

  it('follow the corner the page gives the pill, within the photo pane', async () => {
    const wrapper = await open(device, { photoCorner: 'bottom-right' })

    expect(wrapper.find('[data-testid="week-photo-photo-pane"] [data-testid="photo-pill"]').attributes('data-corner')).toBe('bottom-right')
  })
})
