<script setup lang="ts">
import { monthNameOf } from '~/utils/monthSoft'

// The month's heading, "October 2026", in the display face: the month large and
// the year smaller and quieter. The name comes from the month itself, as the
// shown month is not always the one `now` is in.
const props = defineProps<{
  /** The month shown, `2026-10`. */
  month: string
}>()

const monthName = computed(() => monthNameOf(props.month))
const year = computed(() => props.month.slice(0, 4))
</script>

<template>
  <h1 class="title" data-testid="month-title">
    <!-- The space is for the text ("October 2026"); between flex items it takes no room. -->
    <span class="month">{{ monthName }}</span>{{ ' ' }}<span class="year">{{ year }}</span>
  </h1>
</template>

<style scoped>
.title {
  display: flex;
  align-items: baseline;
  gap: 20px;
  margin: 0;
  padding-left: 12px;
  font-family: var(--font-display);
  font-weight: 400;
  line-height: 1;
}

.month {
  font-size: 88px;
  letter-spacing: -0.02em;
}

.year {
  color: var(--muted);
  font-size: 44px;
}
</style>
