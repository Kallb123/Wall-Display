<script setup lang="ts">
import type { Component } from 'vue'
import MonthDayRows from './MonthDayRows.vue'
import MonthGreeting from './MonthGreeting.vue'
import MonthNow from './MonthNow.vue'
import type { FittedPanelDay } from '~/utils/monthPanel'

// The portrait stage's band across the full width (mocks 4a, 4b and 4j): today's
// big date, the weather and its high and low in words on the left, and today's
// events on the right. Only as tall as its content, so it is not fitted and its
// rows have no locations or wrapping. The sage chrome (`.panel`) is styled by
// MonthSoftView, which owns the column the band sits in.
defineProps<{
  /** The takeover's greeting; null for none. The band is a `takeover` all the same when there is a takeover without one. */
  greeting: string | null
  takeover: boolean
  dayNumber: number
  weekday: string
  nowWeather: { icon: Component | null, text: string } | null
  /** `High 14° · Low 8°`, or null when the forecast has neither. */
  highLow: string | null
  day: FittedPanelDay
  fill: boolean
  initials: boolean
}>()
</script>

<template>
  <div class="panel band" :class="{ takeover }" data-testid="today-band">
    <div class="band-now">
      <MonthGreeting v-if="greeting" :greeting="greeting" />

      <MonthNow :day-number="dayNumber" :weekday="weekday" :weather="nowWeather">
        <div v-if="highLow" class="high-low" data-testid="today-high-low">
          {{ highLow }}
        </div>
      </MonthNow>
    </div>

    <MonthDayRows :day="day" size="roomy" :fill="fill" :initials="initials" />
  </div>
</template>

<style scoped>
/* Two columns, the right starting at x 616 on the stage, and only as tall as the taller of them. The `.side` is for the weight to beat `.panel.takeover`, which is in MonthSoftView. */
.side .panel.band {
  display: grid;
  flex: none;
  grid-template-columns: 516px minmax(0, 1fr);
  align-items: start;
  padding: 44px 52px 47px;
}

.band-now {
  display: flex;
  flex-direction: column;
  gap: 36px;
  min-width: 0;
}

.band .now {
  flex-direction: column;
  align-items: flex-start;
  gap: 40px;
}

.band :deep(.weather-now) {
  margin-top: 30px;
}

/* Level with the date's top, as in the mock. */
.band .rows,
.band .nothing {
  margin-top: 9px;
}

/* Today's range in words, a step quieter than the conditions above it. */
.high-low {
  margin-top: 20px;
  color: var(--panel-muted);
  font-family: var(--font-body);
  font-size: 26px;
  font-weight: 700;
  line-height: 1.1;
}
</style>
