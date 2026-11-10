import { describe, expect, it } from 'vitest'
import { starChartLayout } from '../../../shared/star-chart-layout'
import type { StarChart, StarChartPerson } from '../../../shared/stars'

// Monday 9 Nov 2026, noon in London (UTC), so the week is 9-15 Nov from a Monday and 8-14 Nov from a Sunday.
const NOW = new Date('2026-11-11T12:00:00Z') // Wednesday
const base = { now: NOW, timeZone: 'Europe/London', weekStart: 'monday' as const, grid: { rows: 1, columns: 4 } }

const person = (id: string, overrides: Partial<StarChartPerson> = {}): StarChartPerson => ({
  id, name: id.toUpperCase(), initial: id[0]!.toUpperCase(), colour: '#C67139', period: 'week', goal: null, ...overrides,
})

const chart = (people: StarChartPerson[], counts: StarChart['counts'] = {}): StarChart => ({ people, counts })

describe('starChartLayout', () => {
  it('lays out nothing for a null chart or no people', () => {
    for (const none of [null, chart([])]) {
      const layout = starChartLayout({ ...base, chart: none })
      expect(layout.cards).toEqual([])
      expect(layout.hidden).toBe(0)
      expect(layout.title).toBe('Stars')
      expect(layout.weekRange).toBe('9 – 15 Nov')
    }
  })

  it('totals a week person over the week today is in (Monday start)', () => {
    const layout = starChartLayout({ ...base, chart: chart([person('ann')], { ann: { '2026-11-08': 5, '2026-11-09': 1, '2026-11-11': 2, '2026-11-15': 3, '2026-11-16': 9 } }) })
    const [card] = layout.cards

    // 8 Nov (Sunday) and 16 Nov are outside the Monday week.
    expect(card!.total).toBe(6)
    expect(card!.period).toBe('week')
    expect(card!.week.map(day => day.date)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'])
    expect(card!.week.map(day => day.weekday)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(card!.week.map(day => day.count)).toEqual([1, 0, 2, 0, 0, 0, 3])
  })

  it('starts the week on Sunday when asked', () => {
    const layout = starChartLayout({ ...base, weekStart: 'sunday', chart: chart([person('ann')], { ann: { '2026-11-08': 5, '2026-11-15': 3 } }) })

    expect(layout.cards[0]!.total).toBe(5)
    expect(layout.cards[0]!.week[0]).toMatchObject({ date: '2026-11-08', weekday: 'Sun', count: 5 })
    expect(layout.weekRange).toBe('8 – 14 Nov')
  })

  it('totals a day person on today alone', () => {
    const layout = starChartLayout({ ...base, chart: chart([person('bo', { period: 'day' })], { bo: { '2026-11-10': 4, '2026-11-11': 2 } }) })

    expect(layout.cards[0]!.total).toBe(2)
    expect(layout.cards[0]!.period).toBe('day')
  })

  it('marks today and the days to come', () => {
    const [card] = starChartLayout({ ...base, chart: chart([person('ann')]) }).cards

    expect(card!.week.map(day => day.today)).toEqual([false, false, true, false, false, false, false])
    expect(card!.week.map(day => day.future)).toEqual([false, false, false, true, true, true, true])
  })

  it('reaches a goal at exactly the goal and counts the extra beyond it', () => {
    const people = [person('ann', { goal: 5 }), person('bo', { goal: 5 }), person('cy', { goal: 5 }), person('di')]
    const layout = starChartLayout({ ...base, chart: chart(people, { ann: { '2026-11-11': 4 }, bo: { '2026-11-11': 5 }, cy: { '2026-11-09': 5, '2026-11-11': 3 }, di: { '2026-11-11': 9 } }) })
    const [ann, bo, cy, di] = layout.cards

    expect([ann!.reached, ann!.extra]).toEqual([false, 0])
    expect([bo!.reached, bo!.extra]).toEqual([true, 0])
    expect([cy!.reached, cy!.extra]).toEqual([true, 3])
    // No goal: never reached, and no extra.
    expect([di!.reached, di!.extra, di!.goal]).toEqual([false, 0, null])
  })

  it('flags a day that met the goal for a day person only', () => {
    const counts = { bo: { '2026-11-09': 3, '2026-11-10': 2, '2026-11-11': 4 } }
    const day = starChartLayout({ ...base, chart: chart([person('bo', { period: 'day', goal: 3 })], counts) }).cards[0]!
    const week = starChartLayout({ ...base, chart: chart([person('bo', { period: 'week', goal: 3 })], counts) }).cards[0]!
    const noGoal = starChartLayout({ ...base, chart: chart([person('bo', { period: 'day' })], counts) }).cards[0]!

    expect(day.week.map(entry => entry.metGoal)).toEqual([true, false, true, false, false, false, false])
    expect(week.week.some(entry => entry.metGoal)).toBe(false)
    expect(noGoal.week.some(entry => entry.metGoal)).toBe(false)
  })

  it('keeps the first rows * columns people in config order and counts the rest as hidden', () => {
    const people = ['a', 'b', 'c', 'd', 'e'].map(id => person(id))
    const layout = starChartLayout({ ...base, grid: { rows: 2, columns: 2 }, chart: chart(people) })

    expect(layout.cards.map(card => card.person.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(layout.hidden).toBe(1)
    expect(starChartLayout({ ...base, grid: { rows: 2, columns: 3 }, chart: chart(people) }).hidden).toBe(0)
  })

  it('works out today in the display\'s zone, not UTC', () => {
    // 23:30 UTC on Sunday 15 Nov is already Monday 16 Nov in Auckland (UTC+13).
    const layout = starChartLayout({ ...base, now: new Date('2026-11-15T23:30:00Z'), timeZone: 'Pacific/Auckland', chart: chart([person('ann')], { ann: { '2026-11-16': 2 } }) })

    expect(layout.cards[0]!.total).toBe(2)
    expect(layout.cards[0]!.week[0]).toMatchObject({ date: '2026-11-16', today: true })
  })
})
