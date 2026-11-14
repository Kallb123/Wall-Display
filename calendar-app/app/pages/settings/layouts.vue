<script setup lang="ts">
import type { DisplaySettings } from '../../../shared/display'
import type { DisplayStatus, PhotoFeedChoice, PhotosSettingsStatus } from '../../../shared/settings'

// The Layouts tab (architecture §7.6): the shared library of custom layouts,
// to add, edit, copy, delete and put on a wall. All of that is the manager's;
// this page tells it which displays there are (and what each shows now, to mark
// the layouts in use), whether a photo source is set up, and which photo feeds
// are, for the photo pane's "Photos from".

useHead({ title: 'Layouts · Settings' })

const { data: statuses } = usePolledFetch<DisplayStatus[]>('/api/settings/displays', 5_000)
const displays = computed(() => (statuses.value ?? []).map(status => ({
  id: status.id,
  name: status.name,
  layout: status.state.view === 'custom' ? status.state.layout : null,
})))

/** The feeds a photo pane can draw from. Null until the server has said, which leaves the choice out rather than showing an empty one. */
const photoFeeds = ref<PhotoFeedChoice[] | null>(null)

/** Until the server has said, assume photos are available: a layout that has them stays editable either way. */
const photosConfigured = ref(true)
onMounted(async () => {
  try {
    const all = await $fetch<DisplaySettings[]>('/api/displays')
    photosConfigured.value = all.some(display => display.photo_sources.length > 0)
  } catch {
    // The manager reports an unreachable server itself.
  }
  try {
    const status = await $fetch<PhotosSettingsStatus>('/api/settings/photos')
    photoFeeds.value = status.configured ? status.feeds : []
  } catch {
    // Without them a layout keeps the feed it has, and the choice is not offered.
  }
})
</script>

<template>
  <div class="layouts-page" data-testid="layouts-page">
    <p class="intro">
      A layout puts several views on the wall at once, such as a photo beside the week. Each has one arrangement for a landscape wall and one for a portrait wall.
    </p>
    <LayoutsManager :displays="displays" :photos-configured="photosConfigured" :photo-feeds="photoFeeds" />
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
