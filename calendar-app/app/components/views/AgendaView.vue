<script setup lang="ts">
import { Leaf } from 'lucide-vue-next'
import type { CalendarEvent } from '../../../shared/types/events'
import { agendaDays } from '~/utils/agenda'
import type { AgendaDay, AgendaItem } from '~/utils/agenda'
import { formatTime } from '~/utils/format'
import { personFill } from '~/utils/themes'
import { formatCurrent, formatHighLow, weatherIcon } from '~/utils/weather'
import type { ViewProps } from '../../utils/views'
import { currentWeather, weatherLabel, weatherOn } from '../../../shared/weather'

// Today and tomorrow in large type (architecture §4.1): a card for each, with
// the all-day events first, then the timed ones, and a "now" marker in today's.
// There is no mock for it yet, so it borrows the Soft month's side panel: a
// sage panel for today, a plain tile for tomorrow, and the same initial badges.
// A special day's greeting (architecture §6) goes above today's list.
//
// The weather (PR 2.7) is a line under each long date: today's has the current
// conditions as well as the forecast, tomorrow's only the forecast. A day with
// no weather has no line, so the card is as it was.
const props = defineProps<ViewProps>()

const MAX_BADGES = 3

/** A row to draw: an event or the "now" marker. */
type Row
  = | { kind: 'all-day' | 'timed', item: AgendaItem }
    | { kind: 'now' }

const days = computed(() => agendaDays(props.events, props.now, props.timezone).map((day, index) => ({ ...day, weather: weatherLine(day, index === 0) })))
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

function fill(event: CalendarEvent): string {
  // An event with nobody on it (no person matched) gets the muted colour.
  return event.people[0] ? personFill(event.people[0].colour) : 'var(--surface)'
}

function barColour(event: CalendarEvent): string {
  return event.people[0]?.colour ?? 'var(--muted)'
}
</script>

<template>
  <section class="view" data-testid="agenda-view">
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

      <div v-if="isEmpty(day)" class="empty" data-testid="empty-day">
        <AppIcon :icon="Leaf" :size="120" />
        <p class="calm">
          Nothing planned
        </p>
      </div>

      <ul v-else class="rows">
        <template v-for="(row, position) in rowsFor(day)" :key="row.kind === 'now' ? 'now' : row.item.event.id">
          <li v-if="row.kind === 'now'" class="now" data-testid="now-marker">
            <span class="now-label">Now</span>
          </li>

          <li
            v-else
            class="event"
            :class="[row.kind, { past: row.item.past, ongoing: row.item.ongoing }]"
            :style="row.kind === 'all-day' ? { background: fill(row.item.event) } : undefined"
            data-testid="event"
            :data-position="position"
          >
            <span v-if="row.kind === 'timed'" class="stripe" :style="{ background: barColour(row.item.event) }" />
            <span v-if="row.item.event.people.length" class="badges">
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

.event.all-day {
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
