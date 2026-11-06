import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import WeekView from '~/components/views/WeekView.vue'
import { fixtureEvents } from '../helpers/fixtureEvents'
import { NO_SPECIAL_DAYS } from '~/utils/views'
import type { ViewProps } from '~/utils/views'
import type { Takeover, TileDecoration } from '../../shared/special-days'
import type { CalendarEvent } from '../../shared/types/events'
import type { WeatherSnapshot } from '../../shared/weather'

// The week view on the fixture family and the day the mocks are set on, Wed 28
// Oct 2026. The layout itself is tested in test/unit/shared/week-layout.test.ts;
// this is that it is drawn, and drawn from the right week.

const NOW = new Date('2026-10-28T09:41:00Z')
const events = fixtureEvents()

const weather: WeatherSnapshot = {
  current: { condition: 'rainy', temperature: 12.4 },
  daily: [
    { date: '2026-10-27', condition: 'cloudy', high: 13, low: 7 },
    { date: '2026-10-28', condition: 'rainy', high: 14, low: 8 },
    { date: '2026-10-29', condition: 'sunny', high: 12.6, low: null },
  ],
  temperature_unit: '°C',
  updated_at: NOW.toISOString(),
}

const props = (overrides: Partial<ViewProps> = {}): ViewProps => ({
  view: 'week', stage: { width: 2560, height: 1440, orientation: 'landscape' }, events, now: NOW, timezone: 'Europe/London', month: '2026-10', weekOf: '2026-10-28', weekHours: { from: 7, to: 21 }, weekStart: 'monday', weather: null, specialDays: NO_SPECIAL_DAYS, ...overrides,
})

const person = { id: 'mum', name: 'Mum', initial: 'M', colour: '#C67139' }
const event = (id: number, overrides: Partial<CalendarEvent>): CalendarEvent => ({
  id, calendar_id: 'family', title: `Event ${id}`, display_title: `Event ${id}`, location: null,
  start: '2026-10-28T14:00:00Z', end: '2026-10-28T15:00:00Z', all_day: false, start_date: null, end_date: null, people: [person],
  ...overrides,
})

type Wrapper = Awaited<ReturnType<typeof mountSuspended>>
const tile = (wrapper: Wrapper, date: string) => wrapper.find(`[data-testid="day-tile"][data-date="${date}"]`)

describe('WeekView', () => {
  it('draws seven tiles for the week, with today flagged once', async () => {
    const wrapper = await mountSuspended(WeekView, { props: props() })

    const tiles = wrapper.findAll('[data-testid="day-tile"]')
    expect(tiles.map(day => day.attributes('data-date'))).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'])
    expect(tiles.filter(day => day.attributes('data-today') === 'true').map(day => day.attributes('data-date'))).toEqual(['2026-10-28'])
    expect(wrapper.find('[data-testid="today-number"]').text()).toBe('28')
    // The days before today are veiled, as one strip that covers the gap between them.
    const veils = wrapper.findAll('[data-testid="veil"]')
    expect(veils).toHaveLength(1)
    expect(veils[0]!.attributes('style')).toContain('grid-column: 2 / span 2')
  })

  it('titles the week, with the year apart', async () => {
    const wrapper = await mountSuspended(WeekView, { props: props() })

    expect(wrapper.find('[data-testid="week-title"]').text()).toBe('26 October – 1 November 2026')
    expect(wrapper.find('[data-testid="week-title"] .year').text()).toBe('2026')
  })

  it('shows the week of the date it is given, not of today', async () => {
    const wrapper = await mountSuspended(WeekView, { props: props({ weekOf: '2026-12-02' }) })

    expect(wrapper.find('[data-testid="week-title"]').text()).toBe('30 November – 6 December 2026')
    expect(tile(wrapper, '2026-12-02').exists()).toBe(true)
    expect(wrapper.find('[data-testid="today-number"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="now-line"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="veil"]')).toHaveLength(0)
  })

  it('starts the week on Sunday when asked to', async () => {
    const wrapper = await mountSuspended(WeekView, { props: props({ weekStart: 'sunday' }) })

    expect(wrapper.findAll('[data-testid="day-tile"]')[0]!.attributes('data-date')).toBe('2026-10-25')
  })

  it('draws an all-day event as a bar and a timed one as a block, each with its person\'s initial', async () => {
    const wrapper = await mountSuspended(WeekView, { props: props() })

    const bar = wrapper.findAll('[data-kind="bar"]').find(candidate => candidate.text().includes('Half term'))!
    expect(bar.attributes('data-testid')).toBe('event')
    expect(bar.find('.badge').text()).toBe('H')

    const block = wrapper.findAll('[data-kind="block"]').find(candidate => candidate.text().includes('1:1 with Priya'))!
    expect(block.attributes('data-testid')).toBe('event')
    expect(block.text()).toContain('14:00')
    expect(block.find('.badge').text()).toBe('D')
  })

  it('puts overlapping blocks side by side, on tracks', async () => {
    const wrapper = await mountSuspended(WeekView, { props: props() })

    const blocks = wrapper.findAll('[data-kind="block"]')
    const byTitle = (title: string) => blocks.find(candidate => candidate.text().includes(title))!
    const party = byTitle('party')
    const trick = byTitle('rick or treat')
    expect([party.attributes('data-tracks'), trick.attributes('data-tracks')]).toEqual(['2', '2'])
    expect(new Set([party.attributes('data-track'), trick.attributes('data-track')])).toEqual(new Set(['0', '1']))
    expect(trick.attributes('style')).toContain('width: 50%')
  })

  it('gives a block with no neighbour the whole column', async () => {
    const wrapper = await mountSuspended(WeekView, { props: props({ events: [event(1, {})] }) })

    const block = wrapper.find('[data-kind="block"]')
    expect(block.attributes('data-tracks')).toBe('1')
    expect(block.attributes('style')).toContain('left: 0%')
    expect(block.attributes('style')).toContain('width: 100%')
  })

  it('draws a block at its minutes of the hour scale, and dims one that is over', async () => {
    const wrapper = await mountSuspended(WeekView, { props: props({
      events: [
        event(1, { start: '2026-10-28T08:00:00Z', end: '2026-10-28T09:00:00Z', display_title: 'Over' }),
        event(2, { start: '2026-10-28T14:00:00Z', end: '2026-10-28T15:30:00Z', display_title: 'Later' }),
      ],
    }) })

    const [over, later] = wrapper.findAll('[data-kind="block"]')
    // 07:00 to 21:00 is 840 minutes: 08:00 is 60 of them, and an hour and a half is 90.
    expect(over!.classes()).toContain('past')
    expect(over!.attributes('style')).toContain(`top: ${60 / 840 * 100}%`)
    expect(later!.classes()).not.toContain('past')
    expect(later!.attributes('style')).toContain(`top: ${420 / 840 * 100}%`)
    expect(later!.attributes('style')).toContain(`height: ${90 / 840 * 100}%`)
    // One hour label for each hour drawn.
    expect(wrapper.findAll('.hour-label').map(label => label.text())).toHaveLength(14)
    expect(wrapper.find('.hour-label').text()).toBe('07:00')
  })

  it('draws the now line in today\'s column, with the time, at 09:41', async () => {
    const wrapper = await mountSuspended(WeekView, { props: props() })

    expect(wrapper.findAll('[data-testid="now-line"]')).toHaveLength(1)
    expect(wrapper.find('[data-testid="now-time"]').text()).toBe('09:41')
    expect(wrapper.find('[data-testid="now-line"]').attributes('style')).toContain(`top: ${161 / 840 * 100}%`)
  })

  it('puts the now line at the edge of a band when now is in the folded hours', async () => {
    const wrapper = await mountSuspended(WeekView, { props: props({ now: new Date('2026-10-28T05:30:00Z') }) })

    expect(wrapper.find('[data-testid="now-line"]').classes()).toContain('at-bottom')
    expect(wrapper.find('[data-testid="now-time"]').exists()).toBe(false)
  })

  it('folds the hours outside the range into bands, with what is wholly inside them', async () => {
    const wrapper = await mountSuspended(WeekView, { props: props({
      events: [
        event(1, { start: '2026-10-28T06:15:00Z', end: '2026-10-28T06:45:00Z', display_title: 'Early run' }),
        event(2, { start: '2026-10-28T22:00:00Z', end: '2026-10-28T23:00:00Z', display_title: 'Late call' }),
        event(3, { start: '2026-10-28T22:30:00Z', end: '2026-10-28T23:00:00Z', display_title: 'Later call' }),
      ],
    }) })

    const items = wrapper.findAll('[data-testid="band-item"]')
    expect(items.map(item => [item.attributes('data-band'), item.text()])).toEqual([
      ['early', expect.stringContaining('06:15')],
      ['late', expect.stringContaining('Late call')],
    ])
    expect(wrapper.findAll('.band-label').map(label => label.text())).toEqual(['00–07', '21–24'])
    expect(wrapper.find('.chip-more').text()).toBe('+1')
    expect(wrapper.findAll('[data-kind="block"]')).toHaveLength(0)
  })

  it('has no bands when every hour is drawn', async () => {
    const wrapper = await mountSuspended(WeekView, { props: props({ weekHours: { from: 0, to: 24 } }) })

    expect(wrapper.find('.band-label').exists()).toBe(false)
    expect(wrapper.findAll('.hour-label')).toHaveLength(24)
  })

  it('draws no strip for a week with nothing all day, and none of the blocks for an empty week', async () => {
    const wrapper = await mountSuspended(WeekView, { props: props({ events: [] }) })

    expect(wrapper.find('.strip').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="event"]')).toHaveLength(0)
    expect(wrapper.findAll('[data-testid="day-tile"]')).toHaveLength(7)
  })

  it('shows "+N more" in a crowded day', async () => {
    const crowded = [1, 2, 3, 4].map(id => event(id, { all_day: true, start_date: '2026-10-28', end_date: '2026-10-29', start: '2026-10-28T00:00:00Z', end: '2026-10-29T00:00:00Z' }))
    const wrapper = await mountSuspended(WeekView, { props: props({ events: crowded }) })

    expect(wrapper.find('[data-testid="more"]').text()).toBe('+2 more')
    expect(wrapper.findAll('[data-kind="bar"]')).toHaveLength(2)
  })

  describe('weather', () => {
    it('draws nothing without a snapshot', async () => {
      const wrapper = await mountSuspended(WeekView, { props: props() })

      expect(wrapper.find('[data-testid="day-weather"]').exists()).toBe(false)
    })

    it('puts each day\'s forecast in its heading, and leaves out a day the forecast does not cover', async () => {
      const wrapper = await mountSuspended(WeekView, { props: props({ weather }) })

      expect(wrapper.findAll('[data-testid="day-weather"]').map(day => day.text())).toEqual(['13° / 7°', '14° / 8°', '13°'])
      expect(wrapper.find('[data-testid="day-weather"] svg').classes()).toContain('lucide-cloud-icon')
    })
  })

  describe('special days', () => {
    const pumpkin: TileDecoration = { id: 'halloween', name: 'Halloween', palette: 'night', tile_art: 'pumpkin.svg' }
    const birthday: TileDecoration = { id: 'isla', name: 'Isla\'s birthday', palette: 'warm', tile_art: 'cake.webp' }
    const takeover: Takeover = { id: 'halloween', name: 'Halloween', date: '2026-10-28', greeting: 'Happy Halloween', palette: 'night', full_art: 'wall.webp', extra_art: null }

    it('draws nothing special with nothing to draw', async () => {
      const wrapper = await mountSuspended(WeekView, { props: props() })

      expect(wrapper.find('[data-testid="tile-art"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="greeting"]').exists()).toBe(false)
      expect(wrapper.find('[data-special]').exists()).toBe(false)
    })

    it('marks a decorated tile with its first day and draws the art of every day on it, in order', async () => {
      const specialDays = { tiles: [{ date: '2026-10-31', days: [pumpkin, birthday] }, { date: '2026-10-30', days: [{ ...pumpkin, tile_art: null }] }, { date: '2027-03-01', days: [pumpkin] }], takeover: null }
      const wrapper = await mountSuspended(WeekView, { props: props({ specialDays }) })

      expect(wrapper.findAll('[data-special]').map(day => [day.attributes('data-date'), day.attributes('data-special')])).toEqual([['2026-10-30', 'halloween'], ['2026-10-31', 'halloween']])
      expect(wrapper.findAll('[data-testid="tile-art"]').map(image => image.attributes('src'))).toEqual(['/special-days/pumpkin.svg', '/special-days/cake.webp'])
      expect(tile(wrapper, '2026-10-30').attributes('data-special')).toBe('halloween')
    })

    it('draws the greeting only with a takeover', async () => {
      const wrapper = await mountSuspended(WeekView, { props: props({ specialDays: { tiles: [], takeover } }) })

      expect(wrapper.find('[data-testid="greeting"]').text()).toBe('Happy Halloween')
      expect(wrapper.find('[data-testid="greeting"]').attributes('style')).toContain('font-size: 56px')

      await wrapper.setProps({ specialDays: { tiles: [], takeover: { ...takeover, greeting: null } } })

      expect(wrapper.find('[data-testid="greeting"]').exists()).toBe(false)
    })
  })
})
