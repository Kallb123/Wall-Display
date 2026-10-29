import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ClockWidget from '~/components/ClockWidget.vue'
import OfflineBadge from '~/components/OfflineBadge.vue'
import OverlayBanner from '~/components/OverlayBanner.vue'
import PlaceholderView from '~/components/views/PlaceholderView.vue'
import type { CalendarEvent } from '../../shared/types/events'

// Light component tests. The page itself (sockets, caching, scaling) is covered
// by the Playwright tests in test/visual, which can play the server.

describe('ClockWidget', () => {
  const now = new Date('2026-10-28T09:41:00Z')

  it('shows the time in the display zone, 24-hour', async () => {
    const wrapper = await mountSuspended(ClockWidget, { props: { now, timezone: 'Europe/London' } })

    expect(wrapper.find('[data-testid="clock-time"]').text()).toBe('09:41')
    expect(wrapper.find('[data-testid="clock-date"]').exists()).toBe(false)
  })

  it('shows the weekday and date when asked', async () => {
    const wrapper = await mountSuspended(ClockWidget, { props: { now, timezone: 'Asia/Tokyo', showDate: true } })

    expect(wrapper.find('[data-testid="clock-time"]').text()).toBe('18:41')
    expect(wrapper.find('[data-testid="clock-date"]').text()).toBe('Wednesday 28 October')
  })
})

describe('OfflineBadge', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('appears only after the socket has not been open for the delay', async () => {
    vi.useFakeTimers()
    const wrapper = await mountSuspended(OfflineBadge, { props: { status: 'connecting' } })
    const badge = () => wrapper.find('[data-testid="offline-badge"]')

    expect(badge().exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(2900)
    expect(badge().exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(badge().exists()).toBe(true)
    expect(badge().text()).toBe('Offline')
  })

  it('does not start again when the status flips between connecting and closed', async () => {
    vi.useFakeTimers()
    const wrapper = await mountSuspended(OfflineBadge, { props: { status: 'connecting' } })

    await vi.advanceTimersByTimeAsync(2000)
    await wrapper.setProps({ status: 'closed' })
    await vi.advanceTimersByTimeAsync(1100)

    expect(wrapper.find('[data-testid="offline-badge"]').exists()).toBe(true)
  })

  it('never shows if the socket opens in time, and goes when it opens again', async () => {
    vi.useFakeTimers()
    const wrapper = await mountSuspended(OfflineBadge, { props: { status: 'connecting' } })

    await vi.advanceTimersByTimeAsync(1000)
    await wrapper.setProps({ status: 'open' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(wrapper.find('[data-testid="offline-badge"]').exists()).toBe(false)

    await wrapper.setProps({ status: 'closed' })
    await vi.advanceTimersByTimeAsync(3100)
    expect(wrapper.find('[data-testid="offline-badge"]').exists()).toBe(true)

    await wrapper.setProps({ status: 'open' })
    expect(wrapper.find('[data-testid="offline-badge"]').exists()).toBe(false)
  })
})

describe('OverlayBanner', () => {
  const now = new Date('2026-10-28T09:41:00Z')
  const banner = (wrapper: Awaited<ReturnType<typeof mountSuspended>>) => wrapper.find('[data-testid="overlay-banner"]')

  it('shows the text as a status message', async () => {
    const overlay = { text: 'Bins out tonight', icon: null, until: '2026-10-28T11:41:00Z' }
    const wrapper = await mountSuspended(OverlayBanner, { props: { overlay, now } })

    expect(banner(wrapper).text()).toBe('Bins out tonight')
    expect(banner(wrapper).attributes('role')).toBe('status')
  })

  it('shows one that stays until cleared', async () => {
    const wrapper = await mountSuspended(OverlayBanner, { props: { overlay: { text: 'Hello', icon: null, until: null }, now } })

    expect(banner(wrapper).exists()).toBe(true)
  })

  it('shows nothing for no overlay', async () => {
    const wrapper = await mountSuspended(OverlayBanner, { props: { overlay: null, now } })

    expect(banner(wrapper).exists()).toBe(false)
  })

  it('shows nothing once its time has passed, and goes when the clock gets there', async () => {
    const overlay = { text: 'Bins out tonight', icon: null, until: '2026-10-28T09:41:30Z' }
    const wrapper = await mountSuspended(OverlayBanner, { props: { overlay: { ...overlay, until: '2026-10-28T09:40:00Z' }, now } })
    expect(banner(wrapper).exists()).toBe(false)

    await wrapper.setProps({ overlay })
    expect(banner(wrapper).exists()).toBe(true)

    await wrapper.setProps({ now: new Date('2026-10-28T09:41:30Z') })
    expect(banner(wrapper).exists()).toBe(false)
  })

  it('draws the icon it is named, or the plain message icon', async () => {
    const wrapper = await mountSuspended(OverlayBanner, { props: { overlay: { text: 'Bins', icon: 'mdi:trash-can', until: null }, now } })
    const trash = banner(wrapper).find('svg').classes()
    expect(trash).toContain('lucide-trash2-icon')

    await wrapper.setProps({ overlay: { text: 'Hello', icon: 'no-such-icon', until: null } })

    expect(banner(wrapper).find('svg').classes()).toContain('lucide-message-circle-icon')
  })
})

describe('PlaceholderView', () => {
  const now = new Date('2026-10-28T09:41:00Z')
  const person = { id: 'mum', name: 'Mum', initial: 'M', colour: '#C67139' }
  const event = (id: number, overrides: Partial<CalendarEvent>): CalendarEvent => ({
    id, calendar_id: 'family', title: `Event ${id}`, display_title: `Event ${id}`, location: null,
    start: '2026-10-28T14:00:00Z', end: '2026-10-28T15:00:00Z', all_day: false, start_date: null, end_date: null, people: [person],
    ...overrides,
  })

  it('names the view and lists what is still to come', async () => {
    const events = [
      event(1, { start: '2026-10-28T07:00:00Z', end: '2026-10-28T08:00:00Z', display_title: 'Already over' }),
      event(2, { all_day: true, start_date: '2026-10-28', end_date: '2026-10-29', display_title: 'All day thing' }),
      event(3, { display_title: 'School run' }),
    ]
    const wrapper = await mountSuspended(PlaceholderView, { props: { view: 'agenda', events, now, timezone: 'Europe/London', month: '2026-10', weekStart: 'monday', weather: null } })

    expect(wrapper.find('h1').text()).toBe('Agenda')
    const rows = wrapper.findAll('[data-testid="event"]').map(row => row.text())
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('All day')
    expect(rows[0]).toContain('All day thing')
    expect(rows[1]).toContain('14:00')
    expect(rows[1]).toContain('School run')
  })

  it('shows at most eight events', async () => {
    const events = Array.from({ length: 12 }, (_, i) => event(i + 1, {}))
    const wrapper = await mountSuspended(PlaceholderView, { props: { view: 'month', events, now, timezone: 'Europe/London', month: '2026-10', weekStart: 'monday', weather: null } })

    expect(wrapper.findAll('[data-testid="event"]')).toHaveLength(8)
  })
})
