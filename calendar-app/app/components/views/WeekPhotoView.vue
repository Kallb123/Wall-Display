<script setup lang="ts">
import { bleeds, edgeBleed, paneClipPath } from '../../utils/bleed'
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
//
// While burn-in shifting is on, the photo is drawn past the three sides it has
// on the stage's edge (`edgeBleed`, utils/bleed.ts), so the strip the shift
// uncovers there is photo and not the ground. The pane is then clipped to an
// outline that takes in the bleed (`paneClipPath`) instead of by `overflow`,
// with its rounded corners where they were, and the view does not clip to the stage.
const props = defineProps<ViewProps>()

const panes = computed(() => weekPhotoPanes(props.stage))
const portrait = computed(() => props.stage.orientation === 'portrait')

/** How far the photo is drawn past the stage's edge on each side: it is at the top left of the stage. */
const bleed = computed(() => edgeBleed({ x: 0, y: 0, ...panes.value.photo }, props.stage, props.burnIn ?? false))

const photoStyle = computed(() => ({
  width: `${panes.value.photo.width}px`,
  height: `${panes.value.photo.height}px`,
  ...(bleeds(bleed.value) && {
    clipPath: paneClipPath(panes.value.photo.width, panes.value.photo.height, portrait.value
      ? { topLeft: false, topRight: false, bottomRight: true, bottomLeft: true }
      : { topLeft: false, topRight: true, bottomRight: true, bottomLeft: false }, bleed.value),
    '--bleed': `${Math.max(bleed.value.top, bleed.value.right, bleed.value.bottom, bleed.value.left)}px`,
  }),
}))
</script>

<template>
  <section class="view" :class="[portrait ? 'portrait' : 'landscape', { bleeding: bleeds(bleed) }]" data-testid="week-photo-view">
    <div
      class="photo-pane"
      :class="{ bleeding: bleeds(bleed) }"
      :style="photoStyle"
      data-testid="week-photo-photo-pane"
    >
      <PhotoView v-bind="props" :stage="panes.photo" pane :bleed="bleeds(bleed) ? bleed : undefined" />
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

/* Clipped by its outline (`paneClipPath`), which takes in the bleed, in place of the rounded corners above; the shadow is the tile colour under it until the first photo has loaded. */
.photo-pane.bleeding {
  overflow: visible;
  border-radius: 0;
  box-shadow: 0 0 0 var(--bleed) var(--tile);
}

/* The photo draws past the stage's edge, and the stage clips it. */
.view.bleeding {
  overflow: visible;
}

.week-pane {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
</style>
