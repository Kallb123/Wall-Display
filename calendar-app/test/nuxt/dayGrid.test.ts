import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import CustomLayoutView from '~/components/views/CustomLayoutView.vue'
import DayGridView from '~/components/views/DayGridView.vue'
import { eventFill } from '~/utils/eventFill'
import { personFill } from '~/utils/themes'
import { NO_SPECIAL_DAYS, stageFor } from '~/utils/views'
import type { ViewProps } from '~/utils/views'
import { DEFAULT_PANE_OPTIONS } from '../../shared/layouts'
import type { CustomLayout, DayGrid } from '../../shared/layouts'
import type { CalendarEvent } from '../../shared/types/events'
import type { WeatherSnapshot } from '../../shared/weather'

// The day grid on its own and in a custom layout's pane, at Wed 28 Oct 2026
// (London is UTC). Which tile holds which day and event is tested in
// test/unit/shared/day-grid-layout.test.ts and the capacity in
// test/unit/display/dayGrid.test.ts; this is that it is drawn.

const NOW = new Date('2026-10-28T09:41:00Z')

const weather: WeatherSnapshot = {
  current: { condition: 'rainy', temperature: 12.4 },
  daily: [{ date: '2026-10-28', condition: 'rainy', high: 14, low: 8 }],
  hourly: [],
  temperature_unit: '°C',
  updated_at: NOW.toISOString(),
}

const mum = { id: 'mum', name: 'Mum', initial: 'M', colour: '#C67139' }
const event = (id: number, overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id, calendar_id: 'family', title: `Event ${id}`, display_title: `Event ${id}`, icon: null, location: null,
  start: '2026-10-28T14:00:00Z', end: '2026-10-28T15:00:00Z', all_day: false, start_date: null, end_date: null, people: [mum],
  ...overrides,
})

const grid = (overrides: Partial<DayGrid> = {}): DayGrid => ({ rows: 2, columns: 4, start: 'today', ...overrides })

const props = (overrides: Partial<ViewProps> = {}): ViewProps => ({
  view: 'custom', stage: { width: 2560, height: 1440, orientation: 'landscape' }, dayGrid: grid(), events: [], now: NOW, timezone: 'Europe/London', month: '2026-10', weekOf: '2026-10-28', weekHours: { from: 7, to: 21 }, dayParts: { afternoon: 12, evening: 17 }, weekStart: 'monday', weather: null, specialDays: NO_SPECIAL_DAYS, ...overrides,
})

const mounted: { unmount: () => void }[] = []
async function open(overrides: Partial<ViewProps> = {}) {
  const wrapper = await mountSuspended(DayGridView, { props: props(overrides) })
  mounted.push(wrapper)
  return wrapper
}
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
})

type Wrapper = Awaited<ReturnType<typeof open>>
const tile = (wrapper: Wrapper, date: string) => wrapper.find(`[data-testid="day-tile"][data-date="${date}"]`)

describe('DayGridView', () => {
  it('draws rows times columns tiles from today, one day each', async () => {
    const wrapper = await open()

    const tiles = wrapper.findAll('[data-testid="day-tile"]')
    expect(tiles.map(day => day.attributes('data-date'))).toEqual(['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'])
    expect(wrapper.attributes('style')).toContain('--columns: 4')
    expect(wrapper.attributes('style')).toContain('--rows: 2')
    expect(tile(wrapper, '2026-10-28').text()).toContain('Wed')
    expect(tile(wrapper, '2026-10-28').text()).toContain('28')
  })

  it('uses the default grid when none is given', async () => {
    const wrapper = await open({ dayGrid: undefined })

    expect(wrapper.findAll('[data-testid="day-tile"]')).toHaveLength(8)
  })

  it('marks today once, with the filled date', async () => {
    const wrapper = await open()

    expect(wrapper.findAll('[data-testid="day-tile"]').filter(day => day.attributes('data-today') === 'true').map(day => day.attributes('data-date'))).toEqual(['2026-10-28'])
    expect(wrapper.find('[data-testid="today-number"]').text()).toBe('28')
    expect(tile(wrapper, '2026-10-28').attributes('style')).toContain('--today-cell')
  })

  it('names the month on the first tile and the 1st, and counts the events', async () => {
    const wrapper = await open({ events: [event(1), event(2, { start: '2026-10-29T08:00:00Z', end: '2026-10-29T09:00:00Z' }), event(3, { start: '2026-10-29T10:00:00Z', end: '2026-10-29T11:00:00Z' })] })

    expect(wrapper.findAll('[data-testid="tile-month"]').map(month => month.text())).toEqual(['Oct', 'Nov'])
    expect(tile(wrapper, '2026-10-28').find('[data-testid="tile-count"]').text()).toBe('1 event')
    expect(tile(wrapper, '2026-10-29').find('[data-testid="tile-count"]').text()).toBe('2 events')
    expect(tile(wrapper, '2026-10-30').find('[data-testid="tile-count"]').text()).toBe('No events')
  })

  it('draws an event as a card with its title, its time, "All day" and its badge', async () => {
    const wrapper = await open({ events: [event(1, { display_title: 'Dentist' }), event(2, { display_title: 'Half term', all_day: true, start: '2026-10-28T00:00:00Z', end: '2026-10-29T00:00:00Z', start_date: '2026-10-28', end_date: '2026-10-29' })] })

    const cards = tile(wrapper, '2026-10-28').findAll('[data-testid="event"]')
    expect(cards.map(card => card.find('.name').text())).toEqual(['Half term', 'Dentist'])
    expect(cards.map(card => card.find('.time').text())).toEqual(['All day', '14:00'])
    expect(cards[1]!.find('.badge').text()).toBe('M')
  })

  it('shows the day\'s forecast as an icon and the high', async () => {
    const wrapper = await open({ weather })

    expect(tile(wrapper, '2026-10-28').find('[data-testid="day-weather"]').text()).toBe('14°')
    expect(tile(wrapper, '2026-10-29').find('[data-testid="day-weather"]').exists()).toBe(false)
  })

  it('leaves the forecast out when the pane\'s option is off', async () => {
    const wrapper = await open({ weather, paneOptions: { ...DEFAULT_PANE_OPTIONS, weather_on_dates: false } })

    expect(wrapper.find('[data-testid="day-weather"]').exists()).toBe(false)
  })

  it('shows no forecast on a day that is over, in a grid that starts at the week\'s beginning', async () => {
    const wrapper = await open({ weather: { ...weather, daily: [{ date: '2026-10-27', condition: 'cloudy', high: 13, low: 7 }, ...weather.daily] }, dayGrid: grid({ start: 'week' }) })

    expect(tile(wrapper, '2026-10-27').find('[data-testid="day-weather"]').exists()).toBe(false)
    expect(tile(wrapper, '2026-10-28').find('[data-testid="day-weather"]').exists()).toBe(true)
  })

  it('ends a full tile with "+N more", the cards fitting the tile', async () => {
    const many = Array.from({ length: 12 }, (_, index) => event(index + 1, { start: `2026-10-28T${String(8 + index).padStart(2, '0')}:00:00Z`, end: `2026-10-28T${String(8 + index).padStart(2, '0')}:30:00Z` }))
    const wrapper = await open({ events: many })

    const day = tile(wrapper, '2026-10-28')
    const shown = day.findAll('[data-testid="event"]').length
    // A 2 by 4 grid on the landscape stage has tiles 672 px tall: six cards, and the shorter "+N more" line still fits under all six.
    expect(shown).toBe(6)
    expect(day.find('[data-testid="more"]').text()).toBe(`+${12 - shown} more`)
    expect(tile(wrapper, '2026-10-29').find('[data-testid="more"]').exists()).toBe(false)
  })

  it('draws a 1 by 1 grid as a single tile for today', async () => {
    const wrapper = await open({ dayGrid: grid({ rows: 1, columns: 1 }), events: [event(1)] })

    expect(wrapper.findAll('[data-testid="day-tile"]')).toHaveLength(1)
    expect(wrapper.find('[data-testid="day-tile"]').attributes('data-today')).toBe('true')
    expect(wrapper.findAll('[data-testid="event"]')).toHaveLength(1)
  })

  it('has no veil when it starts today', async () => {
    const wrapper = await open()

    expect(wrapper.findAll('[data-testid="veil"]')).toHaveLength(0)
  })

  it('veils the days before today, and dims an event that is over, when it starts at the week', async () => {
    const wrapper = await open({
      dayGrid: grid({ start: 'week' }),
      events: [event(1, { start: '2026-10-27T10:00:00Z', end: '2026-10-27T11:00:00Z' }), event(2, { start: '2026-10-28T07:00:00Z', end: '2026-10-28T08:00:00Z' }), event(3)],
    })

    expect(wrapper.findAll('[data-testid="day-tile"]')[0]!.attributes('data-date')).toBe('2026-10-26')
    expect(wrapper.findAll('[data-testid="veil"]')).toHaveLength(2)
    expect(tile(wrapper, '2026-10-27').find('[data-testid="veil"]').exists()).toBe(true)
    expect(tile(wrapper, '2026-10-28').find('[data-testid="veil"]').exists()).toBe(false)
    const today = tile(wrapper, '2026-10-28').findAll('[data-testid="event"]')
    expect(today.map(card => card.classes('past'))).toEqual([true, false])
  })

  it('tints and decorates a special day\'s tile', async () => {
    const day = { id: 'pumpkin', name: 'Pumpkin day', palette: 'night', tile_art: 'pumpkin.png' } as never
    const wrapper = await open({ specialDays: { tiles: [{ date: '2026-10-31', days: [day] }], takeover: null } })

    expect(tile(wrapper, '2026-10-31').attributes('data-special')).toBe('pumpkin')
    expect(tile(wrapper, '2026-10-30').attributes('data-special')).toBeUndefined()
  })
})

vi.mock('~/utils/eventFill', { spy: true })

describe('DayGridView pane options', () => {
/** The backgrounds `eventFill` has given so far: the test DOM drops a gradient it cannot parse (color-mix), so what a view drew is read from what it was handed. */
const fillsGiven = () => vi.mocked(eventFill).mock.results.map(result => (result.value as { background: string }).background)
  const options = (overrides: Partial<typeof DEFAULT_PANE_OPTIONS>) => ({ ...DEFAULT_PANE_OPTIONS, ...overrides })
  const card = (wrapper: Wrapper) => tile(wrapper, '2026-10-28').find('[data-testid="event"]')

  it('fills a card with the first person\'s colour when asked', async () => {
    const filled = await open({ events: [event(1)], paneOptions: options({ fill_events: true }) })
    expect(card(filled).attributes('style')).toContain('--card-ring')

    const plain = await open({ events: [event(1)], paneOptions: options({}) })
    expect(card(plain).attributes('style') ?? '').not.toContain('--card-ring')
  })

  it('splits a filled card between several people', async () => {
    const dad = { id: 'dad', name: 'Dad', initial: 'D', colour: '#3A7CA5' }
    const shared = await open({ events: [event(1, { people: [mum, dad] })], paneOptions: options({ fill_events: true }) })
    expect(card(shared).attributes('style')).toContain(`--card-ring: ${personFill(mum.colour)}`)
    expect(fillsGiven().at(-1)).toBe(`linear-gradient(to right, ${personFill(mum.colour)} 0% 50%, ${personFill(dad.colour)} 50% 100%)`)
    expect(card(shared).findAll('.badge')).toHaveLength(2)

    const solo = await open({ events: [event(1)], paneOptions: options({ fill_events: true }) })
    expect(card(solo).attributes('style')).toContain(`--card-ring: ${personFill(mum.colour)}`)
  })

  it('leaves the initials off a filled card only when asked', async () => {
    const badges = async (paneOptions: ReturnType<typeof options>) => card(await open({ events: [event(1)], paneOptions })).findAll('.badge').length
    expect(await badges(options({ fill_events: true }))).toBe(1)
    expect(await badges(options({ fill_events: true, show_initials: false }))).toBe(0)
    expect(await badges(options({ show_initials: false }))).toBe(1)
  })

  it('lets every card wrap when asked, and none otherwise', async () => {
    const on = await open({ events: [event(1)], paneOptions: options({ wrap_titles: true }) })
    expect(tile(on, '2026-10-28').find('[data-wrap-box]').exists()).toBe(true)
    await vi.waitFor(() => expect(card(on).attributes('data-wrap')).toBe('on'))

    for (const paneOptions of [options({}), undefined]) {
      const off = await open({ events: [event(1)], paneOptions })
      expect(card(off).attributes('data-wrap')).toBeUndefined()
    }
  })

  it('is as before with no options', async () => {
    const wrapper = await open({ events: [event(1)] })

    expect(card(wrapper).attributes('style') ?? '').not.toContain('--card-ring')
    expect(wrapper.find('[data-wrap]').exists()).toBe(false)
  })
})

describe('DayGridView locations', () => {
  const options = (overrides: Partial<typeof DEFAULT_PANE_OPTIONS>) => ({ ...DEFAULT_PANE_OPTIONS, ...overrides })
  const card = (wrapper: Wrapper) => tile(wrapper, '2026-10-28').find('[data-testid="event"]')
  const place = (wrapper: Wrapper) => card(wrapper).find('[data-testid="event-location"]')

  it('draws the shortened location after the time, and the fit turns it on', async () => {
    const wrapper = await open({ events: [event(1, { location: 'Leisure Centre, 12 High Street, Town' })] })

    await vi.waitFor(() => expect(place(wrapper).text()).toBe('Leisure Centre'))
    expect(card(wrapper).find('.lines').element.lastElementChild).toBe(place(wrapper).element)
    await vi.waitFor(() => expect(card(wrapper).attributes('data-location')).toBe('on'))
  })

  it('draws nothing for no location or a link', async () => {
    for (const location of [null, '', 'https://meet.google.com/abc-defg-hij']) {
      const wrapper = await open({ events: [event(1, { location })] })
      expect(place(wrapper).exists()).toBe(false)
    }
  })

  it('draws nothing when locations are off, by the preference or by the pane', async () => {
    const events = [event(1, { location: 'Leisure Centre' })]
    expect(place(await open({ events, showLocations: false })).exists()).toBe(false)
    expect(place(await open({ events, paneOptions: options({ show_locations: false }) })).exists()).toBe(false)
    expect(place(await open({ events, showLocations: false, paneOptions: options({ show_locations: true }) })).exists()).toBe(true)
  })

  it('shows the location together with wrapping', async () => {
    const wrapper = await open({ events: [event(1, { location: 'Leisure Centre' })], paneOptions: options({ wrap_titles: true }) })

    await vi.waitFor(() => expect(card(wrapper).attributes('data-location')).toBe('on'))
    expect(card(wrapper).attributes('data-wrap')).toBe('on')
  })
})

describe('CustomLayoutView with a days pane', () => {
  const layout = (): CustomLayout => ({
    id: 'days',
    name: 'Days',
    landscape: { rows: [{ size: 1, panes: [{ component: 'days', size: 1, grid: grid({ rows: 3, columns: 5 }) }] }] },
    portrait: { rows: [{ size: 1, panes: [{ component: 'days', size: 1, grid: grid({ rows: 5, columns: 2 }) }] }] },
    options: {},
    created_at: '2026-10-01T09:00:00.000Z',
    updated_at: '2026-10-01T09:00:00.000Z',
  })

  it('draws the day grid with the pane\'s own grid on each stage', async () => {
    for (const [device, count] of [['landscape', 15], ['portrait', 10]] as const) {
      const wrapper = await mountSuspended(CustomLayoutView, { props: props({ stage: stageFor('custom', device), layout: layout(), dayGrid: undefined }) })
      mounted.push(wrapper)
      await flushPromises()

      expect(wrapper.find('[data-testid="layout-pane-days"] [data-testid="day-grid-view"]').exists()).toBe(true)
      expect(wrapper.findAll('[data-testid="day-tile"]')).toHaveLength(count)
    }
  })
})

describe('DayGridView calendar icons', () => {
  it('puts the icon before the title of a card, and leaves an event without one bare', async () => {
    const wrapper = await open({ events: [event(1, { display_title: 'Dinner', icon: '🍽️' }), event(2, { display_title: 'Dentist', icon: null, start: '2026-10-28T09:00:00Z', end: '2026-10-28T10:00:00Z' })] })

    const cards = tile(wrapper, '2026-10-28').findAll('[data-testid="event"]')
    expect(cards.map(card => card.find('.name').text())).toEqual(['Dentist', '🍽️ Dinner'])
  })
})
