<script setup lang="ts">
import { Info, TriangleAlert } from 'lucide-vue-next'

// A line or two the page wants noticed: a failure (tinted with the accent, as
// the remote does for a problem, and with an icon so it never relies on colour
// alone) or a plain note.
withDefaults(defineProps<{
  tone?: 'error' | 'note'
}>(), { tone: 'note' })
</script>

<template>
  <div class="notice" :class="tone" :role="tone === 'error' ? 'alert' : 'status'">
    <AppIcon :icon="tone === 'error' ? TriangleAlert : Info" :size="22" />
    <div class="text">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.notice {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 18px;
  border-radius: 20px;
  background: var(--bg);
  color: var(--muted);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
}

.notice > :first-child {
  flex: none;
  margin-top: 1px;
}

.text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.notice.error {
  background: color-mix(in oklch, var(--accent) 16%, var(--surface));
  box-shadow: inset 0 0 0 2px color-mix(in oklch, var(--accent) 45%, transparent);
  color: var(--text);
}

.notice.error > :first-child {
  color: var(--accent-ink);
}
</style>
