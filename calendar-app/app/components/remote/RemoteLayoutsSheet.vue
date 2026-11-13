<script setup lang="ts">
import { X } from 'lucide-vue-next'
import type { CustomLayout } from '../../../shared/layouts'

// The edit sheet: the layouts manager, on a sheet that fills the screen. The page
// holds the layouts, so this passes what the manager says up (`changed`).

defineProps<{
  /** What the manager marks as "shown on": this display, and the layout it is on. */
  displays: { id: string, name: string, layout: string | null }[]
  photosConfigured: boolean
  /** The library as the socket last sent it, if it has. */
  live: CustomLayout[] | null | undefined
}>()

const emit = defineEmits<{
  changed: [layouts: CustomLayout[]]
  close: []
}>()
</script>

<template>
  <div class="scrim editor-scrim" data-testid="layouts-sheet">
    <div class="sheet layouts-sheet" role="dialog" aria-modal="true" aria-labelledby="layouts-sheet-title" @keydown.esc="emit('close')">
      <header class="sheet-head">
        <h2 id="layouts-sheet-title" class="sheet-title">
          Edit layouts
        </h2>
        <button type="button" class="dismiss" aria-label="Close" data-testid="layouts-close" @click="emit('close')">
          <AppIcon :icon="X" :size="22" />
        </button>
      </header>
      <LayoutsManager compact :displays="displays" :photos-configured="photosConfigured" :live="live" @changed="emit('changed', $event)" />
    </div>
  </div>
</template>

<style scoped src="../../assets/remote-base.css"></style>
<style scoped src="../../assets/remote-sheet.css"></style>

<style scoped>
.editor-scrim {
  z-index: 5;
}

/* The edit sheet fills the screen, and scrolls inside itself. */
.layouts-sheet {
  height: 100dvh;
  max-height: 100dvh;
  overflow-y: auto;
  border-radius: 0;
  padding-top: max(20px, env(safe-area-inset-top));
}

.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
