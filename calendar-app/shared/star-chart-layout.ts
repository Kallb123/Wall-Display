import { dayOfWeek, todayIn } from './dates'
import type { StarGrid } from './layouts'
import { starsOn, starTotal, starWeek } from './stars'
import type { StarChart, StarChartPerson, StarPeriod } from './stars'
import { SHORT_WEEKDAYS, shortWeekRange } from './week-layout'

// The star chart's layout (PR 5.20): a grid of person cards, `rows` by
// `columns`, one per person with a chart, in config order, left to right and
// then top to bottom. The view draws this output and adds nothing to it. Pure:
// no Nuxt or Vue imports, no I/O, and no use of the process's local time. Days
// are `YYYY-MM-DD` strings in the display's time zone.
//
// What this is not: it does not decide sizes, colours, how many star icons fit
// in a row or whether the week strip fits (the view works those out from
// app/utils/starChart.ts). It hands over every number the view might draw.

export interface StarChartLayoutInput {
  /** The current moment. Today comes from it. */
  now: Date
  /** The display's IANA zone; today is the date in it. */
  timeZone: string
  weekStart: 'monday' | 'sunday'
  grid: StarGrid
  /** What the server last sent, or null for nothing heard yet (the same as nobody having a chart). */
  chart: StarChart | null
}

/** One day of a person's week strip. */
export interface StarWeekDay {
  /** `YYYY-MM-DD`. */
  date: string
  /** `Mon`. */
  weekday: string
  /** The stars the person has on the day. */
  count: number
  today: boolean
  /** After today: nothing can have been earned yet. */
  future: boolean
  /** The person's period is `day`, they have a goal, and the day's count reaches it. Always false for a `week` person. */
  metGoal: boolean
}

/** One person's card. */
export interface StarCard {
  person: StarChartPerson
  period: StarPeriod
  /** Stars to reach per period, or null for no goal. */
  goal: number | null
  /** The stars earned in the current period: today's for `day`, this week's for `week`. */
  total: number
  /** There is a goal and the total has reached it. */
  reached: boolean
  /** The stars beyond the goal: `total - goal` when it is positive, else 0. 0 with no goal. */
  extra: number
  /** The seven days of the week today is in. */
  week: StarWeekDay[]
}

export interface StarChartLayout {
  title: string
  /** `9 – 15 Nov`: the week today is in, in the style of the week view's short title. */
  weekRange: string
  /** The cards shown, at most `rows * columns`, in config order. */
  cards: StarCard[]
  /** People with a chart who did not fit in the grid. */
  hidden: number
}

/** The header's title. */
export const STAR_CHART_TITLE = 'Stars'

/** Lays out the grid: a card for each person, in order, as far as the grid goes. */
export function starChartLayout({ now, timeZone, weekStart, grid, chart }: StarChartLayoutInput): StarChartLayout {
  const today = todayIn(now, timeZone)
  const dates = starWeek(today, weekStart)
  const people = chart?.people ?? []
  const capacity = Math.max(0, grid.rows * grid.columns)
  const shown = people.slice(0, capacity)

  const cards = shown.map((person): StarCard => {
    // `chart` is not null here: with no chart there are no people to show.
    const counts = chart!
    const total = starTotal(counts, person, today, weekStart)
    const goal = person.goal
    return {
      person,
      period: person.period,
      goal,
      total,
      reached: goal !== null && total >= goal,
      extra: goal !== null ? Math.max(0, total - goal) : 0,
      week: dates.map((date): StarWeekDay => {
        const count = starsOn(counts, person.id, date)
        return {
          date,
          weekday: SHORT_WEEKDAYS[dayOfWeek(date)]!,
          count,
          today: date === today,
          future: date > today,
          metGoal: person.period === 'day' && goal !== null && count >= goal,
        }
      }),
    }
  })

  return {
    title: STAR_CHART_TITLE,
    weekRange: shortWeekRange(dates[0]!, dates[6]!),
    cards,
    hidden: people.length - shown.length,
  }
}
