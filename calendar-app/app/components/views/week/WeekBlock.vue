<script setup lang="ts">
import { eventLabel } from '~/utils/eventLabel'
import { ONE_LINE_MINUTES, weekBlockStyle } from '~/utils/weekView'
import { eventLocation } from '../../../../shared/location'
import type { TimedBlock } from '../../../../shared/week-layout'
import WeekBadges from './WeekBadges.vue'

// A timed event as a block in its day's column, placed in minutes as percentages
// of the hours area. A block under 50 minutes is one line, the badge and the
// title; a longer one has the badge and time over a title that wraps to three
// lines (marked for `useWrapFit`, which only fits the locations here).
//
// The location is a second, quieter line under the title, left out of the markup
// when locations are off, when the event has none worth showing and in a one-line
// block. Otherwise it is hidden unless `useWrapFit` set `data-location="on"` on
// the words (the title and location, which take no box of their own).
defineProps<{
  block: TimedBlock
  /** The height of the hour scale in minutes, which the block's percentages are of. */
  rangeMinutes: number
  locationsOn: boolean
}>()
</script>

<template>
  <div
    class="block"
    :class="{ 'one-line': block.height < ONE_LINE_MINUTES, 'shared': block.tracks > 1, 'past': block.past }"
    :style="weekBlockStyle(block, rangeMinutes)"
    data-testid="event"
    data-kind="block"
    :data-track="block.track"
    :data-tracks="block.tracks"
  >
    <span class="inner" data-wrap-box>
      <span class="top">
        <WeekBadges :item="block" />
        <span class="time">{{ block.time }}</span>
      </span>
      <span class="words" data-wrap-item>
        <span class="name">{{ eventLabel(block.event) }}</span>
        <span
          v-if="locationsOn && block.height >= ONE_LINE_MINUTES && eventLocation(block.event.location)"
          class="location"
          data-location-line
          data-testid="event-location"
        >{{ eventLocation(block.event.location) }}</span>
      </span>
    </span>
  </div>
</template>

<style scoped>
/* `.portrait` is a class of the week's root. The side-by-side gap is `--gap`, set on the column's blocks. */
.block {
  position: absolute;
  box-sizing: border-box;
  min-width: 0;
  padding: 0 0 0 0;
  overflow: hidden;
  color: var(--bar-text);
  font-size: 20px;
  line-height: 1.2;
}

/* A gap on every side of a block, taken out of the box so neighbours never touch. */
.block {
  border: 0 solid transparent;
  border-width: 1px var(--gap) 1px 0;
  background-clip: padding-box;
}

.block .inner {
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-sizing: border-box;
  height: 100%;
  padding: 8px 10px 6px 12px;
  overflow: hidden;
}

.block .top {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.block .time {
  flex: none;
  color: var(--muted);
  font-weight: 700;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.block .name {
  display: -webkit-box;
  font-weight: 600;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow-wrap: anywhere;
}

/* The title and the location: no box of their own, so they are the inner's flex items as the title alone was. */
.block .words {
  display: contents;
}

/* A second, quieter line under the title, only where the fit found room for it (data-location is set by useWrapFit on the words). */
.block .location {
  display: none;
  flex: none;
  min-width: 0;
  overflow: hidden;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.2;
  opacity: 0.7;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.block .words[data-location='on'] .location {
  display: block;
}

/* With the location in, the title keeps its lines and the fit sees whether the two fit. */
.block .words[data-location='on'] .name {
  flex-shrink: 0;
}

.block.one-line .location {
  display: none;
}

/* Squeezed between neighbours as well: the title matters more than the time, which the hour scale gives anyway. */
.block.one-line.shared .time {
  display: none;
}

/* Too short for two lines: the time and the title side by side on one. */
.block.one-line .inner {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding-top: 0;
  padding-bottom: 0;
}

.block.one-line .name {
  display: block;
  min-width: 0;
  white-space: nowrap;
  line-clamp: 1;
  -webkit-line-clamp: 1;
}

.block.past {
  opacity: 0.45;
}

.portrait .block {
  font-size: 18px;
}

.portrait .block .inner {
  gap: 3px;
  padding: 7px 8px 6px 7px;
}

.portrait .block .top {
  gap: 6px;
}

.portrait .block .time {
  min-width: 0;
  overflow: hidden;
  font-size: 17px;
  white-space: nowrap;
}

.portrait .block .location {
  font-size: 15px;
}

/* One line: the badge and the title, with no time. */
.portrait .block.one-line .inner {
  gap: 6px;
  padding: 0 8px 0 6px;
}

.portrait .block.one-line .time {
  display: none;
}
</style>
