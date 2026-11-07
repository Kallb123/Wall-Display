<script setup lang="ts">
import type { DisplaySettings } from '../../../shared/display'
import type { DisplayStatus } from '../../../shared/settings'

// The Layouts tab (architecture §7.6): the shared library of custom layouts,
// to add, edit, copy, delete and put on a wall. All of that is the manager's;
// this page tells it which displays there are (and what each shows now, to mark
// the layouts in use) and whether a photo source is set up.

useHead({ title: 'Layouts · Settings' })

const { data: statuses } = usePolledFetch<DisplayStatus[]>('/api/settings/displays', 5_000)
const displays = computed(() => (statuses.value ?? []).map(status => ({
  id: status.id,
  name: status.name,
  layout: status.state.view === 'custom' ? status.state.layout : null,
})))

/** Until the server has said, assume photos are available: a layout that has them stays editable either way. */
const photosConfigured = ref(true)
onMounted(async () => {
  try {
    const all = await $fetch<DisplaySettings[]>('/api/displays')
    photosConfigured.value = all.some(display => display.photo_sources.length > 0)
  } catch {
    // The manager reports an unreachable server itself.
  }
})
</script>

<template>
  <div class="layouts-page" data-testid="layouts-page">
    <p class="intro">
      A layout puts several views on the wall at once, such as a photo beside the week. Each has one arrangement for a landscape wall and one for a portrait wall.
    </p>
    <LayoutsManager :displays="displays" :photos-configured="photosConfigured" />
  </div>
</template>

<style scoped>
.layouts-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.intro {
  margin: 0;
  color: var(--muted);
  font-size: 17px;
  font-weight: 500;
}
</style>
