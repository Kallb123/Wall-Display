import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ClockWidget from '~/components/ClockWidget.vue'
import OfflineBadge from '~/components/OfflineBadge.vue'
import OverlayBanner from '~/components/OverlayBanner.vue'

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

  it('is on the right unless told to take the left', async () => {
    vi.useFakeTimers()
    const wrapper = await mountSuspended(OfflineBadge, { props: { status: 'closed' } })
    await vi.advanceTimersByTimeAsync(3100)
    expect(wrapper.find('[data-testid="offline-badge"]').classes()).toContain('side-right')

    await wrapper.setProps({ side: 'left' })

    expect(wrapper.find('[data-testid="offline-badge"]').classes()).toContain('side-left')
    expect(wrapper.find('[data-testid="offline-badge"]').classes()).not.toContain('side-right')
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
