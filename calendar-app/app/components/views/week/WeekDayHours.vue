<script setup lang="ts">
import { percentOf } from '~/utils/weekView'
import type { NowLine, OverflowChip, TimedBlock, WeekDay } from '../../../../shared/week-layout'
import WeekBlock from './WeekBlock.vue'
import WeekNowLine from './WeekNowLine.vue'

// The hours of one day, over its tile: a rule at each hour, the day's timed
// events as blocks, a "+N" chip for blocks that had no track left, and the now
// line when now is in this day. Everything is placed in minutes, as percentages of
// this box, which the grid gives whatever room is left; the parent puts it in the
// day's column.
defineProps<{
  day: WeekDay
  /** The hour labels, which the rules are drawn at. */
  hours: number[]
  /** The height of the hour scale in minutes. */
  rangeMinutes: number
  /** This day's blocks and chips only. */
  blocks: TimedBlock[]
  overflow: OverflowChip[]
  now: NowLine | null
  /** The tile's background, which the "+N" chip's ring matches to lift it off the blocks. */
  tileBackground: string
  /** The gap between side-by-side blocks (px). */
  blockGap: number
  locationsOn: boolean
}>()
</script>

<template>
  <div class="hours" :style="{ '--tile-bg': tileBackground }">
    <span
      v-for="(hour, index) in hours"
      :key="hour"
      class="rule"
      :style="{ top: percentOf(index * 60, rangeMinutes) }"
    />
    <div class="blocks" :style="{ '--gap': `${blockGap}px` }">
      <WeekBlock
        v-for="block in blocks"
        :key="block.event.id"
        :block="block"
        :range-minutes="rangeMinutes"
        :locations-on="locationsOn"
      />
      <!-- Blocks that had no track left, counted where they start. Over the blocks, with a ring in the tile's colour to lift it off them. -->
      <div
        v-for="chip in overflow"
        :key="chip.top"
        class="overflow"
        :style="{ top: percentOf(chip.top, rangeMinutes) }"
        data-testid="overflow"
      >
        +{{ chip.count }}
      </div>
    </div>
    <WeekNowLine
      v-if="now && now.column === day.column && typeof now.position === 'number'"
      :top="percentOf(now.position, rangeMinutes)"
    />
  </div>
</template>

<style scoped>
/* `.portrait` is a class of the week's root. */
.hours {
  position: relative;
  grid-row: 4;
  min-height: 0;
}

.rule {
  position: absolute;
  right: 14px;
  left: 14px;
  height: 2px;
  background: var(--line);
}

/* Blocks are placed in minutes, as percentages of this box. */
.blocks {
  position: absolute;
  inset: 0 8px;
}

/* The count of what did not fit, on the right edge at the hidden blocks' start. */
.overflow {
  position: absolute;
  right: 0;
  z-index: 3;
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--accent);
  box-shadow: 0 0 0 3px var(--tile-bg);
  color: var(--on-accent);
  font-size: 17px;
  font-weight: 700;
  line-height: 1.3;
  transform: translateY(-35%);
}

.portrait .rule {
  right: 10px;
  left: 10px;
}

.portrait .blocks {
  inset: 0 2px 0 6px;
}
</style>
