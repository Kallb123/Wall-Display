<script setup lang="ts">
import type { Component } from 'vue'

// A tab whose page comes in a later PR: a calm card that says what will be here.
defineProps<{
  icon: Component
  title: string
}>()
</script>

<template>
  <SettingsCard class="placeholder">
    <span class="badge">
      <AppIcon :icon="icon" :size="30" />
    </span>
    <div>
      <h2 class="heading">
        {{ title }}
      </h2>
      <p class="text">
        <slot />
      </p>
    </div>
  </SettingsCard>
</template>

<style scoped>
.placeholder {
  flex-direction: row;
  align-items: flex-start;
  gap: 24px;
  padding: 36px 40px;
}

.badge {
  display: grid;
  flex: none;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--panel);
  color: var(--panel-text);
}

.heading {
  margin: 0 0 8px;
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 400;
}

.text {
  max-width: 60ch;
  margin: 0;
  color: var(--muted);
  font-size: 17px;
  font-weight: 500;
  line-height: 1.5;
}
</style>
