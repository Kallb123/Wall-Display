<script setup lang="ts">
import MonthPanelDay from './MonthPanelDay.vue'
import type { PanelDayView } from '~/utils/monthSoft'

// The portrait stage's strip of three cards for the next three days, as wide as
// the grid's columns allow, on the tile colour. Each card is fitted by
// `useWrapFit`, so it is a `data-wrap-box`.
defineProps<{
  days: PanelDayView[]
  fill: boolean
  initials: boolean
  locations: boolean
}>()
</script>

<template>
  <div class="next-days" data-testid="next-days">
    <MonthPanelDay
      v-for="day in days"
      :key="day.date"
      :day="day"
      size="card"
      :fill="fill"
      :initials="initials"
      :locations="locations"
      data-wrap-box
    />
  </div>
</template>

<style scoped>
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

/* Inside the cards, so past their scope. */
.next-days :deep(.day-weather) {
  color: var(--muted);
}

.next-days :deep(.nothing) {
  color: var(--muted);
}
</style>
