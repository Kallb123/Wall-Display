<script setup lang="ts">
import type { Component } from 'vue'
import { CalendarDays, CalendarRange, Images, LayoutGrid, ListTodo, Rows3 } from 'lucide-vue-next'
import type { LayoutArrangement, LayoutComponent } from '../../../shared/layouts'
import { COMPONENT_LABELS } from '~/utils/layoutEditor'

// A small picture of one arrangement, in the proportions of the wall (16:9, or
// 9:16 turned upright): the rows and panes in their weights, each pane named
// and marked with the icon of the view it holds. It is only a sketch, not the
// views themselves. In the editor a pane can be tapped to select it; in the
// list it is a thumbnail, with the names left out because they would not fit.

const props = withDefaults(defineProps<{
  arrangement: LayoutArrangement
  orientation?: 'landscape' | 'portrait'
  /** The component whose pane is picked out. */
  selected?: LayoutComponent | null
  /** Panes are buttons that select themselves. */
  interactive?: boolean
  /** Write each pane's name in it. */
  labels?: boolean
}>(), { orientation: 'landscape', selected: null, interactive: false, labels: true })

const emit = defineEmits<{
  select: [component: LayoutComponent]
}>()

const ICONS: Record<LayoutComponent, Component> = {
  month: CalendarDays,
  week: CalendarRange,
  week_parts: Rows3,
  agenda: ListTodo,
  days: LayoutGrid,
  photo: Images,
}

const summary = computed(() => props.arrangement.rows
  .map(row => row.panes.map(pane => COMPONENT_LABELS[pane.component]).join(' and '))
  .join(', then '))
</script>

<template>
  <div
    class="preview"
    :class="[orientation, { thumb: !labels }]"
    :role="interactive ? 'group' : 'img'"
    :aria-label="`${orientation} arrangement: ${summary}`"
    data-testid="layout-preview"
  >
    <div v-for="(row, r) in arrangement.rows" :key="r" class="row" :style="{ flexGrow: row.size }">
      <component
        :is="interactive ? 'button' : 'div'"
        v-for="pane in row.panes"
        :key="pane.component"
        class="pane"
        :class="{ selected: selected === pane.component, photo: pane.component === 'photo' }"
        :style="{ flexGrow: pane.size }"
        :type="interactive ? 'button' : undefined"
        :aria-pressed="interactive ? selected === pane.component : undefined"
        :aria-label="interactive ? `${COMPONENT_LABELS[pane.component]} pane` : undefined"
        :data-component="pane.component"
        data-testid="preview-pane"
        @click="interactive && emit('select', pane.component)"
      >
        <span
          v-if="pane.grid"
          class="tiles"
          aria-hidden="true"
          data-testid="preview-grid"
          :style="{ gridTemplateRows: `repeat(${pane.grid.rows}, 1fr)`, gridTemplateColumns: `repeat(${pane.grid.columns}, 1fr)` }"
        >
          <i v-for="n in pane.grid.rows * pane.grid.columns" :key="n" />
        </span>
        <AppIcon :icon="ICONS[pane.component]" :size="labels ? 20 : 12" />
        <span v-if="labels" class="name">{{ COMPONENT_LABELS[pane.component] }}</span>
        <span v-if="labels && pane.grid" class="caption">{{ pane.grid.rows }}×{{ pane.grid.columns }}</span>
      </component>
    </div>
  </div>
</template>

<style scoped>
.preview {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 4px;
  border-radius: 16px;
  background: var(--bg);
  box-shadow: inset 0 0 0 2px var(--line);
}

.preview.landscape {
  aspect-ratio: 16 / 9;
}

/* Upright, but no taller than the landscape picture beside it would be. */
.preview.portrait {
  width: 40%;
  min-width: 140px;
  margin: 0 auto;
  aspect-ratio: 9 / 16;
}

.preview.thumb {
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
}

.row {
  display: flex;
  flex: 1 1 0;
  gap: 4px;
  min-height: 0;
}

.thumb .row {
  gap: 2px;
}

.pane {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  padding: 4px;
  overflow: hidden;
  border: 2px solid transparent;
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
}

.thumb .pane {
  padding: 0;
  border-width: 0;
  border-radius: 4px;
  color: var(--muted);
}

.pane {
  position: relative;
}

/* The day grid's tiles, faint, under the icon and the name. */
.tiles {
  position: absolute;
  inset: 3px;
  display: grid;
  gap: 2px;
  pointer-events: none;
}

.tiles i {
  border-radius: 2px;
  background: color-mix(in oklch, var(--muted) 16%, transparent);
}

.pane > :not(.tiles) {
  position: relative;
}

.caption {
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.pane.photo {
  background: color-mix(in oklch, var(--accent-2) 30%, var(--surface));
}

button.pane {
  cursor: pointer;
  touch-action: manipulation;
}

.pane.selected {
  border-color: var(--accent);
  background: color-mix(in oklch, var(--accent) 18%, var(--surface));
}

.pane:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}

.name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
