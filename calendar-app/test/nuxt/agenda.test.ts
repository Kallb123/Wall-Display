import { describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import AgendaView from '~/components/views/AgendaView.vue'
import { eventFill } from '~/utils/eventFill'
import { personFill } from '~/utils/themes'
import { NO_SPECIAL_DAYS } from '~/utils/views'
import type { ViewProps } from '~/utils/views'
import type { CalendarEvent } from '../../shared/types/events'
import type { Takeover } from '../../shared/special-days'
import { DEFAULT_PANE_OPTIONS } from '../../shared/layouts'
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
  view: 'agenda', stage: { width: 2560, height: 1440, orientation: 'landscape' }, events: [], now: NOW, timezone: 'Europe/London', month: '2026-10', weekStart: 'monday', weekOf: '2026-10-28', weekHours: { from: 7, to: 21 }, dayParts: { afternoon: 12, evening: 17 }, weather: null, specialDays: NO_SPECIAL_DAYS, ...overrides,
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

describe('AgendaView special days', () => {
  const takeover: Takeover = { id: 'halloween', name: 'Halloween', date: '2026-10-28', greeting: 'Happy Halloween', palette: 'night', full_art: 'wall.webp', extra_art: null, full_art_portrait: null, extra_art_portrait: null }

  it('draws no greeting without a takeover', async () => {
    const wrapper = await mountSuspended(AgendaView, { props: props() })

    expect(wrapper.find('[data-testid="greeting"]').exists()).toBe(false)
  })

  it('puts the greeting in today\'s card, between the heading and the list', async () => {
    const wrapper = await mountSuspended(AgendaView, { props: props({ specialDays: { tiles: [], takeover } }) })

    const greetings = wrapper.findAll('[data-testid="greeting"]')
    expect(greetings).toHaveLength(1)
    expect(greetings[0]!.text()).toBe('Happy Halloween')
    const today = wrapper.find('[data-testid="day-today"]')
    expect(today.element.contains(greetings[0]!.element)).toBe(true)
    expect(today.element.children[0]!.tagName).toBe('HEADER')
    expect(today.element.children[1]).toBe(greetings[0]!.element)
  })

  it('draws no greeting for a takeover without one', async () => {
    const wrapper = await mountSuspended(AgendaView, { props: props({ specialDays: { tiles: [], takeover: { ...takeover, greeting: null } } }) })

    expect(wrapper.find('[data-testid="greeting"]').exists()).toBe(false)
  })
})

describe('AgendaView portrait', () => {
  const portrait = { width: 1440, height: 2560, orientation: 'portrait' as const }
  const hourly = (day: string, count: number): CalendarEvent[] => Array.from({ length: count }, (_, i) => ({
    id: Number(day.slice(-2)) * 100 + i, calendar_id: 'family', title: `E${i}`, display_title: `E${i}`, location: null,
    start: `${day}T${String(10 + i).padStart(2, '0')}:00:00Z`, end: `${day}T${String(10 + i).padStart(2, '0')}:30:00Z`, all_day: false, start_date: null, end_date: null, people: [],
  }))
  const count = (wrapper: Awaited<ReturnType<typeof mountSuspended>>, day: 'day-today' | 'day-tomorrow') =>
    wrapper.findAll(`[data-testid="${day}"] [data-testid="event"]`).length

  it('stacks the cards and holds fewer rows in tomorrow\'s', async () => {
    const events = [...hourly('2026-10-28', 12).slice(1), ...hourly('2026-10-29', 12)]
    const portraitView = await mountSuspended(AgendaView, { props: props({ events, stage: portrait }) })
    const landscape = await mountSuspended(AgendaView, { props: props({ events }) })

    expect(portraitView.find('[data-testid="agenda-view"]').classes()).toContain('portrait')
    expect(landscape.find('[data-testid="agenda-view"]').classes()).not.toContain('portrait')
    expect([count(portraitView, 'day-today'), count(portraitView, 'day-tomorrow')]).toEqual([7, 4])
    expect([count(landscape, 'day-today'), count(landscape, 'day-tomorrow')]).toEqual([7, 7])
    expect(portraitView.find('[data-testid="day-tomorrow"] [data-testid="more"]').text()).toBe('+8 more')
  })
})

vi.mock('~/utils/eventFill', { spy: true })

describe('AgendaView pane options', () => {
/** The backgrounds `eventFill` has given so far: the test DOM drops a gradient it cannot parse (color-mix), so what a view drew is read from what it was handed. */
const fillsGiven = () => vi.mocked(eventFill).mock.results.map(result => (result.value as { background: string }).background)
  const mum = { id: 'mum', name: 'Mum', initial: 'M', colour: '#C67139' }
  const timed: CalendarEvent = {
    id: 1, calendar_id: 'family', title: 'Dentist', display_title: 'Dentist', location: null,
    start: '2026-10-28T14:00:00Z', end: '2026-10-28T15:00:00Z', all_day: false, start_date: null, end_date: null, people: [mum],
  }
  const options = (overrides: Partial<typeof DEFAULT_PANE_OPTIONS>) => ({ ...DEFAULT_PANE_OPTIONS, ...overrides })
  const row = (wrapper: Awaited<ReturnType<typeof mountSuspended>>) => wrapper.find('[data-testid="day-today"] [data-testid="event"]')

  it('fills a timed row, without its stripe, when asked', async () => {
    const filled = await mountSuspended(AgendaView, { props: props({ events: [timed], paneOptions: options({ fill_events: true }) }) })
    expect(row(filled).attributes('style')).toContain('--ring')
    expect(row(filled).find('.stripe').exists()).toBe(false)

    const plain = await mountSuspended(AgendaView, { props: props({ events: [timed], paneOptions: options({}) }) })
    expect(row(plain).attributes('style') ?? '').not.toContain('--ring')
    expect(row(plain).find('.stripe').exists()).toBe(true)
  })

  it('splits a filled row between several people, and leaves one person\'s fill as it was', async () => {
    const dad = { id: 'dad', name: 'Dad', initial: 'D', colour: '#3A7CA5' }
    const shared = await mountSuspended(AgendaView, { props: props({ events: [{ ...timed, people: [mum, dad] }], paneOptions: options({ fill_events: true }) }) })
    const style = row(shared).attributes('style') ?? ''
    // The ring is the first person's fill, whatever the test DOM does with the gradient itself.
    expect(style).toContain(`--ring: ${personFill(mum.colour)}`)
    expect(vi.mocked(eventFill).mock.calls.at(-1)![0]).toEqual([mum, dad])
    expect(fillsGiven().at(-1)).toBe(`linear-gradient(to right, ${personFill(mum.colour)} 0% 50%, ${personFill(dad.colour)} 50% 100%)`)

    const solo = await mountSuspended(AgendaView, { props: props({ events: [timed], paneOptions: options({ fill_events: true }) }) })
    expect(row(solo).attributes('style')).toContain(`--ring: ${personFill(mum.colour)}`)
  })

  it('leaves the initials off a filled row only when asked', async () => {
    const badges = async (paneOptions: ReturnType<typeof options>) => (await mountSuspended(AgendaView, { props: props({ events: [timed], paneOptions }) })).findAll('[data-testid="day-today"] .badge').length
    expect(await badges(options({ fill_events: true }))).toBe(1)
    expect(await badges(options({ fill_events: true, show_initials: false }))).toBe(0)
    // Without the fill the option means nothing.
    expect(await badges(options({ show_initials: false }))).toBe(1)
  })

  it('lets every event row wrap when asked, and none otherwise', async () => {
    const on = await mountSuspended(AgendaView, { props: props({ events: [timed], paneOptions: options({ wrap_titles: true }) }) })
    expect(on.find('[data-wrap-box]').exists()).toBe(true)
    await vi.waitFor(() => expect(row(on).attributes('data-wrap')).toBe('on'))

    for (const paneOptions of [options({}), undefined]) {
      const off = await mountSuspended(AgendaView, { props: props({ events: [timed], paneOptions }) })
      expect(row(off).attributes('data-wrap')).toBeUndefined()
    }
  })

  it('is as before with no options', async () => {
    const wrapper = await mountSuspended(AgendaView, { props: props({ events: [timed] }) })

    expect(row(wrapper).attributes('style') ?? '').not.toContain('--ring')
    expect(row(wrapper).find('.stripe').exists()).toBe(true)
    expect(wrapper.find('[data-wrap]').exists()).toBe(false)
  })
})
