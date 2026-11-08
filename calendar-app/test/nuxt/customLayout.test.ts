import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import CustomLayoutView from '~/components/views/CustomLayoutView.vue'
import { fixtureEvents } from '../helpers/fixtureEvents'
import AgendaView from '~/components/views/AgendaView.vue'
import PhotoView from '~/components/views/PhotoView.vue'
import WeekView from '~/components/views/WeekView.vue'
import { NO_SPECIAL_DAYS, stageFor } from '~/utils/views'
import type { ViewProps } from '~/utils/views'
import { DEFAULT_PANE_OPTIONS } from '../../shared/layouts'
import type { CustomLayout } from '../../shared/layouts'

// A custom layout on both stages, with the server pretended as in
// photoView.test.ts. The panes' geometry and the fitting are tested in
// test/unit/display/layouts.test.ts; this is that each pane gets the right
// existing view, in the right box, told the right things. The looks are in
// test/visual.

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

class FakeImage {
  src = ''
  decode() {
    return Promise.resolve()
  }
}

const NOW = new Date('2026-10-28T09:41:00Z')

const layout = (overrides: Partial<CustomLayout> = {}): CustomLayout => ({
  id: 'kitchen',
  name: 'Kitchen',
  landscape: { rows: [{ size: 1, panes: [{ component: 'photo', size: 1 }, { component: 'week', size: 2 }, { component: 'agenda', size: 1 }] }] },
  portrait: { rows: [{ size: 1, panes: [{ component: 'photo', size: 1 }] }, { size: 2, panes: [{ component: 'week', size: 1 }] }, { size: 1, panes: [{ component: 'agenda', size: 1 }] }] },
  created_at: '2026-10-01T09:00:00.000Z',
  updated_at: '2026-10-01T09:00:00.000Z',
  ...overrides,
  options: overrides.options ?? {},
})

const props = (device: 'portrait' | 'landscape', overrides: Partial<ViewProps> = {}): ViewProps => ({
  view: 'custom', stage: stageFor('custom', device), layout: layout(), events: fixtureEvents(), now: NOW, timezone: 'Europe/London', month: '2026-10', weekOf: '2026-10-28', weekHours: { from: 7, to: 21 }, dayParts: { afternoon: 12, evening: 17 }, weekStart: 'monday', weather: null, specialDays: NO_SPECIAL_DAYS,
  displayId: 'hallway', photoNext: 0, socketOpens: 0, ...overrides,
})

const mounted: { unmount: () => void }[] = []

async function open(device: 'portrait' | 'landscape', overrides: Partial<ViewProps> = {}) {
  const wrapper = await mountSuspended(CustomLayoutView, { props: props(device, overrides) })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  fetchMock.mockResolvedValue({ photo: null })
  vi.stubGlobal('Image', FakeImage)
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const style = (wrapper: Awaited<ReturnType<typeof open>>, component: string) => wrapper.find(`[data-testid="layout-pane-${component}"]`).attributes('style') ?? ''

describe('CustomLayoutView on the landscape stage', () => {
  it('draws one existing view in each pane of the landscape arrangement', async () => {
    const wrapper = await open('landscape')

    expect(wrapper.find('[data-testid="layout-pane-photo"] [data-testid="photo-view"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="layout-pane-week"] [data-testid="week-view"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="layout-pane-agenda"] [data-testid="agenda-view"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid^="layout-pane-"]')).toHaveLength(3)
  })

  it('puts the panes where the weights say', async () => {
    const wrapper = await open('landscape')

    expect(style(wrapper, 'photo')).toContain('left: 0px; top: 0px; width: 640px; height: 1440px')
    expect(style(wrapper, 'week')).toContain('left: 640px; top: 0px; width: 1280px; height: 1440px')
    expect(style(wrapper, 'agenda')).toContain('left: 1920px; top: 0px; width: 640px; height: 1440px')
  })

  it('tells each view it is a pane, and what it is, on a stage of its own shape', async () => {
    const wrapper = await open('landscape')

    // The photo pane is taller than wide, so it asks for the portrait rendition; the week is the narrow layout.
    expect(wrapper.find('[data-testid="photo-pill"]').classes()).toContain('compact')
    expect(wrapper.find('[data-testid="week-view"]').classes()).toContain('portrait')
    expect(fetchMock).toHaveBeenCalledWith('/api/photos/next', expect.objectContaining({ query: { display: 'hallway', orientation: 'portrait' } }))
  })

  it('scales a pane that is smaller than its view\'s minimum and leaves the others alone', async () => {
    const wrapper = await open('landscape')

    // The week's 1280×1440 box is no smaller than the narrow week's 1000×1200 minimum.
    expect(wrapper.find('[data-testid="layout-pane-week"] .virtual-stage').attributes('data-scale')).toBe('1')
    // The agenda's 640×1440 box is taller than wide, so it is the portrait agenda at 1300 wide: 640 / 1300 of its size.
    const scale = 640 / 1300
    const agenda = wrapper.find('[data-testid="layout-pane-agenda"] .virtual-stage')
    expect(Number(agenda.attributes('data-scale'))).toBeCloseTo(scale)
    expect(agenda.attributes('style')).toContain('width: 1300px; height: 2925px')
    expect(agenda.attributes('style')).toContain('transform: scale(')
    expect(wrapper.find('[data-testid="layout-pane-photo"] .virtual-stage').attributes('style')).not.toContain('transform')
  })

  it('rounds the photo pane\'s inner corners only', async () => {
    const wrapper = await open('landscape')

    expect(style(wrapper, 'photo')).toContain('border-radius: 0px 64px 64px 0px')
  })
})

describe('CustomLayoutView on the portrait stage', () => {
  it('draws the portrait arrangement', async () => {
    const wrapper = await open('portrait')

    expect(style(wrapper, 'photo')).toContain('left: 0px; top: 0px; width: 1440px; height: 640px')
    expect(style(wrapper, 'week')).toContain('left: 0px; top: 640px; width: 1440px; height: 1280px')
    expect(style(wrapper, 'agenda')).toContain('left: 0px; top: 1920px; width: 1440px; height: 640px')
    expect(style(wrapper, 'photo')).toContain('border-radius: 0px 0px 64px 64px')
  })

  it('asks for the landscape rendition of a photo pane that is wider than tall', async () => {
    await open('portrait')

    expect(fetchMock).toHaveBeenCalledWith('/api/photos/next', expect.objectContaining({ query: { display: 'hallway', orientation: 'landscape' } }))
  })
})

describe('CustomLayoutView with pane options', () => {
  it('gives each view the options of its pane, defaults where none are set', async () => {
    const wrapper = await open('landscape', { layout: layout({ options: { week: { show_hours: false }, agenda: { wrap_titles: true, fill_events: true } } }) })

    expect(wrapper.findComponent(WeekView).props('paneOptions')).toEqual({ ...DEFAULT_PANE_OPTIONS, show_hours: false })
    expect(wrapper.findComponent(AgendaView).props('paneOptions')).toEqual({ ...DEFAULT_PANE_OPTIONS, wrap_titles: true, fill_events: true })
    expect(wrapper.findComponent(PhotoView).props('paneOptions')).toEqual(DEFAULT_PANE_OPTIONS)
  })

  it('fits a month with no sidebar to its smaller minimum', async () => {
    const month = { rows: [{ size: 1, panes: [{ component: 'month' as const, size: 3 }, { component: 'agenda' as const, size: 1 }] }] }
    const scaleOf = async (options: CustomLayout['options']) => {
      const wrapper = await open('landscape', { layout: layout({ landscape: month, portrait: month, options }) })
      const scale = Number(wrapper.find('[data-testid="layout-pane-month"] .virtual-stage').attributes('data-scale'))
      wrapper.unmount()
      return scale
    }

    // A 1920×1440 box: 1920 / 2200 with the sidebar, and no scaling without it (1550×1370 fits).
    expect(await scaleOf({})).toBeCloseTo(1920 / 2200)
    expect(await scaleOf({ month: { show_sidebar: false } })).toBe(1)
  })
})

describe('CustomLayoutView with one pane', () => {
  const single = layout({
    landscape: { rows: [{ size: 1, panes: [{ component: 'month', size: 1 }] }] },
    portrait: { rows: [{ size: 1, panes: [{ component: 'month', size: 1 }] }] },
  })

  it('is the full view, not a pane of one', async () => {
    const wrapper = await open('landscape', { layout: single })

    expect(wrapper.findAll('[data-testid^="layout-pane-"]')).toHaveLength(1)
    expect(wrapper.find('[data-testid="layout-pane-month"] .virtual-stage').attributes('data-scale')).toBe('1')
    expect(style(wrapper, 'month')).toContain('width: 2560px; height: 1440px')
  })

  it('tells a pane in a layout of several that it is one', async () => {
    const wrapper = await open('landscape', { layout: layout({ landscape: { rows: [{ size: 1, panes: [{ component: 'week', size: 1 }, { component: 'photo', size: 1 }] }] } }) })

    expect(wrapper.find('[data-testid="photo-pill"]').classes()).toContain('compact')
  })

  it('has no compact pill on a lone photo frame', async () => {
    const photo = { rows: [{ size: 1, panes: [{ component: 'photo' as const, size: 1 }] }] }
    const wrapper = await open('landscape', { layout: layout({ landscape: photo, portrait: photo }) })

    expect(wrapper.find('[data-testid="photo-pill"]').classes()).not.toContain('compact')
  })
})

describe('CustomLayoutView with no layout', () => {
  it.each([[null], [undefined]])('says so when the layout is %s', async (missing) => {
    const wrapper = await open('landscape', { layout: missing })

    expect(wrapper.find('[data-testid="custom-layout-empty"]').text()).toBe('No layout')
    expect(wrapper.find('[data-testid="custom-layout-view"]').exists()).toBe(false)
  })
})
