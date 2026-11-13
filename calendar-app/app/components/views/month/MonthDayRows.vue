<script setup lang="ts">
import MonthPanelRows from '../MonthPanelRows.vue'
import type { FittedPanelDay } from '~/utils/monthPanel'

// A day's rows, or "Nothing planned" when it has neither rows nor a "+N more".
// The portrait band and every panel day or card list a day this way; the props
// besides `day` are those of `MonthPanelRows`, passed on as they are.
defineProps<{
  day: FittedPanelDay
  size?: 'standard' | 'roomy' | 'card'
  fill?: boolean
  initials?: boolean
  locations?: boolean
}>()
</script>

<template>
  <p v-if="!day.rows.length && !day.more" class="nothing">
    Nothing planned
  </p>

  <MonthPanelRows v-else :day="day" :size="size" :fill="fill" :initials="initials" :locations="locations" />
</template>

<style scoped>
.nothing {
  margin: 0;
  color: var(--panel-muted);
  font-size: 26px;
  font-weight: 600;
  line-height: 1.3;
}
</style>
