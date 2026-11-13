<script setup lang="ts">
import MonthBand from './month/MonthBand.vue'
import MonthGreeting from './month/MonthGreeting.vue'
import MonthGrid from './month/MonthGrid.vue'
import MonthNextDays from './month/MonthNextDays.vue'
import MonthPanel from './month/MonthPanel.vue'
import MonthTitle from './month/MonthTitle.vue'
import { formatWeekday } from '~/utils/format'
import { todayIn } from '~/utils/eventRanges'
import { fitPanelDay, laneSpans, PORTRAIT_TODAY_ROWS, PORTRAIT_STRIP_ROWS } from '~/utils/monthPanel'
import { COMPACT_TILE_WIDTH, decorationsOf, MIN_TILE_WIDTH, panelDayView, tileWidthOn } from '~/utils/monthSoft'
import { weatherIcon, formatCurrent, formatHighLowWords } from '~/utils/weather'
import { showsLocations, showsWeatherOnDates } from '../../utils/views'
import type { ViewProps } from '../../utils/views'
import { monthLayout, LANES, PORTRAIT_LANES } from '../../../shared/month-layout'
import { DEFAULT_PANE_OPTIONS } from '../../../shared/layouts'
import { currentWeather, weatherOn } from '../../../shared/weather'

// The month in the Soft style (mocks 1c and 1d, architecture §4.4): the month
// title above a sage panel for today and the next three days on the left, and
// five rows of rounded day tiles on the right. The layout (which event goes in
// which lane, where "+N more" and the veils go, what the panel lists) is worked
// out by `monthLayout`; this only draws it, and fits the panel's days to the
// room there is. The grid shows `month`, which the server can pin to another
// month; the panel always starts at today.
//
// On the portrait stage (PR 5.12, mocks 4a, 4b and 4j, architecture §4.6) the
// same pieces are stacked in a column instead: the title, then a band across the
// full width that holds today (the big date, the weather and its high and low on
// the left, today's events on the right), then the five weeks at seven narrow
// columns, then a strip of three cards for the next three days. The tiles are
// taller, so each holds six lanes (`PORTRAIT_LANES`) and a timed row is just its
// badge and title, with no room for the time. Nothing about which day is where
// changes: it is the same `monthLayout`, asked for more lanes. The landscape
// layout is untouched by any of this.
//
// Special days (architecture §6, PR S.3) are drawn from `specialDays`, which the
// page has already decided: a decorated tile is tinted with its first day's
// palette accent and carries every day's art in its top-right corner, and a
// takeover's greeting goes at the top of the panel (or the band). The takeover's
// colours are the stage's theme and its art is a layer behind this view, so the
// one thing the panel does about it is stop being full height: only as tall as
// its content, it leaves the lower part of the column clear for the art to show.
// The portrait band is only as tall as its content anyway, which with a greeting
// in it takes room from the weeks, so the portrait grid lets its lanes shrink a
// little rather than lose one. With nothing special, none of this draws and the
// view is exactly as it was.
//
// The weather (PR 2.7) is drawn in the panel only: the current conditions under
// the weekday, and each day's icon and high / low at the right of its heading
// (the portrait band adds today's high and low in words). Any part that is not
// known is left out, and with no weather at all nothing is drawn, so the panel
// is exactly as it was.
//
// The weather is also drawn in the grid (issue 72): a day's tile that is today
// or later and has a forecast shows its icon and high at the right end of the
// date row, opposite the day number, in muted type. Past days and days without
// a forecast stay plain, and so does every tile when the month's forecast on
// dates is off (the display's preference, or a pane's `weather_on_dates`). It
// takes no lane and no height, and gives way rather than push or cut the day
// number: in a narrow tile (`COMPACT_TILE_WIDTH`, the portrait stage or a small
// pane) it is the icon alone, and where the right end is taken by a special
// day's art, or the tile is too narrow even for the icon (`MIN_TILE_WIDTH`),
// it is left out. The panel's and the cards' weather above is not affected by
// the toggle.
//
// An event's location (issue 74) is never drawn in a tile. The panel's rows and the
// strip's cards show it as a second, quieter line under the title, and only where
// `useWrapFit` finds room left over once every title has its own (the display's
// preference, or a pane's `show_locations`); it never costs a title a line, clips
// a row or changes a "+N more". The portrait band is not fitted, so it has none.
//
// A custom layout's pane options (architecture §4.8) change the pieces, never
// the month: `show_title` and `show_sidebar` leave out the heading, and the
// panel (the band and the strip in portrait), so the grid takes their room; a
// takeover's greeting is then drawn in a header row of its own above the grid,
// at the right of the title if that is shown, so it is never lost, and a header
// with nothing in it is not drawn. `fill_events` gives the timed rows and the
// panel's rows the fill the bars have, split between the people when there are
// several (`eventFill`), and `show_initials` (on) can leave their badges out so
// the title has the room. The bars are coloured and badged whatever the options
// say, and are left as they are. `wrap_titles` lets a title use more
// lines where there is room: in the grid a bar or timed row may run down into
// the free lanes below it (`laneSpans`), and in the panel and the strip's cards
// `useWrapFit` measures. The portrait band is left out of that on purpose: it is
// as tall as its content, so a wrapped row would push the weeks down instead of
// using spare room. Without the options (every full-screen month) none of this
// shows.
// `showLocations` left out means on, not the false Vue makes of an omitted boolean.
// `showLocations` left out means on, not the false Vue makes of an omitted boolean.
const props = withDefaults(defineProps<ViewProps>(), { showLocations: undefined })

const options = computed(() => props.paneOptions ?? DEFAULT_PANE_OPTIONS)
/** Whether coloured events show their people's initials: always, unless they are coloured and the pane asks for none. */
const showInitials = computed(() => !options.value.fill_events || options.value.show_initials)
const root = ref<HTMLElement | null>(null)
useWrapFit(root, () => options.value.wrap_titles)
const locationsOn = computed(() => showsLocations(props))

const today = computed(() => todayIn(props.now, props.timezone))
const portrait = computed(() => props.stage.orientation === 'portrait')

const layout = computed(() => monthLayout({
  month: props.month,
  today: today.value,
  timeZone: props.timezone,
  weekStart: props.weekStart,
  events: props.events,
  lanes: portrait.value ? PORTRAIT_LANES : undefined,
}))

const tileWidth = computed(() => tileWidthOn(props.stage.width, portrait.value, options.value.show_sidebar))
const compactTiles = computed(() => tileWidth.value < COMPACT_TILE_WIDTH)
const showsCellWeather = computed(() => showsWeatherOnDates(props, 'month') && tileWidth.value >= MIN_TILE_WIDTH)

/** The takeover's greeting when it has no panel to go in, to be drawn in the header row. */
const headerGreeting = computed(() => options.value.show_sidebar ? null : props.specialDays.takeover?.greeting ?? null)

/** Each week's lane spans for wrapping titles, or nulls when the option is off. */
const spans = computed(() => layout.value.rows.map(week => options.value.wrap_titles ? laneSpans(week, portrait.value ? PORTRAIT_LANES : LANES) : null))

/** The panel's days, each trimmed to the rows that fit, with its forecast. Only the first is today, so only it has events that are over. */
const panelDays = computed(() => layout.value.panel.map((day, index) => panelDayView(day, props.now, index === 0, props.weather)))

/** Portrait: today's rows for the band, which has room for more than a panel day. */
const bandDay = computed(() => fitPanelDay(layout.value.panel[0]!, props.now, true, PORTRAIT_TODAY_ROWS))

/** Portrait: the three days after today, each in a card with room for fewer rows. */
const stripDays = computed(() => layout.value.panel.slice(1).map(day => panelDayView(day, props.now, false, props.weather, PORTRAIT_STRIP_ROWS)))

/** `High 14° · Low 8°` for today, or null when the forecast has neither. */
const todayHighLow = computed(() => {
  const day = weatherOn(props.weather, today.value)
  return day ? formatHighLowWords(day) : null
})

const dayNumber = computed(() => Number(today.value.slice(8, 10)))
const weekday = computed(() => formatWeekday(props.now, props.timezone))

/** The current conditions as an icon and words, or null for none (or if they are too old to say what it is like now). */
const nowWeather = computed(() => {
  const current = currentWeather(props.weather, props.now)
  const text = current && formatCurrent(current)
  return current && text ? { icon: weatherIcon(current.condition), text } : null
})

const decorated = computed(() => decorationsOf(props.specialDays.tiles))
</script>

<template>
  <section ref="root" class="view" :class="{ portrait, 'no-side': !options.show_sidebar }" data-testid="month-view">
    <!-- Without the sidebar there is no column for the title or a takeover's greeting, so they share a row above the grid. -->
    <header v-if="!options.show_sidebar && (options.show_title || headerGreeting)" class="head">
      <MonthTitle v-if="options.show_title" :month="month" />
      <MonthGreeting v-if="headerGreeting" class="head-greeting" :greeting="headerGreeting" />
    </header>

    <div v-if="options.show_sidebar" class="side">
      <MonthTitle v-if="options.show_title" :month="month" />

      <MonthBand
        v-if="portrait"
        :greeting="specialDays.takeover?.greeting ?? null"
        :takeover="!!specialDays.takeover"
        :day-number="dayNumber"
        :weekday="weekday"
        :now-weather="nowWeather"
        :high-low="todayHighLow"
        :day="bandDay"
        :fill="options.fill_events"
        :initials="showInitials"
      />

      <MonthPanel
        v-else
        :greeting="specialDays.takeover?.greeting ?? null"
        :takeover="!!specialDays.takeover"
        :day-number="dayNumber"
        :weekday="weekday"
        :now-weather="nowWeather"
        :days="panelDays"
        :fill="options.fill_events"
        :initials="showInitials"
        :locations="locationsOn"
      />
    </div>

    <MonthGrid
      :layout="layout"
      :spans="spans"
      :decorated="decorated"
      :weather="weather"
      :today="today"
      :portrait="portrait"
      :fill-events="options.fill_events"
      :show-initials="showInitials"
      :cell-weather="showsCellWeather"
      :compact-tiles="compactTiles"
    />

    <MonthNextDays
      v-if="portrait && options.show_sidebar"
      :days="stripDays"
      :fill="options.fill_events"
      :initials="showInitials"
      :locations="locationsOn"
    />
  </section>
</template>

<style scoped>
/* Sizes are px on the 2560×1440 stage, taken from the Soft mock. The pieces (title, panel, band, grid, strip) are in ./month and style themselves; what is here is the view's own layout and the chrome of the panel and the band. */
.view {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 640px minmax(0, 1fr);
  gap: 48px;
  padding: 48px;
  overflow: hidden;
}

.side {
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-height: 0;
}

.panel {
  box-sizing: border-box;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 36px;
  min-height: 0;
  padding: 44px 48px;
  overflow: hidden;
  border-radius: 64px;
  background: var(--panel);
  color: var(--panel-text);
}

/* During a takeover, only as tall as what is in it (and still shrinking to the column if that is too much), so the art shows below. */
.panel.takeover {
  flex: 0 1 auto;
}

/* Without the sidebar: the title and a takeover's greeting in a row above the grid, which then has the whole width. */
.view.no-side {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 40px;
}

/* At the right of the title, as the week has it, or alone at the left when there is no title. */
.head .head-greeting {
  min-width: 0;
  margin-bottom: 0;
  text-align: right;
}

.head .head-greeting:first-child {
  flex: 1;
  padding-left: 12px;
  text-align: left;
}

.no-side .grid {
  flex: 1;
}

/* The portrait stage (1440×2560, mocks 4a, 4b and 4j): one column of title, today's band, the weeks and the strip. */
.view.portrait {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.portrait .side {
  flex: none;
}

.portrait .grid {
  flex: 1;
}
</style>
