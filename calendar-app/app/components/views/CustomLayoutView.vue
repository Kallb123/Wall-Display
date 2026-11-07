<script setup lang="ts">
import type { ViewProps } from '../../utils/views'

// The custom layout view (PR 5.17). A placeholder until the display work
// draws the layout's panes: it says there is nothing to show.
defineProps<ViewProps>()
</script>

<template>
  <div class="custom-layout-empty">
    No layout
  </div>
</template>

<style scoped>
.custom-layout-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--text-muted, currentColor);
  font-size: 48px;
}
</style>
