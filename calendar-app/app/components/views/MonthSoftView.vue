<script setup lang="ts">
import { formatWeekday } from '~/utils/format'
import { todayIn } from '~/utils/eventRanges'
import { fitPanelDay } from '~/utils/monthPanel'
import { greetingSize, tileArt } from '~/utils/specialDays'
import { paletteAccent, personFill, tileTint } from '~/utils/themes'
import { formatCurrent, formatHighLow, weatherIcon } from '~/utils/weather'
import type { ViewProps } from '../../utils/views'
import { monthLayout } from '../../../shared/month-layout'
import type { DayCell, ItemPeople } from '../../../shared/month-layout'
import { specialDayArtUrl } from '../../../shared/special-days'
import { currentWeather, weatherOn } from '../../../shared/weather'

// The month in the Soft style (mocks 1c and 1d, architecture §4.4): the month
// title above a sage panel for today and the next three days on the left, and
// five rows of rounded day tiles on the right. The layout (which event goes in
// which lane, where "+N more" and the veils go, what the panel lists) is worked
// out by `monthLayout`; this only draws it, and fits the panel's days to the
// room there is. The grid shows `month`, which the server can pin to another
// month; the panel always starts at today.
//
// Special days (architecture §6, PR S.3) are drawn from `specialDays`, which the
// page has already decided: a decorated tile is tinted with its first day's
// palette accent and carries every day's art in its top-right corner, and a
// takeover's greeting goes at the top of the panel. The takeover's colours are
// the stage's theme and its art is a layer behind this view, so the one thing
// the panel does about it is stop being full height: only as tall as its
// content, it leaves the lower part of the column clear for the art to show.
// With nothing special, none of this draws and the view is exactly as it was.
//
// The weather (PR 2.7) is drawn in the panel only: the current conditions under
// the weekday, and each day's icon and high / low at the right of its heading.
// Any part that is not known is left out, and with no weather at all nothing
// is drawn, so the panel is exactly as it was.
const props = defineProps<ViewProps>()

const today = computed(() => todayIn(props.now, props.timezone))

const layout = computed(() => monthLayout({
  month: props.month,
  today: today.value,
  timeZone: props.timezone,
  weekStart: props.weekStart,
  events: props.events,
}))

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

/** The badges an item gets: its first people, as many as the layout kept initials for. Keyed by person, as two can share an initial. */
function badgesOf(item: ItemPeople): { id: string, initial: string, colour: string }[] {
  return item.initials.map((initial, index) => ({ id: item.people[index]!.id, initial, colour: item.people[index]!.colour }))
}

/** A bar's fill. With nobody on it (no person matched) it is the surface colour and has no badge. */
const barFill = (colour: string | null): string => colour ? personFill(colour) : 'var(--surface)'

function barStyle(bar: { colour: string | null, column: number, span: number, lane: number, roundStart: boolean, roundEnd: boolean }) {
  const start = bar.roundStart ? '999px' : '8px'
  const end = bar.roundEnd ? '999px' : '8px'
  return {
    'gridColumn': `${bar.column + 1} / span ${bar.span}`,
    'gridRow': bar.lane + 2,
    // A round end sits in from the tile's edge; a square one runs on into its neighbour.
    'margin': `0 ${bar.roundEnd ? '8px' : '0'} 0 ${bar.roundStart ? '8px' : '0'}`,
    'borderRadius': `${start} ${end} ${end} ${start}`,
    'background': barFill(bar.colour),
    '--ring': barFill(bar.colour),
  }
}
</script>

<template>
  <section class="view" data-testid="month-view">
    <div class="side">
      <h1 class="title" data-testid="month-title">
        <!-- The space is for the text ("October 2026"); between flex items it takes no room. -->
        <span class="month">{{ monthName }}</span>{{ ' ' }}<span class="year">{{ year }}</span>
      </h1>

      <div class="panel" :class="{ takeover: specialDays.takeover }" data-testid="panel">
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

            <div v-else class="rows">
              <div
                v-for="row in day.rows"
                :key="row.item.event.id"
                class="row"
                :class="{ past: row.past }"
                data-kind="panel"
                data-testid="event"
              >
                <span class="badges">
                  <span
                    v-for="badge in badgesOf(row.item)"
                    :key="badge.id"
                    class="badge"
                    :style="{ background: badge.colour }"
                  >{{ badge.initial }}</span>
                </span>
                <span class="time">{{ row.item.time ?? 'All day' }}</span>
                <span class="name">{{ row.item.event.display_title }}</span>
              </div>
              <div v-if="day.more" class="row more-row" data-testid="panel-more">
                <span class="badges" />
                <span class="time">+{{ day.more }} more</span>
              </div>
            </div>
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
            </div>
          </template>

          <div
            v-for="bar in week.bars"
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
            v-for="row in week.timed"
            :key="row.event.id"
            class="timed"
            data-kind="timed"
            :style="{ gridColumn: row.column + 1, gridRow: row.lane + 2, '--ring': tileBackground(week.cells[row.column]!) }"
            data-testid="event"
          >
            <span v-if="row.initials.length" class="badges">
              <span
                v-for="badge in badgesOf(row)"
                :key="badge.id"
                class="badge"
                :style="{ background: badge.colour }"
              >{{ badge.initial }}</span>
            </span>
            <span class="time">{{ row.time }}</span>
            <span class="name">{{ row.event.display_title }}</span>
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

/* A day's rows share their columns (a subgrid), so the times line up even when an event has several badges or "Until 11:30" is wider than "09:00". */
.rows {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  row-gap: 10px;
}

.row {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: subgrid;
  align-items: center;
  column-gap: 14px;
  font-size: 26px;
  line-height: 1.3;
  --ring: var(--panel);
}

.row.past {
  opacity: 0.45;
}

.row .time {
  min-width: 100px;
  color: var(--panel-muted);
  font-size: 23px;
  font-weight: 700;
}

.row .name {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The badge column is at least one badge wide, so an event with nobody on it still lines up. */
.row .badges {
  min-width: 40px;
  min-height: 40px;
  align-items: center;
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
</style>
