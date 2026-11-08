import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import WeekView from '~/components/views/WeekView.vue'
import { fixtureEvents } from '../helpers/fixtureEvents'
import { NO_SPECIAL_DAYS } from '~/utils/views'
import type { ViewProps } from '~/utils/views'
import { DEFAULT_PANE_OPTIONS } from '../../shared/layouts'
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
  view: 'week', stage: { width: 2560, height: 1440, orientation: 'landscape' }, events, now: NOW, timezone: 'Europe/London', month: '2026-10', weekOf: '2026-10-28', weekHours: { from: 7, to: 21 }, dayParts: { afternoon: 12, evening: 17 }, weekStart: 'monday', weather: null, specialDays: NO_SPECIAL_DAYS, ...overrides,
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
    const takeover: Takeover = { id: 'halloween', name: 'Halloween', date: '2026-10-28', greeting: 'Happy Halloween', palette: 'night', full_art: 'wall.webp', extra_art: null, full_art_portrait: null, extra_art_portrait: null }

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

  describe('on the portrait stage', () => {
    const portrait = (overrides: Partial<ViewProps> = {}) => props({ stage: { width: 1440, height: 2560, orientation: 'portrait' }, ...overrides })
    const at = (title: string, start: string, end: string, id: number) => event(id, { display_title: title, start: `2026-10-28T${start}:00Z`, end: `2026-10-28T${end}:00Z` })

    it('is flagged, and draws the same seven tiles', async () => {
      const landscape = await mountSuspended(WeekView, { props: props() })
      const wrapper = await mountSuspended(WeekView, { props: portrait() })

      expect(wrapper.find('[data-testid="week-view"]').classes()).toContain('portrait')
      expect(landscape.find('[data-testid="week-view"]').classes()).not.toContain('portrait')
      expect(wrapper.findAll('[data-testid="day-tile"]')).toHaveLength(7)
    })

    it('puts two overlapping blocks side by side and counts the third in a chip, with no block drawn for it', async () => {
      const events = [at('A', '10:00', '11:00', 1), at('B', '10:00', '11:00', 2), at('C', '10:30', '11:30', 3)]
      const wrapper = await mountSuspended(WeekView, { props: portrait({ events }) })

      expect(wrapper.findAll('[data-kind="block"]').map(block => [block.text().includes('C'), block.attributes('data-tracks')])).toEqual([[false, '2'], [false, '2']])
      const chips = wrapper.findAll('[data-testid="overflow"]')
      expect(chips.map(chip => chip.text())).toEqual(['+1'])
      // 10:30 is 210 minutes into the 07:00 to 21:00 scale.
      expect(chips[0]!.attributes('style')).toContain(`top: ${210 / 840 * 100}%`)
    })

    it('draws all three side by side in landscape, and no chip', async () => {
      const events = [at('A', '10:00', '11:00', 1), at('B', '10:00', '11:00', 2), at('C', '10:30', '11:30', 3)]
      const wrapper = await mountSuspended(WeekView, { props: props({ events }) })

      expect(wrapper.findAll('[data-kind="block"]')).toHaveLength(3)
      expect(wrapper.find('[data-testid="overflow"]').exists()).toBe(false)
    })

    it('draws a block under 50 minutes on one line and a longer one on two', async () => {
      const events = [at('Short', '09:00', '09:40', 1), at('Long', '12:00', '13:00', 2)]
      const wrapper = await mountSuspended(WeekView, { props: portrait({ events }) })

      const [short, long] = wrapper.findAll('[data-kind="block"]')
      expect(short!.classes()).toContain('one-line')
      expect(long!.classes()).not.toContain('one-line')
    })

    it('keeps the chip\'s ring in the colour of its tile', async () => {
      const events = [at('A', '10:00', '11:00', 1), at('B', '10:00', '11:00', 2), at('C', '10:00', '11:00', 3)]
      const wrapper = await mountSuspended(WeekView, { props: portrait({ events }) })

      expect(wrapper.find('.hours[style*="--tile-bg: var(--today-cell)"]').find('[data-testid="overflow"]').exists()).toBe(true)
    })
  })
})

describe('WeekView as a pane', () => {
  const pane = (overrides: Partial<ViewProps> = {}) => props({ stage: { width: 1440, height: 1560, orientation: 'portrait' }, pane: true, ...overrides })

  it('has the short title, with where the week is in time, in place of the full one', async () => {
    const wrapper = await mountSuspended(WeekView, { props: pane() })

    expect(wrapper.find('[data-testid="week-title"] .range').text()).toBe('26 Oct – 1 Nov')
    expect(wrapper.find('[data-testid="week-label"]').text()).toBe('This week')
    expect(wrapper.findAll('[data-testid="day-tile"]')).toHaveLength(7)
    expect(wrapper.find('[data-testid="week-view"]').classes()).toContain('portrait')
  })

  it.each([
    ['2026-11-04', '2 – 8 Nov', 'Next week'],
    ['2026-10-21', '19 – 25 Oct', 'Last week'],
    ['2026-11-18', '16 – 22 Nov', '2026'],
    ['2026-12-30', '28 Dec – 3 Jan', '2026'],
  ])('names the week of %s %s, %s', async (weekOf, range, label) => {
    const wrapper = await mountSuspended(WeekView, { props: pane({ weekOf }) })

    expect(wrapper.find('[data-testid="week-title"] .range').text()).toBe(range)
    expect(wrapper.find('[data-testid="week-label"]').text()).toBe(label)
  })

  it('puts a takeover\'s greeting on its own line', async () => {
    const wrapper = await mountSuspended(WeekView, { props: pane({ specialDays: { tiles: [], takeover: { greeting: 'Happy Halloween' } as Takeover } }) })

    expect(wrapper.find('[data-testid="greeting"]').text()).toBe('Happy Halloween')
  })

  it('keeps the full title when it is not a pane', async () => {
    const wrapper = await mountSuspended(WeekView, { props: props() })

    expect(wrapper.find('[data-testid="week-label"]').exists()).toBe(false)
  })

  describe('pane options', () => {
    const takeover = { greeting: 'Happy Halloween' } as Takeover
    const options = (overrides: Partial<typeof DEFAULT_PANE_OPTIONS>) => ({ ...DEFAULT_PANE_OPTIONS, ...overrides })

    it('draws as before with no options, and with the defaults', async () => {
      for (const paneOptions of [undefined, DEFAULT_PANE_OPTIONS]) {
        const wrapper = await mountSuspended(WeekView, { props: props({ paneOptions }) })

        expect(wrapper.find('[data-testid="week-title"]').exists()).toBe(true)
        expect(wrapper.find('[data-testid="gutter"]').exists()).toBe(true)
        expect(wrapper.findAll('.hour-label')).toHaveLength(14)
        expect(wrapper.find('[data-testid="now-time"]').exists()).toBe(true)
        expect(wrapper.classes()).not.toContain('no-hours')
      }
    })

    it('hides the title, in the pane\'s short form too, and the header with it', async () => {
      for (const pane of [false, true]) {
        const wrapper = await mountSuspended(WeekView, { props: props({ pane, paneOptions: options({ show_title: false }) }) })

        expect(wrapper.find('[data-testid="week-title"]').exists()).toBe(false)
        expect(wrapper.find('.header').exists()).toBe(false)
        expect(wrapper.findAll('[data-testid="day-tile"]')).toHaveLength(7)
      }
    })

    it('keeps a takeover\'s greeting when the title is hidden', async () => {
      const wrapper = await mountSuspended(WeekView, { props: props({ paneOptions: options({ show_title: false }), specialDays: { tiles: [], takeover } }) })

      expect(wrapper.find('[data-testid="week-title"]').exists()).toBe(false)
      expect(wrapper.find('.header').exists()).toBe(true)
      expect(wrapper.find('[data-testid="greeting"]').text()).toBe('Happy Halloween')
    })

    it('hides the hour labels, the folded-band labels and the now time, and keeps the rules and the now line', async () => {
      const wrapper = await mountSuspended(WeekView, { props: props({
        paneOptions: options({ show_hours: false }),
        events: [event(1, { start: '2026-10-28T06:15:00Z', end: '2026-10-28T06:45:00Z' }), event(2, { start: '2026-10-28T09:00:00Z', end: '2026-10-28T10:00:00Z' })],
      }) })

      expect(wrapper.find('[data-testid="gutter"]').exists()).toBe(false)
      expect(wrapper.find('.hour-label').exists()).toBe(false)
      expect(wrapper.find('.band-label').exists()).toBe(false)
      expect(wrapper.find('[data-testid="now-time"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="band-item"]').exists()).toBe(true)
      expect(wrapper.findAll('.rule').length).toBeGreaterThan(0)
      expect(wrapper.find('[data-testid="now-line"]').exists()).toBe(true)
      expect(wrapper.classes()).toContain('no-hours')
      // The columns are still numbered from 2, so the veil and the tiles are where they were.
      expect(wrapper.find('[data-testid="veil"]').attributes('style')).toContain('grid-column: 2 / span 2')
    })
  })
})
