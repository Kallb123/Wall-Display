<script setup lang="ts">
import type { Component } from 'vue'

// Today in the panel and the portrait band: the big date, the weekday and, under
// it, the current conditions. Anything the parent puts in the slot goes under
// the conditions, inside the weekday's column (the band's high and low).
defineProps<{
  dayNumber: number
  weekday: string
  /** The current conditions as an icon and words; null for none. */
  weather: { icon: Component | null, text: string } | null
}>()
</script>

<template>
  <div class="now">
    <div class="big-date" data-testid="panel-date">
      {{ dayNumber }}
    </div>
    <div class="weekday">
      {{ weekday }}
      <div v-if="weather" class="weather-now" data-testid="weather-now">
        <AppIcon v-if="weather.icon" :icon="weather.icon" :size="44" />
        <span class="weather-text">{{ weather.text }}</span>
      </div>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.now {
  display: flex;
  align-items: center;
  gap: 28px;
}

.big-date {
  font-family: var(--font-display);
  font-size: 184px;
  letter-spacing: -0.03em;
  line-height: 0.85;
}

.weekday {
  /* So a long condition is cut with an ellipsis instead of widening the column. */
  min-width: 0;
  font-family: var(--font-display);
  font-size: 44px;
  line-height: 1;
}

/* Quiet: the panel's muted colour and the body face, smaller than the weekday it sits under. */
.weather-now {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  color: var(--panel-muted);
  font-family: var(--font-body);
  font-size: 32px;
  font-weight: 600;
  line-height: 1.1;
}

.weather-now svg {
  flex: none;
}

.weather-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
