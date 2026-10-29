<script setup lang="ts">
// The settings pages' button: a pill, plain or in the accent. Everything else
// (`disabled`, `title`, `@click`, `data-testid`) falls through to the <button>.
withDefaults(defineProps<{
  variant?: 'plain' | 'primary'
}>(), { variant: 'plain' })
</script>

<template>
  <button type="button" class="button" :class="variant">
    <slot />
  </button>
</template>

<style scoped>
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 48px;
  padding: 0 24px;
  border: 2px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  touch-action: manipulation;
}

.button.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}

.button:disabled {
  opacity: 0.6;
  cursor: default;
}

.button:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 3px;
}
</style>
