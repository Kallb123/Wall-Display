<script setup lang="ts">
import { Leaf } from 'lucide-vue-next'
import type { CalendarEvent } from '../../../shared/types/events'
import { agendaDays, PORTRAIT_MAX_ROWS } from '~/utils/agenda'
import type { AgendaDay, AgendaItem } from '~/utils/agenda'
import { formatTime } from '~/utils/format'
import { eventFill } from '~/utils/eventFill'
import { useWrapFit } from '~/composables/useWrapFit'
import { formatCurrent, formatHighLow, weatherIcon } from '~/utils/weather'
import type { ViewProps } from '../../utils/views'
import { DEFAULT_PANE_OPTIONS } from '../../../shared/layouts'
import { currentWeather, weatherLabel, weatherOn } from '../../../shared/weather'

// Today and tomorrow in large type (architecture §4.1): a card for each, with
// the all-day events first, then the timed ones, and a "now" marker in today's.
// Mocks 4e and 4f. It borrows the Soft month's side panel: a sage panel for
// today, a plain tile for tomorrow, and the same initial badges. On the
// portrait stage (PR 5.11) the two cards are stacked, today's the taller, with
// the same type, rows and marker; only how many rows fit changes.
// A special day's greeting (architecture §6.3) goes above today's list; the
// takeover's palette and art are the stage's, not this view's.
//
// The weather (PR 2.7) is a line under each long date: today's has the current
// conditions as well as the forecast, tomorrow's only the forecast. A day with
// no weather has no line, so the card is as it was.
//
// Pane options (architecture §4.8), for a pane of a custom layout; without
// them the view is as it always was. `fill_events` gives the timed rows the
// person's fill the all-day rows already have, minus the side stripe, which
// the fill replaces. With several people the fill is split between them
// (`eventFill`), and `show_initials: false` leaves the badges out of a filled
// row so the title has the room. The all-day rows are coloured and badged
// whatever the options say, and keep their first person's colour.
// `wrap_titles` lets a title take up to three lines, but
// only where the list has room: each card's list is a fixed-size box and each
// event a row in it, and `useWrapFit` turns wrapping on one row at a time, top
// to bottom, while the list still fits.
const props = defineProps<ViewProps>()

const options = computed(() => props.paneOptions ?? DEFAULT_PANE_OPTIONS)
const root = ref<HTMLElement | null>(null)
useWrapFit(root, () => options.value.wrap_titles)

const MAX_BADGES = 3

/** A row to draw: an event or the "now" marker. */
type Row
  = | { kind: 'all-day' | 'timed', item: AgendaItem }
    | { kind: 'now' }

const portrait = computed(() => props.stage.orientation === 'portrait')
const days = computed(() => agendaDays(props.events, props.now, props.timezone, portrait.value ? { maxRows: PORTRAIT_MAX_ROWS } : {}).map((day, index) => ({ ...day, weather: weatherLine(day, index === 0) })))
const time = computed(() => formatTime(props.now, props.timezone))

/** The day's rows in order. The marker is only worth drawing among timed events. */
function rowsFor(day: AgendaDay): Row[] {
  const marker = day.timed.length > 0 ? day.marker : null
  const rows: Row[] = day.allDay.map(item => ({ kind: 'all-day', item }))
  day.timed.forEach((item, index) => {
    if (marker === index) rows.push({ kind: 'now' })
    rows.push({ kind: 'timed', item })
  })
  if (marker === day.timed.length) rows.push({ kind: 'now' })
  return rows
}

const isEmpty = (day: AgendaDay) => day.allDay.length + day.timed.length === 0 && day.more === 0

/** The line under a day's date: an icon, the words and the high / low, any of which can be missing. Null when there is nothing to say. */
function weatherLine(day: AgendaDay, today: boolean) {
  const forecast = weatherOn(props.weather, day.date)
  const current = today ? currentWeather(props.weather, props.now) : null
  const condition = current?.condition ?? forecast?.condition ?? null
  const text = current ? formatCurrent(current) : weatherLabel(forecast?.condition ?? null)
  const range = forecast ? formatHighLow(forecast) : null
  return condition || text || range ? { icon: weatherIcon(condition), text, range } : null
}

/** A row's own background and ring: all-day rows are always filled, timed ones only when asked. The ring is a solid colour, so overlapping badges are cut out of the row they sit on. An event with nobody on it (no person matched) gets the surface colour. */
function rowStyle(row: { kind: 'all-day' | 'timed', item: AgendaItem }) {
  if (row.kind === 'timed' && !options.value.fill_events) return undefined
  // Only a row the option filled is split; an all-day row is as it always was.
  const { background, ring } = eventFill(row.kind === 'timed' ? row.item.event.people : row.item.event.people.slice(0, 1))
  return { background, '--ring': ring }
}

/** Whether a row shows its badges: always, unless it is a timed row the option filled and the pane asks for no initials. */
const showsInitials = (row: { kind: 'all-day' | 'timed' }): boolean => row.kind === 'all-day' || !options.value.fill_events || options.value.show_initials

function barColour(event: CalendarEvent): string {
  return event.people[0]?.colour ?? 'var(--muted)'
}
</script>

<template>
  <section ref="root" class="view" :class="{ portrait }" data-testid="agenda-view">
    <article
      v-for="(day, index) in days"
      :key="day.date"
      class="day"
      :class="index === 0 ? 'today' : 'tomorrow'"
      :data-testid="index === 0 ? 'day-today' : 'day-tomorrow'"
    >
      <header class="head">
        <div class="heading">
          <h2 class="name">
            {{ day.label }}
          </h2>
          <p class="date">
            {{ day.longDate }}
          </p>
          <p v-if="day.weather" class="weather" data-testid="agenda-weather">
            <AppIcon v-if="day.weather.icon" :icon="day.weather.icon" :size="48" />
            <span v-if="day.weather.text">{{ day.weather.text }}</span>
            <span v-if="day.weather.range" class="range">{{ day.weather.range }}</span>
          </p>
        </div>
        <div v-if="index === 0" class="clock" data-testid="clock-time">
          {{ time }}
        </div>
      </header>

      <p v-if="index === 0 && specialDays.takeover?.greeting" class="greeting" data-testid="greeting">
        {{ specialDays.takeover.greeting }}
      </p>

      <div v-if="isEmpty(day)" class="empty" data-testid="empty-day">
        <AppIcon :icon="Leaf" :size="120" />
        <p class="calm">
          Nothing planned
        </p>
      </div>

      <ul v-else class="rows" data-wrap-box>
        <template v-for="(row, position) in rowsFor(day)" :key="row.kind === 'now' ? 'now' : row.item.event.id">
          <li v-if="row.kind === 'now'" class="now" data-testid="now-marker">
            <span class="now-label">Now</span>
          </li>

          <li
            v-else
            class="event"
            :class="[row.kind, { past: row.item.past, ongoing: row.item.ongoing, filled: row.kind === 'timed' && options.fill_events }]"
            :style="rowStyle(row)"
            data-wrap-item
            data-testid="event"
            :data-position="position"
          >
            <span v-if="row.kind === 'timed' && !options.fill_events" class="stripe" :style="{ background: barColour(row.item.event) }" />
            <span v-if="row.item.event.people.length && showsInitials(row)" class="badges">
              <span
                v-for="person in row.item.event.people.slice(0, MAX_BADGES)"
                :key="person.id"
                class="badge"
                :style="{ background: person.colour }"
              >{{ person.initial }}</span>
            </span>
            <span v-if="row.item.time" class="time" data-testid="event-time">{{ row.item.time }}</span>
            <span class="title" data-testid="event-title">{{ row.item.event.display_title }}</span>
            <span v-if="row.kind === 'all-day'" class="all-day-label">All day</span>
          </li>
        </template>

        <li v-if="day.more" class="more" data-testid="more">
          +{{ day.more }} more
        </li>
      </ul>
    </article>
  </section>
</template>

<style scoped>
.view {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 64px;
  padding: 80px 96px;
}

/* Stacked, today's card the taller (mocks 4e, 4f). The fr units are of the space left once the gap is out, so 7:5 is the mock's proportion. */
.view.portrait {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 7fr) minmax(0, 5fr);
  gap: 48px;
  padding: 72px 64px;
}

.day {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 56px 64px;
  overflow: hidden;
  border-radius: var(--radius-lg);
}

/* The sage panel, as in the Soft month's side panel. Its muted text is the panel's own, not the page's. */
.today {
  --ring: var(--panel);
  --muted: var(--panel-muted);
  color: var(--panel-text);
  background: var(--panel);
  box-shadow: var(--shadow-lift);
}

.tomorrow {
  --ring: var(--tile);
  background: var(--tile);
  box-shadow: var(--shadow-soft);
}

.head {
  display: flex;
  flex: none;
  align-items: flex-start;
  justify-content: space-between;
  gap: 32px;
  margin-bottom: 40px;
}

.heading {
  min-width: 0;
}

.name {
  margin: 0;
  font-family: var(--font-display);
  font-size: 120px;
  font-weight: 400;
  line-height: 1;
}

.date {
  margin: 12px 0 0;
  font-size: 48px;
  font-weight: 600;
  line-height: 1.1;
}

.weather {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 20px 0 0;
  color: var(--muted);
  font-size: 40px;
  font-weight: 600;
  line-height: 1.1;
}

.weather svg {
  flex: none;
}

/* Set apart from the words, so "Rain 14° / 8°" doesn't read as one phrase. */
span + .range {
  margin-left: 20px;
}

.range {
  font-variant-numeric: tabular-nums;
}

.clock {
  font-family: var(--font-display);
  font-size: 120px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

/* Between the heading and the list, in the display face like the date above it. */
.greeting {
  flex: none;
  margin: -8px 0 32px;
  font-family: var(--font-display);
  font-size: 64px;
  line-height: 1.1;
  overflow-wrap: anywhere;
  text-wrap: balance;
}

.rows {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow: hidden;
  list-style: none;
}

.event {
  display: flex;
  flex: none;
  align-items: center;
  gap: 24px;
  height: 92px;
  padding: 0 20px;
  font-size: 44px;
}

.event.all-day,
.event.filled {
  border-radius: var(--radius-pill);
}

.event.past {
  opacity: 0.45;
}

/* The person's colour as a short upright bar. */
.stripe {
  flex: none;
  width: 12px;
  height: 64px;
  border-radius: var(--radius-pill);
}

.badges {
  display: flex;
  flex: none;
}

/* Overlapping circles for an event shared by several people. */
.badge {
  display: grid;
  place-items: center;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  box-shadow: 0 0 0 4px var(--ring);
  color: var(--color-neutral-900);
  font-size: 30px;
  font-weight: 700;
}

.badge + .badge {
  margin-left: -14px;
}

.time {
  flex: none;
  min-width: 120px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* One line, cut with an ellipsis, so a long title never pushes the badges or the time out. */
.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * A title that may wrap (useWrapFit sets data-wrap). The row grows from its
 * fixed 92px and keeps the first line where it was: every part has the 68px
 * line box of the single-line row, aligned to the top, so a one-line title
 * looks as before.
 */
[data-wrap='on'].event {
  align-items: flex-start;
  height: auto;
  min-height: 92px;
  padding-block: 12px;
}

[data-wrap='on'] .title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  /* Tighter than the 68px line box, so wrapped lines read as one title; the margins keep a single line where it was. */
  margin-block: 8px;
  line-height: 52px;
  overflow-wrap: anywhere;
  white-space: normal;
}

/* A pill would turn into a stadium once it is several lines tall; the single-line row's own radius keeps the ends round. */
[data-wrap='on'].event.all-day,
[data-wrap='on'].event.filled {
  border-radius: 46px;
}

[data-wrap='on'] .time,
[data-wrap='on'] .all-day-label {
  line-height: 68px;
}

[data-wrap='on'] .badges {
  margin-top: 4px;
}

[data-wrap='on'] .stripe {
  margin-top: 2px;
}

.ongoing .title {
  font-weight: 700;
}

.all-day-label {
  flex: none;
  padding-right: 8px;
  font-size: 30px;
  font-weight: 600;
  opacity: 0.7;
}

/* A line across the list at the present moment, with a small pill at its start. */
.now {
  display: flex;
  flex: none;
  align-items: center;
  gap: 16px;
  height: 40px;
  padding: 0 20px;
}

.now-label {
  padding: 4px 22px 6px;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--on-accent);
  font-size: 30px;
  font-weight: 700;
  line-height: 1.2;
}

.now::after {
  flex: 1;
  height: 4px;
  border-radius: var(--radius-pill);
  background: var(--accent);
  content: '';
}

.more {
  flex: none;
  padding: 0 20px;
  color: var(--muted);
  font-size: 40px;
  font-weight: 600;
}

.empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 32px;
  padding-bottom: 80px;
  color: var(--muted);
}

.calm {
  margin: 0;
  font-family: var(--font-display);
  font-size: 64px;
}
</style>
