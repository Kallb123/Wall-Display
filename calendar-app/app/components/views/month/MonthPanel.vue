<script setup lang="ts">
import type { Component } from 'vue'
import MonthGreeting from './MonthGreeting.vue'
import MonthNow from './MonthNow.vue'
import MonthPanelDay from './MonthPanelDay.vue'
import type { PanelDayView } from '~/utils/monthSoft'

// The landscape panel: a takeover's greeting, today's date and conditions, then
// today and the next three days, each trimmed to the rows that fit. The sage
// chrome (`.panel`, and `.takeover` for the panel's height during a takeover) is
// styled by MonthSoftView, which owns the side column the panel sits in. The
// whole panel is a `data-wrap-box` for `useWrapFit`.
defineProps<{
  greeting: string | null
  /** Whether a takeover is in force, with or without a greeting: the panel is then only as tall as its content. */
  takeover: boolean
  dayNumber: number
  weekday: string
  nowWeather: { icon: Component | null, text: string } | null
  days: PanelDayView[]
  fill: boolean
  initials: boolean
  locations: boolean
}>()
</script>

<template>
  <div class="panel" :class="{ takeover }" data-testid="panel" data-wrap-box>
    <MonthGreeting v-if="greeting" :greeting="greeting" />

    <MonthNow :day-number="dayNumber" :weekday="weekday" :weather="nowWeather" />

    <div class="days">
      <MonthPanelDay v-for="day in days" :key="day.date" :day="day" :fill="fill" :initials="initials" :locations="locations" />
    </div>
  </div>
</template>

<style scoped>
.days {
  display: flex;
  flex-direction: column;
  gap: 30px;
  min-height: 0;
}
</style>
