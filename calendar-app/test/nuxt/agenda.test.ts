import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import AgendaView from '~/components/views/AgendaView.vue'
import type { ViewProps } from '~/utils/views'
import type { WeatherSnapshot } from '../../shared/weather'

// The agenda view's weather lines, for Wed 28 Oct 2026. The events and the
// layout are covered by test/unit/display/agenda.test.ts and the visual specs.

const NOW = new Date('2026-10-28T09:41:00Z')

const weather: WeatherSnapshot = {
  current: { condition: 'rainy', temperature: 12.4 },
  daily: [
    { date: '2026-10-28', condition: 'rainy', high: 14, low: 8 },
    { date: '2026-10-29', condition: 'partlycloudy', high: 13, low: null },
  ],
  temperature_unit: '°C',
  updated_at: NOW.toISOString(),
}

const props = (overrides: Partial<ViewProps> = {}): ViewProps => ({
  view: 'agenda', events: [], now: NOW, timezone: 'Europe/London', month: '2026-10', weekStart: 'monday', weather: null, ...overrides,
})

const line = (wrapper: Awaited<ReturnType<typeof mountSuspended>>, day: 'day-today' | 'day-tomorrow') =>
  wrapper.find(`[data-testid="${day}"] [data-testid="agenda-weather"]`)

/** The words and the range, which are separate spans spaced by the line's gap. */
const parts = (wrapper: Awaited<ReturnType<typeof mountSuspended>>, day: 'day-today' | 'day-tomorrow') =>
  line(wrapper, day).findAll('span').map((span: { text: () => string }) => span.text())

describe('AgendaView weather', () => {
  it('draws nothing without a snapshot', async () => {
    const wrapper = await mountSuspended(AgendaView, { props: props() })

    expect(wrapper.find('[data-testid="agenda-weather"]').exists()).toBe(false)
  })

  it('gives today the current conditions and the range, and tomorrow the forecast', async () => {
    const wrapper = await mountSuspended(AgendaView, { props: props({ weather }) })

    expect(parts(wrapper, 'day-today')).toEqual(['12° · Rain', '14° / 8°'])
    expect(line(wrapper, 'day-today').find('svg').classes()).toContain('lucide-cloud-rain-icon')
    expect(parts(wrapper, 'day-tomorrow')).toEqual(['Partly cloudy', '13°'])
    expect(line(wrapper, 'day-tomorrow').find('svg').classes()).toContain('lucide-cloud-sun-icon')
  })

  it('falls back to today\'s forecast once the current conditions are old', async () => {
    const wrapper = await mountSuspended(AgendaView, { props: props({ weather, now: new Date('2026-10-28T13:00:00Z') }) })

    expect(parts(wrapper, 'day-today')).toEqual(['Rain', '14° / 8°'])
  })

  it('leaves out a day the forecast does not cover', async () => {
    const wrapper = await mountSuspended(AgendaView, { props: props({ weather: { ...weather, daily: [weather.daily[0]!] } }) })

    expect(line(wrapper, 'day-today').exists()).toBe(true)
    expect(line(wrapper, 'day-tomorrow').exists()).toBe(false)
  })

  it('goes when the snapshot does', async () => {
    const wrapper = await mountSuspended(AgendaView, { props: props({ weather }) })
    expect(wrapper.findAll('[data-testid="agenda-weather"]')).toHaveLength(2)

    await wrapper.setProps({ weather: null })

    expect(wrapper.find('[data-testid="agenda-weather"]').exists()).toBe(false)
  })
})
