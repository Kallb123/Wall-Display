<script setup lang="ts">
import MonthWeek from './MonthWeek.vue'
import type { LaneSpans } from '~/utils/monthPanel'
import type { Decorations } from '~/utils/monthSoft'
import type { MonthLayout } from '../../../../shared/month-layout'
import type { WeatherSnapshot } from '../../../../shared/weather'

// The weekday headings above the weeks, five rows of rounded day tiles. Each
// week is a `MonthWeek`, which places everything in it on one grid. The grid's
// share of the view (`flex: 1`, which depends on the layout) is set by
// MonthSoftView.
defineProps<{
  layout: MonthLayout
  /** Each week's lane spans for wrapping titles, or nulls when the option is off. */
  spans: (LaneSpans | null)[]
  decorated: Decorations
  weather: WeatherSnapshot | null
  today: string
  portrait: boolean
  fillEvents: boolean
  showInitials: boolean
  /** Whether a tile shows its forecast, and whether that is the icon alone. */
  cellWeather: boolean
  compactTiles: boolean
}>()
</script>

<template>
  <div class="grid">
    <div class="weekdays">
      <div v-for="name in layout.weekdays" :key="name" class="weekday-name">
        {{ name }}
      </div>
    </div>

    <div class="weeks">
      <MonthWeek
        v-for="(week, weekIndex) in layout.rows"
        :key="weekIndex"
        :week="week"
        :spans="spans[weekIndex] ?? null"
        :decorated="decorated"
        :weather="weather"
        :today="today"
        :portrait="portrait"
        :fill-events="fillEvents"
        :show-initials="showInitials"
        :cell-weather="cellWeather"
        :compact-tiles="compactTiles"
      />
    </div>
  </div>
</template>

<style scoped>
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
</style>
