<script setup lang="ts">
// The small mark beside a part of a day's look: where its value comes from.
// "From Birthday" says the day is using its scene's; "Changed" says the day has
// its own, with Reset to go back to the scene's. A day with no scene has
// nothing to compare with, so no mark.
defineProps<{
  origin: 'scene' | 'own' | null
  sceneName: string
}>()

const emit = defineEmits<{
  reset: []
}>()
</script>

<template>
  <span v-if="origin === 'scene'" class="mark from" data-testid="mark-from">From {{ sceneName }}</span>
  <span v-else-if="origin === 'own'" class="group">
    <span class="mark changed" data-testid="mark-changed">Changed</span>
    <button type="button" class="reset" :aria-label="`Reset to ${sceneName}`" data-testid="reset" @click="emit('reset')">Reset</button>
  </span>
</template>

<style scoped>
.group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.mark {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}

.from {
  background: var(--bg);
  color: var(--muted);
}

.changed {
  background: color-mix(in oklch, var(--accent) 22%, var(--surface));
  color: var(--text);
}

.reset {
  min-height: 32px;
  padding: 0 8px;
  border: 0;
  background: none;
  color: var(--accent-ink);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
  touch-action: manipulation;
}

.reset:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
</style>
