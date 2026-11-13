<script setup lang="ts">
import { tileArt } from '~/utils/specialDays'
import { paletteAccent, PORTRAIT_WEEK_TILE_TINT, tileTint } from '~/utils/themes'
import { formatHighLow, weatherIcon } from '~/utils/weather'
import { showsLocations, showsWeatherOnDates } from '../../utils/views'
import type { ViewProps } from '../../utils/views'
import { blockGapFor, gridRowsOf, paneTitle, splitTitle } from '~/utils/weekView'
import type { DayForecast } from '~/utils/weekView'
import { useWrapFit } from '~/composables/useWrapFit'
import { DEFAULT_PANE_OPTIONS } from '../../../shared/layouts'
import { todayIn } from '../../../shared/dates'
import { forecastOn } from '../../../shared/weather'
import { PORTRAIT_MAX_TRACKS, weekLayout } from '../../../shared/week-layout'
import type { WeekDay } from '../../../shared/week-layout'
import WeekAllDayStrip from './week/WeekAllDayStrip.vue'
import WeekBand from './week/WeekBand.vue'
import WeekDayHead from './week/WeekDayHead.vue'
import WeekDayHours from './week/WeekDayHours.vue'
import WeekGutter from './week/WeekGutter.vue'
import WeekHeader from './week/WeekHeader.vue'

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
//
// The drawing is split by part: the sizes and inline styles are in `utils/weekView`,
// and the title, a day's heading, the all-day strip, a band, the gutter and a day's
// hours (with its blocks) are components in `week/`. They are all children of the
// one grid below, so the markup is as it was in a single file. Their styles are
// scoped to them, and the `portrait` and `pane` classes of the root here still
// reach them as ancestors.
const props = withDefaults(defineProps<ViewProps>(), { showLocations: undefined })

const options = computed(() => props.paneOptions ?? DEFAULT_PANE_OPTIONS)
const locationsOn = computed(() => showsLocations(props))

const root = ref<HTMLElement | null>(null)
useWrapFit(root, () => false)
const showHeader = computed(() => options.value.show_title || !!props.specialDays.takeover?.greeting)

const portrait = computed(() => props.stage.orientation === 'portrait')

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

/** The pane's title: `26 Oct – 1 Nov` and, muted, "This week", "Next week", "Last week" or else the year of the week's first day. */
const shortTitle = computed(() => paneTitle(layout.value.days[0]!.date, layout.value.days[6]!.date, props.now, props.timezone, props.weekStart))

/** `26 October – 1 November` and `2026`, so the year can be muted as in the month's title. */
const title = computed(() => splitTitle(layout.value.title))

/** Whether the forecasts are drawn at all: the pane's option, or else the display's preference for this view. Off, the head is as it is with no weather. */
const showsWeather = computed(() => showsWeatherOnDates(props, 'week'))
/** Today, `YYYY-MM-DD`: a day before it shows no forecast. */
const today = computed(() => todayIn(props.now, props.timezone))

/** Each column's forecast: an icon and `14° / 8°`, either of which can be missing; null when the forecast has neither (or there is none). */
const forecasts = computed<(DayForecast | null)[]>(() => layout.value.days.map((day) => {
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

/** The blocks in one column. */
const blocksIn = (column: number) => layout.value.blocks.filter(block => block.column === column)

/** The "+N" chips in one column. */
const overflowIn = (column: number) => layout.value.overflow.filter(chip => chip.column === column)

const gridRows = computed(() => gridRowsOf(layout.value, portrait.value, anyWeather.value))
</script>

<template>
  <section ref="root" class="view" :class="{ 'portrait': portrait, pane, 'no-hours': !options.show_hours }" data-testid="week-view">
    <WeekHeader
      v-if="showHeader"
      :show-title="options.show_title"
      :pane="pane"
      :title="title"
      :short-title="shortTitle"
      :greeting="specialDays.takeover?.greeting"
    />

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
      <WeekDayHead
        v-for="day in layout.days"
        :key="`head-${day.date}`"
        :style="{ gridColumn: day.column + 2 }"
        :day="day"
        :art="decorated.get(day.date)?.art"
        :forecast="forecasts[day.column] ?? null"
        :portrait="portrait"
      />

      <!-- The all-day strip: the bars run across the tiles on the columns of the grid, which this one shares. -->
      <WeekAllDayStrip v-if="layout.allDay.lanes" :all-day="layout.allDay" />

      <!-- The folded hours before and after the range: a dashed edge, a label in the gutter and what is wholly inside them. -->
      <template v-for="(band, edge) in [layout.early, layout.late]" :key="edge">
        <WeekBand
          v-if="band"
          :band="band"
          :edge="edge === 0 ? 'early' : 'late'"
          :days="layout.days"
          :now="layout.now"
          :show-hours="options.show_hours"
        />
      </template>

      <!-- The hours: labels in the gutter, a rule at each hour in each column, and the blocks. -->
      <WeekGutter
        v-if="options.show_hours"
        :hours="layout.hours"
        :range-minutes="layout.rangeMinutes"
        :now="layout.now"
      />
      <WeekDayHours
        v-for="day in layout.days"
        :key="`hours-${day.date}`"
        :style="{ gridColumn: day.column + 2 }"
        :day="day"
        :hours="layout.hours"
        :range-minutes="layout.rangeMinutes"
        :blocks="blocksIn(day.column)"
        :overflow="overflowIn(day.column)"
        :now="layout.now"
        :tile-background="tileBackground(day)"
        :block-gap="blockGapFor(portrait)"
        :locations-on="locationsOn"
      />

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
/* Sizes are px on the 2560×1440 stage, in the language of the Soft month. The parts have their own styles in `week/`. */
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

.portrait .grid {
  grid-template-columns: 64px repeat(7, minmax(0, 1fr));
  column-gap: 10px;
}

.portrait .tile,
.portrait .veil {
  border-radius: 28px;
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
