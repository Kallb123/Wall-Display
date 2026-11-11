<script setup lang="ts">
import MonthPanelRows from './MonthPanelRows.vue'
import { formatWeekday } from '~/utils/format'
import { eventLabel } from '~/utils/eventLabel'
import { todayIn } from '~/utils/eventRanges'
import { badgesOf, fitPanelDay, laneSpans, PORTRAIT_STRIP_ROWS, PORTRAIT_TODAY_ROWS } from '~/utils/monthPanel'
import { greetingSize, tileArt } from '~/utils/specialDays'
import { eventFill } from '~/utils/eventFill'
import { paletteAccent, personFill, tileTint } from '~/utils/themes'
import { formatCurrent, formatHighLow, formatHighLowWords, weatherIcon } from '~/utils/weather'
import { showsWeatherOnDates } from '../../utils/views'
import type { ViewProps } from '../../utils/views'
import { monthLayout, LANES, PORTRAIT_LANES } from '../../../shared/month-layout'
import type { DayCell } from '../../../shared/month-layout'
import { DEFAULT_PANE_OPTIONS } from '../../../shared/layouts'
import { specialDayArtUrl } from '../../../shared/special-days'
import { currentWeather, forecastOn, formatTemperature, weatherOn } from '../../../shared/weather'

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
const props = defineProps<ViewProps>()

const options = computed(() => props.paneOptions ?? DEFAULT_PANE_OPTIONS)
/** Whether coloured events show their people's initials: always, unless they are coloured and the pane asks for none. */
const showInitials = computed(() => !options.value.fill_events || options.value.show_initials)
const root = ref<HTMLElement | null>(null)
useWrapFit(root, () => options.value.wrap_titles)

/** The grid's outer padding and the gap between its columns (px), as in the styles below. */
const VIEW_PADDING = 48
const SIDE_COLUMN = 640
const VIEW_GAP = 48
const TILE_GAP = 14
/** Below this tile width (px) the weather beside the date is the icon alone; the portrait stage's tiles are about 180 and the landscape stage's about 240. */
const COMPACT_TILE_WIDTH = 220
/** Below this tile width (px) there is no room for even the icon beside the day number, so none is drawn. */
const MIN_TILE_WIDTH = 120

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

/** How wide a day's tile is (px) on this stage: the grid is the stage less its padding, and less the side column when that sits at its left (landscape with the sidebar). */
const tileWidth = computed(() => {
  const side = !portrait.value && options.value.show_sidebar ? SIDE_COLUMN + VIEW_GAP : 0
  const grid = props.stage.width - 2 * VIEW_PADDING - side
  return (grid - 6 * TILE_GAP) / 7
})
const compactTiles = computed(() => tileWidth.value < COMPACT_TILE_WIDTH)
const showsCellWeather = computed(() => showsWeatherOnDates(props, 'month') && tileWidth.value >= MIN_TILE_WIDTH)

/** The mark in a day's date row: the icon and the high (the high is left out when the tiles are compact); null for a day that is over or has no forecast, or where the art of a special day holds that end of the row. */
function cellWeather(cell: DayCell) {
  if (!showsCellWeather.value || decorated.value.get(cell.date)?.art.length) return null
  const day = forecastOn(props.weather, cell.date, today.value)
  if (!day) return null
  const icon = weatherIcon(day.condition)
  const text = compactTiles.value || day.high === null ? null : formatTemperature(day.high)
  return icon || text ? { icon, text } : null
}

/** The takeover's greeting when it has no panel to go in, to be drawn in the header row. */
const headerGreeting = computed(() => options.value.show_sidebar ? null : props.specialDays.takeover?.greeting ?? null)

/** Each week's lane spans for wrapping titles, or nulls when the option is off. */
const spans = computed(() => layout.value.rows.map(week => options.value.wrap_titles ? laneSpans(week, portrait.value ? PORTRAIT_LANES : LANES) : null))

/** A panel day's icon and `14° / 8°`, either of which can be missing; null when the forecast has neither. */
function dayWeather(date: string) {
  const day = weatherOn(props.weather, date)
  if (!day) return null
  return { icon: weatherIcon(day.condition), text: formatHighLow(day) }
}

/** The panel's days, each trimmed to the rows that fit, with its forecast. Only the first is today, so only it has events that are over. */
const panelDays = computed(() => layout.value.panel.map((day, index) => ({
  ...fitPanelDay(day, props.now, index === 0),
  weather: dayWeather(day.date),
})))

/** Portrait: today's rows for the band, which has room for more than a panel day. */
const bandDay = computed(() => fitPanelDay(layout.value.panel[0]!, props.now, true, PORTRAIT_TODAY_ROWS))

/** Portrait: the three days after today, each in a card with room for fewer rows. */
const stripDays = computed(() => layout.value.panel.slice(1).map(day => ({
  ...fitPanelDay(day, props.now, false, PORTRAIT_STRIP_ROWS),
  weather: dayWeather(day.date),
})))

/** `High 14° · Low 8°` for today, or null when the forecast has neither. */
const todayHighLow = computed(() => {
  const day = weatherOn(props.weather, today.value)
  return day ? formatHighLowWords(day) : null
})

/** `October`, from the month itself: the shown month is not always the one `now` is in. */
const monthName = computed(() => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long' }).format(new Date(`${props.month}-01T00:00:00Z`)))
const year = computed(() => props.month.slice(0, 4))

const dayNumber = computed(() => Number(today.value.slice(8, 10)))
const weekday = computed(() => formatWeekday(props.now, props.timezone))

/** The current conditions as an icon and words, or null for none (or if they are too old to say what it is like now). */
const nowWeather = computed(() => {
  const current = currentWeather(props.weather, props.now)
  const text = current && formatCurrent(current)
  return current && text ? { icon: weatherIcon(current.condition), text } : null
})

/** What a decorated date has: the first day's id and accent (they set the tint) and every day's art, side by side. */
const decorated = computed(() => new Map(props.specialDays.tiles.flatMap(({ date, days }) => {
  const first = days[0]
  return first ? [[date, { id: first.id, accent: paletteAccent(first.palette), art: tileArt(days) }] as const] : []
})))

/** A tile's background: today's own, the month's, or the neighbouring months'; with a special day's tint mixed into it. */
function tileBackground(cell: DayCell): string {
  const base = cell.today ? 'var(--today-cell)' : cell.inMonth ? 'var(--tile)' : 'var(--tile-out)'
  const special = decorated.value.get(cell.date)
  return special ? tileTint(special.accent, base) : base
}

function numberColours(cell: DayCell): { background: string, color: string } {
  if (cell.today) return { background: 'var(--today-num-bg)', color: 'var(--today-num-fg)' }
  return { background: 'transparent', color: cell.inMonth ? 'var(--text)' : 'var(--faint)' }
}

/** A bar's fill. With nobody on it (no person matched) it is the surface colour and has no badge. */
const barFill = (colour: string | null): string => colour ? personFill(colour) : 'var(--surface)'

/** The grid row of an item on `lane`: its own, or, when its title may wrap, that and the free ones below it. */
const laneRow = (lane: number, span = 1) => span > 1 ? `${lane + 2} / span ${span}` : lane + 2

function barStyle(bar: { colour: string | null, column: number, span: number, lane: number, roundStart: boolean, roundEnd: boolean }, lanes = 1) {
  // A bar that may be several lines tall would be a half-circle at each end with 999px, so its ends are a lane's half height.
  const round = lanes > 1 ? '17px' : '999px'
  const start = bar.roundStart ? round : '8px'
  const end = bar.roundEnd ? round : '8px'
  return {
    'gridColumn': `${bar.column + 1} / span ${bar.span}`,
    'gridRow': laneRow(bar.lane, lanes),
    // A round end sits in from the tile's edge; a square one runs on into its neighbour.
    'margin': `0 ${bar.roundEnd ? '8px' : '0'} 0 ${bar.roundStart ? '8px' : '0'}`,
    'borderRadius': `${start} ${end} ${end} ${start}`,
    'background': barFill(bar.colour),
    '--ring': barFill(bar.colour),
    ...(lanes > 1 ? { '--lines': lanes } : {}),
  }
}

/** A timed row in the grid: its place, and with "colour whole events" the pill a bar has. Otherwise it is bare on the tile. */
function timedStyle(row: { people: readonly { colour: string }[], column: number, lane: number }, week: { cells: DayCell[] }, lanes = 1) {
  const place = { gridColumn: row.column + 1, gridRow: laneRow(row.lane, lanes), ...(lanes > 1 ? { '--lines': lanes } : {}) }
  if (!options.value.fill_events) return { ...place, '--ring': tileBackground(week.cells[row.column]!) }
  const { background, ring } = eventFill(row.people)
  return {
    ...place,
    // In from the tile's edge like a bar's round end, so the badge sits where it does on a bar.
    margin: '0 8px',
    borderRadius: lanes > 1 ? '17px' : '999px',
    background,
    '--ring': ring,
  }
}
</script>

<template>
  <section ref="root" class="view" :class="{ portrait, 'no-side': !options.show_sidebar }" data-testid="month-view">
    <!-- Without the sidebar there is no column for the title or a takeover's greeting, so they share a row above the grid. -->
    <header v-if="!options.show_sidebar && (options.show_title || headerGreeting)" class="head">
      <h1 v-if="options.show_title" class="title" data-testid="month-title">
        <span class="month">{{ monthName }}</span>{{ ' ' }}<span class="year">{{ year }}</span>
      </h1>
      <div
        v-if="headerGreeting"
        class="greeting head-greeting"
        data-testid="greeting"
        :style="{ fontSize: `${greetingSize(headerGreeting)}px` }"
      >
        {{ headerGreeting }}
      </div>
    </header>

    <div v-if="options.show_sidebar" class="side">
      <h1 v-if="options.show_title" class="title" data-testid="month-title">
        <!-- The space is for the text ("October 2026"); between flex items it takes no room. -->
        <span class="month">{{ monthName }}</span>{{ ' ' }}<span class="year">{{ year }}</span>
      </h1>

      <div v-if="portrait" class="panel band" :class="{ takeover: specialDays.takeover }" data-testid="today-band">
        <div class="band-now">
          <div
            v-if="specialDays.takeover?.greeting"
            class="greeting"
            data-testid="greeting"
            :style="{ fontSize: `${greetingSize(specialDays.takeover.greeting)}px` }"
          >
            {{ specialDays.takeover.greeting }}
          </div>

          <div class="now">
            <div class="big-date" data-testid="panel-date">
              {{ dayNumber }}
            </div>
            <div class="weekday">
              {{ weekday }}
              <div v-if="nowWeather" class="weather-now" data-testid="weather-now">
                <AppIcon v-if="nowWeather.icon" :icon="nowWeather.icon" :size="44" />
                <span class="weather-text">{{ nowWeather.text }}</span>
              </div>
              <div v-if="todayHighLow" class="high-low" data-testid="today-high-low">
                {{ todayHighLow }}
              </div>
            </div>
          </div>
        </div>

        <p v-if="!bandDay.rows.length && !bandDay.more" class="nothing">
          Nothing planned
        </p>
        <MonthPanelRows v-else :day="bandDay" size="roomy" :fill="options.fill_events" :initials="showInitials" />
      </div>

      <div v-else class="panel" :class="{ takeover: specialDays.takeover }" data-testid="panel" data-wrap-box>
        <div
          v-if="specialDays.takeover?.greeting"
          class="greeting"
          data-testid="greeting"
          :style="{ fontSize: `${greetingSize(specialDays.takeover.greeting)}px` }"
        >
          {{ specialDays.takeover.greeting }}
        </div>

        <div class="now">
          <div class="big-date" data-testid="panel-date">
            {{ dayNumber }}
          </div>
          <div class="weekday">
            {{ weekday }}
            <div v-if="nowWeather" class="weather-now" data-testid="weather-now">
              <AppIcon v-if="nowWeather.icon" :icon="nowWeather.icon" :size="44" />
              <span class="weather-text">{{ nowWeather.text }}</span>
            </div>
          </div>
        </div>

        <div class="days">
          <section v-for="day in panelDays" :key="day.date" class="day" data-testid="panel-day" :data-date="day.date">
            <header class="day-head">
              <h2 class="day-label">
                {{ day.label }}
              </h2>
              <div v-if="day.weather" class="day-weather" data-testid="day-weather">
                <AppIcon v-if="day.weather.icon" :icon="day.weather.icon" :size="34" />
                <span v-if="day.weather.text">{{ day.weather.text }}</span>
              </div>
            </header>

            <p v-if="!day.rows.length && !day.more" class="nothing">
              Nothing planned
            </p>

            <MonthPanelRows v-else :day="day" :fill="options.fill_events" :initials="showInitials" />
          </section>
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="weekdays">
        <div v-for="name in layout.weekdays" :key="name" class="weekday-name">
          {{ name }}
        </div>
      </div>

      <div class="weeks">
        <div v-for="(week, weekIndex) in layout.rows" :key="weekIndex" class="week">
          <template v-for="cell in week.cells" :key="cell.date">
            <div
              class="tile"
              :style="{ gridColumn: cell.column + 1, background: tileBackground(cell) }"
              data-testid="day-tile"
              :data-date="cell.date"
              :data-today="cell.today"
              :data-special="decorated.get(cell.date)?.id"
            />
            <div v-if="decorated.get(cell.date)?.art.length" class="tile-art" :style="{ gridColumn: cell.column + 1 }">
              <img
                v-for="(name, index) in decorated.get(cell.date)!.art"
                :key="`${name}-${index}`"
                :src="specialDayArtUrl(name)"
                alt=""
                draggable="false"
                data-testid="tile-art"
              >
            </div>
            <div class="date" :style="{ gridColumn: cell.column + 1 }">
              <span class="number" :style="numberColours(cell)" :data-testid="cell.today ? 'today-number' : undefined">{{ cell.day }}</span>
              <span v-if="cellWeather(cell)" class="cell-weather" data-testid="cell-weather" :data-date="cell.date">
                <AppIcon v-if="cellWeather(cell)!.icon" :icon="cellWeather(cell)!.icon!" :size="30" />
                <span v-if="cellWeather(cell)!.text">{{ cellWeather(cell)!.text }}</span>
              </span>
            </div>
          </template>

          <div
            v-for="(bar, barIndex) in week.bars"
            :key="`${bar.event.id}-${bar.column}`"
            class="bar"
            :style="barStyle(bar, spans[weekIndex]?.bars[barIndex])"
            :class="{ tall: (spans[weekIndex]?.bars[barIndex] ?? 1) > 1 }"
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
            v-for="(row, rowIndex) in week.timed"
            :key="row.event.id"
            class="timed"
            :class="{ tall: (spans[weekIndex]?.timed[rowIndex] ?? 1) > 1, filled: options.fill_events, bare: options.fill_events && (!row.initials.length || !showInitials) }"
            data-kind="timed"
            :style="timedStyle(row, week, spans[weekIndex]?.timed[rowIndex])"
            data-testid="event"
          >
            <span v-if="row.initials.length && showInitials" class="badges">
              <span
                v-for="badge in badgesOf(row)"
                :key="badge.id"
                class="badge"
                :style="{ background: badge.colour }"
              >{{ badge.initial }}</span>
            </span>
            <span v-if="!portrait" class="time">{{ row.time }}</span>
            <span class="name">{{ eventLabel(row.event) }}</span>
          </div>

          <div
            v-for="more in week.more"
            :key="more.column"
            class="more"
            :style="{ gridColumn: more.column + 1, gridRow: more.lane + 2 }"
            data-testid="more"
          >
            +{{ more.count }} more
          </div>

          <!-- Last, so it is over the tiles and what is on them. -->
          <div
            v-for="veil in week.veils"
            :key="veil.column"
            class="veil"
            :style="{ gridColumn: `${veil.column + 1} / span ${veil.span}` }"
            data-testid="veil"
          />
        </div>
      </div>
    </div>

    <div v-if="portrait && options.show_sidebar" class="next-days" data-testid="next-days">
      <section v-for="day in stripDays" :key="day.date" class="day" data-testid="panel-day" :data-date="day.date" data-wrap-box>
        <header class="day-head">
          <h2 class="day-label">
            {{ day.label }}
          </h2>
          <div v-if="day.weather" class="day-weather" data-testid="day-weather">
            <AppIcon v-if="day.weather.icon" :icon="day.weather.icon" :size="34" />
            <span v-if="day.weather.text">{{ day.weather.text }}</span>
          </div>
        </header>

        <p v-if="!day.rows.length && !day.more" class="nothing">
          Nothing planned
        </p>

        <MonthPanelRows v-else :day="day" size="card" :fill="options.fill_events" :initials="showInitials" />
      </section>
    </div>
  </section>
</template>

<style scoped>
/* Sizes are px on the 2560×1440 stage, taken from the Soft mock. */
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

.title {
  display: flex;
  align-items: baseline;
  gap: 20px;
  margin: 0;
  padding-left: 12px;
  font-family: var(--font-display);
  font-weight: 400;
  line-height: 1;
}

.month {
  font-size: 88px;
  letter-spacing: -0.02em;
}

.year {
  color: var(--muted);
  font-size: 44px;
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

/* Pulled up a little: the display face's line box leaves a gap above the date. The size is set from the length of the greeting. */
.greeting {
  margin-bottom: -12px;
  font-family: var(--font-display);
  line-height: 1.05;
  overflow-wrap: anywhere;
  text-wrap: balance;
}

.now {
  display: flex;
  align-items: center;
  gap: 28px;
}

.big-date {
  font-family: var(--font-display);
  font-size: 184px;
  letter-spacing: -0.03em;
  line-height: 0.85;
}

.weekday {
  /* So a long condition is cut with an ellipsis instead of widening the column. */
  min-width: 0;
  font-family: var(--font-display);
  font-size: 44px;
  line-height: 1;
}

/* Quiet: the panel's muted colour and the body face, smaller than the weekday it sits under. */
.weather-now {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  color: var(--panel-muted);
  font-family: var(--font-body);
  font-size: 32px;
  font-weight: 600;
  line-height: 1.1;
}

.weather-now svg,
.day-weather svg {
  flex: none;
}

.weather-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.days {
  display: flex;
  flex-direction: column;
  gap: 30px;
  min-height: 0;
}

.day {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.day-head {
  display: flex;
  align-items: center;
  gap: 14px;
}

.day-label {
  margin: 0;
  font-family: var(--font-display);
  font-size: 36px;
  font-weight: 400;
  line-height: 1.1;
}

/* The forecast at the right end of the date row: it may shrink and clip itself, never the day number. */
.cell-weather {
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin-left: auto;
  padding-right: 16px;
  overflow: hidden;
  color: var(--muted);
  font-size: 24px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.cell-weather svg {
  flex: none;
}

/* At the right of the heading, where it doesn't compete with the events below. */
.day-weather {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  margin-left: auto;
  color: var(--panel-muted);
  font-size: 26px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.badge {
  display: grid;
  flex: none;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  color: var(--color-neutral-900);
  font-size: 19px;
  font-weight: 700;
}

.badges {
  display: flex;
  flex: none;
}

/* Overlapping circles for an event shared by several people, ringed in whatever they sit on. */
.badge + .badge {
  margin-left: -12px;
}

.badges:has(.badge + .badge) .badge {
  box-shadow: 0 0 0 3px var(--ring);
}

.nothing {
  margin: 0;
  color: var(--panel-muted);
  font-size: 26px;
  font-weight: 600;
  line-height: 1.3;
}

.grid {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.weekdays {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  column-gap: 14px;
  padding: 6px 0 12px;
  color: var(--muted);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.1em;
  /* The mock's text inherits the design system's 1.6, which is what puts the first row of tiles where it is. */
  line-height: 1.6;
  text-transform: uppercase;
}

.weekday-name {
  padding-left: 20px;
}

.weeks {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
}

/* The date, then four lanes for events, then whatever room is left. Everything in the week is placed on this one grid, so a bar can run across tiles. */
.week {
  display: grid;
  flex: 1;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  grid-template-rows: 52px repeat(4, 34px) 1fr;
  column-gap: 14px;
  row-gap: 5px;
}

.tile {
  grid-row: 1 / -1;
  border-radius: 32px;
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
.head-greeting {
  min-width: 0;
  margin-bottom: 0;
  text-align: right;
}

.head-greeting:first-child {
  flex: 1;
  padding-left: 12px;
  text-align: left;
}

.no-side .grid {
  flex: 1;
}

/*
 * The top-right of a tile, beside the date number, for a special day's art. It
 * sits in the date's row, which is 52 px, and the 60 px art runs a few px into
 * the first lane: the bars and times come later in the grid so they paint over
 * it, and nothing is pushed. Art from several days sits side by side.
 */
.tile-art {
  display: flex;
  grid-row: 1;
  align-items: flex-start;
  align-self: start;
  justify-self: end;
  gap: 6px;
  padding: 0 14px 0 0;
  pointer-events: none;
}

.tile-art img {
  display: block;
  width: auto;
  max-width: 96px;
  height: 60px;
  object-fit: contain;
}

.date {
  display: flex;
  grid-row: 1;
  align-items: center;
  padding: 6px 0 0 10px;
}

.number {
  display: grid;
  flex: none;
  place-items: center;
  min-width: 40px;
  height: 40px;
  border-radius: 999px;
  font-size: 27px;
  font-weight: 700;
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

.bar .badge,
.timed .badge {
  width: 24px;
  height: 24px;
  font-size: 14px;
}

.bar .badge + .badge,
.timed .badge + .badge {
  margin-left: -8px;
}

.bar .badges:has(.badge + .badge) .badge,
.timed .badges:has(.badge + .badge) .badge {
  box-shadow: 0 0 0 2px var(--ring);
}

.bar .name,
.timed .name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.timed {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 0 12px;
  overflow: hidden;
  font-size: 20px;
  white-space: nowrap;
}

.timed .time {
  flex: none;
  color: var(--muted);
  font-weight: 700;
}

/* "Colour whole events": a pill like a bar, text on the fill, the time a step quieter but still readable on it. */
.timed.filled {
  padding: 0 14px 0 4px;
  color: var(--bar-text);
}

.timed.filled.bare {
  padding-left: 12px;
}

.timed.filled .time {
  color: inherit;
  opacity: 0.8;
}

/*
 * "Wrap long titles" in the grid: an item that was given the free lanes below
 * its own is as tall as its title needs, from the top of its lane, up to the
 * lanes it has (--lines of them, which --lines of 26 px lines and 4 px above and
 * below fit). Its first line is where it always was: 4 px down, in a 26 px line
 * box, centres in a 34 px lane, and a one-line title is the 34 px it was.
 */
.bar.tall,
.timed.tall {
  align-self: start;
  align-items: flex-start;
  box-sizing: border-box;
  min-height: 34px;
  max-height: 100%;
  padding-top: 4px;
  padding-bottom: 4px;
}

.tall .badges {
  margin-top: 1px;
}

.tall .time,
.tall .name {
  line-height: 26px;
}

/* Broken only between words: a tile is narrow enough that breaking anywhere cut "Playgroup" into "Playgr" and "oup". A word too long for the tile is clipped, as it was before wrapping. */
.tall .name {
  display: -webkit-box;
  overflow-wrap: normal;
  white-space: normal;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: var(--lines);
  line-clamp: var(--lines);
}

.timed .name {
  font-weight: 600;
}

.more {
  display: flex;
  align-items: center;
  padding: 0 16px;
  color: var(--accent-ink);
  font-size: 20px;
  font-weight: 700;
}

.veil {
  grid-row: 1 / -1;
  border-radius: 32px;
  background: var(--veil);
  pointer-events: none;
}

/*
 * The portrait stage (1440×2560, mocks 4a, 4b and 4j): one column of title,
 * today's band, the weeks and the strip. Sizes are the mocks' doubled.
 */
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

/* Two columns, the right starting at x 616 on the stage, and only as tall as the taller of them. */
.panel.band {
  display: grid;
  flex: none;
  grid-template-columns: 516px minmax(0, 1fr);
  align-items: start;
  padding: 44px 52px 47px;
}

.band-now {
  display: flex;
  flex-direction: column;
  gap: 36px;
  min-width: 0;
}

.band .now {
  flex-direction: column;
  align-items: flex-start;
  gap: 40px;
}

.band .weather-now {
  margin-top: 30px;
}

/* Level with the date's top, as in the mock. */
.band .rows,
.band .nothing {
  margin-top: 9px;
}

/* Today's range in words, a step quieter than the conditions above it. */
.high-low {
  margin-top: 20px;
  color: var(--panel-muted);
  font-family: var(--font-body);
  font-size: 26px;
  font-weight: 700;
  line-height: 1.1;
}

/*
 * Six lanes where landscape has four. The lanes may be a little under their 34
 * px when the band is tall (a takeover's greeting makes it so), so that six
 * still fit; at the mock's 290 px tiles they are the full 34.
 */
.portrait .week {
  min-height: 0;
  grid-template-rows: 52px repeat(6, minmax(28px, 34px)) 1fr;
}

/* The next three days, as wide as the grid's columns allow, on the tile colour. */
.next-days {
  display: grid;
  flex: none;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  height: 284px;
}

.next-days .day {
  box-sizing: border-box;
  min-width: 0;
  padding: 30px 32px;
  overflow: hidden;
  border-radius: 40px;
  background: var(--tile);
  color: var(--text);
}

.next-days .day-weather {
  color: var(--muted);
}

.next-days .nothing {
  color: var(--muted);
}
</style>
