<script setup lang="ts">
import { useWrapFit } from '~/composables/useWrapFit'
import { tileArt } from '~/utils/specialDays'
import { eventFill } from '~/utils/eventFill'
import { paletteAccent, tileTint } from '~/utils/themes'
import { formatHighLow, weatherIcon } from '~/utils/weather'
import {
  DAY_CARD_GAP, DAY_CARD_HEIGHT, DAY_GRID_GAP, DAY_GRID_PADDING, DAY_HEAD_GAP, DAY_HEAD_HEIGHT, DAY_MORE_HEIGHT, DAY_TILE_PADDING,
  dayGridCellItems, dayGridOverflowItems, dayTileHeight,
} from '../../utils/dayGrid'
import type { ViewProps } from '../../utils/views'
import { dayGridLayout } from '../../../shared/day-grid-layout'
import type { DayGridCell } from '../../../shared/day-grid-layout'
import { DEFAULT_DAY_GRID, DEFAULT_PANE_OPTIONS } from '../../../shared/layouts'
import type { CalendarEvent } from '../../../shared/types/events'
import type { ItemPeople } from '../../../shared/month-layout'
import { specialDayArtUrl } from '../../../shared/special-days'
import { weatherOn } from '../../../shared/weather'
import { MAX_BADGE_INITIALS } from '../../../shared/week-layout'

// The day grid (architecture §4.8a): a layout component, drawn in a pane of a
// custom layout or on the whole stage. Rounded tiles in rows and columns, one
// day in each, from today (or the start of this week) onwards. A tile has a
// head (the date large with its weekday, the month on the first tile and the
// 1st, the number of events, the day's forecast) and the day's events as
// stacked cards: title over time, with the people as overlapping badges at the
// right. "+N more" when the tile is full.
//
// Which day is in which tile, what each event shows and how many fit is the
// layout engine's (`dayGridLayout`); the view only tells it how many lines a
// tile holds, from the tile's height (`dayGridCellItems`). Every size here is a
// constant of app/utils/dayGrid.ts, set on the root as CSS variables, so the
// capacity and the drawing cannot drift. A tile clips anything that does not
// fit. Colour is neutral: the theme's tile, surface and accent tokens only.
//
// Today's tile is tinted as the month's is, with the filled date. Under
// `start: 'week'` the days before today are under the month's veil, and an
// event that is over is dimmed. A special day's tint and art are drawn as in
// the month. The takeover's palette is the stage's theme, so it reaches here
// with no code of its own.
//
// Pane options (architecture §4.8), for a pane of a custom layout; without
// them the view is as it always was. `fill_events` fills a card with its
// person's colour instead of the neutral card, split between the people when
// there are several (`eventFill`), and `show_initials: false` leaves a filled
// card's badges out so the title has the room. `wrap_titles` lets a title take
// up to three lines: the engine has already decided how many cards fit at the
// fixed height, so a wrapped card only uses the tile's spare room, and
// `useWrapFit` turns wrapping on one card at a time while the tile's cards
// still fit (each `.cards` is the fixed-size box, each card an item in it).
const props = defineProps<ViewProps>()

const options = computed(() => props.paneOptions ?? DEFAULT_PANE_OPTIONS)
/** Whether the cards show their people's initials: always, unless they are coloured and the pane asks for none. */
const showInitials = computed(() => !options.value.fill_events || options.value.show_initials)
const root = ref<HTMLElement | null>(null)
useWrapFit(root, () => options.value.wrap_titles)

/** A filled card's background and the ring of its overlapping badges (the same colour, so they are cut out of the card). */
function cardStyle(event: CalendarEvent) {
  if (!options.value.fill_events) return undefined
  const { background, ring } = eventFill(event.people)
  return { background, '--card-ring': ring }
}

const grid = computed(() => props.dayGrid ?? DEFAULT_DAY_GRID)

const tileHeight = computed(() => dayTileHeight(props.stage.height, grid.value.rows))
const cellItems = computed(() => dayGridCellItems(tileHeight.value))
const overflowItems = computed(() => dayGridOverflowItems(tileHeight.value))

const layout = computed(() => dayGridLayout({
  now: props.now,
  timeZone: props.timezone,
  weekStart: props.weekStart,
  grid: grid.value,
  events: props.events,
  cellItems: cellItems.value,
  overflowItems: overflowItems.value,
}))

/** The weather icon and the day's high, or null when the forecast has neither. */
function forecastOf(date: string) {
  const forecast = weatherOn(props.weather, date)
  if (!forecast) return null
  const text = formatHighLow({ high: forecast.high, low: null })
  const icon = weatherIcon(forecast.condition)
  return icon || text ? { icon, text } : null
}

/** What a decorated date has: the first day's id and accent (they set the tint) and every day's art. */
const decorated = computed(() => new Map(props.specialDays.tiles.flatMap(({ date, days }) => {
  const first = days[0]
  return first ? [[date, { id: first.id, accent: paletteAccent(first.palette), art: tileArt(days) }] as const] : []
})))

function tileBackground(cell: DayGridCell): string {
  const base = cell.today ? 'var(--today-cell)' : 'var(--tile)'
  const special = decorated.value.get(cell.date)
  return special ? tileTint(special.accent, base) : base
}

/** The badges an item gets: its first people. Keyed by person, as two can share an initial. */
function badgesOf(item: ItemPeople): { id: string, initial: string, colour: string }[] {
  return item.initials.slice(0, MAX_BADGE_INITIALS).map((initial, index) => ({ id: item.people[index]!.id, initial, colour: item.people[index]!.colour }))
}

const countText = (count: number): string => count === 0 ? 'No events' : count === 1 ? '1 event' : `${count} events`

const cssVars = computed(() => ({
  '--grid-padding': `${DAY_GRID_PADDING}px`,
  '--grid-gap': `${DAY_GRID_GAP}px`,
  '--tile-padding': `${DAY_TILE_PADDING}px`,
  '--head-height': `${DAY_HEAD_HEIGHT}px`,
  '--head-gap': `${DAY_HEAD_GAP}px`,
  '--card-height': `${DAY_CARD_HEIGHT}px`,
  '--card-gap': `${DAY_CARD_GAP}px`,
  '--more-height': `${DAY_MORE_HEIGHT}px`,
  '--rows': grid.value.rows,
  '--columns': grid.value.columns,
}))
</script>

<template>
  <section ref="root" class="view" :style="cssVars" data-testid="day-grid-view">
    <div
      v-for="cell in layout.cells"
      :key="cell.date"
      class="tile"
      :class="{ today: cell.today }"
      :style="{ background: tileBackground(cell) }"
      data-testid="day-tile"
      :data-date="cell.date"
      :data-today="cell.today"
      :data-past="cell.past"
      :data-special="decorated.get(cell.date)?.id"
    >
      <header class="head">
        <div class="when">
          <span class="number" :class="{ today: cell.today }" :data-testid="cell.today ? 'today-number' : undefined">{{ cell.day }}</span>
          <span class="names">
            <span class="weekday">{{ cell.weekday }}</span>
            <span v-if="cell.month" class="month" data-testid="tile-month">{{ cell.month }}</span>
          </span>
          <span v-if="decorated.get(cell.date)?.art.length" class="tile-art">
            <img
              v-for="(name, index) in decorated.get(cell.date)!.art"
              :key="`${name}-${index}`"
              :src="specialDayArtUrl(name)"
              alt=""
              draggable="false"
              data-testid="tile-art"
            >
          </span>
          <span v-if="forecastOf(cell.date)" class="weather" data-testid="day-weather">
            <AppIcon v-if="forecastOf(cell.date)!.icon" :icon="forecastOf(cell.date)!.icon!" :size="30" />
            <span v-if="forecastOf(cell.date)!.text">{{ forecastOf(cell.date)!.text }}</span>
          </span>
        </div>
        <div class="count" data-testid="tile-count">
          {{ countText(cell.count) }}
        </div>
      </header>

      <div class="cards" data-wrap-box>
        <div
          v-for="item in cell.items"
          :key="item.event.id"
          class="card"
          :class="{ past: item.past, filled: options.fill_events }"
          :style="cardStyle(item.event)"
          data-wrap-item
          data-testid="event"
        >
          <span class="lines">
            <span class="name">{{ item.event.display_title }}</span>
            <span class="time">{{ item.time ?? 'All day' }}</span>
          </span>
          <span v-if="item.initials.length && showInitials" class="badges">
            <span
              v-for="badge in badgesOf(item)"
              :key="badge.id"
              class="badge"
              :style="{ background: badge.colour }"
            >{{ badge.initial }}</span>
          </span>
        </div>
        <div v-if="cell.more" class="more" data-testid="more">
          +{{ cell.more }} more
        </div>
      </div>

      <!-- Last, so it is over the tile and what is on it. The past days of a grid that starts at the week's beginning. -->
      <div v-if="cell.past" class="veil" data-testid="veil" />
    </div>
  </section>
</template>

<style scoped>
/* Sizes are px on the stage the view is laid out on; the ones the capacity depends on come from app/utils/dayGrid.ts as variables. */
.view {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
  grid-template-rows: repeat(var(--rows), minmax(0, 1fr));
  gap: var(--grid-gap);
  padding: var(--grid-padding);
  overflow: hidden;
}

.tile {
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: var(--head-gap);
  min-width: 0;
  min-height: 0;
  padding: var(--tile-padding);
  overflow: hidden;
  border-radius: 36px;
  /* The cards: a touch of the text colour over whatever the tile is, so they show on today's and on a tinted tile as on the plain one. */
  --card: color-mix(in oklch, var(--text) 8%, transparent);
  --card-ring: color-mix(in oklch, var(--text) 8%, var(--tile));
  color: var(--text);
}

.head {
  display: flex;
  flex: none;
  flex-direction: column;
  justify-content: space-between;
  height: var(--head-height);
  min-width: 0;
}

.when {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  height: 60px;
}

.number {
  display: grid;
  flex: none;
  place-items: center;
  min-width: 60px;
  height: 60px;
  box-sizing: border-box;
  padding: 0 6px;
  border-radius: 999px;
  font-family: var(--font-display);
  font-size: 48px;
  line-height: 1;
}

.number.today {
  background: var(--today-num-bg);
  color: var(--today-num-fg);
}

.names {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  line-height: 1;
}

.weekday {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.month {
  color: var(--muted);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.tile-art {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
  pointer-events: none;
}

.tile-art img {
  display: block;
  width: auto;
  max-width: 56px;
  height: 44px;
  object-fit: contain;
}

/* At the right of the head, quiet. */
.weather {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  color: var(--muted);
  font-size: 24px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.weather svg {
  flex: none;
}

.count {
  overflow: hidden;
  color: var(--muted);
  font-size: 22px;
  font-weight: 600;
  line-height: 28px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cards {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--card-gap);
  min-height: 0;
  overflow: hidden;
}

.card {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  box-sizing: border-box;
  min-width: 0;
  height: var(--card-height);
  padding: 0 14px 0 18px;
  border-radius: 22px;
  background: var(--card);
  color: var(--text);
}

.card.filled {
  color: var(--bar-text);
}

/* The muted time, on a fill. */
.card.filled .time {
  color: inherit;
  opacity: 0.75;
}

/* A title that may wrap (useWrapFit sets data-wrap): the card grows from its fixed height, with the same 32px title line, so a one-line title looks as before. */
.card[data-wrap='on'] {
  height: auto;
  min-height: var(--card-height);
  padding-block: 6px;
}

.card.past {
  opacity: 0.45;
}

.lines {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.name {
  overflow: hidden;
  font-size: 28px;
  font-weight: 700;
  line-height: 32px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-wrap='on'] .name {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow-wrap: anywhere;
  white-space: normal;
}

.time {
  overflow: hidden;
  color: var(--muted);
  font-size: 22px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  line-height: 26px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badges {
  display: flex;
  flex: none;
}

.badge {
  display: grid;
  flex: none;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: var(--color-neutral-900);
  font-size: 17px;
  font-weight: 700;
}

.badge + .badge {
  margin-left: -10px;
}

/* Overlapping circles are ringed in the card they sit on. */
.badges:has(.badge + .badge) .badge {
  box-shadow: 0 0 0 3px var(--card-ring);
}

.more {
  flex: none;
  padding-left: 18px;
  color: var(--accent-ink);
  font-size: 24px;
  font-weight: 700;
  line-height: var(--more-height);
}

.veil {
  position: absolute;
  inset: 0;
  background: var(--veil);
  pointer-events: none;
}
</style>
