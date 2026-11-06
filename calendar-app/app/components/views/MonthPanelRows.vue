<script setup lang="ts">
import { badgesOf } from '~/utils/monthPanel'
import type { FittedPanelDay } from '~/utils/monthPanel'

// A day's rows in the Soft month view's panel: a badge for each person, the time
// (or "All day"), the title, and a "+N more" row when the day was trimmed. The
// landscape panel, the portrait band and the portrait strip's cards all list a
// day this way, so it lives here once; `size` is the only thing that differs.
// `roomy` has a little more air between rows than the landscape side panel, which
// the portrait band has the height for, and `card` is the strip's smaller type.
// The sizes are not named `panel`, `band` or `side`: the parent's scoped styles of
// those names would reach this component's root element.
defineProps<{
  day: FittedPanelDay
  size?: 'standard' | 'roomy' | 'card'
}>()
</script>

<template>
  <div class="rows" :class="size ?? 'standard'">
    <div
      v-for="row in day.rows"
      :key="row.item.event.id"
      class="row"
      :class="{ past: row.past }"
      data-kind="panel"
      data-testid="event"
    >
      <span class="badges">
        <span
          v-for="badge in badgesOf(row.item)"
          :key="badge.id"
          class="badge"
          :style="{ background: badge.colour }"
        >{{ badge.initial }}</span>
      </span>
      <span class="time">{{ row.item.time ?? 'All day' }}</span>
      <span class="name">{{ row.item.event.display_title }}</span>
    </div>
    <div v-if="day.more" class="row more-row" data-testid="panel-more">
      <span class="badges" />
      <span class="time">+{{ day.more }} more</span>
    </div>
  </div>
</template>

<style scoped>
/* A day's rows share their columns (a subgrid), so the times line up even when an event has several badges or "Until 11:30" is wider than "09:00". */
.rows {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  row-gap: 10px;
}

.row {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: subgrid;
  align-items: center;
  column-gap: 14px;
  font-size: 26px;
  line-height: 1.3;
  --ring: var(--panel);
}

.row.past {
  opacity: 0.45;
}

.row .time {
  min-width: 100px;
  color: var(--panel-muted);
  font-size: 23px;
  font-weight: 700;
}

.row .name {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The badge column is at least one badge wide, so an event with nobody on it still lines up. */
.row .badges {
  min-width: 40px;
  min-height: 40px;
  align-items: center;
}

.badge {
  display: grid;
  flex: none;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  color: var(--color-neutral-900);
  font-size: 19px;
  font-weight: 700;
}

.badges {
  display: flex;
  flex: none;
}

/* Overlapping circles for an event shared by several people, ringed in whatever they sit on. */
.badge + .badge {
  margin-left: -12px;
}

.badges:has(.badge + .badge) .badge {
  box-shadow: 0 0 0 3px var(--ring);
}

/* The portrait band: the same type, with the room between rows the mock gives it. */
.rows.roomy {
  row-gap: 14px;
}

/* The portrait strip's cards (mock 4a): smaller, on the tile colour rather than the panel's. */
.rows.card {
  row-gap: 14px;
}

.rows.card .row {
  column-gap: 12px;
  font-size: 24px;
  --ring: var(--tile);
}

.rows.card .row .time {
  min-width: 96px;
  font-size: 21px;
}

.rows.card .row .badges {
  min-width: 32px;
  min-height: 32px;
}

.rows.card .badge {
  width: 32px;
  height: 32px;
  font-size: 16px;
}

.rows.card .badge + .badge {
  margin-left: -10px;
}
</style>
