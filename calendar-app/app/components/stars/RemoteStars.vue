<script setup lang="ts">
import { Minus, Plus } from 'lucide-vue-next'
import { starTotal, starsOn } from '../../../shared/stars'
import type { StarChart, StarChartPerson } from '../../../shared/stars'
import PersonBadge from '~/components/settings/PersonBadge.vue'

// The remote's Stars section: a line for each person with a star chart, with
// their badge and name, how many stars they have today and, in smaller type,
// their total for their own period (and the goal, if they have one), and a big
// minus and plus to take one away or give one. A tap is only a request
// (`adjust`); the page sends it and shows the chart the server sends back, so
// this never counts anything itself.

const props = defineProps<{
  chart: StarChart
  /** The wall's today, `YYYY-MM-DD`. */
  today: string
  weekStart: 'monday' | 'sunday'
}>()

const emit = defineEmits<{
  adjust: [personId: string, delta: 1 | -1]
}>()

/** What a person's line says under their name. */
function summary(person: StarChartPerson): string {
  const total = starTotal(props.chart, person, props.today, props.weekStart)
  if (person.period === 'week') return `${total}${person.goal === null ? '' : ` of ${person.goal}`} this week`
  return person.goal === null ? 'Today' : `Goal ${person.goal} a day`
}
</script>

<template>
  <ul class="card stars" data-testid="star-list">
    <li v-for="person in chart.people" :key="person.id" class="person" :data-testid="`star-row-${person.id}`">
      <PersonBadge :person="person" :size="44" />
      <div class="text">
        <p class="name">
          {{ person.name }}
        </p>
        <p class="hint" :data-testid="`star-summary-${person.id}`">
          {{ summary(person) }}
        </p>
      </div>
      <button
        type="button"
        class="step"
        :aria-label="`Take a star from ${person.name}`"
        :disabled="starsOn(chart, person.id, today) === 0"
        :data-testid="`star-minus-${person.id}`"
        @click="emit('adjust', person.id, -1)"
      >
        <AppIcon :icon="Minus" :size="28" />
      </button>
      <output class="count" :aria-label="`${person.name}'s stars today`" :data-testid="`star-today-${person.id}`">{{ starsOn(chart, person.id, today) }}</output>
      <button
        type="button"
        class="step plus"
        :aria-label="`Give ${person.name} a star`"
        :data-testid="`star-plus-${person.id}`"
        @click="emit('adjust', person.id, 1)"
      >
        <AppIcon :icon="Plus" :size="28" />
      </button>
    </li>
  </ul>
</template>

<style scoped>
/* The remote's card, with a line to each person. The page's own button reset does not reach in here. */
.stars {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 6px 14px;
  list-style: none;
  border-radius: var(--card-radius);
  background: var(--surface);
  box-shadow: var(--shadow-soft);
}

.person {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 0;
}

.person + .person {
  border-top: 2px solid var(--line);
}

.text {
  flex: 1;
  min-width: 0;
}

.name {
  margin: 0;
  overflow: hidden;
  font-size: 19px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hint {
  margin: 2px 0 0;
  color: var(--muted);
  font-size: 14px;
  font-weight: 500;
}

.count {
  min-width: 1.6em;
  font-family: var(--font-display);
  font-size: 34px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.step {
  display: grid;
  flex: none;
  place-items: center;
  width: 56px;
  height: 56px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--bg);
  box-shadow: inset 0 0 0 2px var(--line);
  color: var(--text);
  cursor: pointer;
  touch-action: manipulation;
}

.step.plus {
  background: var(--accent);
  box-shadow: none;
  color: var(--on-accent);
}

.step:disabled {
  opacity: 0.4;
  cursor: default;
}

.step:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 3px;
}
</style>
