<script setup lang="ts">
import type { Component } from 'vue'
import { CalendarDays, CalendarRange, Images, LayoutGrid, ListTodo, Moon, PanelTop, Pencil, Rows3 } from 'lucide-vue-next'
import type { View } from '../../../shared/display'
import type { CustomLayout } from '../../../shared/layouts'

// The "On the wall" section: a tile for each view, then one for each custom
// layout and the way into editing them. A tap is only a request (`setView`,
// `setLayout`); the page sends it and shows the state that comes back.

defineProps<{
  view: View | undefined
  /** Whether the photo frame and the week and photo view get a tile. */
  showPhotoTile: boolean
  /** The layouts to offer, each marked with whether it is the one on the wall. */
  layoutTiles: { layout: CustomLayout, active: boolean }[]
}>()

const emit = defineEmits<{
  setView: [view: View]
  setLayout: [id: string]
  edit: []
}>()

// Four calendar views fill the 2x2 grid; Night gets a full-width tile beneath it, then the photo frame and the week and photo view share a row.
const TILES: { view: View, label: string, icon: Component, wide?: boolean }[] = [
  { view: 'agenda', label: 'Agenda', icon: ListTodo },
  { view: 'month', label: 'Month', icon: CalendarDays },
  { view: 'week', label: 'Week', icon: CalendarRange },
  { view: 'week_parts', label: 'Day parts', icon: Rows3 },
  { view: 'night', label: 'Night', icon: Moon, wide: true },
]
</script>

<template>
  <section aria-labelledby="wall-title">
    <h2 id="wall-title" class="label">
      On the wall
    </h2>
    <div class="tiles">
      <button
        v-for="tile in TILES"
        :key="tile.view"
        type="button"
        class="tile"
        :class="{ active: view === tile.view, wide: tile.wide }"
        :aria-pressed="view === tile.view"
        :data-testid="`tile-${tile.view}`"
        @click="emit('setView', tile.view)"
      >
        <AppIcon :icon="tile.icon" :size="32" />
        {{ tile.label }}
      </button>
      <!-- Night sits under the 2x2 grid, full width; the photo frame and week and photo tiles share the row below it. -->
      <button
        v-if="showPhotoTile"
        type="button"
        class="tile"
        :class="{ active: view === 'photo' }"
        :aria-pressed="view === 'photo'"
        data-testid="tile-photo"
        @click="emit('setView', 'photo')"
      >
        <AppIcon :icon="Images" :size="32" />
        Photo frame
      </button>
      <button
        v-if="showPhotoTile"
        type="button"
        class="tile"
        :class="{ active: view === 'week_photo' }"
        :aria-pressed="view === 'week_photo'"
        data-testid="tile-week_photo"
        @click="emit('setView', 'week_photo')"
      >
        <AppIcon :icon="PanelTop" :size="32" />
        Week + photo
      </button>
    </div>

    <h3 id="layouts-title" class="sublabel">
      Layouts
    </h3>
    <div class="tiles" role="group" aria-labelledby="layouts-title" data-testid="layout-tiles">
      <button
        v-for="{ layout, active } in layoutTiles"
        :key="layout.id"
        type="button"
        class="tile layout-tile"
        :class="{ active }"
        :aria-pressed="active"
        :data-testid="`layout-tile-${layout.id}`"
        @click="emit('setLayout', layout.id)"
      >
        <AppIcon :icon="LayoutGrid" :size="26" />
        <span class="layout-name">{{ layout.name }}</span>
      </button>
      <button type="button" class="button edit-layouts" data-testid="layouts-edit" @click="emit('edit')">
        <AppIcon :icon="Pencil" :size="22" />
        Edit layouts
      </button>
    </div>
  </section>
</template>

<style scoped src="../../assets/remote-base.css"></style>

<style scoped>
.tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  min-height: 112px;
  padding: 18px;
  border-radius: var(--card-radius);
  background: var(--surface);
  box-shadow: var(--shadow-soft);
  font-size: 19px;
  font-weight: 700;
  text-align: left;
  transition: background 0.2s ease, color 0.2s ease;
}

.tile.active {
  background: var(--accent);
  color: var(--on-accent);
}

.sublabel {
  margin: 20px 0 12px 4px;
  font-family: var(--font-display);
  font-size: 19px;
  font-weight: 400;
}

/* A layout's tile is the wide tile's shape, two to a row, with a name that may be long. */
.layout-tile {
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  min-height: 72px;
  padding: 0 18px;
  font-size: 17px;
}

.layout-tile > svg {
  flex: none;
}

.layout-name {
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.edit-layouts {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.tile.wide {
  grid-column: 1 / -1;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 16px;
  min-height: 72px;
  padding: 0 22px;
}
</style>
