<script setup lang="ts">
import { eventLabel } from '~/utils/eventLabel'
import { BAND_SHOWN } from '~/utils/weekView'
import type { Band, NowLine, WeekDay } from '../../../../shared/week-layout'
import WeekBadges from './WeekBadges.vue'
import WeekNowLine from './WeekNowLine.vue'

// A folded band, the hours before the first one drawn (`early`, grid row 3) or
// after the last (`late`, row 5): a label in the gutter, and in each column a cell
// with a dashed edge towards the hours, holding what is wholly inside the band.
// It has several elements for the grid and no wrapper, so they are the grid's own
// children. The cells show the first item and a "+N" for the rest. The now line is
// drawn when now falls in this band.
const props = defineProps<{
  band: Band
  edge: 'early' | 'late'
  days: WeekDay[]
  now: NowLine | null
  /** Whether the hour labels are drawn: the band's label goes with them. */
  showHours: boolean
}>()

const row = computed(() => props.edge === 'early' ? 3 : 5)

/** A band's cell in a column: its items by start time. */
const itemsIn = (column: number) => props.band.items[column] ?? []
</script>

<template>
  <div v-if="showHours" class="band-label" :style="{ gridRow: row }">
    {{ band.label }}
  </div>
  <div
    v-for="day in days"
    :key="`${edge}-${day.date}`"
    class="band"
    :class="edge"
    :style="{ gridColumn: day.column + 2, gridRow: row }"
  >
    <div
      v-for="item in itemsIn(day.column).slice(0, BAND_SHOWN)"
      :key="item.event.id"
      class="chip"
      :class="{ past: item.past }"
      :style="{ '--ring': 'transparent' }"
      data-testid="band-item"
      :data-band="edge"
    >
      <WeekBadges :item="item" />
      <span class="time">{{ item.time }}</span>
      <span class="name">{{ eventLabel(item.event) }}</span>
    </div>
    <span v-if="itemsIn(day.column).length > BAND_SHOWN" class="chip-more">+{{ itemsIn(day.column).length - BAND_SHOWN }}</span>
    <!-- The now line, when now is in this band. -->
    <WeekNowLine v-if="now && now.column === day.column && now.position === edge" :edge="edge" />
  </div>
</template>

<style scoped>
/* `.portrait` is a class of the week's root. */
/* A folded band: dashed above and below, so it reads as hours squeezed out rather than a row of events. */
.band-label {
  display: flex;
  grid-column: 1;
  align-items: center;
  justify-content: flex-end;
  padding-right: 8px;
  color: var(--faint);
  font-size: 18px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.band {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 0 14px;
  border-top: 2px dashed var(--line);
  border-bottom: 2px dashed var(--line);
  overflow: hidden;
}

/* Only the edge towards the hours is dashed; the outer one would sit on the tile's own edge. */
.band.early {
  border-top-color: transparent;
}

.band.late {
  border-bottom-color: transparent;
}

.chip {
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 19px;
  font-weight: 600;
  white-space: nowrap;
}

.chip.past {
  opacity: 0.45;
}

.chip .time {
  flex: none;
  color: var(--muted);
  font-weight: 700;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.chip-more {
  flex: none;
  color: var(--accent-ink);
  font-size: 19px;
  font-weight: 700;
}

/* The gutter is 64 px wide: the label ("00–07") stays on one line. */
.portrait .band-label {
  padding-right: 4px;
  font-size: 16px;
  letter-spacing: 0;
  white-space: nowrap;
}

/* A column has no room for a time beside the title in the band either. */
.portrait .band {
  padding: 0 8px;
}

.portrait .chip {
  font-size: 18px;
}

.portrait .chip .time {
  display: none;
}
</style>
