<script setup lang="ts">
import { greetingSize, tileArt } from '~/utils/specialDays'
import { paletteAccent, personFill, tileTint } from '~/utils/themes'
import { formatHighLow, weatherIcon } from '~/utils/weather'
import type { ViewProps } from '../../utils/views'
import type { ItemPeople } from '../../../shared/month-layout'
import { specialDayArtUrl } from '../../../shared/special-days'
import { weatherOn } from '../../../shared/weather'
import { MAX_BADGE_INITIALS, weekLayout } from '../../../shared/week-layout'
import type { AllDayBar, Band, TimedBlock, WeekDay } from '../../../shared/week-layout'

// The week in the Soft style (architecture §4.5; there is no mock, so it borrows
// the Soft month's language): the date range as a title, then seven tall rounded
// day tiles side by side. Down the left is a gutter of hour labels. In each
// tile, from the top: the weekday and date (with the day's forecast under it,
// when there is one), the all-day and multi-day events as bars in a strip that
// runs across the tiles, a thin folded band for anything before the first hour
// drawn, the hours themselves with the timed events as blocks, and a thin
// folded band for anything after the last. Events that overlap in time sit side
// by side. A "now" line crosses today's column.
//
// The layout (which lane a bar is in, which track a block is on, which hours
// are folded, where now is) is worked out by `weekLayout`; this only draws it.
// Every part of the week shares one CSS grid, so the strip's bars and the bands
// can run across the tiles and the gutter, and the hour scale lines up in all
// seven columns. The hour scale is drawn in percentages of its own height: the
// layout gives minutes, and the grid gives that row whatever room is left.
//
// Special days (architecture §6) are the page's decision, drawn here as in the
// month: a decorated tile is tinted with its first day's palette accent and
// carries every day's art beside its date, and a takeover's greeting goes at the
// right of the title. The takeover's palette is the stage's, and its art is a
// layer behind this view, so the view has no background of its own and the art
// shows in the gaps between the tiles.
//
// The weather (PR 2.7) is each day's icon and high / low in its heading. Any
// part that is not known is left out, and with no weather at all the heading is
// shorter and nothing is drawn.
const props = defineProps<ViewProps>()

/** The height of a lane in the all-day strip, and the gap between lanes (px). Used for the strip's rows. */
const LANE = 34
const LANE_GAP = 5

const layout = computed(() => weekLayout({
  weekOf: props.weekOf,
  now: props.now,
  timeZone: props.timezone,
  weekStart: props.weekStart,
  hours: props.weekHours,
  events: props.events,
}))

/** `26 October – 1 November` and `2026`, so the year can be muted as in the month's title. A title that spans two years keeps the first one in the text. */
const title = computed(() => {
  const match = /^(.*) (\d{4})$/.exec(layout.value.title)
  return match ? { range: match[1]!, year: match[2]! } : { range: layout.value.title, year: '' }
})

/** Each column's forecast: an icon and `14° / 8°`, either of which can be missing; null when the forecast has neither (or there is none). */
const forecasts = computed(() => layout.value.days.map((day) => {
  const forecast = weatherOn(props.weather, day.date)
  if (!forecast) return null
  const text = formatHighLow(forecast)
  const icon = weatherIcon(forecast.condition)
  return icon || text ? { icon, text } : null
}))
const anyWeather = computed(() => forecasts.value.some(forecast => forecast !== null))

/** What a decorated date has: the first day's id and accent (they set the tint) and every day's art, side by side. */
const decorated = computed(() => new Map(props.specialDays.tiles.flatMap(({ date, days }) => {
  const first = days[0]
  return first ? [[date, { id: first.id, accent: paletteAccent(first.palette), art: tileArt(days) }] as const] : []
})))

/** A tile's background: today's own or the ordinary one, with a special day's tint mixed into it. */
function tileBackground(day: WeekDay): string {
  const base = day.today ? 'var(--today-cell)' : 'var(--tile)'
  const special = decorated.value.get(day.date)
  return special ? tileTint(special.accent, base) : base
}

/** The badges an item gets: its first people, as many as the layout kept initials for. Keyed by person, as two can share an initial. */
function badgesOf(item: ItemPeople): { id: string, initial: string, colour: string }[] {
  return item.initials.slice(0, MAX_BADGE_INITIALS).map((initial, index) => ({ id: item.people[index]!.id, initial, colour: item.people[index]!.colour }))
}

/** An event's fill. With nobody on it (no person matched) it is the surface colour and has no badge. */
const fillOf = (colour: string | null): string => colour ? personFill(colour) : 'var(--surface)'

function barStyle(bar: AllDayBar) {
  const start = bar.roundStart ? '999px' : '8px'
  const end = bar.roundEnd ? '999px' : '8px'
  return {
    'gridColumn': `${bar.column + 1} / span ${bar.span}`,
    'gridRow': bar.lane + 1,
    // A round end sits in from the tile's edge; a square one runs on into its neighbour.
    'margin': `0 ${bar.roundEnd ? '8px' : '0'} 0 ${bar.roundStart ? '8px' : '0'}`,
    'borderRadius': `${start} ${end} ${end} ${start}`,
    'background': fillOf(bar.colour),
    '--ring': fillOf(bar.colour),
  }
}

/** The blocks in one column. */
const blocksIn = (column: number): TimedBlock[] => layout.value.blocks.filter(block => block.column === column)

/** Below this many minutes a block has room for one line only: the time and the title side by side. */
const ONE_LINE_MINUTES = 50
/** The gap between side-by-side blocks, and at the tile's edge (px). */
const BLOCK_GAP = 6

function blockStyle(block: TimedBlock) {
  const range = layout.value.rangeMinutes
  // The corner that was cut by the range is square; the others are rounded.
  const top = block.clippedStart ? '6px' : '14px'
  const bottom = block.clippedEnd ? '6px' : '14px'
  return {
    'top': `${block.top / range * 100}%`,
    'height': `${block.height / range * 100}%`,
    'left': `${block.track / block.tracks * 100}%`,
    'width': `${100 / block.tracks}%`,
    'borderRadius': `${top} ${top} ${bottom} ${bottom}`,
    'background': fillOf(block.colour),
    '--ring': fillOf(block.colour),
  }
}

/** The now pill sits over the gutter, so an hour label within this many minutes of it is hidden rather than overlapped. */
const NOW_CLEARANCE = 25
const coveredByNow = (minutes: number): boolean => {
  const position = layout.value.now?.position
  return typeof position === 'number' && Math.abs(position - minutes) < NOW_CLEARANCE
}

/** Where a position falls on the hour scale, as a percentage of its height. */
const percent = (minutes: number): string => `${minutes / layout.value.rangeMinutes * 100}%`

/** The rows of the grid, top to bottom: heading, strip, early band, hours, late band. The strip and the bands take no room when empty. */
const gridRows = computed(() => {
  const strip = layout.value.allDay.lanes
  return [
    anyWeather.value ? '116px' : '72px',
    strip ? `${strip * LANE + (strip - 1) * LANE_GAP + 14}px` : '0px',
    layout.value.early ? '48px' : '0px',
    'minmax(0, 1fr)',
    layout.value.late ? '48px' : '0px',
  ].join(' ')
})

/** A band's cell in a column: its items by start time. */
const bandItems = (band: Band, column: number) => band.items[column] ?? []

// The cells of a band show the first item and a "+N" for the rest.
const BAND_SHOWN = 1
</script>

<template>
  <section class="view" data-testid="week-view">
    <header class="header">
      <h1 class="title" data-testid="week-title">
        <!-- The space is for the text ("26 October – 1 November 2026"); between flex items it takes no room. -->
        <span class="range">{{ title.range }}</span>{{ ' ' }}<span v-if="title.year" class="year">{{ title.year }}</span>
      </h1>
      <div
        v-if="specialDays.takeover?.greeting"
        class="greeting"
        data-testid="greeting"
        :style="{ fontSize: `${greetingSize(specialDays.takeover.greeting)}px` }"
      >
        {{ specialDays.takeover.greeting }}
      </div>
    </header>

    <div class="grid" :style="{ gridTemplateRows: gridRows }">
      <!-- The tiles, one tall tile per day behind everything else in its column. -->
      <div
        v-for="day in layout.days"
        :key="day.date"
        class="tile"
        :style="{ gridColumn: day.column + 2, background: tileBackground(day) }"
        data-testid="day-tile"
        :data-date="day.date"
        :data-today="day.today"
        :data-special="decorated.get(day.date)?.id"
      />

      <!-- Headings. -->
      <div
        v-for="day in layout.days"
        :key="`head-${day.date}`"
        class="head"
        :style="{ gridColumn: day.column + 2 }"
      >
        <div class="date">
          <span
            class="number"
            :class="{ today: day.today }"
            :data-testid="day.today ? 'today-number' : undefined"
          >{{ day.day }}</span>
          <span class="weekday">{{ day.weekday }}</span>
        </div>
        <div v-if="decorated.get(day.date)?.art.length" class="tile-art">
          <img
            v-for="(name, index) in decorated.get(day.date)!.art"
            :key="`${name}-${index}`"
            :src="specialDayArtUrl(name)"
            alt=""
            draggable="false"
            data-testid="tile-art"
          >
        </div>
        <div v-if="forecasts[day.column]" class="day-weather" data-testid="day-weather">
          <AppIcon v-if="forecasts[day.column]!.icon" :icon="forecasts[day.column]!.icon!" :size="32" />
          <span v-if="forecasts[day.column]!.text">{{ forecasts[day.column]!.text }}</span>
        </div>
      </div>

      <!-- The all-day strip: the bars run across the tiles on the columns of the grid, which this one shares. -->
      <div
        v-if="layout.allDay.lanes"
        class="strip"
        :style="{ gridTemplateRows: `repeat(${layout.allDay.lanes}, ${LANE}px)`, rowGap: `${LANE_GAP}px` }"
      >
        <div
          v-for="bar in layout.allDay.bars"
          :key="`${bar.event.id}-${bar.column}`"
          class="bar"
          :style="barStyle(bar)"
          data-testid="event"
          data-kind="bar"
        >
          <span v-if="bar.initials.length" class="badges">
            <span
              v-for="badge in badgesOf(bar)"
              :key="badge.id"
              class="badge"
              :style="{ background: badge.colour }"
            >{{ badge.initial }}</span>
          </span>
          <span class="name">{{ bar.event.display_title }}</span>
        </div>
        <div
          v-for="more in layout.allDay.more"
          :key="more.column"
          class="more"
          :style="{ gridColumn: more.column + 1, gridRow: more.lane + 1 }"
          data-testid="more"
        >
          +{{ more.count }} more
        </div>
      </div>

      <!-- The folded hours before and after the range: a dashed edge, a label in the gutter and what is wholly inside them. -->
      <template v-for="(band, edge) in [layout.early, layout.late]" :key="edge">
        <template v-if="band">
          <div class="band-label" :style="{ gridRow: edge === 0 ? 3 : 5 }">
            {{ band.label }}
          </div>
          <div
            v-for="day in layout.days"
            :key="`${edge}-${day.date}`"
            class="band"
            :class="edge === 0 ? 'early' : 'late'"
            :style="{ gridColumn: day.column + 2, gridRow: edge === 0 ? 3 : 5 }"
          >
            <div
              v-for="item in bandItems(band, day.column).slice(0, BAND_SHOWN)"
              :key="item.event.id"
              class="chip"
              :class="{ past: item.past }"
              :style="{ '--ring': 'transparent' }"
              data-testid="band-item"
              :data-band="edge === 0 ? 'early' : 'late'"
            >
              <span v-if="item.initials.length" class="badges">
                <span
                  v-for="badge in badgesOf(item)"
                  :key="badge.id"
                  class="badge"
                  :style="{ background: badge.colour }"
                >{{ badge.initial }}</span>
              </span>
              <span class="time">{{ item.time }}</span>
              <span class="name">{{ item.event.display_title }}</span>
            </div>
            <span v-if="bandItems(band, day.column).length > BAND_SHOWN" class="chip-more">+{{ bandItems(band, day.column).length - BAND_SHOWN }}</span>
            <!-- The now line, when now is in this band. -->
            <template v-if="layout.now && layout.now.column === day.column && layout.now.position === (edge === 0 ? 'early' : 'late')">
              <div class="now-line" :class="edge === 0 ? 'at-bottom' : 'at-top'" data-testid="now-line">
                <span class="now-dot" />
              </div>
            </template>
          </div>
        </template>
      </template>

      <!-- The hours: labels in the gutter, a rule at each hour in each column, and the blocks. -->
      <div class="gutter">
        <span
          v-for="(hour, index) in layout.hours"
          :key="hour"
          class="hour-label"
          :class="{ covered: coveredByNow(index * 60) }"
          :style="{ top: percent(index * 60) }"
        >{{ String(hour).padStart(2, '0') }}:00</span>
        <span
          v-if="layout.now && typeof layout.now.position === 'number'"
          class="now-time"
          :style="{ top: percent(layout.now.position) }"
          data-testid="now-time"
        >{{ layout.now.time }}</span>
      </div>
      <div
        v-for="day in layout.days"
        :key="`hours-${day.date}`"
        class="hours"
        :style="{ gridColumn: day.column + 2 }"
      >
        <span
          v-for="(hour, index) in layout.hours"
          :key="hour"
          class="rule"
          :style="{ top: percent(index * 60) }"
        />
        <div class="blocks" :style="{ '--gap': `${BLOCK_GAP}px` }">
          <div
            v-for="block in blocksIn(day.column)"
            :key="block.event.id"
            class="block"
            :class="{ 'one-line': block.height < ONE_LINE_MINUTES, 'shared': block.tracks > 1, 'past': block.past }"
            :style="blockStyle(block)"
            data-testid="event"
            data-kind="block"
            :data-track="block.track"
            :data-tracks="block.tracks"
          >
            <span class="inner">
              <span class="top">
                <span v-if="block.initials.length" class="badges">
                  <span
                    v-for="badge in badgesOf(block)"
                    :key="badge.id"
                    class="badge"
                    :style="{ background: badge.colour }"
                  >{{ badge.initial }}</span>
                </span>
                <span class="time">{{ block.time }}</span>
              </span>
              <span class="name">{{ block.event.display_title }}</span>
            </span>
          </div>
        </div>
        <div
          v-if="layout.now && layout.now.column === day.column && typeof layout.now.position === 'number'"
          class="now-line"
          :style="{ top: percent(layout.now.position) }"
          data-testid="now-line"
        >
          <span class="now-dot" />
        </div>
      </div>

      <!-- Last, so they are over the tiles and what is on them. -->
      <div
        v-for="day in layout.days.filter(candidate => candidate.past)"
        :key="`veil-${day.date}`"
        class="veil"
        :style="{ gridColumn: day.column + 2 }"
        data-testid="veil"
      />
    </div>
  </section>
</template>

<style scoped>
/* Sizes are px on the 2560×1440 stage, in the language of the Soft month. */
.view {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 48px;
  overflow: hidden;
}

.header {
  display: flex;
  flex: none;
  align-items: baseline;
  justify-content: space-between;
  gap: 48px;
  padding-left: 12px;
}

.title {
  display: flex;
  align-items: baseline;
  gap: 20px;
  margin: 0;
  font-family: var(--font-display);
  font-weight: 400;
  line-height: 1;
  white-space: nowrap;
}

.range {
  font-size: 88px;
  letter-spacing: -0.02em;
}

.year {
  color: var(--muted);
  font-size: 44px;
}

/* At the right of the title, where the month view's panel has its own. The size is set from the length of the greeting. */
.greeting {
  min-width: 0;
  font-family: var(--font-display);
  line-height: 1.05;
  text-align: right;
  text-wrap: balance;
}

/* A gutter for the hour labels, then seven equal columns. Everything in the week is placed on this one grid; its rows are set from the layout. */
.grid {
  position: relative;
  display: grid;
  flex: 1;
  grid-template-columns: 96px repeat(7, minmax(0, 1fr));
  column-gap: 14px;
  min-height: 0;
}

.tile {
  grid-row: 1 / -1;
  border-radius: 32px;
}

.head {
  position: relative;
  grid-row: 1;
  min-width: 0;
  padding: 14px 0 0 20px;
}

.date {
  display: flex;
  align-items: center;
  gap: 14px;
}

.number {
  display: grid;
  place-items: center;
  min-width: 44px;
  height: 44px;
  border-radius: 999px;
  font-size: 30px;
  font-weight: 700;
}

.number.today {
  background: var(--today-num-bg);
  color: var(--today-num-fg);
}

.weekday {
  color: var(--muted);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.1em;
  line-height: 1;
  text-transform: uppercase;
}

/* The top-right of a tile, beside the date, for a special day's art; it does not push anything. */
.tile-art {
  position: absolute;
  top: 8px;
  right: 14px;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  pointer-events: none;
}

.tile-art img {
  display: block;
  width: auto;
  max-width: 96px;
  height: 56px;
  object-fit: contain;
}

/* Under the date, quiet. */
.day-weather {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
  color: var(--muted);
  font-size: 26px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.day-weather svg {
  flex: none;
}

/* The strip shares the seven columns (a subgrid), so a bar can run across tiles. */
.strip {
  display: grid;
  grid-column: 2 / -1;
  grid-row: 2;
  grid-template-columns: subgrid;
  align-content: start;
  min-height: 0;
}

.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 0 14px 0 4px;
  overflow: hidden;
  color: var(--bar-text);
  font-size: 20px;
  font-weight: 700;
  white-space: nowrap;
}

.more {
  display: flex;
  align-items: center;
  padding: 0 16px;
  color: var(--accent-ink);
  font-size: 20px;
  font-weight: 700;
}

.badges {
  display: flex;
  flex: none;
}

.badge {
  display: grid;
  flex: none;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  color: var(--color-neutral-900);
  font-size: 14px;
  font-weight: 700;
}

.badge + .badge {
  margin-left: -8px;
}

/* Overlapping circles for an event shared by several people, ringed in whatever they sit on. */
.badges:has(.badge + .badge) .badge {
  box-shadow: 0 0 0 2px var(--ring);
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* A folded band: dashed above and below, so it reads as hours squeezed out rather than a row of events. */
.band-label {
  display: flex;
  grid-column: 1;
  align-items: center;
  justify-content: flex-end;
  padding-right: 8px;
  color: var(--faint);
  font-size: 18px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.band {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 0 14px;
  border-top: 2px dashed var(--line);
  border-bottom: 2px dashed var(--line);
  overflow: hidden;
}

/* Only the edge towards the hours is dashed; the outer one would sit on the tile's own edge. */
.band.early {
  border-top-color: transparent;
}

.band.late {
  border-bottom-color: transparent;
}

.chip {
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 19px;
  font-weight: 600;
  white-space: nowrap;
}

.chip.past {
  opacity: 0.45;
}

.chip .time,
.block .time {
  flex: none;
  color: var(--muted);
  font-weight: 700;
}

.chip-more {
  flex: none;
  color: var(--accent-ink);
  font-size: 19px;
  font-weight: 700;
}

/* The hour labels' own column. Positioned boxes of the same height as the hours area, so a label's percentage is a line's. */
.gutter {
  position: relative;
  grid-column: 1;
  grid-row: 4;
  min-height: 0;
}

.hour-label {
  position: absolute;
  right: 6px;
  color: var(--muted);
  font-size: 22px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 1;
  transform: translateY(-50%);
}

.hour-label.covered {
  visibility: hidden;
}

/* The hours labelled at the edge of the range would stick out of the tile; the first sits below the band instead. */
.hour-label:first-child {
  transform: translateY(-20%);
}

.hours {
  position: relative;
  grid-row: 4;
  min-height: 0;
}

.rule {
  position: absolute;
  right: 14px;
  left: 14px;
  height: 2px;
  background: var(--line);
}

/* Blocks are placed in minutes, as percentages of this box. */
.blocks {
  position: absolute;
  inset: 0 8px;
}

.block {
  position: absolute;
  box-sizing: border-box;
  min-width: 0;
  padding: 0 0 0 0;
  overflow: hidden;
  color: var(--bar-text);
  font-size: 20px;
  line-height: 1.2;
}

/* A gap on every side of a block, taken out of the box so neighbours never touch. */
.block {
  border: 0 solid transparent;
  border-width: 1px var(--gap) 1px 0;
  background-clip: padding-box;
}

.block .inner {
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-sizing: border-box;
  height: 100%;
  padding: 8px 10px 6px 12px;
  overflow: hidden;
}

.block .top {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.block .name {
  display: -webkit-box;
  font-weight: 600;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow-wrap: anywhere;
}

/* Squeezed between neighbours as well: the title matters more than the time, which the hour scale gives anyway. */
.block.one-line.shared .time {
  display: none;
}

/* Too short for two lines: the time and the title side by side on one. */
.block.one-line .inner {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding-top: 0;
  padding-bottom: 0;
}

.block.one-line .name {
  display: block;
  min-width: 0;
  white-space: nowrap;
  line-clamp: 1;
  -webkit-line-clamp: 1;
}

.block.past {
  opacity: 0.45;
}

/* Now: a rule across today's column with a dot at its left end, and the time in the gutter. */
.now-line {
  position: absolute;
  right: 0;
  left: 0;
  z-index: 2;
  height: 4px;
  border-radius: 2px;
  background: var(--accent);
  transform: translateY(-50%);
  pointer-events: none;
}

.now-line.at-bottom {
  top: auto;
  bottom: 0;
  transform: translateY(50%);
}

.now-line.at-top {
  top: 0;
}

.now-dot {
  position: absolute;
  top: 50%;
  left: 6px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent);
  transform: translateY(-50%);
}

.now-time {
  position: absolute;
  right: 0;
  z-index: 2;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 20px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 1.1;
  transform: translateY(-50%);
}

.veil {
  grid-row: 1 / -1;
  border-radius: 32px;
  background: var(--veil);
  pointer-events: none;
}
</style>
