<script setup lang="ts">
import { weekPhotoPanes } from '../../utils/views'
import type { ViewProps } from '../../utils/views'
import PhotoView from './PhotoView.vue'
import WeekView from './WeekView.vue'

// The week and photo hybrid (PR 5.14, architecture §4.6, mocks 4k, 4l and 4o):
// the photo frame in one pane and the week in the other, on the portrait stage
// the photo on top and on the landscape stage the photo on the left. It adds no
// view of its own. It cuts the stage in two (`weekPhotoPanes`) and gives each
// pane to the view that draws it, which is told it is a pane: the photo frame
// then has the compact pill without the next event, and the week the short
// title. Each pane asks for what suits its own shape, so the photo is fetched
// in the rendition for the pane and the week is always the narrow layout.
//
// The photo pane's far corners are rounded (the lower two on the portrait
// stage, the right two on the landscape one) so it sits like a card on the
// stage; `overflow: hidden` clips the photo to them. It is tinted with the
// tile colour until the first photo has loaded. A takeover's palette is the
// stage's and so reaches the week; the photo covers its own pane.
const props = defineProps<ViewProps>()

const panes = computed(() => weekPhotoPanes(props.stage))
const portrait = computed(() => props.stage.orientation === 'portrait')
</script>

<template>
  <section class="view" :class="portrait ? 'portrait' : 'landscape'" data-testid="week-photo-view">
    <div
      class="photo-pane"
      :style="{ width: `${panes.photo.width}px`, height: `${panes.photo.height}px` }"
      data-testid="week-photo-photo-pane"
    >
      <PhotoView v-bind="props" :stage="panes.photo" pane />
    </div>
    <div class="week-pane" data-testid="week-photo-week-pane">
      <WeekView v-bind="props" :stage="panes.week" pane />
    </div>
  </section>
</template>

<style scoped>
.view {
  position: absolute;
  inset: 0;
  display: flex;
  overflow: hidden;
}

.portrait {
  flex-direction: column;
}

.landscape {
  flex-direction: row;
}

.photo-pane {
  position: relative;
  flex: none;
  overflow: hidden;
  isolation: isolate;
  background: var(--tile);
}

.portrait .photo-pane {
  border-radius: 0 0 64px 64px;
}

.landscape .photo-pane {
  border-radius: 0 64px 64px 0;
}

.week-pane {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
</style>
