<script setup lang="ts">
import { badgesOf } from '~/utils/monthPanel'
import { eventLabel } from '~/utils/eventLabel'
import type { FittedPanelDay } from '~/utils/monthPanel'
import { eventFill } from '~/utils/eventFill'

// A day's rows in the Soft month view's panel: a badge for each person, the time
// (or "All day"), the title, and a "+N more" row when the day was trimmed. The
// landscape panel, the portrait band and the portrait strip's cards all list a
// day this way, so it lives here once; `size` is the only thing that differs.
// `roomy` has a little more air between rows than the landscape side panel, which
// the portrait band has the height for, and `card` is the strip's smaller type.
// The sizes are not named `panel`, `band` or `side`: the parent's scoped styles of
// those names would reach this component's root element.
//
// `fill` (the "colour whole events" pane option) draws each row as a pill in its
// fill, as the grid's bars are (split between the people when there are several,
// `eventFill`), or the surface colour with nobody on it; the badges sit inside at
// the left, unless `initials` is false, which leaves them out and the title the
// room (only asked for with `fill`, the parent decides). Every row is marked as an item for
// `useWrapFit`: it only does anything where the parent has put the list in a
// `[data-wrap-box]`, and then a row with `data-wrap="on"` lets its title wrap.
defineProps<{
  day: FittedPanelDay
  size?: 'standard' | 'roomy' | 'card'
  fill?: boolean
  /** Draw the initials badges. False leaves them out of the rows, with their column. */
  initials?: boolean
}>()

/** A filled row's background and the ring of its overlapping badges. */
function fillStyle(people: readonly { colour: string }[]) {
  const { background, ring } = eventFill(people)
  return { background, '--ring': ring }
}
</script>

<template>
  <div class="rows" :class="[size ?? 'standard', { plain: initials === false }]">
    <div
      v-for="row in day.rows"
      :key="row.item.event.id"
      class="row"
      :class="{ past: row.past, filled: fill }"
      :style="fill ? fillStyle(row.item.people) : undefined"
      data-kind="panel"
      data-testid="event"
      data-wrap-item
    >
      <span v-if="initials !== false" class="badges">
        <span
          v-for="badge in badgesOf(row.item)"
          :key="badge.id"
          class="badge"
          :style="{ background: badge.colour }"
        >{{ badge.initial }}</span>
      </span>
      <span class="time">{{ row.item.time ?? 'All day' }}</span>
      <span class="name">{{ eventLabel(row.item.event) }}</span>
    </div>
    <div v-if="day.more" class="row more-row" data-testid="panel-more">
      <span v-if="initials !== false" class="badges" />
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

/* Without the badges there are two columns, the time and the title. */
.rows.plain {
  grid-template-columns: auto minmax(0, 1fr);
}

/* "Colour whole events": a pill in the person's fill. It is a little taller than the bare row, so the badge sits inside it with a hair of the fill around it. */
.row.filled {
  padding: 2px 18px 2px 2px;
  border-radius: 999px;
  color: var(--bar-text);
}

.rows.plain .row.filled {
  padding: 6px 18px;
}

.row.filled .time {
  color: inherit;
  opacity: 0.8;
}

/*
 * "Wrap long titles", where there is room (the parent's box was measured and this
 * row may grow): the title takes as many lines as it needs, up to three, and the
 * badge and the time stay level with its first line. Each cell has a margin to the
 * badge's height so that a one-line row is exactly as tall as it was.
 */
.row[data-wrap='on'] {
  align-items: start;
}

.row[data-wrap='on'] .time,
.row[data-wrap='on'] .name {
  margin-block: calc((var(--badge, 40px) - 1.3em) / 2);
}

.row[data-wrap='on'] .name {
  display: -webkit-box;
  overflow-wrap: anywhere;
  white-space: normal;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
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
  --badge: 32px;
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
