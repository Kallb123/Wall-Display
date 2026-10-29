<script setup lang="ts">
import type { SettingsPerson } from '../../../shared/settings'

// A person's coloured initial: the same circle the wall puts on their events.
withDefaults(defineProps<{
  person: Pick<SettingsPerson, 'initial' | 'colour'>
  size?: number
}>(), { size: 40 })
</script>

<template>
  <span class="badge" :style="{ background: person.colour, width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.5)}px` }" aria-hidden="true">{{ person.initial }}</span>
</template>

<style scoped>
.badge {
  display: inline-grid;
  flex: none;
  place-items: center;
  border-radius: 50%;
  /* The text colour the wall's badges use: dark on every person's colour. */
  color: var(--color-neutral-900);
  font-weight: 700;
  line-height: 1;
}
</style>
