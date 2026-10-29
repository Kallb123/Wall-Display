<script setup lang="ts">
import type { CalendarEvent } from '../../../shared/types/events'
import { formatTime } from '~/utils/format'
import { personFill } from '~/utils/themes'
import { todayIn } from '~/utils/eventRanges'
import type { ViewProps } from '~/utils/views'

// Stands in for the views that aren't built yet (the month and agenda views
// have their own). It shows the design system at work: the display face, a
// sage panel with the clock, and a card of upcoming events on person-coloured
// bars. Replace one entry of `viewFor` in pages/display.vue per real view.
const props = defineProps<ViewProps>()

const MAX_EVENTS = 8
const MAX_BADGES = 3

const label = computed(() => props.view.charAt(0).toUpperCase() + props.view.slice(1))

/** Events still to come today, or later (the events arrive sorted by start). */
const upcoming = computed(() => {
  const today = todayIn(props.now, props.timezone)
  return props.events
    .filter(event => event.all_day ? (event.end_date ?? '') > today : new Date(event.end) > props.now)
    .slice(0, MAX_EVENTS)
})

function timeLabel(event: CalendarEvent): string {
  return event.all_day ? 'All day' : formatTime(new Date(event.start), props.timezone)
}

function fill(event: CalendarEvent): string {
  // An event with nobody on it (no person matched) gets the muted colour.
  return event.people[0] ? personFill(event.people[0].colour) : 'var(--surface)'
}
</script>

<template>
  <section class="view">
    <h1 class="title">
      {{ label }}
    </h1>

    <div class="panel">
      <ClockWidget :now="now" :timezone="timezone" show-date />
    </div>

    <div class="tile">
      <h2 class="heading">
        Coming up
      </h2>
      <ul class="events">
        <li v-for="event in upcoming" :key="event.id" class="bar" :style="{ background: fill(event) }" data-testid="event">
          <span class="badges">
            <span
              v-for="person in event.people.slice(0, MAX_BADGES)"
              :key="person.id"
              class="badge"
              :style="{ background: person.colour }"
            >{{ person.initial }}</span>
          </span>
          <span class="time">{{ timeLabel(event) }}</span>
          <span class="name">{{ event.display_title }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.view {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 1040px 1fr;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 48px 64px;
  padding: 80px 96px;
}

.title {
  grid-column: 1 / -1;
  margin: 0;
  font-family: var(--font-display);
  font-size: 128px;
  font-weight: 400;
  line-height: 1;
}

.panel {
  box-sizing: border-box;
  padding: 72px 80px;
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow-lift);
}

.tile {
  box-sizing: border-box;
  min-width: 0;
  padding: 48px 56px;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--tile);
  box-shadow: var(--shadow-soft);
}

.heading {
  margin: 0 0 24px;
  font-family: var(--font-display);
  font-size: 56px;
  font-weight: 400;
}

.events {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.bar {
  display: flex;
  align-items: center;
  gap: 28px;
  height: 88px;
  padding: 0 16px;
  border-radius: var(--radius-pill);
  font-size: 36px;
}

.badges {
  display: flex;
  flex: none;
}

/* Overlapping circles for an event shared by several people. */
.badge {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  box-shadow: 0 0 0 4px var(--bg);
  color: var(--color-neutral-900);
  font-size: 28px;
  font-weight: 700;
}

.badge + .badge {
  margin-left: -14px;
}

.time {
  flex: none;
  min-width: 140px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
