<script setup lang="ts">
import { formatLongDate, formatTime } from '~/utils/format'

// The time in the display's zone, large, in the display face, with an
// optional weekday and date underneath.
const props = defineProps<{
  now: Date
  timezone: string
  showDate?: boolean
}>()

const time = computed(() => formatTime(props.now, props.timezone))
const date = computed(() => formatLongDate(props.now, props.timezone))
</script>

<template>
  <div class="clock">
    <div class="time" data-testid="clock-time">
      {{ time }}
    </div>
    <div v-if="showDate" class="date" data-testid="clock-date">
      {{ date }}
    </div>
  </div>
</template>

<style scoped>
.clock {
  line-height: 1;
}

.time {
  font-family: var(--font-display);
  font-size: 280px;
  font-variant-numeric: tabular-nums;
}

.date {
  margin-top: 24px;
  font-size: 56px;
  font-weight: 600;
}
</style>
