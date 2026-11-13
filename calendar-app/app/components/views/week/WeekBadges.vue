<script setup lang="ts">
import { weekBadgesOf } from '~/utils/weekView'
import type { ItemPeople } from '../../../../shared/month-layout'

// The overlapping initials circles at the start of an event in the week view: a
// bar, a block or a band item. Nothing is drawn for an event with nobody on it.
// The circles are ringed in `--ring`, which the event sets to its own fill.
defineProps<{ item: ItemPeople }>()
</script>

<template>
  <span v-if="item.initials.length" class="badges">
    <span
      v-for="badge in weekBadgesOf(item)"
      :key="badge.id"
      class="badge"
      :style="{ background: badge.colour }"
    >{{ badge.initial }}</span>
  </span>
</template>

<style scoped>
.badges {
  display: flex;
  flex: none;
}

.badge {
  display: grid;
  flex: none;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  color: var(--color-neutral-900);
  font-size: 14px;
  font-weight: 700;
}

.badge + .badge {
  margin-left: -8px;
}

/* Overlapping circles for an event shared by several people, ringed in whatever they sit on. */
.badges:has(.badge + .badge) .badge {
  box-shadow: 0 0 0 2px var(--ring);
}

/* Smaller in a block on the portrait stage. (`.portrait` is the week's root and `.block` the block's: only the badge is this component's.) */
.portrait .block .badge {
  width: 22px;
  height: 22px;
  font-size: 13px;
}
</style>
