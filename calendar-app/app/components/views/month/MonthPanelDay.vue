<script setup lang="ts">
import MonthDayRows from './MonthDayRows.vue'
import type { PanelDayView } from '~/utils/monthSoft'

// One day in the landscape panel, or one of the portrait strip's cards: its
// heading with the day's forecast at the right, then its rows. `size` is that of
// `MonthPanelRows`. The strip's own colours are set by its styles, and it marks
// each card `data-wrap-box` for `useWrapFit` (the panel marks its whole list).
defineProps<{
  day: PanelDayView
  size?: 'standard' | 'roomy' | 'card'
  fill?: boolean
  initials?: boolean
  locations?: boolean
}>()
</script>

<template>
  <section class="day" data-testid="panel-day" :data-date="day.date">
    <header class="day-head">
      <h2 class="day-label">
        {{ day.label }}
      </h2>
      <div v-if="day.weather" class="day-weather" data-testid="day-weather">
        <AppIcon v-if="day.weather.icon" :icon="day.weather.icon" :size="34" />
        <span v-if="day.weather.text">{{ day.weather.text }}</span>
      </div>
    </header>

    <MonthDayRows :day="day" :size="size" :fill="fill" :initials="initials" :locations="locations" />
  </section>
</template>

<style scoped>
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

.day-weather svg {
  flex: none;
}
</style>
