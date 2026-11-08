import { describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import WeekPartsView from '~/components/views/WeekPartsView.vue'
import { fixtureEvents } from '../helpers/fixtureEvents'
import { NO_SPECIAL_DAYS } from '~/utils/views'
import { eventFill } from '~/utils/eventFill'
import { personFill } from '~/utils/themes'
import type { ViewProps } from '~/utils/views'
import { DEFAULT_PANE_OPTIONS } from '../../shared/layouts'
import type { Takeover, TileDecoration } from '../../shared/special-days'
import type { CalendarEvent } from '../../shared/types/events'
import type { WeatherSnapshot } from '../../shared/weather'

// The week by part of day on the fixture family and the day the mocks are set
// on, Wed 28 Oct 2026. The layout itself is tested in
// test/unit/shared/week-parts-layout.test.ts; this is that it is drawn, in the
// right rows and cells.

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
  view: 'week_parts', stage: { width: 2560, height: 1440, orientation: 'landscape' }, events, now: NOW, timezone: 'Europe/London', month: '2026-10', weekOf: '2026-10-28', weekHours: { from: 7, to: 21 }, dayParts: { afternoon: 12, evening: 17 }, weekStart: 'monday', weather: null, specialDays: NO_SPECIAL_DAYS, ...overrides,
})

const person = { id: 'mum', name: 'Mum', initial: 'M', colour: '#C67139' }
const event = (id: number, overrides: Partial<CalendarEvent>): CalendarEvent => ({
  id, calendar_id: 'family', title: `Event ${id}`, display_title: `Event ${id}`, location: null,
  start: '2026-10-28T14:00:00Z', end: '2026-10-28T15:00:00Z', all_day: false, start_date: null, end_date: null, people: [person],
  ...overrides,
})
/** A timed event on Wed 28 Oct, London time being UTC. */
const at = (id: number, start: string, title = `Event ${id}`) => event(id, { display_title: title, start: `2026-10-28T${start}:00Z`, end: `2026-10-28T${start.slice(0, 2)}:59:00Z` })

type Wrapper = Awaited<ReturnType<typeof mountSuspended>>
const row = (wrapper: Wrapper, date: string) => wrapper.find(`[data-testid="day-row"][data-date="${date}"]`)
const cell = (wrapper: Wrapper, date: string, part: string) => row(wrapper, date).find(`[data-testid="part-cell"][data-part="${part}"]`)

vi.mock('~/utils/eventFill', { spy: true })
/** The backgrounds `eventFill` has given so far: the test DOM drops a gradient it cannot parse (color-mix), so what a view drew is read from what it was handed. */
const fillsGiven = () => vi.mocked(eventFill).mock.results.map(result => (result.value as { background: string }).background)

describe('WeekPartsView', () => {
  it('draws seven rows for the week, with today flagged once, and the part headings', async () => {
    const wrapper = await mountSuspended(WeekPartsView, { props: props() })

    const rows = wrapper.findAll('[data-testid="day-row"]')
    expect(rows.map(day => day.attributes('data-date'))).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'])
    expect(rows.filter(day => day.attributes('data-today') === 'true').map(day => day.attributes('data-date'))).toEqual(['2026-10-28'])
    expect(wrapper.find('[data-testid="today-number"]').text()).toBe('28')
    expect(rows.every(day => day.findAll('[data-testid="part-cell"]').length === 3)).toBe(true)
    expect(wrapper.findAll('[data-testid="part-heading"]').map(heading => heading.text())).toEqual(['Morning00–12', 'Afternoon12–17', 'Evening17–24'])
    expect(wrapper.find('[data-testid="week-title"]').text()).toBe('26 October – 1 November 2026')
    expect(wrapper.find('[data-testid="week-title"] .year').text()).toBe('2026')
  })

  it('shows the week of the date it is given, and starts on Sunday when asked to', async () => {
    const other = await mountSuspended(WeekPartsView, { props: props({ weekOf: '2026-12-02' }) })

    expect(other.find('[data-testid="week-title"]').text()).toBe('30 November – 6 December 2026')
    expect(other.find('[data-testid="now-part"]').exists()).toBe(false)
    expect(other.find('[data-testid="veil"]').exists()).toBe(false)
    expect(other.find('[data-testid="today-number"]').exists()).toBe(false)

    const sunday = await mountSuspended(WeekPartsView, { props: props({ weekStart: 'sunday' }) })
    expect(sunday.findAll('[data-testid="day-row"]')[0]!.attributes('data-date')).toBe('2026-10-25')
  })

  it('puts a timed event in the cell of the part it starts in, with badge, time and title', async () => {
    const wrapper = await mountSuspended(WeekPartsView, { props: props({
      events: [at(1, '08:30', 'Breakfast club'), at(2, '12:00', 'Lunch'), at(3, '16:59', 'Tea'), at(4, '17:00', 'Supper')],
    }) })

    const titles = (part: string) => cell(wrapper, '2026-10-28', part).findAll('[data-testid="event"]').map((line: { text: () => string }) => line.text())
    expect(titles('morning')).toEqual([expect.stringContaining('Breakfast club')])
    expect(titles('afternoon')).toEqual([expect.stringContaining('Lunch'), expect.stringContaining('Tea')])
    expect(titles('evening')).toEqual([expect.stringContaining('Supper')])
    const line = cell(wrapper, '2026-10-28', 'morning').find('[data-testid="event"]')
    expect(line.find('.badge').text()).toBe('M')
    expect(line.find('.time').text()).toBe('08:30')
    expect(line.find('.name').text()).toBe('Breakfast club')
  })

  it('draws the fixtures\' Wednesday: the half term in the head and the ballet in the afternoon', async () => {
    const wrapper = await mountSuspended(WeekPartsView, { props: props() })

    expect(row(wrapper, '2026-10-28').find('[data-kind="head"]').text()).toContain('Half term')
    expect(row(wrapper, '2026-10-28').find('[data-kind="head"] .badge').exists()).toBe(true)
    expect(wrapper.findAll('[data-kind="line"]').length).toBeGreaterThan(5)
  })

  it('marks today\'s part with the sage outline, and no other', async () => {
    const wrapper = await mountSuspended(WeekPartsView, { props: props() })

    // 09:41 is in the morning.
    expect(wrapper.findAll('[data-testid="now-part"]')).toHaveLength(1)
    expect(cell(wrapper, '2026-10-28', 'morning').find('[data-testid="now-part"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="part-cell"][data-now="true"]')).toHaveLength(1)

    await wrapper.setProps(props({ now: new Date('2026-10-28T18:00:00Z') }))

    expect(cell(wrapper, '2026-10-28', 'evening').find('[data-testid="now-part"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="now-part"]')).toHaveLength(1)
    expect(wrapper.find('[data-testid="now-line"]').exists()).toBe(false)
  })

  it('shows up to two head items, with a time on an overnight one, and "+N" for the rest', async () => {
    const trip = (id: number) => event(id, { all_day: true, start_date: '2026-10-28', end_date: '2026-10-29', start: '2026-10-28T00:00:00Z', end: '2026-10-29T00:00:00Z', display_title: `Trip ${id}` })
    const sleepover = event(9, { display_title: 'Sleepover', start: '2026-10-28T19:30:00Z', end: '2026-10-29T08:00:00Z' })
    const wrapper = await mountSuspended(WeekPartsView, { props: props({ events: [trip(1), trip(2), sleepover] }) })

    const head = row(wrapper, '2026-10-28')
    expect(head.findAll('[data-kind="head"]').map((item: { text: () => string }) => item.text())).toEqual([expect.stringContaining('Trip 1'), expect.stringContaining('Trip 2')])
    expect(head.find('[data-testid="head-more"]').text()).toBe('+1')
    // The sleepover is not a line in the evening cell.
    expect(cell(wrapper, '2026-10-28', 'evening').findAll('[data-testid="event"]')).toHaveLength(0)

    const only = await mountSuspended(WeekPartsView, { props: props({ events: [sleepover] }) })
    expect(row(only, '2026-10-28').find('[data-kind="head"] .time').text()).toBe('19:30')
    expect(row(only, '2026-10-29').find('[data-kind="head"] .time').exists()).toBe(false)
    expect(only.find('[data-testid="head-more"]').exists()).toBe(false)
  })

  it('ends a full cell in "+N more", and holds more lines on the portrait stage', async () => {
    const many = Array.from({ length: 6 }, (_, index) => at(index + 1, `${String(index + 5).padStart(2, '0')}:00`))
    const landscape = await mountSuspended(WeekPartsView, { props: props({ events: many }) })

    const morning = cell(landscape, '2026-10-28', 'morning')
    // Four lines: three events and the count.
    expect(morning.findAll('[data-testid="event"]')).toHaveLength(3)
    expect(morning.find('[data-testid="more"]').text()).toBe('+3 more')
    expect(morning.findAll('[data-testid="event"], [data-testid="more"]').at(-1)!.attributes('data-testid')).toBe('more')

    const portrait = await mountSuspended(WeekPartsView, { props: props({ events: many, stage: { width: 1440, height: 2560, orientation: 'portrait' } }) })
    expect(portrait.find('[data-testid="week-parts-view"]').classes()).toContain('portrait')
    expect(cell(portrait, '2026-10-28', 'morning').findAll('[data-testid="event"]')).toHaveLength(6)
    expect(portrait.find('[data-testid="more"]').exists()).toBe(false)
  })

  it('veils the past days in one strip and dims the events that are over', async () => {
    const wrapper = await mountSuspended(WeekPartsView, { props: props({ events: [at(1, '08:00', 'Over'), at(2, '10:30', 'Later')] }) })

    const veils = wrapper.findAll('[data-testid="veil"]')
    expect(veils).toHaveLength(1)
    expect(veils[0]!.attributes('style')).toContain('grid-row: 1 / span 2')
    const lines = cell(wrapper, '2026-10-28', 'morning').findAll('[data-testid="event"]')
    expect(lines.map((line: { classes: () => string[] }) => line.classes().includes('past'))).toEqual([true, false])
  })

  it('draws no veil on the first day of a week and nothing for an empty week', async () => {
    const wrapper = await mountSuspended(WeekPartsView, { props: props({ events: [], now: new Date('2026-10-26T09:00:00Z') }) })

    expect(wrapper.find('[data-testid="veil"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="event"]')).toHaveLength(0)
    expect(wrapper.findAll('[data-testid="day-row"]')).toHaveLength(7)
  })

  it('names the parts from the display\'s day parts', async () => {
    const wrapper = await mountSuspended(WeekPartsView, { props: props({ dayParts: { afternoon: 11, evening: 18 }, events: [at(1, '11:30', 'Elevenses')] }) })

    expect(wrapper.findAll('[data-testid="part-heading"]').map(heading => heading.text())).toEqual(['Morning00–11', 'Afternoon11–18', 'Evening18–24'])
    expect(cell(wrapper, '2026-10-28', 'afternoon').find('[data-testid="event"]').text()).toContain('Elevenses')
  })

  describe('weather', () => {
    it('draws nothing without a snapshot', async () => {
      const wrapper = await mountSuspended(WeekPartsView, { props: props() })

      expect(wrapper.find('[data-testid="day-weather"]').exists()).toBe(false)
    })

    it('puts each day\'s forecast in its head, and leaves out a day the forecast does not cover', async () => {
      const wrapper = await mountSuspended(WeekPartsView, { props: props({ weather }) })

      expect(wrapper.findAll('[data-testid="day-weather"]').map(day => day.text())).toEqual(['13° / 7°', '14° / 8°', '13°'])
      expect(row(wrapper, '2026-10-28').find('[data-testid="day-weather"]').text()).toBe('14° / 8°')
      expect(wrapper.find('[data-testid="day-weather"] svg').classes()).toContain('lucide-cloud-icon')
    })
  })

  describe('special days', () => {
    const pumpkin: TileDecoration = { id: 'halloween', name: 'Halloween', palette: 'night', tile_art: 'pumpkin.svg' }
    const birthday: TileDecoration = { id: 'isla', name: 'Isla\'s birthday', palette: 'warm', tile_art: 'cake.webp' }
    const takeover: Takeover = { id: 'halloween', name: 'Halloween', date: '2026-10-28', greeting: 'Happy Halloween', palette: 'night', full_art: 'wall.webp', extra_art: null, full_art_portrait: null, extra_art_portrait: null }

    it('draws nothing special with nothing to draw', async () => {
      const wrapper = await mountSuspended(WeekPartsView, { props: props() })

      expect(wrapper.find('[data-testid="tile-art"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="greeting"]').exists()).toBe(false)
      expect(wrapper.find('[data-special]').exists()).toBe(false)
    })

    it('marks a decorated row with its first day and draws the art of every day, in order', async () => {
      const specialDays = { tiles: [{ date: '2026-10-31', days: [pumpkin, birthday] }, { date: '2026-10-30', days: [{ ...pumpkin, tile_art: null }] }, { date: '2027-03-01', days: [pumpkin] }], takeover: null }
      const wrapper = await mountSuspended(WeekPartsView, { props: props({ specialDays }) })

      expect(wrapper.findAll('[data-special]').map(day => [day.attributes('data-date'), day.attributes('data-special')])).toEqual([['2026-10-30', 'halloween'], ['2026-10-31', 'halloween']])
      expect(wrapper.findAll('[data-testid="tile-art"]').map(image => image.attributes('src'))).toEqual(['/special-days/pumpkin.svg', '/special-days/cake.webp'])
    })

    it('gives today\'s row today\'s background', async () => {
      const wrapper = await mountSuspended(WeekPartsView, { props: props() })

      expect(row(wrapper, '2026-10-28').attributes('style')).toContain('var(--today-cell)')
      expect(row(wrapper, '2026-10-29').attributes('style')).toContain('var(--tile)')
    })

    it('draws the greeting only with a takeover', async () => {
      const wrapper = await mountSuspended(WeekPartsView, { props: props({ specialDays: { tiles: [], takeover } }) })

      expect(wrapper.find('[data-testid="greeting"]').text()).toBe('Happy Halloween')
      expect(wrapper.find('[data-testid="greeting"]').attributes('style')).toContain('font-size: 56px')

      await wrapper.setProps({ specialDays: { tiles: [], takeover: { ...takeover, greeting: null } } })

      expect(wrapper.find('[data-testid="greeting"]').exists()).toBe(false)
    })
  })

  describe('pane options', () => {
    const takeover = { greeting: 'Happy Halloween' } as Takeover
    const options = (overrides: Partial<typeof DEFAULT_PANE_OPTIONS>) => ({ ...DEFAULT_PANE_OPTIONS, ...overrides })
    const lines = (wrapper: Wrapper) => wrapper.findAll('[data-kind="line"]')

    it('draws as before with no options', async () => {
      const wrapper = await mountSuspended(WeekPartsView, { props: props() })

      expect(wrapper.find('[data-testid="week-title"]').exists()).toBe(true)
      expect(lines(wrapper).length).toBeGreaterThan(0)
      for (const line of lines(wrapper)) {
        expect(line.classes()).not.toContain('filled')
        expect(line.attributes('style')).not.toContain('background')
        expect(line.attributes('data-wrap')).toBeUndefined()
      }
      expect(wrapper.findAll('[data-wrap-box]')).toHaveLength(21)
    })

    it('hides the title and the empty header, but not the parts line', async () => {
      const wrapper = await mountSuspended(WeekPartsView, { props: props({ paneOptions: options({ show_title: false }) }) })

      expect(wrapper.find('[data-testid="week-title"]').exists()).toBe(false)
      expect(wrapper.find('.header').exists()).toBe(false)
      expect(wrapper.findAll('[data-testid="part-heading"]')).toHaveLength(3)
    })

    it('keeps a takeover\'s greeting when the title is hidden', async () => {
      const wrapper = await mountSuspended(WeekPartsView, { props: props({ paneOptions: options({ show_title: false }), specialDays: { tiles: [], takeover } }) })

      expect(wrapper.find('[data-testid="week-title"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="greeting"]').text()).toBe('Happy Halloween')
    })

    it('fills each line with the person\'s colour, and the surface when nobody matched', async () => {
      const wrapper = await mountSuspended(WeekPartsView, { props: props({
        paneOptions: options({ fill_events: true }),
        events: [at(1, '08:30', 'Breakfast club'), event(2, { start: '2026-10-28T12:30:00Z', end: '2026-10-28T13:00:00Z', people: [] })],
      }) })

      const mine = cell(wrapper, '2026-10-28', 'morning').find('[data-kind="line"]')
      expect(mine.classes()).toContain('filled')
      // happy-dom does not keep a colour-mix() background, but --ring is the same value.
      expect(mine.attributes('style')).toContain(personFill(person.colour))
      const nobody = cell(wrapper, '2026-10-28', 'afternoon').find('[data-kind="line"]')
      expect(nobody.attributes('style')).toContain('var(--surface)')
    })

    it('splits a filled line between several people', async () => {
      const dad = { id: 'dad', name: 'Dad', initial: 'D', colour: '#3A7CA5' }
      const wrapper = await mountSuspended(WeekPartsView, { props: props({
        paneOptions: options({ fill_events: true }),
        events: [event(1, { people: [person, dad], start: '2026-10-28T08:30:00Z', end: '2026-10-28T09:00:00Z' })],
      }) })

      const line = cell(wrapper, '2026-10-28', 'morning').find('[data-kind="line"]')
      expect(line.attributes('style')).toContain(`--ring: ${personFill(person.colour)}`)
      expect(fillsGiven().at(-1)).toBe(`linear-gradient(to right, ${personFill(person.colour)} 0% 50%, ${personFill(dad.colour)} 50% 100%)`)
      expect(line.findAll('.badge')).toHaveLength(2)
    })

    it('leaves the initials off a filled line only when asked', async () => {
      const badges = async (paneOptions: ReturnType<typeof options>) => {
        const wrapper = await mountSuspended(WeekPartsView, { props: props({ paneOptions, events: [at(1, '08:30')] }) })
        const line = cell(wrapper, '2026-10-28', 'morning').find('[data-kind="line"]')
        return [line.findAll('.badge').length, line.classes()] as const
      }
      expect((await badges(options({ fill_events: true })))[0]).toBe(1)
      const [count, classes] = await badges(options({ fill_events: true, show_initials: false }))
      expect(count).toBe(0)
      expect(classes).toContain('bare')
      const [plain, plainClasses] = await badges(options({ show_initials: false }))
      expect(plain).toBe(1)
      expect(plainClasses).not.toContain('bare')
    })

    it('lets titles wrap only when asked', async () => {
      const wrapper = await mountSuspended(WeekPartsView, { props: props({ paneOptions: options({ wrap_titles: true }) }) })

      // Nothing measures in happy-dom, so everything fits and every line may wrap; the "+N more" line is not one of them.
      await vi.waitFor(() => expect(lines(wrapper).every((line: { attributes: (name: string) => string | undefined }) => line.attributes('data-wrap') === 'on')).toBe(true))
      expect(wrapper.findAll('[data-testid="more"]').every(more => more.attributes('data-wrap-item') === undefined)).toBe(true)

      await wrapper.setProps(props({ paneOptions: options({ wrap_titles: false }) }))
      await vi.waitFor(() => expect(lines(wrapper).some((line: { attributes: (name: string) => string | undefined }) => line.attributes('data-wrap') === 'on')).toBe(false))
    })
  })
})
