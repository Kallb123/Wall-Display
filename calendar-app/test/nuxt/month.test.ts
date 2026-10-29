import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import MonthSoftView from '~/components/views/MonthSoftView.vue'
import { fixtureEvents } from '../helpers/fixtureEvents'
import type { ViewProps } from '~/utils/views'
import type { WeatherSnapshot } from '../../shared/weather'

// The Soft month view on the fixture family and the day the mocks are set on,
// Wed 28 Oct 2026. The layout itself is tested in test/unit/shared; this is
// that it is drawn, and drawn from the right month and day.

const NOW = new Date('2026-10-28T09:41:00Z')
const events = fixtureEvents()

const weather: WeatherSnapshot = {
  current: { condition: 'rainy', temperature: 12.4 },
  daily: [
    { date: '2026-10-27', condition: 'cloudy', high: 13, low: 7 },
    { date: '2026-10-28', condition: 'rainy', high: 14, low: 8 },
    { date: '2026-10-29', condition: 'sunny', high: 12.6, low: null },
    { date: '2026-10-30', condition: null, high: null, low: 4 },
  ],
  temperature_unit: '°C',
  updated_at: NOW.toISOString(),
}

const props = (overrides: Partial<ViewProps> = {}): ViewProps => ({
  view: 'month', events, now: NOW, timezone: 'Europe/London', month: '2026-10', weekStart: 'monday', weather: null, ...overrides,
})

describe('MonthSoftView', () => {
  it('draws five weeks of tiles, with today flagged once', async () => {
    const wrapper = await mountSuspended(MonthSoftView, { props: props() })

    const tiles = wrapper.findAll('[data-testid="day-tile"]')
    expect(tiles).toHaveLength(35)
    expect(tiles[0]!.attributes('data-date')).toBe('2026-09-28')
    const flagged = tiles.filter(tile => tile.attributes('data-today') === 'true')
    expect(flagged.map(tile => tile.attributes('data-date'))).toEqual(['2026-10-28'])
    expect(wrapper.find('[data-testid="today-number"]').text()).toBe('28')
  })

  it('titles the month and year', async () => {
    const wrapper = await mountSuspended(MonthSoftView, { props: props() })

    expect(wrapper.find('[data-testid="month-title"]').text()).toBe('October 2026')
  })

  it('lists today and the next three days in the panel, with the big date', async () => {
    const wrapper = await mountSuspended(MonthSoftView, { props: props() })

    const days = wrapper.findAll('[data-testid="panel-day"]')
    expect(days.map(day => day.find('h2').text())).toEqual(['Today', 'Tomorrow', 'Friday', 'Saturday'])
    expect(wrapper.find('[data-testid="panel-date"]').text()).toBe('28')
    expect(wrapper.find('[data-testid="panel"]').text()).toContain('Wednesday')
    // An all-day item says so; a timed one gives its time.
    expect(days[0]!.text()).toContain('All day')
    expect(days[0]!.text()).toContain('Half term')
    expect(days[0]!.text()).toContain('08:45')
    expect(days[0]!.text()).toContain('Nursery')
    // Five events do not fit in four rows: the last is summarised.
    expect(days[0]!.find('[data-testid="panel-more"]').text()).toBe('+2 more')
    expect(days[1]!.find('[data-testid="panel-more"]').exists()).toBe(false)
  })

  it('dims the panel events that are over, and only those', async () => {
    // 18:00 in London: the nursery run and the 1:1 are over; they are dropped first only if the day overflows.
    const wrapper = await mountSuspended(MonthSoftView, { props: props({ now: new Date('2026-10-28T18:00:00Z') }) })

    const rows = wrapper.findAll('[data-testid="panel-day"]')[0]!.findAll('[data-testid="event"]')
    const past = rows.filter(row => row.classes('past')).map(row => row.text())
    const upcoming = rows.filter(row => !row.classes('past')).map(row => row.text())
    expect(past.join(' ')).toContain('1:1 with Priya')
    expect(upcoming.join(' ')).toContain('Half term')
    expect(upcoming.join(' ')).toContain('Pilates')
  })

  it('draws a bar and a timed row, each with its person\'s initial', async () => {
    const wrapper = await mountSuspended(MonthSoftView, { props: props() })

    const bar = wrapper.findAll('[data-kind="bar"]').find(candidate => candidate.text().includes('Half term'))!
    expect(bar.attributes('data-testid')).toBe('event')
    expect(bar.find('.badge').text()).toBe('H')

    const timed = wrapper.findAll('[data-kind="timed"]').find(candidate => candidate.text().includes('1:1 with Priya'))!
    expect(timed.attributes('data-testid')).toBe('event')
    expect(timed.text()).toContain('14:00')
    expect(timed.find('.badge').text()).toBe('D')
  })

  it('shows "+N more" in a crowded day, and veils the past', async () => {
    const wrapper = await mountSuspended(MonthSoftView, { props: props() })

    const more = wrapper.findAll('[data-testid="more"]').map(label => label.text())
    expect(more).toContain('+2 more')
    expect(wrapper.findAll('[data-testid="veil"]').length).toBeGreaterThan(0)
  })

  it('shows a pinned month in the grid while the panel stays on today', async () => {
    const wrapper = await mountSuspended(MonthSoftView, { props: props({ month: '2027-03' }) })

    expect(wrapper.find('[data-testid="month-title"]').text()).toBe('March 2027')
    expect(wrapper.findAll('[data-testid="day-tile"]')).toHaveLength(35)
    expect(wrapper.find('[data-testid="today-number"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="panel-day"]')[0]!.find('h2').text()).toBe('Today')
    expect(wrapper.find('[data-testid="panel-date"]').text()).toBe('28')
  })

  it('says so when a day in the panel is empty', async () => {
    const wrapper = await mountSuspended(MonthSoftView, { props: props({ events: [] }) })

    expect(wrapper.findAll('[data-testid="panel-day"]').every(day => day.text().includes('Nothing planned'))).toBe(true)
    expect(wrapper.findAll('[data-testid="event"]')).toHaveLength(0)
  })

  it('draws nothing for the special-day slots unless they are filled', async () => {
    const wrapper = await mountSuspended(MonthSoftView, { props: props() })

    expect(wrapper.find('.tile-art').exists()).toBe(false)
    expect(wrapper.find('.greeting').exists()).toBe(false)
    expect(wrapper.find('.panel-art').exists()).toBe(false)
  })

  it('draws the filled slots: art in every tile, a greeting and art in the panel', async () => {
    const wrapper = await mountSuspended(MonthSoftView, {
      props: props(),
      slots: {
        'tile-art': `<template #tile-art="{ cell }"><i class="art" :data-day="cell.date" /></template>`,
        'greeting': 'Happy Halloween',
        'panel-art': '<svg class="scene" />',
      },
    })

    const art = wrapper.findAll('.tile-art .art')
    expect(art).toHaveLength(35)
    expect(art[0]!.attributes('data-day')).toBe('2026-09-28')
    expect(wrapper.find('.greeting').text()).toBe('Happy Halloween')
    expect(wrapper.find('.panel-art .scene').exists()).toBe(true)
  })

  describe('weather', () => {
    it('draws nothing without a snapshot', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: props() })

      expect(wrapper.find('[data-testid="weather-now"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="day-weather"]').exists()).toBe(false)
      expect(wrapper.find('svg').exists()).toBe(false)
    })

    it('shows the current conditions under the weekday', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: props({ weather }) })

      const current = wrapper.find('[data-testid="weather-now"]')
      expect(current.text()).toBe('12° · Rain')
      expect(current.find('svg').classes()).toContain('lucide-cloud-rain-icon')
      expect(wrapper.find('.weekday').text()).toContain('Wednesday')
    })

    it('shows each panel day\'s forecast, leaving out what is not known', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: props({ weather }) })

      const days = wrapper.findAll('[data-testid="panel-day"]')
      // The 27th is before the panel starts, and the 31st has no entry.
      expect(days.map(day => day.find('[data-testid="day-weather"]').exists())).toEqual([true, true, true, false])
      expect(days[0]!.find('[data-testid="day-weather"]').text()).toBe('14° / 8°')
      expect(days[0]!.find('[data-testid="day-weather"] svg').classes()).toContain('lucide-cloud-rain-icon')
      expect(days[1]!.find('[data-testid="day-weather"]').text()).toBe('13°')
      expect(days[2]!.find('[data-testid="day-weather"]').text()).toBe('4°')
      expect(days[2]!.find('[data-testid="day-weather"] svg').exists()).toBe(false)
    })

    it('drops the current conditions once they are old, and keeps the forecast', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: props({ weather, now: new Date('2026-10-28T13:00:00Z') }) })

      expect(wrapper.find('[data-testid="weather-now"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="day-weather"]').exists()).toBe(true)
    })

    it('goes when the snapshot does', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: props({ weather }) })
      expect(wrapper.find('[data-testid="weather-now"]').exists()).toBe(true)

      await wrapper.setProps({ weather: null })

      expect(wrapper.find('[data-testid="weather-now"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="day-weather"]').exists()).toBe(false)
    })
  })
})
