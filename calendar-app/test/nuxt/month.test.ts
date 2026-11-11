import { describe, expect, it, vi } from 'vitest'
import type { DOMWrapper } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import MonthSoftView from '~/components/views/MonthSoftView.vue'
import { fixtureEvents } from '../helpers/fixtureEvents'
import { eventFill } from '~/utils/eventFill'
import { personFill } from '~/utils/themes'
import { NO_SPECIAL_DAYS } from '~/utils/views'
import { DEFAULT_PANE_OPTIONS } from '../../shared/layouts'
import type { ResolvedPaneOptions } from '../../shared/layouts'
import type { ViewProps } from '~/utils/views'
import type { Takeover, TileDecoration } from '../../shared/special-days'
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
  view: 'month', stage: { width: 2560, height: 1440, orientation: 'landscape' }, events, now: NOW, timezone: 'Europe/London', month: '2026-10', weekStart: 'monday', weekOf: '2026-10-28', weekHours: { from: 7, to: 21 }, dayParts: { afternoon: 12, evening: 17 }, weather: null, specialDays: NO_SPECIAL_DAYS, ...overrides,
})

vi.mock('~/utils/eventFill', { spy: true })
/** The backgrounds `eventFill` has given so far: the test DOM drops a gradient it cannot parse (color-mix), so what a view drew is read from what it was handed. */
const fillsGiven = () => vi.mocked(eventFill).mock.results.map(result => (result.value as { background: string }).background)

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

  describe('special days', () => {
    const pumpkin: TileDecoration = { id: 'halloween', name: 'Halloween', palette: 'night', tile_art: 'pumpkin.svg' }
    const birthday: TileDecoration = { id: 'isla', name: 'Isla\'s birthday', palette: 'warm', tile_art: 'cake.webp' }
    const takeover: Takeover = { id: 'halloween', name: 'Halloween', date: '2026-10-28', greeting: 'Happy Halloween', palette: 'night', full_art: 'wall.webp', extra_art: null, full_art_portrait: null, backdrop_art: null, backdrop_art_portrait: null, extra_art_portrait: null }

    const tile = (wrapper: Awaited<ReturnType<typeof mountSuspended>>, date: string) => wrapper.find(`[data-testid="day-tile"][data-date="${date}"]`)

    it('draws nothing special with nothing to draw', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: props() })

      expect(wrapper.find('[data-testid="tile-art"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="greeting"]').exists()).toBe(false)
      expect(wrapper.find('[data-special]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="panel"]').classes()).not.toContain('takeover')
      // The tiles are what they were: no tint in any of them.
      expect(wrapper.findAll('[data-testid="day-tile"]').every(day => !day.attributes('style')?.includes('color-mix'))).toBe(true)
    })

    it('marks a decorated tile with its first day, and draws the art of every day on it, in order', async () => {
      const specialDays = { tiles: [{ date: '2026-10-31', days: [pumpkin, birthday] }, { date: '2026-10-30', days: [{ ...pumpkin, tile_art: null }] }], takeover: null }
      const wrapper = await mountSuspended(MonthSoftView, { props: props({ specialDays }) })

      expect(wrapper.findAll('[data-special]').map(day => [day.attributes('data-date'), day.attributes('data-special')])).toEqual([['2026-10-30', 'halloween'], ['2026-10-31', 'halloween']])
      const art = wrapper.findAll('[data-testid="tile-art"]')
      expect(art.map(image => image.attributes('src'))).toEqual(['/special-days/pumpkin.svg', '/special-days/cake.webp'])
      expect(art.every(image => image.attributes('alt') === '')).toBe(true)
      // Beside the date it belongs to: the art is in a box of its own in the same week row, in that column.
      expect(art[0]!.element.parentElement!.classList).toContain('tile-art')
    })

    // The test DOM drops a `background` it can't parse (color-mix), so the tint is read from the ring of the timed events on the tile, which is the tile's own background and kept as a custom property.
    const ringsOn = (wrapper: Awaited<ReturnType<typeof mountSuspended>>, week: number, column: number) => {
      const styles = wrapper.findAll('.week')[week]!.findAll('[data-kind="timed"]').map((row: DOMWrapper<Element>) => row.attributes('style')!)
      return [...new Set(styles.filter((style: string) => style.includes(`grid-column: ${column};`)).map((style: string) => /--ring: ([^;]+);/.exec(style)![1]))]
    }

    it('tints the tile with the first day\'s palette accent at 26%, mixed into what the tile would have been', async () => {
      const specialDays = {
        tiles: [
          // A birthday first: the warm accent is the display's own. Today's cell, one outside the month and one in it each keep their own base.
          { date: '2026-10-28', days: [birthday, pumpkin] },
          { date: '2026-10-31', days: [pumpkin, birthday] },
          { date: '2026-09-30', days: [pumpkin] },
        ],
        takeover: null,
      }
      const wrapper = await mountSuspended(MonthSoftView, { props: props({ specialDays }) })

      // Wed 30 Sep is in the first week and Wed 28 Oct in the last, both in the third column; Sat 31 Oct is in the sixth.
      expect(ringsOn(wrapper, 0, 3)).toEqual(['color-mix(in oklab, var(--color-accent-400) 26%, var(--tile-out))'])
      expect(ringsOn(wrapper, 4, 3)).toEqual(['color-mix(in oklab, var(--accent) 26%, var(--today-cell))'])
      expect(ringsOn(wrapper, 4, 6)).toEqual(['color-mix(in oklab, var(--color-accent-400) 26%, var(--tile))'])
      // The days either side are not decorated.
      expect(ringsOn(wrapper, 4, 4)).toEqual(['var(--tile)'])
    })

    it('draws only the tint for a day with no art', async () => {
      const specialDays = { tiles: [{ date: '2026-10-30', days: [{ ...pumpkin, tile_art: null }] }], takeover: null }
      const wrapper = await mountSuspended(MonthSoftView, { props: props({ specialDays }) })

      expect(tile(wrapper, '2026-10-30').attributes('data-special')).toBe('halloween')
      expect(wrapper.find('[data-testid="tile-art"]').exists()).toBe(false)
    })

    it('ignores a date that has no decorations, and one outside the grid', async () => {
      const specialDays = { tiles: [{ date: '2026-10-29', days: [] }, { date: '2027-03-01', days: [pumpkin] }], takeover: null }
      const wrapper = await mountSuspended(MonthSoftView, { props: props({ specialDays }) })

      expect(wrapper.find('[data-special]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="tile-art"]').exists()).toBe(false)
    })

    it('puts the greeting at the top of the panel and lets the panel shrink to its content', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: props({ specialDays: { tiles: [], takeover } }) })

      const panel = wrapper.find('[data-testid="panel"]')
      expect(panel.classes()).toContain('takeover')
      expect(panel.element.firstElementChild).toBe(wrapper.find('[data-testid="greeting"]').element)
      expect(wrapper.find('[data-testid="greeting"]').text()).toBe('Happy Halloween')
    })

    it('sets a long greeting smaller, so it still fits the panel', async () => {
      const long = 'Happy birthday to the best and bravest seven year old in the whole wide world, Isla!'
      const wrapper = await mountSuspended(MonthSoftView, { props: props({ specialDays: { tiles: [], takeover: { ...takeover, greeting: long } } }) })

      expect(wrapper.find('[data-testid="greeting"]').attributes('style')).toContain('font-size: 38px')
    })

    it('shrinks the panel for a takeover with no greeting, and draws no greeting', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: props({ specialDays: { tiles: [], takeover: { ...takeover, greeting: null } } }) })

      expect(wrapper.find('[data-testid="greeting"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="panel"]').classes()).toContain('takeover')
    })
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

  describe('weather in the day cells', () => {
    const pumpkin: TileDecoration = { id: 'halloween', name: 'Halloween', palette: 'night', tile_art: 'pumpkin.svg' }
    type Wrapper = Awaited<ReturnType<typeof mountSuspended>>
    const cells = (wrapper: Wrapper): DOMWrapper<Element>[] => wrapper.findAll('[data-testid="cell-weather"]')
    const dates = (wrapper: Wrapper) => cells(wrapper).map(cell => cell.attributes('data-date'))

    it('has the icon and the high on today and the days after that have a forecast, and nowhere else', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: props({ weather }) })

      // Yesterday has a forecast but is over; the 30th has a low and nothing to draw; the rest have none.
      expect(dates(wrapper)).toEqual(['2026-10-28', '2026-10-29'])
      expect(cells(wrapper)[0]!.text()).toBe('14°')
      expect(cells(wrapper)[0]!.find('svg').classes()).toContain('lucide-cloud-rain-icon')
      expect(cells(wrapper)[1]!.text()).toBe('13°')
    })

    it('draws nothing without a snapshot', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: props() })

      expect(cells(wrapper)).toHaveLength(0)
    })

    it('is on the days of a neighbouring month that are shown', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: props({ weather, month: '2026-09', now: new Date('2026-09-30T09:00:00Z') }) })
      const next = { ...weather, daily: [{ date: '2026-10-01', condition: 'sunny' as const, high: 15, low: 9 }, ...weather.daily] }
      await wrapper.setProps({ weather: next })

      expect(dates(wrapper)).toContain('2026-10-01')
    })

    it('is the icon alone on the portrait stage', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: props({ weather, stage: { width: 1440, height: 2560, orientation: 'portrait' } }) })

      expect(dates(wrapper)).toEqual(['2026-10-28', '2026-10-29'])
      for (const cell of cells(wrapper)) {
        expect(cell.text()).toBe('')
        expect(cell.find('svg').exists()).toBe(true)
      }
    })

    it('is the icon alone in a small pane, and gone from one too narrow for it', async () => {
      const small = await mountSuspended(MonthSoftView, { props: props({ weather, pane: true, stage: { width: 1200, height: 800, orientation: 'landscape' }, paneOptions: { ...DEFAULT_PANE_OPTIONS, show_sidebar: false } }) })
      expect(cells(small)[0]!.text()).toBe('')
      expect(cells(small)[0]!.find('svg').exists()).toBe(true)

      const tiny = await mountSuspended(MonthSoftView, { props: props({ weather, pane: true, stage: { width: 700, height: 800, orientation: 'landscape' }, paneOptions: { ...DEFAULT_PANE_OPTIONS, show_sidebar: false } }) })
      expect(cells(tiny)).toHaveLength(0)
    })

    it('leaves out the tile of a special day with art in its corner', async () => {
      const specialDays = { tiles: [{ date: '2026-10-29', days: [pumpkin] }], takeover: null }
      const wrapper = await mountSuspended(MonthSoftView, { props: props({ weather, specialDays }) })

      expect(dates(wrapper)).toEqual(['2026-10-28'])
    })

    it('is off when the display\'s preference for the month is off, and on when it is another view that is', async () => {
      const off = await mountSuspended(MonthSoftView, { props: props({ weather, weatherOnDates: { month: false, week: true, week_parts: true, agenda: true } }) })
      expect(cells(off)).toHaveLength(0)

      const other = await mountSuspended(MonthSoftView, { props: props({ weather, weatherOnDates: { month: true, week: false, week_parts: false, agenda: false } }) })
      expect(cells(other)).toHaveLength(2)
    })

    it('goes by the pane option in a pane, whatever the preference says', async () => {
      const off = await mountSuspended(MonthSoftView, { props: props({ weather, paneOptions: { ...DEFAULT_PANE_OPTIONS, weather_on_dates: false } }) })
      expect(cells(off)).toHaveLength(0)

      const on = await mountSuspended(MonthSoftView, { props: props({ weather, weatherOnDates: { month: false, week: true, week_parts: true, agenda: true }, paneOptions: { ...DEFAULT_PANE_OPTIONS, weather_on_dates: true } }) })
      expect(cells(on)).toHaveLength(2)
    })

    it('leaves the panel\'s and the cards\' weather as it was when it is off', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: props({ weather, weatherOnDates: { month: false, week: false, week_parts: false, agenda: false }, paneOptions: { ...DEFAULT_PANE_OPTIONS, weather_on_dates: false } }) })

      expect(wrapper.findAll('[data-testid="panel-day"] [data-testid="day-weather"]')).toHaveLength(3)
      expect(wrapper.find('[data-testid="weather-now"]').exists()).toBe(true)

      const portrait = await mountSuspended(MonthSoftView, { props: props({ weather, stage: { width: 1440, height: 2560, orientation: 'portrait' }, weatherOnDates: { month: false, week: true, week_parts: true, agenda: true } }) })
      expect(portrait.find('[data-testid="today-high-low"]').exists()).toBe(true)
      expect(portrait.findAll('[data-testid="next-days"] [data-testid="day-weather"]')).toHaveLength(2)
    })
  })

  describe('portrait', () => {
    const portrait = (overrides: Partial<ViewProps> = {}) => props({ stage: { width: 1440, height: 2560, orientation: 'portrait' }, weather, ...overrides })
    /** `count` timed events on `date` from 10:00 (so none is over at 09:41). */
    const crowd = (date: string, count: number) => Array.from({ length: count }, (_, index) => ({
      ...events.find(event => !event.all_day)!,
      id: 9000 + index + Number(date.slice(8)) * 20,
      display_title: `Crowd ${index + 1}`,
      start: `${date}T${String(10 + index).padStart(2, '0')}:00:00.000Z`,
      end: `${date}T${String(10 + index).padStart(2, '0')}:30:00.000Z`,
    }))

    it('has a band for today, with the date, weekday, weather and high and low, and no landscape panel', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: portrait() })

      const band = wrapper.find('[data-testid="today-band"]')
      expect(band.exists()).toBe(true)
      expect(wrapper.find('[data-testid="panel"]').exists()).toBe(false)
      expect(band.find('[data-testid="panel-date"]').text()).toBe('28')
      expect(band.text()).toContain('Wednesday')
      expect(band.find('[data-testid="weather-now"]').text()).toBe('12° · Rain')
      expect(band.find('[data-testid="today-high-low"]').text()).toBe('High 14° · Low 8°')
      expect(band.text()).toContain('All day')
      expect(band.find('[data-testid="panel-more"]').exists()).toBe(false)
    })

    it('leaves the high and low out with no forecast', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: portrait({ weather: null }) })

      expect(wrapper.find('[data-testid="today-high-low"]').exists()).toBe(false)
    })

    it('shows "+N more" after seven rows in the band', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: portrait({ events: [...events, ...crowd('2026-10-28', 9)] }) })

      const band = wrapper.find('[data-testid="today-band"]')
      expect(band.findAll('[data-testid="event"]')).toHaveLength(6)
      expect(band.find('[data-testid="panel-more"]').exists()).toBe(true)
    })

    it('has a strip of Tomorrow, Friday and Saturday, with the weather where there is some', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: portrait() })

      const cards = wrapper.find('[data-testid="next-days"]').findAll('[data-testid="panel-day"]')
      expect(cards.map(card => card.find('h2').text())).toEqual(['Tomorrow', 'Friday', 'Saturday'])
      expect(cards.map(card => card.attributes('data-date'))).toEqual(['2026-10-29', '2026-10-30', '2026-10-31'])
      expect(cards[0]!.find('[data-testid="day-weather"]').exists()).toBe(true)
      expect(cards[2]!.find('[data-testid="day-weather"]').exists()).toBe(false)
    })

    it('limits a strip card to four rows, counting "+N more"', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: portrait({ events: [...events, ...crowd('2026-10-29', 8)] }) })

      const card = wrapper.find('[data-testid="next-days"] [data-testid="panel-day"]')
      expect(card.findAll('[data-testid="event"]')).toHaveLength(3)
      expect(card.find('[data-testid="panel-more"]').exists()).toBe(true)
    })

    it('draws a timed row in the grid as its badge and title, with no time, and lays out six lanes', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: portrait({ events: [...events, ...crowd('2026-10-14', 8)] }) })

      const timed = wrapper.findAll('[data-kind="timed"]')
      expect(timed.length).toBeGreaterThan(0)
      for (const row of timed) expect(row.find('.time').exists()).toBe(false)
      // A crowded day's "+N more" is in the sixth lane, which is grid row 7 (the date is row 1).
      const more = wrapper.findAll('[data-testid="more"]').find(label => label.attributes('style')?.includes('grid-row: 7'))
      expect(more).toBeDefined()
    })

    it('puts the greeting in the band during a takeover', async () => {
      const takeover: Takeover = { id: 'halloween', name: 'Halloween', date: '2026-10-28', greeting: 'Happy Halloween', palette: 'night', full_art: 'wall.webp', extra_art: null, full_art_portrait: null, backdrop_art: null, backdrop_art_portrait: null, extra_art_portrait: null }
      const wrapper = await mountSuspended(MonthSoftView, { props: portrait({ specialDays: { tiles: [], takeover } }) })

      const band = wrapper.find('[data-testid="today-band"]')
      expect(band.find('[data-testid="greeting"]').text()).toBe('Happy Halloween')
      expect(band.classes()).toContain('takeover')
    })

    it('shows a pinned month in the grid while the band stays on today', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: portrait({ month: '2026-12' }) })

      expect(wrapper.find('[data-testid="month-title"]').text()).toBe('December 2026')
      expect(wrapper.find('[data-testid="today-number"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="today-band"] [data-testid="panel-date"]').text()).toBe('28')
      expect(wrapper.find('[data-testid="next-days"] [data-testid="panel-day"]').attributes('data-date')).toBe('2026-10-29')
    })

    it('draws nothing portrait on the landscape stage', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: props() })

      expect(wrapper.find('[data-testid="today-band"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="next-days"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="today-high-low"]').exists()).toBe(false)
    })
  })
  describe('pane options', () => {
    const takeover: Takeover = { id: 'halloween', name: 'Halloween', date: '2026-10-28', greeting: 'Happy Halloween', palette: 'night', full_art: 'wall.webp', extra_art: null, full_art_portrait: null, backdrop_art: null, backdrop_art_portrait: null, extra_art_portrait: null }
    const portraitStage = { width: 1440, height: 2560, orientation: 'portrait' } as const
    /** useWrapFit runs in an animation frame after mounting. */
    const afterFit = () => new Promise(resolve => setTimeout(resolve, 50))
    const options = (overrides: Partial<ResolvedPaneOptions>): ResolvedPaneOptions => ({ ...DEFAULT_PANE_OPTIONS, ...overrides })

    it('is unchanged without options: title, panel and no wrapping marks', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: props() })

      expect(wrapper.find('[data-testid="month-title"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="panel"]').exists()).toBe(true)
      expect(wrapper.find('[data-wrap]').exists()).toBe(false)
      expect(wrapper.find('.head').exists()).toBe(false)
      expect(wrapper.findAll('.tall')).toHaveLength(0)
      const timed = wrapper.findAll('[data-kind="timed"]')[0]!
      expect(timed.attributes('style')).not.toContain('background')
    })

    it('hides the title in both orientations and keeps the sidebar', async () => {
      const landscape = await mountSuspended(MonthSoftView, { props: props({ paneOptions: options({ show_title: false }) }) })
      expect(landscape.find('[data-testid="month-title"]').exists()).toBe(false)
      expect(landscape.find('[data-testid="panel"]').exists()).toBe(true)

      const portrait = await mountSuspended(MonthSoftView, { props: props({ stage: portraitStage, paneOptions: options({ show_title: false }) }) })
      expect(portrait.find('[data-testid="month-title"]').exists()).toBe(false)
      expect(portrait.find('[data-testid="today-band"]').exists()).toBe(true)
    })

    it('hides the panel without the sidebar, leaving the title above the weeks', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: props({ paneOptions: options({ show_sidebar: false }) }) })

      expect(wrapper.find('[data-testid="panel"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="panel-day"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="month-title"]').text()).toBe('October 2026')
      expect(wrapper.findAll('[data-testid="day-tile"]')).toHaveLength(35)
    })

    it('hides the band and the strip in portrait, and draws no header with nothing to put in it', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: props({ stage: portraitStage, paneOptions: options({ show_sidebar: false, show_title: false }) }) })

      for (const id of ['today-band', 'next-days', 'panel-day', 'panel-date', 'month-title']) expect(wrapper.find(`[data-testid="${id}"]`).exists()).toBe(false)
      expect(wrapper.find('.head').exists()).toBe(false)
      expect(wrapper.findAll('[data-testid="day-tile"]')).toHaveLength(35)
    })

    it('still draws a takeover\'s greeting when its panel is hidden', async () => {
      const specialDays = { tiles: [], takeover }
      for (const stage of [{ width: 2560, height: 1440, orientation: 'landscape' } as const, portraitStage]) {
        const withTitle = await mountSuspended(MonthSoftView, { props: props({ stage, specialDays, paneOptions: options({ show_sidebar: false }) }) })
        expect(withTitle.find('.head [data-testid="greeting"]').text()).toBe('Happy Halloween')
        expect(withTitle.find('.head [data-testid="month-title"]').exists()).toBe(true)

        const alone = await mountSuspended(MonthSoftView, { props: props({ stage, specialDays, paneOptions: options({ show_sidebar: false, show_title: false }) }) })
        expect(alone.find('.head [data-testid="greeting"]').text()).toBe('Happy Halloween')
        expect(alone.find('[data-testid="month-title"]').exists()).toBe(false)
      }
    })

    it('fills timed rows and panel rows with the person\'s colour', async () => {
      const solo = { ...events.find(event => !event.all_day)!, id: 9900, display_title: 'Bins out', people: [], start: '2026-10-29T10:00:00.000Z', end: '2026-10-29T10:30:00.000Z' }
      const wrapper = await mountSuspended(MonthSoftView, { props: props({ events: [...events, solo], paneOptions: options({ fill_events: true }) }) })

      const timed = wrapper.findAll('[data-kind="timed"]').find(candidate => candidate.text().includes('1:1 with Priya'))!
      // happy-dom drops a background it cannot parse (color-mix), so the fill is checked by the ring it sets.
      expect(timed.attributes('style')).toContain('--ring: color-mix')
      expect(timed.attributes('style')).toContain('border-radius: 999px')
      const panelRow = wrapper.findAll('[data-kind="panel"]').find(candidate => candidate.text().includes('1:1 with Priya'))!
      expect(panelRow.attributes('style')).toContain('--ring: color-mix')
      expect(panelRow.classes()).toContain('filled')
      // Nobody on it: the surface colour.
      const nobody = wrapper.findAll('[data-kind="panel"]').find(candidate => candidate.text().includes('Bins out'))!
      expect(nobody.find('.badge').exists()).toBe(false)
      expect(nobody.attributes('style')).toContain('background: var(--surface)')
    })

    it('splits a filled row between several people', async () => {
      const dad = { id: 'dad', name: 'Dad', initial: 'D', colour: '#3A7CA5' }
      const mum = { id: 'mum', name: 'Mum', initial: 'M', colour: '#C67139' }
      const shared = { ...events.find(event => !event.all_day)!, id: 9901, display_title: 'Both of us', people: [mum, dad], start: '2026-10-29T10:00:00.000Z', end: '2026-10-29T10:30:00.000Z' }
      const wrapper = await mountSuspended(MonthSoftView, { props: props({ events: [...events, shared], paneOptions: options({ fill_events: true }) }) })

      const split = `linear-gradient(to right, ${personFill(mum.colour)} 0% 50%, ${personFill(dad.colour)} 50% 100%)`
      const timed = wrapper.findAll('[data-kind="timed"]').find(candidate => candidate.text().includes('Both of us'))!
      expect(timed.attributes('style')).toContain(`--ring: ${personFill(mum.colour)}`)
      expect(fillsGiven()).toContain(split)
      const panelRow = wrapper.findAll('[data-kind="panel"]').find(candidate => candidate.text().includes('Both of us'))!
      expect(panelRow.attributes('style')).toContain(`--ring: ${personFill(mum.colour)}`)
      expect(fillsGiven().filter(fill => fill === split).length).toBeGreaterThanOrEqual(2)
    })

    it('leaves the initials off filled rows only when asked', async () => {
      const badges = async (paneOptions: ResolvedPaneOptions) => {
        const wrapper = await mountSuspended(MonthSoftView, { props: props({ paneOptions }) })
        const filled = wrapper.findAll('[data-kind="timed"], [data-kind="panel"]')
        return { rows: filled.length, badges: filled.reduce((sum, row) => sum + row.findAll('.badge').length, 0), bare: wrapper.findAll('.timed.bare').length, plain: wrapper.findAll('.rows.plain').length }
      }
      const shown = await badges(options({ fill_events: true }))
      expect(shown.rows).toBeGreaterThan(0)
      expect(shown.badges).toBeGreaterThan(0)
      expect(shown.plain).toBe(0)

      const hidden = await badges(options({ fill_events: true, show_initials: false }))
      expect(hidden.badges).toBe(0)
      expect(hidden.bare).toBeGreaterThan(0)
      expect(hidden.plain).toBeGreaterThan(0)

      // Without the fill the option means nothing.
      const unfilled = await badges(options({ show_initials: false }))
      expect(unfilled.badges).toBe(shown.badges)
      expect(unfilled.plain).toBe(0)
    })

    it('fills the portrait band and the strip too', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: props({ stage: portraitStage, paneOptions: options({ fill_events: true }) }) })

      const rows = wrapper.findAll('[data-testid="today-band"] [data-kind="panel"], [data-testid="next-days"] [data-kind="panel"]')
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every(row => row.classes().includes('filled'))).toBe(true)
    })

    it('lets a timed row with a free lane below take it, and marks the panel rows to wrap', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: props({ paneOptions: options({ wrap_titles: true }) }) })
      await afterFit()

      const spanning = wrapper.findAll('[data-kind="timed"]').filter(candidate => /span [23]/.test(candidate.attributes('style') ?? ''))
      expect(spanning.length).toBeGreaterThan(0)
      expect(spanning[0]!.classes()).toContain('tall')
      // The panel's rows are all marked (nothing overflows where nothing is measured).
      const rows = wrapper.findAll('[data-testid="panel"] [data-wrap-item]')
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every(row => row.attributes('data-wrap') === 'on')).toBe(true)
      // Without the option, the same rows have no span.
      const plain = await mountSuspended(MonthSoftView, { props: props() })
      expect(plain.findAll('[data-kind="timed"]').some(candidate => /span/.test(candidate.attributes('style') ?? ''))).toBe(false)
    })

    it('leaves the portrait band out of the wrapping, and measures the strip\'s cards', async () => {
      const wrapper = await mountSuspended(MonthSoftView, { props: props({ stage: portraitStage, paneOptions: options({ wrap_titles: true }) }) })
      await afterFit()

      expect(wrapper.find('[data-testid="today-band"]').element.closest('[data-wrap-box]')).toBeNull()
      expect(wrapper.find('[data-testid="today-band"] [data-wrap]').exists()).toBe(false)
      expect(wrapper.findAll('[data-testid="next-days"] [data-wrap-box]')).toHaveLength(3)
      expect(wrapper.find('[data-testid="next-days"] [data-wrap="on"]').exists()).toBe(true)
    })
  })
})

describe('MonthSoftView locations', () => {
  const portraitStage = { width: 1440, height: 2560, orientation: 'portrait' } as const
  const afterFit = () => new Promise(resolve => setTimeout(resolve, 50))
  const base = events.find(event => !event.all_day)!
  const at = (id: number, title: string, location: string | null, day = '2026-10-28') => ({ ...base, id, display_title: title, icon: null, people: [], location, start: `${day}T14:00:00.000Z`, end: `${day}T15:00:00.000Z` })
  const withLocations = () => [
    at(9920, 'Swimming', 'Leisure Centre, 12 High Street, Town'),
    at(9921, 'Call', 'https://meet.example.com/abc'),
    at(9922, 'Dentist', null),
    at(9923, 'Pottery', 'Studio 4, Mill Lane', '2026-10-29'),
  ]
  const located = (overrides: Partial<ViewProps>) => props(overrides)
  const lines = (wrapper: Awaited<ReturnType<typeof mountSuspended>>) => wrapper.findAll('[data-testid="event-location"]').map((line: { text: () => string }) => line.text())

  it('draws the shortened location under the title in the panel, and nothing for none or a link', async () => {
    const wrapper = await mountSuspended(MonthSoftView, { props: located({ events: withLocations() }) })

    expect(lines(wrapper)).toEqual(['Leisure Centre', 'Studio 4'])
    const row = wrapper.findAll('[data-testid="panel"] [data-testid="event"]').find(candidate => candidate.text().includes('Swimming'))!
    expect(row.find('[data-location-line]').text()).toBe('Leisure Centre')
    const call = wrapper.findAll('[data-testid="panel"] [data-testid="event"]').find(candidate => candidate.text().includes('Call'))!
    expect(call.find('[data-location-line]').exists()).toBe(false)
  })

  it('marks the row once the fit has found room', async () => {
    const wrapper = await mountSuspended(MonthSoftView, { props: located({ events: withLocations() }) })
    await afterFit()

    const row = wrapper.findAll('[data-testid="panel"] [data-testid="event"]').find(candidate => candidate.text().includes('Swimming'))!
    expect(row.attributes('data-location')).toBe('on')
    expect(row.attributes('data-wrap')).toBeUndefined()
  })

  it('never draws a location in a day tile', async () => {
    const wrapper = await mountSuspended(MonthSoftView, { props: located({ events: withLocations() }) })

    expect(wrapper.find('[data-testid="day-tile"] [data-location-line]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="day-tile"] [data-testid="event-location"]').exists()).toBe(false)
  })

  it('shows the line when the preference is left out', async () => {
    const wrapper = await mountSuspended(MonthSoftView, { props: props({ events: withLocations(), showLocations: undefined }) })

    expect(lines(wrapper)).toEqual(['Leisure Centre', 'Studio 4'])
  })

  it('leaves the line out when the display turns locations off, or the pane does', async () => {
    const off = await mountSuspended(MonthSoftView, { props: located({ events: withLocations(), showLocations: false }) })
    expect(lines(off)).toEqual([])

    const pane = await mountSuspended(MonthSoftView, { props: located({ events: withLocations(), paneOptions: { ...DEFAULT_PANE_OPTIONS, show_locations: false } }) })
    expect(lines(pane)).toEqual([])

    const paneOn = await mountSuspended(MonthSoftView, { props: located({ events: withLocations(), showLocations: false, paneOptions: { ...DEFAULT_PANE_OPTIONS, show_locations: true } }) })
    expect(lines(paneOn)).toEqual(['Leisure Centre', 'Studio 4'])
  })

  it('draws the line in the strip\'s cards but not in the portrait band', async () => {
    const wrapper = await mountSuspended(MonthSoftView, { props: located({ stage: portraitStage, events: withLocations() }) })
    await afterFit()

    expect(wrapper.find('[data-testid="today-band"] [data-location-line]').exists()).toBe(false)
    const cards = wrapper.findAll('[data-testid="next-days"] [data-testid="event-location"]')
    expect(cards.map(line => line.text())).toEqual(['Studio 4'])
    expect(wrapper.find('[data-testid="next-days"] [data-location="on"]').exists()).toBe(true)
  })
})

describe('MonthSoftView calendar icons', () => {
  const dinner = (icon: string | null) => ({ ...events.find(event => !event.all_day)!, id: 9910, display_title: 'Dinner', icon, people: [], start: '2026-10-29T18:00:00.000Z', end: '2026-10-29T19:00:00.000Z' })
  const names = (wrapper: Awaited<ReturnType<typeof mountSuspended>>, kind: 'timed' | 'panel') =>
    wrapper.findAll(`[data-kind="${kind}"] .name`).map((name: { text: () => string }) => name.text())

  it('puts the icon before the title in a tile and in the panel', async () => {
    const wrapper = await mountSuspended(MonthSoftView, { props: props({ events: [...events, dinner('🍽️')] }) })

    expect(names(wrapper, 'timed')).toContain('🍽️ Dinner')
    expect(names(wrapper, 'panel')).toContain('🍽️ Dinner')
  })

  it('draws the bare title when the event has no icon', async () => {
    const wrapper = await mountSuspended(MonthSoftView, { props: props({ events: [...events, dinner(null)] }) })

    expect(names(wrapper, 'timed')).toContain('Dinner')
    expect(names(wrapper, 'panel')).toContain('Dinner')
  })
})
