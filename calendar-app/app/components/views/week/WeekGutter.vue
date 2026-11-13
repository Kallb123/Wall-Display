<script setup lang="ts">
import { coveredByNow, percentOf } from '~/utils/weekView'
import type { NowLine } from '../../../../shared/week-layout'

// The hour labels' own column, left of the seven days, with the now pill over it
// at the current time. It is as tall as the hours area, so a label's percentage is
// the same as the rule's in the columns. An hour label that the pill would overlap
// is hidden.
defineProps<{
  hours: number[]
  rangeMinutes: number
  now: NowLine | null
}>()
</script>

<template>
  <div class="gutter" data-testid="gutter">
    <span
      v-for="(hour, index) in hours"
      :key="hour"
      class="hour-label"
      :class="{ covered: coveredByNow(now?.position, index * 60) }"
      :style="{ top: percentOf(index * 60, rangeMinutes) }"
    >{{ String(hour).padStart(2, '0') }}:00</span>
    <span
      v-if="now && typeof now.position === 'number'"
      class="now-time"
      :style="{ top: percentOf(now.position, rangeMinutes) }"
      data-testid="now-time"
    >{{ now.time }}</span>
  </div>
</template>

<style scoped>
/* `.portrait` is a class of the week's root. */
/* The hour labels' own column. Positioned boxes of the same height as the hours area, so a label's percentage is a line's. */
.gutter {
  position: relative;
  grid-column: 1;
  grid-row: 4;
  min-height: 0;
}

.hour-label {
  position: absolute;
  right: 6px;
  color: var(--muted);
  font-size: 22px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 1;
  transform: translateY(-50%);
}

.hour-label.covered {
  visibility: hidden;
}

/* The hours labelled at the edge of the range would stick out of the tile; the first sits below the band instead. */
.hour-label:first-child {
  transform: translateY(-20%);
}

/* Now: the time in the gutter. */
.now-time {
  position: absolute;
  right: 0;
  z-index: 2;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 20px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 1.1;
  transform: translateY(-50%);
}

.portrait .hour-label {
  right: 4px;
  font-size: 19px;
}

.portrait .now-time {
  padding: 3px 8px;
  font-size: 18px;
}
</style>
