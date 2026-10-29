<script setup lang="ts">
import type { ChipStatus } from '~/utils/settings'

// "MQTT  Connected": a name, a state with a dot, and, when there is a reason
// (an error), the reason underneath. It is also the tooltip, but the page is
// used on a tablet, where there is no hover.
defineProps<{
  /** Left out where a label beside the chip already names it. */
  name?: string
  status: ChipStatus
}>()
</script>

<template>
  <div class="chip" :data-tone="status.tone" :title="status.detail ?? undefined">
    <p class="line">
      <span class="dot" aria-hidden="true" />
      <span v-if="name" class="name">{{ name }}</span>
      <span class="state">{{ status.label }}</span>
    </p>
    <p v-if="status.detail" class="detail">
      {{ status.detail }}
    </p>
  </div>
</template>

<style scoped>
.chip {
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-sizing: border-box;
  min-height: 40px;
  max-width: 320px;
  justify-content: center;
  padding: 6px 16px;
  border-radius: 20px;
  background: var(--surface);
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
}

.line,
.detail {
  margin: 0;
}

.line {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}

.name {
  color: var(--text);
}

/* With a name the state is the secondary word; on its own it is the whole message. */
.name + .state {
  color: var(--muted);
}

.state {
  color: var(--text);
}

.dot {
  flex: none;
  box-sizing: border-box;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent2);
}

/* Partly working: the accent, pulsing as the remote's "Reconnecting" does. */
.chip[data-tone='warn'] .dot {
  background: var(--accent);
  animation: pulse 1.2s ease-in-out infinite;
}

/* Broken: the accent, solid. */
.chip[data-tone='bad'] .dot {
  background: var(--accent-ink);
}

/* Not in use: an empty ring. */
.chip[data-tone='off'] .dot {
  border: 2px solid var(--muted);
  background: none;
}

.detail {
  max-width: 280px;
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
</style>
