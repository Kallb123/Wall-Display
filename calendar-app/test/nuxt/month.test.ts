import { describe, expect, it } from 'vitest'
import type { DOMWrapper } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import MonthSoftView from '~/components/views/MonthSoftView.vue'
import { fixtureEvents } from '../helpers/fixtureEvents'
import { NO_SPECIAL_DAYS } from '~/utils/views'
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
  view: 'month', events, now: NOW, timezone: 'Europe/London', month: '2026-10', weekStart: 'monday', weather: null, specialDays: NO_SPECIAL_DAYS, ...overrides,
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

  describe('special days', () => {
    const pumpkin: TileDecoration = { id: 'halloween', name: 'Halloween', palette: 'night', tile_art: 'pumpkin.svg' }
    const birthday: TileDecoration = { id: 'isla', name: 'Isla\'s birthday', palette: 'warm', tile_art: 'cake.webp' }
    const takeover: Takeover = { id: 'halloween', name: 'Halloween', date: '2026-10-28', greeting: 'Happy Halloween', palette: 'night', full_art: 'wall.webp', extra_art: null }

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
})
