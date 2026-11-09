<script setup lang="ts">
import { Check, Star } from 'lucide-vue-next'
import {
  STAR_GRID_GAP, STAR_GRID_PADDING, STAR_HEAD_HEIGHT, STAR_ICON_GAP, STAR_ICON_SIZE, STAR_PROGRESS_HEIGHT, STAR_SECTION_GAP, STAR_TILE_PADDING, STAR_TITLE_HEIGHT, STAR_WEEK_HEIGHT,
  starHeaderHeight, starIconRow, starTileHeight, starTileWidth, starWeekFits, starsAsIcons,
} from '../../utils/starChart'
import type { ViewProps } from '../../utils/views'
import { DEFAULT_PANE_OPTIONS, DEFAULT_STAR_GRID } from '../../../shared/layouts'
import { starChartLayout } from '../../../shared/star-chart-layout'
import type { StarCard } from '../../../shared/star-chart-layout'

// The star chart (PR 5.20): a layout component, drawn in a pane of a custom
// layout or on the whole stage. A grid of person cards, `rows` by `columns`,
// one for each person with a chart in config order, left to right and then top
// to bottom. People beyond the grid are not shown, and tiles beyond the people
// are left blank: a card is never stretched to fill a tile it does not have.
//
// A card has a head (the person's initial in a circle of their colour, as the
// event badges are, their name, and at the right their total for the period,
// "7" or "7 / 10" with a star, and a caption "today" or "this week"), then the
// progress, then, when the card is tall enough, the week strip.
//
// The progress is a row of star icons for a goal of ten or fewer and for no goal
// (the earned ones filled in the person's colour, the rest outlined; with no
// goal only the earned ones, as many as fit), and a bar for a bigger goal.
// Stars beyond what the row can show, or past the goal, are "+N". The week
// strip has the seven days of the week today is in (the display's week start):
// the weekday's initial over the day's count, today picked out, the days to come
// faint, and, for a person whose period is a day and who has a goal, a day that
// met it is filled with a tick.
//
// What each card shows is the layout engine's (`starChartLayout`); the view only
// decides how much fits, from the card's size (`app/utils/starChart.ts`). Every
// size that capacity depends on is a constant there, set on the root as CSS
// variables, so the capacity and the drawing cannot drift. A card clips what
// does not fit. Colours are the theme's tokens plus each person's own colour.
//
// A goal reached for the period gives the card a ring and a faint wash of the
// person's colour. It is still, with no animation, so a wall that is left on
// does not burn it in or flicker.
//
// Pane option: `show_title` (on unless the layout turns it off) is a header
// above the grid with "Stars" and the week it is for.
const props = defineProps<ViewProps>()

const options = computed(() => props.paneOptions ?? DEFAULT_PANE_OPTIONS)
const grid = computed(() => props.starGrid ?? DEFAULT_STAR_GRID)

const layout = computed(() => starChartLayout({
  now: props.now,
  timeZone: props.timezone,
  weekStart: props.weekStart,
  grid: grid.value,
  chart: props.stars ?? null,
}))

const headerHeight = computed(() => starHeaderHeight(options.value.show_title))
const tileWidth = computed(() => starTileWidth(props.stage.width, grid.value.columns))
const tileHeight = computed(() => starTileHeight(props.stage.height, grid.value.rows, headerHeight.value))
const showWeek = computed(() => starWeekFits(tileHeight.value))

/** The icons of a card's progress row, or null when it is a bar. */
function iconsOf(card: StarCard): { icons: number, filled: number, extra: number } | null {
  return starsAsIcons(card.goal) ? starIconRow(card.total, card.goal, tileWidth.value) : null
}

/** The bar's fill, 0 to 100. */
const barPercent = (card: StarCard): number => card.goal ? Math.min(100, Math.round(100 * card.total / card.goal)) : 0

const periodText = (card: StarCard): string => card.period === 'day' ? 'today' : 'this week'

const cssVars = computed(() => ({
  '--grid-padding': `${STAR_GRID_PADDING}px`,
  '--grid-gap': `${STAR_GRID_GAP}px`,
  '--tile-padding': `${STAR_TILE_PADDING}px`,
  '--title-height': `${STAR_TITLE_HEIGHT}px`,
  '--head-height': `${STAR_HEAD_HEIGHT}px`,
  '--section-gap': `${STAR_SECTION_GAP}px`,
  '--progress-height': `${STAR_PROGRESS_HEIGHT}px`,
  '--icon-gap': `${STAR_ICON_GAP}px`,
  '--week-height': `${STAR_WEEK_HEIGHT}px`,
  '--rows': grid.value.rows,
  '--columns': grid.value.columns,
}))
</script>

<template>
  <section class="view" :style="cssVars" data-testid="star-chart-view">
    <header v-if="options.show_title" class="title" data-testid="star-title">
      <h2>{{ layout.title }}</h2>
      <span class="range">This week · {{ layout.weekRange }}</span>
    </header>

    <div v-if="layout.cards.length" class="grid">
      <article
        v-for="card in layout.cards"
        :key="card.person.id"
        class="card"
        :class="{ reached: card.reached }"
        :style="{ '--person': card.person.colour }"
        data-testid="star-card"
        :data-person="card.person.id"
        :data-reached="card.reached"
      >
        <div class="head">
          <span class="badge" data-testid="star-initial">{{ card.person.initial }}</span>
          <span class="name" data-testid="star-name">{{ card.person.name }}</span>
          <span class="total">
            <span class="figure" data-testid="star-total">
              <span class="number">{{ card.total }}</span>
              <span v-if="card.goal !== null" class="goal" data-testid="star-goal">/ {{ card.goal }}</span>
              <AppIcon :icon="Star" :size="40" class="mark" />
            </span>
            <span class="period" data-testid="star-period">{{ periodText(card) }}</span>
          </span>
        </div>

        <div class="progress" data-testid="star-progress">
          <template v-if="iconsOf(card)">
            <span class="icons" :style="{ '--icon-size': `${STAR_ICON_SIZE}px` }">
              <AppIcon
                v-for="index in iconsOf(card)!.icons"
                :key="index"
                :icon="Star"
                :size="STAR_ICON_SIZE"
                class="star"
                :class="index <= iconsOf(card)!.filled ? 'filled' : 'empty'"
                data-testid="star-icon"
              />
            </span>
          </template>
          <span v-else class="bar" role="progressbar" :aria-valuenow="card.total" :aria-valuemax="card.goal ?? undefined" data-testid="star-bar">
            <span class="fill" :style="{ width: `${barPercent(card)}%` }" />
          </span>
          <span v-if="iconsOf(card) ? iconsOf(card)!.extra : card.extra" class="extra" data-testid="star-extra">+{{ iconsOf(card) ? iconsOf(card)!.extra : card.extra }}</span>
        </div>

        <div v-if="showWeek" class="week" data-testid="star-week">
          <div
            v-for="day in card.week"
            :key="day.date"
            class="day"
            :class="{ today: day.today, future: day.future, met: day.metGoal }"
            data-testid="star-day"
            :data-date="day.date"
            :data-today="day.today"
            :data-future="day.future"
            :data-met="day.metGoal"
          >
            <span class="weekday">{{ day.weekday.slice(0, 1) }}</span>
            <span class="count">
              <AppIcon v-if="day.metGoal" :icon="Check" :size="22" class="tick" data-testid="star-tick" />
              <template v-else>{{ day.count }}</template>
            </span>
          </div>
        </div>
      </article>
    </div>

    <div v-else class="empty" data-testid="star-empty">
      <AppIcon :icon="Star" :size="pane ? 96 : 140" />
      <p class="calm">
        No star charts yet
      </p>
    </div>
  </section>
</template>

<style scoped>
/* Sizes are px on the stage the view is laid out on; the ones the capacity depends on come from app/utils/starChart.ts as variables. */
.view {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding: var(--grid-padding);
  overflow: hidden;
  color: var(--text);
}

.title {
  display: flex;
  flex: none;
  align-items: baseline;
  justify-content: space-between;
  gap: 24px;
  box-sizing: border-box;
  height: var(--title-height);
  padding: 0 12px 20px;
}

.title h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 52px;
  font-weight: 400;
  line-height: 1;
}

.range {
  color: var(--muted);
  font-size: 28px;
  font-weight: 700;
  white-space: nowrap;
}

.grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
  grid-template-rows: repeat(var(--rows), minmax(0, 1fr));
  gap: var(--grid-gap);
  min-height: 0;
}

.card {
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);
  min-width: 0;
  min-height: 0;
  padding: var(--tile-padding);
  overflow: hidden;
  border-radius: 36px;
  background: var(--tile);
  color: var(--text);
}

/* A goal met: a ring and a faint wash of the person's colour. Still, so nothing on the wall flickers or burns in. */
.card.reached {
  background: color-mix(in oklch, var(--person) 14%, var(--tile));
  box-shadow: inset 0 0 0 4px var(--person);
}

.head {
  display: flex;
  flex: none;
  align-items: center;
  gap: 16px;
  height: var(--head-height);
  min-width: 0;
}

.badge {
  display: grid;
  flex: none;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--person);
  color: var(--color-neutral-900);
  font-size: 34px;
  font-weight: 700;
}

.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 34px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.total {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.figure {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-display);
  line-height: 1;
}

.number {
  font-size: 56px;
  font-variant-numeric: tabular-nums;
}

.goal {
  color: var(--muted);
  font-size: 34px;
}

.mark {
  flex: none;
  color: var(--person);
  fill: var(--person);
}

.period {
  color: var(--muted);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 24px;
  text-transform: uppercase;
}

.progress {
  display: flex;
  flex: none;
  align-items: center;
  gap: 14px;
  height: var(--progress-height);
  min-width: 0;
}

.icons {
  display: flex;
  gap: var(--icon-gap);
  min-width: 0;
}

.star {
  flex: none;
}

.star.filled {
  color: var(--person);
  fill: var(--person);
}

.star.empty {
  color: var(--muted);
  fill: none;
  opacity: 0.5;
}

.bar {
  flex: 1;
  height: 24px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in oklch, var(--text) 12%, transparent);
}

.fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--person);
}

.extra {
  flex: none;
  color: var(--accent-ink);
  font-size: 34px;
  font-weight: 700;
}

.week {
  display: grid;
  flex: none;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
  height: var(--week-height);
}

.day {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  padding: 8px 0;
  border-radius: 18px;
}

.day.today {
  background: color-mix(in oklch, var(--text) 12%, transparent);
}

.day.future {
  opacity: 0.4;
}

.weekday {
  color: var(--muted);
  font-size: 22px;
  font-weight: 700;
  line-height: 26px;
}

.count {
  display: grid;
  place-items: center;
  min-width: 40px;
  height: 40px;
  box-sizing: border-box;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 30px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 1;
}

/* A day that met the goal: filled in the person's colour, with a tick for the number. */
.day.met .count {
  background: var(--person);
  color: var(--color-neutral-900);
}

.empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 32px;
  color: var(--muted);
}

.calm {
  margin: 0;
  font-family: var(--font-display);
  font-size: 96px;
}
</style>
