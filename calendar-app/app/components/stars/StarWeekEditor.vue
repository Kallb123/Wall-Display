<script setup lang="ts">
import { Minus, Plus } from 'lucide-vue-next'
import { starWeek, starsOn } from '../../../shared/stars'
import type { StarChart, StarChartPerson } from '../../../shared/stars'
import PersonBadge from '~/components/settings/PersonBadge.vue'

// This week's stars for each person with a chart, a day to a column, with a
// minus and a plus under each day to correct a count (the page sends the
// change with that day's date). Days still to come cannot be changed, as the
// server would refuse them. Beside the days are today's total and the person's
// total for their own period, which is what the wall shows.

const props = defineProps<{
  chart: StarChart
  /** The wall's today, `YYYY-MM-DD`. */
  today: string
  weekStart: 'monday' | 'sunday'
  /** A change is being sent, so the buttons rest. */
  busy?: boolean
}>()

const emit = defineEmits<{
  adjust: [personId: string, date: string, delta: 1 | -1]
}>()

const week = computed(() => starWeek(props.today, props.weekStart))

/** `Mon` over `9`, from the date alone: the string is a calendar date, so it is read in UTC and never shifted by the viewer's zone. */
const dayName = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
const dayNumber = (date: string) => Number(date.slice(8))

const weekTotal = (person: StarChartPerson) => week.value.reduce((sum, date) => sum + starsOn(props.chart, person.id, date), 0)
</script>

<template>
  <div class="scroll" data-testid="star-week">
    <table class="grid">
      <caption class="sr-only">
        Stars this week
      </caption>
      <thead>
        <tr>
          <th scope="col" class="person-head">
            Person
          </th>
          <th v-for="date in week" :key="date" scope="col" class="day" :class="{ today: date === today }" :data-date="date">
            <span class="dow">{{ dayName(date) }}</span>
            <span class="dom">{{ dayNumber(date) }}</span>
          </th>
          <th scope="col" class="total">
            Week
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="person in chart.people" :key="person.id" :data-testid="`star-week-${person.id}`">
          <th scope="row" class="person-head">
            <span class="who">
              <PersonBadge :person="person" :size="32" />
              {{ person.name }}
            </span>
          </th>
          <td v-for="date in week" :key="date" class="day" :class="{ today: date === today }">
            <!-- A column per day: more above the count and fewer below it, so seven days fit a laptop card and a phone needs little scrolling. -->
            <span class="steps">
              <button
                type="button"
                class="step"
                :aria-label="`One more star for ${person.name} on ${dayName(date)} ${dayNumber(date)}`"
                :disabled="busy || date > today"
                :data-testid="`star-plus-${person.id}-${date}`"
                @click="emit('adjust', person.id, date, 1)"
              >
                <AppIcon :icon="Plus" :size="18" />
              </button>
              <span class="count" :data-testid="`star-count-${person.id}-${date}`">{{ starsOn(chart, person.id, date) }}</span>
              <button
                type="button"
                class="step"
                :aria-label="`One fewer star for ${person.name} on ${dayName(date)} ${dayNumber(date)}`"
                :disabled="busy || date > today || starsOn(chart, person.id, date) === 0"
                :data-testid="`star-minus-${person.id}-${date}`"
                @click="emit('adjust', person.id, date, -1)"
              >
                <AppIcon :icon="Minus" :size="18" />
              </button>
            </span>
          </td>
          <td class="total" :data-testid="`star-weektotal-${person.id}`">
            {{ weekTotal(person) }}
            <span v-if="person.goal !== null && person.period === 'week'" class="of">of {{ person.goal }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.scroll {
  max-width: 100%;
  overflow-x: auto;
}

.grid {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}

th,
td {
  padding: 8px 4px;
  text-align: center;
}

tbody tr + tr > * {
  border-top: 2px solid var(--line);
}

.person-head {
  /* Stays in view while the days scroll sideways on a phone. */
  position: sticky;
  left: 0;
  z-index: 1;
  min-width: 6.5em;
  background: var(--surface);
  text-align: left;
  font-size: 16px;
  font-weight: 700;
}

.who {
  display: flex;
  align-items: center;
  gap: 10px;
}

thead th {
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
}

.dow,
.dom {
  display: block;
}

.dom {
  color: var(--text);
  font-size: 18px;
}

.day.today {
  background: color-mix(in oklch, var(--accent) 12%, transparent);
}

.count {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
}

.steps {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.step {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 2px solid var(--line);
  border-radius: 50%;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  touch-action: manipulation;
}

.step:disabled {
  opacity: 0.4;
  cursor: default;
}

.step:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}

td.total {
  min-width: 4em;
  font-size: 20px;
  font-weight: 700;
}

.of {
  display: block;
  color: var(--muted);
  font-size: 13px;
  font-weight: 600;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
