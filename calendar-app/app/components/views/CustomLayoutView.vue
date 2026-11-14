<script setup lang="ts">
import type { Component } from 'vue'
import type { View } from '../../../shared/display'
import { paneOptions } from '../../../shared/layouts'
import type { LayoutComponent } from '../../../shared/layouts'
import { bleeds, edgeBleed, NO_BLEED, PANE_RADIUS, paneClipPath } from '../../utils/bleed'
import type { Bleed } from '../../utils/bleed'
import { layoutPanes, paneFit } from '../../utils/layouts'
import type { PaneBox, RoundedCorners } from '../../utils/layouts'
import type { ViewProps } from '../../utils/views'
import AgendaView from './AgendaView.vue'
import DayGridView from './DayGridView.vue'
import MonthSoftView from './MonthSoftView.vue'
import PhotoView from './PhotoView.vue'
import StarChartView from './StarChartView.vue'
import WeekPartsView from './WeekPartsView.vue'
import WeekView from './WeekView.vue'

// The custom layout view (PR 5.17, architecture §4.8): a user's arrangement of
// the ordinary view components, each in a pane of the stage. It adds no view of
// its own. It cuts the stage into panes (`layoutPanes`, the arrangement for the
// stage's orientation) and gives each to the view that draws it, as the week and
// photo view does for its two, telling each it is a pane unless the layout is
// that view alone.
//
// A pane smaller than its view was designed for (`paneFit`) is not squeezed:
// the view is laid out on a virtual stage at its minimum size, and that is
// scaled down to the pane with a transform, so nothing overflows or clips. The
// photo frame needs no minimum and draws to any box. The photo pane gets the
// rounded inner corners of the week and photo view (all square when its
// `rounded_corners` option is off), and the tile colour until
// the first photo has loaded. A takeover's palette is the stage's and reaches
// every calendar pane; the photo covers its own.
//
// While burn-in shifting is on, a photo pane on the stage's edge draws its photo
// past the edge (`edgeBleed`, utils/bleed.ts), so the strip the shift uncovers
// beside it is photo and not the ground. The pane is then clipped to an outline
// (`paneClipPath`) rather than by its own box, which takes in the bleed and keeps
// the rounded corners where they are, and the view does not clip to the stage.
const props = defineProps<ViewProps>()

const components: Record<LayoutComponent, Component> = {
  month: MonthSoftView,
  week: WeekView,
  week_parts: WeekPartsView,
  agenda: AgendaView,
  photo: PhotoView,
  days: DayGridView,
  stars: StarChartView,
}

const arrangement = computed(() => {
  const layout = props.layout
  if (!layout) return null
  return props.stage.orientation === 'portrait' ? layout.portrait : layout.landscape
})

const panes = computed(() => {
  if (!arrangement.value) return []
  return layoutPanes(arrangement.value, props.stage).map((box) => {
    const options = paneOptions(props.layout, box.component)
    const bleed = box.component === 'photo' ? edgeBleed(box, props.stage, props.burnIn ?? false) : NO_BLEED
    return { box, options, bleed, fit: paneFit(box.component, box, box.grid, options, box.starGrid) }
  })
})

/** Whether any pane draws past the stage's edge, when the view must not clip to it. */
const anyBleed = computed(() => panes.value.some(({ bleed }) => bleeds(bleed)))

/** A layout of one pane fills the stage, so its view is the full view and not a pane of one. */
const single = computed(() => panes.value.length === 1)

/** The view a pane tells its component it is: its own, or `custom` for a component that is not a view (the day grid and the star chart). */
const viewOf = (component: LayoutComponent): View => (component === 'days' || component === 'stars' ? 'custom' : component)

const SQUARE: RoundedCorners = { topLeft: false, topRight: false, bottomRight: false, bottomLeft: false }

const boxStyle = (box: PaneBox, bleed: Bleed, roundedCorners: boolean) => {
  const rounded = roundedCorners ? box.rounded : SQUARE
  return {
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    ...(box.component === 'photo' && (bleeds(bleed)
      ? { clipPath: paneClipPath(box.width, box.height, rounded, bleed), '--bleed': `${Math.max(bleed.top, bleed.right, bleed.bottom, bleed.left)}px` }
      : { borderRadius: [rounded.topLeft, rounded.topRight, rounded.bottomRight, rounded.bottomLeft].map(round => round ? `${PANE_RADIUS}px` : '0').join(' ') })),
  }
}
</script>

<template>
  <section v-if="panes.length" class="view" :class="{ bleeding: anyBleed }" data-testid="custom-layout-view">
    <div
      v-for="{ box, fit, options, bleed } in panes"
      :key="box.component"
      class="pane"
      :class="{ photo: box.component === 'photo', bleeding: bleeds(bleed) }"
      :style="boxStyle(box, bleed, options.rounded_corners)"
      :data-testid="`layout-pane-${box.component}`"
    >
      <div
        class="virtual-stage"
        :style="{ width: `${fit.stage.width}px`, height: `${fit.stage.height}px`, transform: fit.scale === 1 ? undefined : `scale(${fit.scale})` }"
        :data-scale="fit.scale"
      >
        <component :is="components[box.component]" v-bind="props" :view="viewOf(box.component)" :stage="fit.stage" :pane="!single" :day-grid="box.grid" :star-grid="box.starGrid" :pane-options="options" :bleed="bleeds(bleed) ? bleed : undefined" />
      </div>
    </div>
  </section>
  <div v-else class="empty" data-testid="custom-layout-empty">
    No layout
  </div>
</template>

<style scoped>
.view {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

/* The pane's box on the stage, which clips whatever the view draws beyond it. */
.pane {
  position: absolute;
  overflow: hidden;
  isolation: isolate;
}

.pane.photo {
  background: var(--tile);
}

/* Clipped by its outline (`paneClipPath`), which takes in the bleed; the shadow is the tile colour under it until the first photo has loaded. */
.pane.bleeding {
  overflow: visible;
  box-shadow: 0 0 0 var(--bleed) var(--tile);
}

/* A pane draws past the stage's edge, and the stage clips it. */
.view.bleeding {
  overflow: visible;
}

/* The view is laid out at this size, which is the pane's or, for a pane that is too small, the view's minimum; the transform shrinks it to the pane. */
.virtual-stage {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
}

.empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted, currentColor);
  font-family: var(--font-display);
  font-size: 96px;
}
</style>
