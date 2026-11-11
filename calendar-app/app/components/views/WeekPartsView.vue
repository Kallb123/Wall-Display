<script setup lang="ts">
import { greetingSize, tileArt } from '~/utils/specialDays'
import { eventLabel } from '~/utils/eventLabel'
import { eventFill } from '~/utils/eventFill'
import { paletteAccent, personFill, tileTint } from '~/utils/themes'
import { formatHighLow, weatherIcon } from '~/utils/weather'
import { showsLocations, showsWeatherOnDates } from '../../utils/views'
import type { ViewProps } from '../../utils/views'
import { useWrapFit } from '~/composables/useWrapFit'
import { DEFAULT_PANE_OPTIONS } from '../../../shared/layouts'
import type { ItemPeople } from '../../../shared/month-layout'
import { todayIn } from '../../../shared/dates'
import { eventLocation } from '../../../shared/location'
import { specialDayArtUrl } from '../../../shared/special-days'
import { forecastOn } from '../../../shared/weather'
import { MAX_BADGE_INITIALS } from '../../../shared/week-layout'
import { LANDSCAPE_CELL_ITEMS, PORTRAIT_CELL_ITEMS, weekPartsLayout } from '../../../shared/week-parts-layout'
import type { WeekPartsRow } from '../../../shared/week-parts-layout'

// The week by part of day (architecture §4.5a; mock 4q, the week as a list, is
// the closest design): the week view with its axes flipped. The title, then a
// line naming the three parts of the day with their hours, then seven rounded
// rows, one for each day. A row has a head on the left (the date and weekday,
// the day's forecast, and the all-day, multi-day and overnight events as small
// bars, with a "+N" when there are more than two) and three cells, morning,
// afternoon and evening. A timed event is a line in the cell of the part it
// starts in: badge, start time and title, in start order, and the last line is
// "+N more" when the cell is full.
//
// Today's row has today's background, and the cell of the part we are in has the
// sage outline, in place of the week view's "now" line. Past days are under one
// veil and a past event is dimmed, as in the week view.
//
// The layout (which cell an event is in, what the head holds, which part is
// now) is worked out by `weekPartsLayout`; this only draws it. There is one
// structure for both stages. The rows share the height, so they are about
// 190 px tall on the 2560×1440 stage and about 340 px on the 1440×2560 one, and
// a cell holds four lines on the first and eight on the second
// (`LANDSCAPE_CELL_ITEMS`, `PORTRAIT_CELL_ITEMS`). The type is the same size on
// both. The portrait stage stacks the head's parts (date, weather, bars) in one
// column, where the landscape stage puts the bars beside the date.
//
// Special days (architecture §6) are drawn as in the week view: a decorated
// day's row is tinted with its first day's palette accent and carries every
// day's art beside its date, and a takeover's greeting goes at the right of the
// title (under it in portrait). A takeover's art is a layer behind this view, so
// the view has no background of its own and the art shows in the gaps between
// the rows.
//
// The weather (PR 2.7) is the day's icon and high / low in its head. Any part
// that is not known is left out.
//
// A custom layout can set three options (`paneOptions`, architecture §4.8).
// `show_title: false` drops the title; the header then holds the takeover's
// greeting alone, and is not drawn when there is none, so it takes no room. The
// parts line stays. `fill_events` gives each cell line the fill the head's items
// already have, inside the line's own 32 px box (no vertical padding, the badge
// is 24 px), so a filled line is no taller than a plain one and the cell still
// holds the lines it was counted for; with several people the fill is split
// between them (`eventFill`), and `show_initials: false` leaves the line's
// badges out, the title taking the room. The head's items are coloured and
// badged whatever the options say, and are left as they are. `wrap_titles` lets a title run on to up to
// three lines, but only where the cell has room: each cell is a fixed-size,
// overflow-hidden box and each line an item for `useWrapFit`, which measures and
// switches wrapping on from the top down while everything still fits. The head's
// items are not a bounded box (they sit in a flex column that nothing clips), so
// they stay one line.
//
// An event's location (`eventLocation`, the first part of an address) is a second,
// quieter line under a cell line's title, and only where there is room: it is
// left out of the markup when locations are off (`showsLocations`, the display's
// preference or the pane's `show_locations`) or the event has none worth showing,
// and otherwise hidden unless `useWrapFit` set `data-location="on"` on the line,
// which it does when the cell still holds everything after every title has its
// room. It works with title wrapping on or off, and it is the first thing to go:
// it never costs a line, a title's wrap, or a "+N more". The badge and time stay
// level with the title's first line. The head's items have none.
// An optional boolean prop left out is false in Vue; `showLocations` left out means on (`showsLocations`), so it defaults to undefined.
const props = withDefaults(defineProps<ViewProps>(), { showLocations: undefined })

const options = computed(() => props.paneOptions ?? DEFAULT_PANE_OPTIONS)
/** Whether the cell lines show their people's initials: always, unless they are coloured and the pane asks for none. */
const showInitials = computed(() => !options.value.fill_events || options.value.show_initials)
const showHeader = computed(() => options.value.show_title || !!props.specialDays.takeover?.greeting)

const root = ref<HTMLElement | null>(null)
useWrapFit(root, () => options.value.wrap_titles)

/** Whether locations are drawn at all: the pane's option, or else the display's preference. */
const locationsOn = computed(() => showsLocations(props))

const portrait = computed(() => props.stage.orientation === 'portrait')

const layout = computed(() => weekPartsLayout({
  weekOf: props.weekOf,
  now: props.now,
  timeZone: props.timezone,
  weekStart: props.weekStart,
  dayParts: props.dayParts,
  events: props.events,
  cellItems: portrait.value ? PORTRAIT_CELL_ITEMS : LANDSCAPE_CELL_ITEMS,
}))

/** How many days of the shown week are before today: the rows the veil covers. */
const pastDays = computed(() => layout.value.rows.filter(row => row.past).length)

/** `26 October – 1 November` and `2026`, so the year can be muted as in the week's title. A title that spans two years keeps the first one in the text. */
const title = computed(() => {
  const match = /^(.*) (\d{4})$/.exec(layout.value.title)
  return match ? { range: match[1]!, year: match[2]! } : { range: layout.value.title, year: '' }
})

/** Whether the forecasts are drawn at all: the pane's option, or else the display's preference for this view. Off, the head is as it is with no weather. */
const showsWeather = computed(() => showsWeatherOnDates(props, 'week_parts'))
/** Today, `YYYY-MM-DD`: a day before it shows no forecast. */
const today = computed(() => todayIn(props.now, props.timezone))

/** Each day's forecast: an icon and `14° / 8°`, either of which can be missing; null when the forecast has neither (or there is none). */
const forecasts = computed(() => layout.value.rows.map((row) => {
  if (!showsWeather.value) return null
  const forecast = forecastOn(props.weather, row.date, today.value)
  if (!forecast) return null
  const text = formatHighLow(forecast)
  const icon = weatherIcon(forecast.condition)
  return icon || text ? { icon, text } : null
}))

/** What a decorated date has: the first day's id and accent (they set the tint) and every day's art, side by side. */
const decorated = computed(() => new Map(props.specialDays.tiles.flatMap(({ date, days }) => {
  const first = days[0]
  return first ? [[date, { id: first.id, accent: paletteAccent(first.palette), art: tileArt(days) }] as const] : []
})))

/** A row's background: today's own or the ordinary one, with a special day's tint mixed into it. */
function rowBackground(row: WeekPartsRow): string {
  const base = row.today ? 'var(--today-cell)' : 'var(--tile)'
  const special = decorated.value.get(row.date)
  return special ? tileTint(special.accent, base) : base
}

/** The badges an item gets: its first people, as many as the layout kept initials for. Keyed by person, as two can share an initial. */
function badgesOf(item: ItemPeople): { id: string, initial: string, colour: string }[] {
  return item.initials.slice(0, MAX_BADGE_INITIALS).map((initial, index) => ({ id: item.people[index]!.id, initial, colour: item.people[index]!.colour }))
}

/** A filled line's background and ring: split between the people when there are several (`eventFill`), the surface colour with nobody on it. */
function lineStyle(item: ItemPeople) {
  const { background, ring } = eventFill(item.people)
  return { background, '--ring': ring }
}

/** An event's fill. With nobody on it (no person matched) it is the surface colour and has no badge. */
const fillOf = (colour: string | null): string => colour ? personFill(colour) : 'var(--surface)'
</script>

<template>
  <section ref="root" class="view" :class="{ portrait }" data-testid="week-parts-view">
    <header v-if="showHeader" class="header">
      <h1 v-if="options.show_title" class="title" data-testid="week-title">
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

    <!-- The three parts and their hours, over the cells' columns. -->
    <div class="parts">
      <div
        v-for="part in layout.parts"
        :key="part.name"
        class="part"
        data-testid="part-heading"
        :data-part="part.name"
      >
        <span class="part-name">{{ part.label }}</span>
        <span class="part-hours">{{ part.hours }}</span>
      </div>
    </div>

    <div class="rows">
      <div
        v-for="row in layout.rows"
        :key="row.date"
        class="day-row"
        :style="{ gridRow: row.row + 1, background: rowBackground(row) }"
        data-testid="day-row"
        :data-date="row.date"
        :data-today="row.today"
        :data-special="decorated.get(row.date)?.id"
      >
        <div class="head">
          <div class="when">
            <div class="date">
              <span
                class="number"
                :class="{ today: row.today }"
                :data-testid="row.today ? 'today-number' : undefined"
              >{{ row.day }}</span>
              <span class="weekday">{{ row.weekday }}</span>
              <div v-if="decorated.get(row.date)?.art.length" class="tile-art">
                <img
                  v-for="(name, index) in decorated.get(row.date)!.art"
                  :key="`${name}-${index}`"
                  :src="specialDayArtUrl(name)"
                  alt=""
                  draggable="false"
                  data-testid="tile-art"
                >
              </div>
            </div>
            <div v-if="forecasts[row.row]" class="day-weather" data-testid="day-weather">
              <AppIcon v-if="forecasts[row.row]!.icon" :icon="forecasts[row.row]!.icon!" :size="26" />
              <span v-if="forecasts[row.row]!.text">{{ forecasts[row.row]!.text }}</span>
            </div>
          </div>
          <div v-if="row.head.items.length" class="head-items">
            <div
              v-for="item in row.head.items"
              :key="item.event.id"
              class="head-item"
              :class="{ past: item.past }"
              :style="{ background: fillOf(item.colour), '--ring': fillOf(item.colour) }"
              data-testid="event"
              data-kind="head"
            >
              <span v-if="item.initials.length" class="badges">
                <span
                  v-for="badge in badgesOf(item)"
                  :key="badge.id"
                  class="badge"
                  :style="{ background: badge.colour }"
                >{{ badge.initial }}</span>
              </span>
              <span v-if="item.time" class="time">{{ item.time }}</span>
              <span class="name">{{ eventLabel(item.event) }}</span>
            </div>
            <span v-if="row.head.more" class="head-more" data-testid="head-more">+{{ row.head.more }}</span>
          </div>
        </div>

        <div
          v-for="cell in row.cells"
          :key="cell.part"
          class="cell"
          :class="{ now: cell.now }"
          data-wrap-box
          data-testid="part-cell"
          :data-part="cell.part"
          :data-now="cell.now"
        >
          <!-- Drawn over the lines, so the outline can be seen even where a title runs under it. -->
          <span v-if="cell.now" class="now-ring" data-testid="now-part" />
          <div
            v-for="item in cell.items"
            :key="item.event.id"
            class="line"
            :class="{ past: item.past, ongoing: item.ongoing, filled: options.fill_events, bare: options.fill_events && !showInitials }"
            :style="options.fill_events ? lineStyle(item) : { '--ring': 'transparent' }"
            data-wrap-item
            data-testid="event"
            data-kind="line"
          >
            <span v-if="item.initials.length && showInitials" class="badges">
              <span
                v-for="badge in badgesOf(item)"
                :key="badge.id"
                class="badge"
                :style="{ background: badge.colour }"
              >{{ badge.initial }}</span>
            </span>
            <span class="time">{{ item.time }}</span>
            <span class="words">
              <span class="name">{{ eventLabel(item.event) }}</span>
              <span
                v-if="locationsOn && eventLocation(item.event.location)"
                class="location"
                data-location-line
                data-testid="event-location"
              >{{ eventLocation(item.event.location) }}</span>
            </span>
          </div>
          <div v-if="cell.more" class="line-more" data-testid="more">
            +{{ cell.more }} more
          </div>
        </div>
      </div>

      <!-- Last, so it is over the rows and what is on them. One veil across the past days, which always come first in the week. -->
      <div
        v-if="pastDays > 0"
        class="veil"
        :style="{ gridRow: `1 / span ${pastDays}` }"
        data-testid="veil"
      />
    </div>
  </section>
</template>

<style scoped>
/* Sizes are px on the 2560×1440 stage, in the language of the week view. */
.view {
  --head-width: 560px;
  --row-gap: 12px;

  position: absolute;
  inset: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 40px 48px 44px;
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
  font-size: 80px;
  letter-spacing: -0.02em;
}

.year {
  color: var(--muted);
  font-size: 40px;
}

/* At the right of the title, where the week view has its own. The size is set from the length of the greeting. */
.greeting {
  min-width: 0;
  font-family: var(--font-display);
  line-height: 1.05;
  text-align: right;
  text-wrap: balance;
}

/* The same columns as a row's: the head's width (empty here), then the three cells. */
.parts {
  display: grid;
  flex: none;
  grid-template-columns: var(--head-width) repeat(3, minmax(0, 1fr));
}

.part {
  display: flex;
  align-items: baseline;
  gap: 14px;
  padding: 0 0 0 28px;
  white-space: nowrap;
}

.part:first-child {
  grid-column: 2;
}

.part-name {
  font-size: 30px;
  font-weight: 700;
}

.part-hours {
  color: var(--muted);
  font-size: 22px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  letter-spacing: 0.04em;
}

/* Seven equal rows that fill what is left. The veil shares the grid. */
.rows {
  position: relative;
  display: grid;
  flex: 1;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: repeat(7, minmax(0, 1fr));
  row-gap: var(--row-gap);
  min-height: 0;
}

.day-row {
  position: relative;
  display: grid;
  grid-column: 1;
  grid-template-columns: var(--head-width) repeat(3, minmax(0, 1fr));
  min-height: 0;
  border-radius: 32px;
}

.veil {
  grid-column: 1;
  border-radius: 32px;
  background: var(--veil);
  pointer-events: none;
}

.head {
  position: relative;
  display: flex;
  gap: 18px;
  min-width: 0;
  min-height: 0;
  padding: 16px 0 14px 22px;
}

.when {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 12px;
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

/* Under the date, quiet. */
.day-weather {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 4px;
  color: var(--muted);
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.day-weather svg {
  flex: none;
}

/* After the weekday, for a special day's art. */
.tile-art {
  display: flex;
  align-items: center;
  gap: 6px;
  pointer-events: none;
}

.tile-art img {
  display: block;
  width: auto;
  max-width: 64px;
  height: 44px;
  object-fit: contain;
}

/* The all-day, multi-day and overnight events, one small bar each, beside the date. */
.head-items {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  /* Under the art, which is in the corner. */
  padding-top: 2px;
}

.head-item {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 3px 14px 3px 4px;
  border-radius: 999px;
  color: var(--bar-text);
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
}

.head-item.past,
.line.past {
  opacity: 0.45;
}

.head-more {
  align-self: flex-start;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 20px;
  font-weight: 700;
  line-height: 1.4;
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
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.time {
  flex: none;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

/* A part of the day: its lines from the top, each one line of its own. */
.cell {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  padding: 16px 22px 12px 28px;
  overflow: hidden;
}

.line {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  min-width: 0;
  font-size: 26px;
  font-weight: 600;
  line-height: 32px;
  white-space: nowrap;
}

.line .time {
  font-size: 24px;
}

/* The whole line in the person's colour, as the head's items are. No vertical padding: the line is 32 px and the badge 24, so the badge sits 4 px in from the pill's edge and the line is no taller than an unfilled one. */
.line.filled {
  padding: 0 14px 0 4px;
  border-radius: 999px;
  color: var(--bar-text);
}

.line.filled.bare {
  padding-left: 14px;
}

.line.filled .time {
  color: inherit;
  opacity: 0.75;
}

/* The title and, under it, the location. Where there is no location this is the title alone, as it was. */
.words {
  display: flex;
  flex: 0 1 auto;
  flex-direction: column;
  min-width: 0;
}

.words .name {
  flex: none;
}

/* A second, quieter line, only where the fit found room for it (data-location is set by useWrapFit). */
.location {
  display: none;
  min-width: 0;
  overflow: hidden;
  font-size: 20px;
  font-weight: 600;
  line-height: 26px;
  opacity: 0.7;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-location='on'] .location {
  display: block;
}

.line.filled .location {
  color: inherit;
}

/* Wrapping where the fit allowed it (data-wrap is set by useWrapFit): up to three lines, the badge and time staying on the first. */
.line[data-wrap='on'],
.line[data-location='on'] {
  align-items: flex-start;
}

.line[data-wrap='on'] .badges,
.line[data-location='on'] .badges {
  align-self: flex-start;
  margin-top: 4px;
}

/* A filled line of several lines is a rounded box, not a stadium. */
.line.filled[data-wrap='on'],
.line.filled[data-location='on'] {
  border-radius: 16px;
}

[data-wrap='on'] .name {
  display: -webkit-box;
  overflow: hidden;
  overflow-wrap: anywhere;
  white-space: normal;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
}

.line.ongoing .name {
  font-weight: 700;
}

.line-more {
  flex: none;
  color: var(--accent-ink);
  font-size: 22px;
  font-weight: 700;
  line-height: 32px;
}

/* Now: the sage ring round the part we are in, inset from the row's edge. */
.now-ring {
  position: absolute;
  inset: 6px;
  border: 4px solid var(--accent2);
  border-radius: 26px;
  pointer-events: none;
}

/*
 * The portrait stage (1440×2560). The rows are about 340 px tall, so the head
 * stacks its parts and a cell has room for eight lines. Type is as in landscape.
 */
.portrait {
  --head-width: 300px;
  --row-gap: 10px;

  gap: 14px;
  padding: 44px 40px 48px;
}

.portrait .header {
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
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

/* On a line of its own, as long as the stage is wide. */
.portrait .greeting {
  text-align: left;
}

.portrait .part {
  gap: 10px;
  padding-left: 16px;
}

.portrait .part-name {
  font-size: 28px;
}

.portrait .part-hours {
  font-size: 20px;
}

.portrait .day-row,
.portrait .veil {
  border-radius: 28px;
}

.portrait .head {
  flex-direction: column;
  gap: 14px;
  padding: 16px 12px 14px 18px;
}

.portrait .tile-art img {
  max-width: 64px;
  height: 40px;
}

.portrait .head-items {
  flex: none;
}

.portrait .cell {
  padding: 16px 10px 12px 16px;
}

.portrait .line {
  gap: 7px;
}

.portrait .now-ring {
  inset: 5px;
  border-radius: 22px;
}
</style>
