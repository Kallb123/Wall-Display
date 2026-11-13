<script setup lang="ts">
import { eventLabel } from '~/utils/eventLabel'
import { LANE, LANE_GAP, weekBarStyle } from '~/utils/weekView'
import type { WeekLayout } from '../../../../shared/week-layout'
import WeekBadges from './WeekBadges.vue'

// The all-day strip: the all-day and multi-day events as bars that run across the
// tiles, on the columns of the grid this shares (a subgrid), and the "+N more" in
// a full day's last lane. The parent draws it only when there is a lane to fill.
defineProps<{
  allDay: WeekLayout['allDay']
}>()
</script>

<template>
  <div
    class="strip"
    :style="{ gridTemplateRows: `repeat(${allDay.lanes}, ${LANE}px)`, rowGap: `${LANE_GAP}px` }"
  >
    <div
      v-for="bar in allDay.bars"
      :key="`${bar.event.id}-${bar.column}`"
      class="bar"
      :style="weekBarStyle(bar)"
      data-testid="event"
      data-kind="bar"
    >
      <WeekBadges :item="bar" />
      <span class="name">{{ eventLabel(bar.event) }}</span>
    </div>
    <div
      v-for="more in allDay.more"
      :key="more.column"
      class="more"
      :style="{ gridColumn: more.column + 1, gridRow: more.lane + 1 }"
      data-testid="more"
    >
      +{{ more.count }} more
    </div>
  </div>
</template>

<style scoped>
/* `.portrait` is a class of the week's root. */
/* The strip shares the seven columns (a subgrid), so a bar can run across tiles. */
.strip {
  display: grid;
  grid-column: 2 / -1;
  grid-row: 2;
  grid-template-columns: subgrid;
  align-content: start;
  min-height: 0;
}

.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 0 14px 0 4px;
  overflow: hidden;
  color: var(--bar-text);
  font-size: 20px;
  font-weight: 700;
  white-space: nowrap;
}

.more {
  display: flex;
  align-items: center;
  padding: 0 16px;
  color: var(--accent-ink);
  font-size: 20px;
  font-weight: 700;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.portrait .bar {
  gap: 8px;
  padding: 0 12px 0 4px;
  font-size: 19px;
}

.portrait .more {
  padding: 0 12px;
  font-size: 19px;
}
</style>
