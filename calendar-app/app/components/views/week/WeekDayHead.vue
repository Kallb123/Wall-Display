<script setup lang="ts">
import { specialDayArtUrl } from '../../../../shared/special-days'
import type { WeekDay } from '../../../../shared/week-layout'
import type { DayForecast } from '~/utils/weekView'

// A day's heading, at the top of its tile: the date number (marked for today) and
// the weekday, a decorated day's art in the corner and the forecast under the
// date. Any part that is not known is left out. The parent places it in its
// column of the grid.
defineProps<{
  day: WeekDay
  /** The art beside the date, by name, for a special day; none or empty draws nothing. */
  art?: string[]
  forecast: DayForecast | null
  portrait: boolean
}>()
</script>

<template>
  <div class="head">
    <div class="date">
      <span
        class="number"
        :class="{ today: day.today }"
        :data-testid="day.today ? 'today-number' : undefined"
      >{{ day.day }}</span>
      <span class="weekday">{{ day.weekday }}</span>
    </div>
    <div v-if="art?.length" class="tile-art">
      <img
        v-for="(name, index) in art"
        :key="`${name}-${index}`"
        :src="specialDayArtUrl(name)"
        alt=""
        draggable="false"
        data-testid="tile-art"
      >
    </div>
    <div v-if="forecast" class="day-weather" data-testid="day-weather">
      <AppIcon v-if="forecast.icon" :icon="forecast.icon" :size="portrait ? 26 : 32" />
      <span v-if="forecast.text">{{ forecast.text }}</span>
    </div>
  </div>
</template>

<style scoped>
/* `.portrait` is a class of the week's root. */
.head {
  position: relative;
  grid-row: 1;
  min-width: 0;
  padding: 14px 0 0 20px;
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

/* The top-right of a tile, beside the date, for a special day's art; it does not push anything. */
.tile-art {
  position: absolute;
  top: 8px;
  right: 14px;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  pointer-events: none;
}

.tile-art img {
  display: block;
  width: auto;
  max-width: 96px;
  height: 56px;
  object-fit: contain;
}

/* Under the date, quiet. */
.day-weather {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
  color: var(--muted);
  font-size: 26px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.day-weather :deep(svg) {
  flex: none;
}

/* The date and its weekday on one line, the weather under it. */
.portrait .head {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 0 0 10px;
}

.portrait .date {
  gap: 10px;
}

.portrait .number {
  min-width: 40px;
  height: 40px;
  font-size: 27px;
}

.portrait .weekday {
  font-size: 19px;
}

.portrait .day-weather {
  gap: 8px;
  margin-top: 0;
  padding-left: 4px;
  font-size: 20px;
}

/* Narrow tiles: a smaller picture, tucked into the corner. */
.portrait .tile-art {
  top: 6px;
  right: 8px;
}

.portrait .tile-art img {
  max-width: 44px;
  height: 44px;
}
</style>
