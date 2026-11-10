import { afterEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import StarChartView from '~/components/views/StarChartView.vue'
import { NO_SPECIAL_DAYS } from '~/utils/views'
import type { ViewProps } from '~/utils/views'
import { DEFAULT_PANE_OPTIONS } from '../../shared/layouts'
import type { StarGrid } from '../../shared/layouts'
import type { StarChart, StarChartPerson } from '../../shared/stars'

// The star chart on its own, at Wed 11 Nov 2026 (London is UTC). What each card
// holds is tested in test/unit/shared/star-chart-layout.test.ts and the
// capacity in test/unit/display/starChart.test.ts; this is that it is drawn.

const NOW = new Date('2026-11-11T09:41:00Z')

const person = (id: string, overrides: Partial<StarChartPerson> = {}): StarChartPerson => ({
  id, name: id.toUpperCase(), initial: id[0]!.toUpperCase(), colour: '#C67139', period: 'week', goal: null, ...overrides,
})

const chart = (people: StarChartPerson[], counts: StarChart['counts'] = {}): StarChart => ({ people, counts })

const grid = (overrides: Partial<StarGrid> = {}): StarGrid => ({ rows: 1, columns: 4, ...overrides })

const props = (overrides: Partial<ViewProps> = {}): ViewProps => ({
  view: 'custom', stage: { width: 2560, height: 1440, orientation: 'landscape' }, starGrid: grid(), stars: chart([person('ann', { goal: 5 })], { ann: { '2026-11-11': 3 } }), events: [], now: NOW, timezone: 'Europe/London', month: '2026-11', weekOf: '2026-11-11', weekHours: { from: 7, to: 21 }, dayParts: { afternoon: 12, evening: 17 }, weekStart: 'monday', weather: null, specialDays: NO_SPECIAL_DAYS, ...overrides,
})

const mounted: { unmount: () => void }[] = []
async function open(overrides: Partial<ViewProps> = {}) {
  const wrapper = await mountSuspended(StarChartView, { props: props(overrides) })
  mounted.push(wrapper)
  return wrapper
}
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

describe('StarChartView', () => {
  it('draws a card for each person, in order, with name, initial, total and goal', async () => {
    const wrapper = await open({ stars: chart([person('ann', { goal: 5 }), person('bo', { period: 'day' })], { ann: { '2026-11-10': 1, '2026-11-11': 3 }, bo: { '2026-11-11': 2 } }) })
    const cards = wrapper.findAll('[data-testid="star-card"]')

    expect(cards.map(card => card.attributes('data-person'))).toEqual(['ann', 'bo'])
    expect(cards[0]!.find('[data-testid="star-name"]').text()).toBe('ANN')
    expect(cards[0]!.find('[data-testid="star-initial"]').text()).toBe('A')
    expect(cards[0]!.find('[data-testid="star-total"]').text()).toBe('4/ 5')
    expect(cards[0]!.find('[data-testid="star-period"]').text()).toBe('this week')
    expect(cards[1]!.find('[data-testid="star-total"]').text()).toBe('2')
    expect(cards[1]!.find('[data-testid="star-goal"]').exists()).toBe(false)
    expect(cards[1]!.find('[data-testid="star-period"]').text()).toBe('today')
  })

  it('draws the goal as icons, filled for what is earned', async () => {
    const wrapper = await open()
    const icons = wrapper.findAll('[data-testid="star-icon"]')

    expect(icons).toHaveLength(5)
    expect(icons.map(icon => icon.classes().includes('filled'))).toEqual([true, true, true, false, false])
  })

  it('draws a bar for a goal over ten, and "+N" past the goal', async () => {
    const wrapper = await open({ stars: chart([person('ann', { goal: 12 })], { ann: { '2026-11-11': 15 } }) })

    expect(wrapper.find('[data-testid="star-bar"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="star-icon"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="star-extra"]').text()).toBe('+3')
  })

  it('draws only the earned stars with no goal', async () => {
    const wrapper = await open({ stars: chart([person('ann')], { ann: { '2026-11-11': 2 } }) })

    expect(wrapper.findAll('[data-testid="star-icon"]')).toHaveLength(2)
  })

  it('highlights a card whose goal is reached', async () => {
    const wrapper = await open({ stars: chart([person('ann', { goal: 3 }), person('bo', { goal: 9 })], { ann: { '2026-11-11': 3 }, bo: { '2026-11-11': 3 } }) })
    const [ann, bo] = wrapper.findAll('[data-testid="star-card"]')

    expect(ann!.attributes('data-reached')).toBe('true')
    expect(ann!.classes()).toContain('reached')
    expect(bo!.attributes('data-reached')).toBe('false')
  })

  it('leaves out people beyond the grid and leaves empty tiles blank', async () => {
    const people = ['a', 'b', 'c'].map(id => person(id))
    const small = await open({ starGrid: grid({ columns: 2 }), stars: chart(people) })
    expect(small.findAll('[data-testid="star-card"]')).toHaveLength(2)

    const roomy = await open({ starGrid: grid({ columns: 6 }), stars: chart(people) })
    expect(roomy.findAll('[data-testid="star-card"]')).toHaveLength(3)
  })

  it('has a header with the title and the week, unless show_title is off', async () => {
    const shown = await open()
    expect(shown.find('[data-testid="star-title"]').text()).toContain('Stars')
    expect(shown.find('[data-testid="star-title"]').text()).toContain('This week · 9 – 15 Nov')

    const hidden = await open({ paneOptions: { ...DEFAULT_PANE_OPTIONS, show_title: false } })
    expect(hidden.find('[data-testid="star-title"]').exists()).toBe(false)
  })

  it('says so when there are no charts, or nothing heard yet', async () => {
    for (const none of [null, undefined, chart([])]) {
      const wrapper = await open({ stars: none })

      expect(wrapper.find('[data-testid="star-empty"]').text()).toBe('No star charts yet')
      expect(wrapper.find('[data-testid="star-card"]').exists()).toBe(false)
    }
  })

  it('shows the week strip on a tall card and leaves it out on a short one', async () => {
    const tall = await open({ stage: { width: 2560, height: 1440, orientation: 'landscape' } })
    expect(tall.find('[data-testid="star-week"]').exists()).toBe(true)
    expect(tall.findAll('[data-testid="star-day"]')).toHaveLength(7)

    const short = await open({ stage: { width: 2560, height: 300, orientation: 'landscape' } })
    expect(short.find('[data-testid="star-week"]').exists()).toBe(false)
    expect(short.find('[data-testid="star-progress"]').exists()).toBe(true)
  })

  it('picks out today, fades the days to come and ticks a day that met the goal', async () => {
    const wrapper = await open({ stars: chart([person('bo', { period: 'day', goal: 2 })], { bo: { '2026-11-09': 2, '2026-11-10': 1, '2026-11-11': 4 } }) })
    const days = wrapper.findAll('[data-testid="star-day"]')

    expect(days.map(day => day.attributes('data-today'))).toEqual(['false', 'false', 'true', 'false', 'false', 'false', 'false'])
    expect(days.map(day => day.attributes('data-future'))).toEqual(['false', 'false', 'false', 'true', 'true', 'true', 'true'])
    expect(days.map(day => day.attributes('data-met'))).toEqual(['true', 'false', 'true', 'false', 'false', 'false', 'false'])
    expect(wrapper.findAll('[data-testid="star-tick"]')).toHaveLength(2)
    expect(days[1]!.text()).toContain('1')
  })
})
