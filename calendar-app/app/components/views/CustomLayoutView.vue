<script setup lang="ts">
import type { Component } from 'vue'
import type { View } from '../../../shared/display'
import type { LayoutComponent } from '../../../shared/layouts'
import { layoutPanes, paneFit } from '../../utils/layouts'
import type { PaneBox } from '../../utils/layouts'
import type { ViewProps } from '../../utils/views'
import AgendaView from './AgendaView.vue'
import DayGridView from './DayGridView.vue'
import MonthSoftView from './MonthSoftView.vue'
import PhotoView from './PhotoView.vue'
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
// rounded inner corners of the week and photo view, and the tile colour until
// the first photo has loaded. A takeover's palette is the stage's and reaches
// every calendar pane; the photo covers its own.
const props = defineProps<ViewProps>()

const components: Record<LayoutComponent, Component> = {
  month: MonthSoftView,
  week: WeekView,
  week_parts: WeekPartsView,
  agenda: AgendaView,
  photo: PhotoView,
  days: DayGridView,
}

const arrangement = computed(() => {
  const layout = props.layout
  if (!layout) return null
  return props.stage.orientation === 'portrait' ? layout.portrait : layout.landscape
})

const panes = computed(() => {
  if (!arrangement.value) return []
  return layoutPanes(arrangement.value, props.stage).map(box => ({ box, fit: paneFit(box.component, box, box.grid) }))
})

/** A layout of one pane fills the stage, so its view is the full view and not a pane of one. */
const single = computed(() => panes.value.length === 1)

/** The view a pane tells its component it is: its own, or `custom` for a component that is not a view (the day grid). */
const viewOf = (component: LayoutComponent): View => (component === 'days' ? 'custom' : component)

const boxStyle = (box: PaneBox) => ({
  left: `${box.x}px`,
  top: `${box.y}px`,
  width: `${box.width}px`,
  height: `${box.height}px`,
  ...(box.component === 'photo' && { borderRadius: [box.rounded.topLeft, box.rounded.topRight, box.rounded.bottomRight, box.rounded.bottomLeft].map(round => round ? '64px' : '0').join(' ') }),
})
</script>

<template>
  <section v-if="panes.length" class="view" data-testid="custom-layout-view">
    <div
      v-for="{ box, fit } in panes"
      :key="box.component"
      class="pane"
      :class="{ photo: box.component === 'photo' }"
      :style="boxStyle(box)"
      :data-testid="`layout-pane-${box.component}`"
    >
      <div
        class="virtual-stage"
        :style="{ width: `${fit.stage.width}px`, height: `${fit.stage.height}px`, transform: fit.scale === 1 ? undefined : `scale(${fit.scale})` }"
        :data-scale="fit.scale"
      >
        <component :is="components[box.component]" v-bind="props" :view="viewOf(box.component)" :stage="fit.stage" :pane="!single" :day-grid="box.grid" />
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
