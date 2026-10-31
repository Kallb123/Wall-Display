<script setup lang="ts">
import { ImageIcon, Plus } from 'lucide-vue-next'
import { specialDayArtUrl } from '../../../shared/special-days'
import type { SpecialDay, SpecialDayScene } from '../../../shared/special-days'
import { dateChip, daySummary, daysUsing, usedByLabel } from '~/utils/specialDayEditor'

// The left-hand column of the special days page: a switch between the days and
// the scenes, the list for the one chosen, and a button to add to it. Choosing
// a row, adding and switching are asked of the page, which decides whether
// unsaved changes allow it. The row being edited carries a dot while it has
// changes that are not saved.

const props = defineProps<{
  mode: 'days' | 'scenes'
  days: readonly SpecialDay[]
  scenes: readonly SpecialDayScene[]
  /** What the editor is showing. An `id` of null is a new one that has no row yet. */
  selected: { kind: 'day' | 'scene', id: string | null } | null
  /** The selected one has changes that are not saved. */
  dirty: boolean
}>()

const emit = defineEmits<{
  'update:mode': [mode: 'days' | 'scenes']
  'select': [kind: 'day' | 'scene', id: string]
  'add': [kind: 'day' | 'scene']
}>()

const kind = computed(() => props.mode === 'days' ? 'day' : 'scene')

function isSelected(rowKind: 'day' | 'scene', id: string): boolean {
  return props.selected?.kind === rowKind && props.selected.id === id
}

/** A new day or scene that is being filled in has no row until it is saved, so it gets one that says so. */
const adding = computed(() => props.selected !== null && props.selected.id === null && props.selected.kind === kind.value)
</script>

<template>
  <section class="list" aria-label="Special days and scenes" data-testid="special-days-list">
    <div class="switch" role="group" aria-label="Show">
      <button type="button" class="seg" :aria-pressed="mode === 'days'" data-testid="switch-days" @click="emit('update:mode', 'days')">
        Days
      </button>
      <button type="button" class="seg" :aria-pressed="mode === 'scenes'" data-testid="switch-scenes" @click="emit('update:mode', 'scenes')">
        Scenes
      </button>
    </div>

    <SettingsPillButton :data-testid="mode === 'days' ? 'add-day' : 'add-scene'" @click="emit('add', kind)">
      <AppIcon :icon="Plus" :size="20" />
      {{ mode === 'days' ? 'Add a day' : 'Add a scene' }}
    </SettingsPillButton>

    <ul v-if="mode === 'days'" class="rows">
      <li v-if="adding">
        <div class="row current" aria-current="true" data-testid="new-row">
          <span class="chip new">New</span>
          <span class="text">
            <span class="name">New day</span>
            <span class="summary">Not saved yet</span>
          </span>
        </div>
      </li>
      <li v-for="day in days" :key="day.id">
        <button
          type="button"
          class="row"
          :class="{ current: isSelected('day', day.id) }"
          :aria-current="isSelected('day', day.id) ? 'true' : undefined"
          :data-id="day.id"
          data-testid="day-row"
          @click="emit('select', 'day', day.id)"
        >
          <span class="chip" aria-hidden="true">
            <span class="chip-day">{{ dateChip(day).day }}</span>
            <span class="chip-month">{{ dateChip(day).month }}</span>
          </span>
          <span class="text">
            <span class="name">{{ day.name }}</span>
            <span class="summary">{{ daySummary(day, scenes) }}</span>
          </span>
          <span v-if="dirty && isSelected('day', day.id)" class="dot" role="img" aria-label="Unsaved changes" data-testid="row-unsaved" />
        </button>
      </li>
    </ul>

    <ul v-else class="rows">
      <li v-if="adding">
        <div class="row current" aria-current="true" data-testid="new-row">
          <span class="thumb"><AppIcon :icon="ImageIcon" :size="22" /></span>
          <span class="text">
            <span class="name">New scene</span>
            <span class="summary">Not saved yet</span>
          </span>
        </div>
      </li>
      <li v-for="scene in scenes" :key="scene.id">
        <button
          type="button"
          class="row"
          :class="{ current: isSelected('scene', scene.id) }"
          :aria-current="isSelected('scene', scene.id) ? 'true' : undefined"
          :data-id="scene.id"
          data-testid="scene-row"
          @click="emit('select', 'scene', scene.id)"
        >
          <span class="thumb">
            <img v-if="scene.tile_art" :src="specialDayArtUrl(scene.tile_art)" alt="">
            <AppIcon v-else :icon="ImageIcon" :size="22" />
          </span>
          <span class="text">
            <span class="name">{{ scene.name }}</span>
            <span class="summary">{{ usedByLabel(daysUsing(scene.id, days).length) }}</span>
          </span>
          <span v-if="dirty && isSelected('scene', scene.id)" class="dot" role="img" aria-label="Unsaved changes" data-testid="row-unsaved" />
        </button>
      </li>
    </ul>

    <p v-if="mode === 'days' && days.length === 0 && !adding" class="empty" data-testid="list-empty">
      No special days yet.
    </p>
    <p v-else-if="mode === 'scenes' && scenes.length === 0 && !adding" class="empty" data-testid="list-empty">
      No scenes yet.
    </p>
  </section>
</template>

<style scoped>
.list {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  padding: 20px;
  border-radius: 28px;
  background: var(--surface);
  box-shadow: var(--shadow-soft);
}

/* The Days / Scenes switch: two halves of one pill. */
.switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  border-radius: var(--radius-pill);
  background: var(--bg);
}

.seg {
  min-height: 44px;
  border: 0;
  border-radius: var(--radius-pill);
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  touch-action: manipulation;
}

.seg[aria-pressed='true'] {
  background: var(--accent);
  color: var(--on-accent);
}

.seg:focus-visible,
.row:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 3px;
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 64px;
  padding: 8px 12px;
  border: 2px solid transparent;
  border-radius: 20px;
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  touch-action: manipulation;
}

button.row:hover {
  background: var(--bg);
}

.row.current {
  border-color: var(--accent);
  background: var(--bg);
}

/* The date, as a small calendar page: the day big over the month. */
.chip {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: var(--bg);
  line-height: 1;
}

.row.current .chip {
  background: var(--surface);
}

.chip.new {
  color: var(--accent-ink);
  font-size: 14px;
  font-weight: 700;
}

.chip-day {
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.chip-month {
  margin-top: 2px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.thumb {
  display: grid;
  flex: none;
  place-items: center;
  width: 48px;
  height: 48px;
  overflow: hidden;
  border-radius: 14px;
  background: var(--bg);
  color: var(--muted);
}

.row.current .thumb {
  background: var(--surface);
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.name,
.summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.name {
  font-size: 17px;
  font-weight: 700;
}

.summary {
  color: var(--muted);
  font-size: 14px;
  font-weight: 600;
}

.dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
}

.empty {
  margin: 0;
  padding: 16px 0 8px;
  color: var(--muted);
  font-size: 16px;
  font-weight: 600;
  text-align: center;
}
</style>
