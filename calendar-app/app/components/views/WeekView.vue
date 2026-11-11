<script setup lang="ts">
import { greetingSize, tileArt } from '~/utils/specialDays'
import { eventLabel } from '~/utils/eventLabel'
import { paletteAccent, personFill, PORTRAIT_WEEK_TILE_TINT, tileTint } from '~/utils/themes'
import { formatHighLow, weatherIcon } from '~/utils/weather'
import { showsLocations, showsWeatherOnDates } from '../../utils/views'
import type { ViewProps } from '../../utils/views'
import { useWrapFit } from '~/composables/useWrapFit'
import { DEFAULT_PANE_OPTIONS } from '../../../shared/layouts'
import type { ItemPeople } from '../../../shared/month-layout'
import { todayIn } from '../../../shared/dates'
import { currentWeek, weekDiff } from '../../../shared/display'
import { eventLocation } from '../../../shared/location'
import { specialDayArtUrl } from '../../../shared/special-days'
import { forecastOn } from '../../../shared/weather'
import { MAX_BADGE_INITIALS, PORTRAIT_MAX_TRACKS, shortWeekRange, weekLayout } from '../../../shared/week-layout'
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
// On the portrait stage (PR 5.13, mocks 4c and 4d, architecture §4.6) the week
// is the same seven tiles, narrower: a smaller title, a slimmer gutter and
// tighter gaps, with the type sizes as they are in landscape or a little under.
// Each column is about 176 px wide, so no more than two blocks sit side by side
// (`PORTRAIT_MAX_TRACKS`) and the rest are counted in a "+N" chip at their start
// time, on the column's right edge. A block under 50 minutes is one line, the
// badge and the title; a longer one has the badge and time over a title that
// wraps to three lines. A takeover's greeting has a line to itself under the
// title, which already fills the width. Which day is where, and how the hours
// are folded, is not different: it is the same `weekLayout`. Landscape is drawn
// exactly as before.
//
// The weather (PR 2.7) is each day's icon and high / low in its heading. Any
// part that is not known is left out, and with no weather at all the heading is
// shorter and nothing is drawn.
//
// As a pane of the week and photo view (`pane`, PR 5.14, mock 4k) it is the same
// portrait layout in the box it is given, with a short title in place of the
// full one: the range without a year, and under it in muted type where the
// week is in time, "This week", "Next week", "Last week" or else the year.
//
// A custom layout can switch two parts off (`paneOptions`, architecture §4.8):
// the title, so a layout that shows the date elsewhere does not say it twice, and
// the hour labels. Without the title the header holds the takeover's greeting
// alone, and is not drawn at all when there is none, so it takes no room and
// leaves no gap. Without the hour labels the gutter column stays in the grid
// with no width (so the columns, the strip's subgrid and the veil keep their
// numbers) and the grid is pulled back by the one gap after it; the seven days
// take the width. The hour rules and the now line are in the columns, and stay.
//
// A timed block shows its event's location (`eventLocation`, the first part of an
// address) as a second, quieter line under the title, but only in a block with
// room for it, a long event. The line is left out of the markup when locations
// are off (`showsLocations`: the display's preference, or the pane's
// `show_locations`), when the event has none worth showing and in a one-line
// block. Otherwise it is hidden unless `useWrapFit` set `data-location="on"` on
// the block's words (its title and location, which take no box of their own), which
// it does when the block's inner box still does not overflow with it. For that
// measure the title does not give way to the location, so a block whose title is
// already cut gets none, and a title is never cut shorter for a location. This view
// does not wrap titles, so the fit is only for the locations. The all-day bars,
// the band items and the "+N" chips have none.
// An optional boolean prop left out is false in Vue; `showLocations` left out means on (`showsLocations`), so it defaults to undefined.
const props = withDefaults(defineProps<ViewProps>(), { showLocations: undefined })

const options = computed(() => props.paneOptions ?? DEFAULT_PANE_OPTIONS)
const locationsOn = computed(() => showsLocations(props))

const root = ref<HTMLElement | null>(null)
useWrapFit(root, () => false)
const showHeader = computed(() => options.value.show_title || !!props.specialDays.takeover?.greeting)

const portrait = computed(() => props.stage.orientation === 'portrait')

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
  maxTracks: portrait.value ? PORTRAIT_MAX_TRACKS : undefined,
}))

/** How many days of the shown week are before today: the columns the veil covers. */
const pastDays = computed(() => layout.value.days.filter(day => day.past).length)

/** `26 October – 1 November` and `2026`, so the year can be muted as in the month's title. A title that spans two years keeps the first one in the text. */
/** The pane's title: `26 Oct – 1 Nov` and, muted, "This week", "Next week", "Last week" or else the year of the week's first day. */
const shortTitle = computed(() => {
  const first = layout.value.days[0]!.date
  const range = shortWeekRange(first, layout.value.days[6]!.date)
  const offset = weekDiff(currentWeek(props.now, props.timezone, props.weekStart), first)
  const label = offset === 0 ? 'This week' : offset === 1 ? 'Next week' : offset === -1 ? 'Last week' : first.slice(0, 4)
  return { range, label }
})

const title = computed(() => {
  const match = /^(.*) (\d{4})$/.exec(layout.value.title)
  return match ? { range: match[1]!, year: match[2]! } : { range: layout.value.title, year: '' }
})

/** Whether the forecasts are drawn at all: the pane's option, or else the display's preference for this view. Off, the head is as it is with no weather. */
const showsWeather = computed(() => showsWeatherOnDates(props, 'week'))
/** Today, `YYYY-MM-DD`: a day before it shows no forecast. */
const today = computed(() => todayIn(props.now, props.timezone))

/** Each column's forecast: an icon and `14° / 8°`, either of which can be missing; null when the forecast has neither (or there is none). */
const forecasts = computed(() => layout.value.days.map((day) => {
  if (!showsWeather.value) return null
  const forecast = forecastOn(props.weather, day.date, today.value)
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
  return special ? tileTint(special.accent, base, portrait.value ? PORTRAIT_WEEK_TILE_TINT : undefined) : base
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

/** The "+N" chips in one column. */
const overflowIn = (column: number) => layout.value.overflow.filter(chip => chip.column === column)

/** Below this many minutes a block has room for one line only: the time and the title side by side. */
const ONE_LINE_MINUTES = 50
/** The gap between side-by-side blocks, and at the tile's edge (px). Less in the narrow portrait columns. */
const blockGap = computed(() => portrait.value ? 4 : 6)

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
    portrait.value ? (anyWeather.value ? '112px' : '68px') : (anyWeather.value ? '116px' : '72px'),
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
  <section ref="root" class="view" :class="{ 'portrait': portrait, pane, 'no-hours': !options.show_hours }" data-testid="week-view">
    <header v-if="showHeader" class="header">
      <h1 v-if="options.show_title && pane" class="title" data-testid="week-title">
        <span class="range">{{ shortTitle.range }}</span>{{ ' ' }}<span class="year" data-testid="week-label">{{ shortTitle.label }}</span>
      </h1>
      <h1 v-else-if="options.show_title" class="title" data-testid="week-title">
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
          <AppIcon v-if="forecasts[day.column]!.icon" :icon="forecasts[day.column]!.icon!" :size="portrait ? 26 : 32" />
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
          <span class="name">{{ eventLabel(bar.event) }}</span>
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
          <div v-if="options.show_hours" class="band-label" :style="{ gridRow: edge === 0 ? 3 : 5 }">
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
              <span class="name">{{ eventLabel(item.event) }}</span>
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
      <div v-if="options.show_hours" class="gutter" data-testid="gutter">
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
        :style="{ gridColumn: day.column + 2, '--tile-bg': tileBackground(day) }"
      >
        <span
          v-for="(hour, index) in layout.hours"
          :key="hour"
          class="rule"
          :style="{ top: percent(index * 60) }"
        />
        <div class="blocks" :style="{ '--gap': `${blockGap}px` }">
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
            <span class="inner" data-wrap-box>
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
              <span class="words" data-wrap-item>
                <span class="name">{{ eventLabel(block.event) }}</span>
                <span
                  v-if="locationsOn && block.height >= ONE_LINE_MINUTES && eventLocation(block.event.location)"
                  class="location"
                  data-location-line
                  data-testid="event-location"
                >{{ eventLocation(block.event.location) }}</span>
              </span>
            </span>
          </div>
          <!-- Blocks that had no track left, counted where they start. Over the blocks, with a ring in the tile's colour to lift it off them. -->
          <div
            v-for="chip in overflowIn(day.column)"
            :key="chip.top"
            class="overflow"
            :style="{ top: percent(chip.top) }"
            data-testid="overflow"
          >
            +{{ chip.count }}
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

      <!-- Last, so it is over the tiles and what is on them. One strip across the past days, as in the month, so the gaps between them (where a bar runs on) are veiled too. Past days always come first in the week. -->
      <div
        v-if="pastDays > 0"
        class="veil"
        :style="{ gridColumn: `2 / span ${pastDays}` }"
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
  /* So a pane is sized by the box it is in, not by the stage. */
  container-type: size;
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

/* The title and the location: no box of their own, so they are the inner's flex items as the title alone was. */
.block .words {
  display: contents;
}

/* A second, quieter line under the title, only where the fit found room for it (data-location is set by useWrapFit on the words). */
.block .location {
  display: none;
  flex: none;
  min-width: 0;
  overflow: hidden;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.2;
  opacity: 0.7;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.block .words[data-location='on'] .location {
  display: block;
}

/* With the location in, the title keeps its lines and the fit sees whether the two fit. */
.block .words[data-location='on'] .name {
  flex-shrink: 0;
}

.block.one-line .location {
  display: none;
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

/*
 * The portrait stage (1440×2560, mocks 4c and 4d). Sizes are the mock's; the
 * mock is drawn at the stage's own size, so they are px as they are.
 */
.portrait {
  gap: 24px;
  padding: 48px 40px;
}

.portrait .header {
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
}

.portrait .title {
  gap: 18px;
}

.portrait .range {
  font-size: 76px;
}

.portrait .year {
  font-size: 40px;
}

/* The short title of a pane (mock 4k): the range in the display face, the label muted beside it. */
.pane .range {
  font-size: 56px;
  letter-spacing: -0.02em;
}

.pane .year {
  font-size: 32px;
}

/* On a line of its own, as long as the stage is wide. */
.portrait .greeting {
  text-align: left;
}

.portrait .grid {
  grid-template-columns: 64px repeat(7, minmax(0, 1fr));
  column-gap: 10px;
}

.portrait .tile,
.portrait .veil {
  border-radius: 28px;
}

/* The date and its weekday on one line, the weather under it. */
.portrait .head {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 0 0 10px;
}

.portrait .date {
  gap: 10px;
}

.portrait .number {
  min-width: 40px;
  height: 40px;
  font-size: 27px;
}

.portrait .weekday {
  font-size: 19px;
}

.portrait .day-weather {
  gap: 8px;
  margin-top: 0;
  padding-left: 4px;
  font-size: 20px;
}

/* Narrow tiles: a smaller picture, tucked into the corner. */
.portrait .tile-art {
  top: 6px;
  right: 8px;
}

.portrait .tile-art img {
  max-width: 44px;
  height: 44px;
}

.portrait .bar {
  gap: 8px;
  padding: 0 12px 0 4px;
  font-size: 19px;
}

.portrait .more {
  padding: 0 12px;
  font-size: 19px;
}

/* The gutter is 64 px wide: the label ("00–07") stays on one line. */
.portrait .band-label {
  padding-right: 4px;
  font-size: 16px;
  letter-spacing: 0;
  white-space: nowrap;
}

/* A column has no room for a time beside the title in the band either. */
.portrait .band {
  padding: 0 8px;
}

.portrait .chip {
  font-size: 18px;
}

.portrait .chip .time {
  display: none;
}

.portrait .hour-label {
  right: 4px;
  font-size: 19px;
}

.portrait .now-time {
  padding: 3px 8px;
  font-size: 18px;
}

.portrait .rule {
  right: 10px;
  left: 10px;
}

.portrait .blocks {
  inset: 0 2px 0 6px;
}

.portrait .block {
  font-size: 18px;
}

.portrait .block .inner {
  gap: 3px;
  padding: 7px 8px 6px 7px;
}

.portrait .block .top {
  gap: 6px;
}

.portrait .block .badge {
  width: 22px;
  height: 22px;
  font-size: 13px;
}

.portrait .block .time {
  min-width: 0;
  overflow: hidden;
  font-size: 17px;
  white-space: nowrap;
}

.portrait .block .location {
  font-size: 15px;
}

/* One line: the badge and the title, with no time. */
.portrait .block.one-line .inner {
  gap: 6px;
  padding: 0 8px 0 6px;
}

.portrait .block.one-line .time {
  display: none;
}

/* The count of what did not fit, on the right edge at the hidden blocks' start. */
.overflow {
  position: absolute;
  right: 0;
  z-index: 3;
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--accent);
  box-shadow: 0 0 0 3px var(--tile-bg);
  color: var(--on-accent);
  font-size: 17px;
  font-weight: 700;
  line-height: 1.3;
  transform: translateY(-35%);
}

.portrait .now-dot {
  left: 4px;
}

/* No hour labels: the gutter column has no width and the grid is pulled back by the gap after it, so the days start at the grid's edge. */
.view.no-hours .grid {
  grid-template-columns: 0 repeat(7, minmax(0, 1fr));
  margin-left: -14px;
}

.view.portrait.no-hours .grid {
  margin-left: -10px;
}
</style>
