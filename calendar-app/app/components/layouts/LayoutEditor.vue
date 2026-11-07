<script setup lang="ts">
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, Copy, Minus, Monitor, Plus, RotateCcw, Trash2 } from 'lucide-vue-next'
import { LAYOUT_COMPONENTS } from '../../../shared/layouts'
import type { CustomLayout, CustomLayoutInput, LayoutComponent } from '../../../shared/layouts'
import LayoutPreview from './LayoutPreview.vue'
import { COMPONENT_LABELS, componentsOf, editorErrors, findPane, inputOf, movePane, moveRow, newLayoutInput, resetPortrait, resizePane, resizeRow, sameInput, toggleComponent } from '~/utils/layoutEditor'
import type { MoveDirection, Orientation, PaneAt } from '~/utils/layoutEditor'
import '~/assets/special-days-form.css'

// The editor for one layout (PR 5.17): its name, the components it shows, and
// the arrangement of each orientation as a picture whose panes are tapped to
// select them and moved or resized with buttons (no dragging, so it works with
// a finger, a keyboard and a screen reader alike). The form is the draft; the
// manager above owns what happens to it (saving, deleting, asking the wall),
// and says what the server answered through `busy` and `serverError`. Make a
// new editor (a new `key`) for each layout shown.

const props = withDefaults(defineProps<{
  /** The layout being edited, or null for a new one. */
  saved: CustomLayout | null
  /** A photo source is set up, so the photo pane is on offer. */
  photosConfigured: boolean
  /** The action in progress (`save`, `delete`, …), so the buttons rest. */
  busy?: string | null
  /** What the server said was wrong with the last save. */
  serverError?: string | null
  /** The displays the layout can be put on. */
  displays?: readonly { id: string, name: string }[]
}>(), { busy: null, serverError: null, displays: () => [] })

const emit = defineEmits<{
  dirty: [dirty: boolean]
  save: [body: CustomLayoutInput]
  delete: []
  duplicate: []
  show: [displayId: string]
}>()

const id = useId()
const draft = ref<CustomLayoutInput>(props.saved ? inputOf(props.saved) : newLayoutInput())
const which = ref<Orientation>('landscape')
const picked = ref<LayoutComponent | null>(null)
const confirmingDelete = ref(false)

const isDirty = computed(() => props.saved === null || !sameInput(draft.value, inputOf(props.saved)))
watch(isDirty, dirty => emit('dirty', dirty), { immediate: true })

const arrangement = computed(() => draft.value[which.value])
const components = computed(() => componentsOf(draft.value))
/** The pane the controls act on: the one picked, or the first if it has gone. */
const selected = computed<LayoutComponent>(() => picked.value && findPane(arrangement.value, picked.value) ? picked.value : arrangement.value.rows[0]!.panes[0]!.component)
const at = computed<PaneAt>(() => findPane(arrangement.value, selected.value)!)
const rowCount = computed(() => arrangement.value.rows.length)
const paneSize = computed(() => arrangement.value.rows[at.value.row]!.panes[at.value.pane]!.size)
const rowSize = computed(() => arrangement.value.rows[at.value.row]!.size)

const errors = computed(() => editorErrors(draft.value))
const nameError = computed(() => draft.value.name !== '' ? errors.value.find(error => error.path === 'name')?.message ?? null : null)
const canSave = computed(() => errors.value.length === 0 && isDirty.value && props.busy === null)

/** Whether the component can be switched on or off: the last one can't go, and the photo pane needs a photo source (unless it is already there). */
function toggleDisabled(component: LayoutComponent): boolean {
  const on = components.value.includes(component)
  if (on) return components.value.length === 1
  return component === 'photo' && !props.photosConfigured
}

function toggle(component: LayoutComponent) {
  draft.value = toggleComponent(draft.value, component, !components.value.includes(component))
}

function move(direction: MoveDirection) {
  draft.value = movePane(draft.value, which.value, at.value, direction)
}
const cannotMove = (direction: MoveDirection): boolean => movePane(draft.value, which.value, at.value, direction) === draft.value

const resizeWidth = (delta: 1 | -1) => {
  draft.value = resizePane(draft.value, which.value, at.value, delta)
}
const resizeHeight = (delta: 1 | -1) => {
  draft.value = resizeRow(draft.value, which.value, at.value.row, delta)
}
const shiftRow = (direction: 'up' | 'down') => {
  draft.value = moveRow(draft.value, which.value, at.value.row, direction)
}

const MOVES: { direction: MoveDirection, icon: typeof ArrowUp, word: string }[] = [
  { direction: 'left', icon: ArrowLeft, word: 'left' },
  { direction: 'right', icon: ArrowRight, word: 'right' },
  { direction: 'up', icon: ArrowUp, word: 'up' },
  { direction: 'down', icon: ArrowDown, word: 'down' },
]

const pickedDisplay = ref('')
const target = computed(() => props.displays.find(display => display.id === pickedDisplay.value) ?? props.displays[0] ?? null)

function save() {
  if (canSave.value) emit('save', { ...draft.value, name: draft.value.name.trim() })
}

function confirmDelete() {
  confirmingDelete.value = false
  emit('delete')
}
</script>

<template>
  <form class="editor" novalidate data-testid="layout-editor" @submit.prevent="save">
    <SettingsCard>
      <div class="sd-field">
        <label :for="`${id}-name`" class="sd-label">Name</label>
        <input
          :id="`${id}-name`"
          v-model="draft.name"
          class="sd-input"
          type="text"
          autocomplete="off"
          placeholder="Kitchen"
          :aria-invalid="nameError ? 'true' : undefined"
          :aria-describedby="nameError ? `${id}-name-error` : undefined"
          data-testid="layout-name"
        >
        <p v-if="nameError" :id="`${id}-name-error`" class="sd-error" data-testid="layout-name-error">
          Name {{ nameError }}
        </p>
        <p v-if="saved" class="sd-hint" data-testid="layout-id">
          Its id is <code>{{ saved.id }}</code>, which a schedule in config.yaml uses to show it.
        </p>
      </div>

      <div class="sd-field">
        <span :id="`${id}-shows`" class="sd-label">Shows</span>
        <div class="chips" role="group" :aria-labelledby="`${id}-shows`">
          <button
            v-for="component in LAYOUT_COMPONENTS"
            :key="component"
            type="button"
            class="chip"
            :aria-pressed="components.includes(component)"
            :disabled="toggleDisabled(component)"
            :data-testid="`toggle-${component}`"
            @click="toggle(component)"
          >
            {{ COMPONENT_LABELS[component] }}
            <span v-if="component === 'photo' && !photosConfigured && !components.includes('photo')" class="not-set-up">Not set up</span>
          </button>
        </div>
      </div>
    </SettingsCard>

    <SettingsCard>
      <div class="switch" role="group" aria-label="Arrangement for">
        <button
          v-for="orientation in (['landscape', 'portrait'] as const)"
          :key="orientation"
          type="button"
          class="seg"
          :aria-pressed="which === orientation"
          :data-testid="`switch-${orientation}`"
          @click="which = orientation"
        >
          {{ orientation === 'landscape' ? 'Landscape' : 'Portrait' }}
        </button>
      </div>

      <LayoutPreview
        :arrangement="arrangement"
        :orientation="which"
        :selected="selected"
        interactive
        @select="picked = $event"
      />
      <p class="sd-hint">
        Tap a pane, then move or resize it. A wall shows the landscape or the portrait arrangement, whichever way up it is.
      </p>

      <div class="controls" role="group" :aria-label="`Move and resize the ${COMPONENT_LABELS[selected]} pane`" data-testid="pane-controls">
        <p class="selection">
          <strong>{{ COMPONENT_LABELS[selected] }}</strong>
          <span>row {{ at.row + 1 }} of {{ rowCount }}</span>
        </p>

        <div class="group" role="group" aria-label="Move">
          <button
            v-for="move_ in MOVES"
            :key="move_.direction"
            type="button"
            class="icon"
            :aria-label="`Move ${COMPONENT_LABELS[selected]} ${move_.word}`"
            :title="`Move ${move_.word}`"
            :disabled="cannotMove(move_.direction)"
            :data-testid="`move-${move_.direction}`"
            @click="move(move_.direction)"
          >
            <AppIcon :icon="move_.icon" :size="22" />
          </button>
        </div>

        <div class="group" role="group" aria-label="Width">
          <span class="group-label">Width {{ paneSize }}</span>
          <button type="button" class="icon" :aria-label="`Make ${COMPONENT_LABELS[selected]} narrower`" title="Narrower" :disabled="paneSize <= 1" data-testid="narrower" @click="resizeWidth(-1)">
            <AppIcon :icon="Minus" :size="22" />
          </button>
          <button type="button" class="icon" :aria-label="`Make ${COMPONENT_LABELS[selected]} wider`" title="Wider" :disabled="paneSize >= 4" data-testid="wider" @click="resizeWidth(1)">
            <AppIcon :icon="Plus" :size="22" />
          </button>
        </div>

        <div class="group" role="group" aria-label="Row height">
          <span class="group-label">Row height {{ rowSize }}</span>
          <button type="button" class="icon" aria-label="Make the row shorter" title="Shorter" :disabled="rowSize <= 1" data-testid="shorter" @click="resizeHeight(-1)">
            <AppIcon :icon="Minus" :size="22" />
          </button>
          <button type="button" class="icon" aria-label="Make the row taller" title="Taller" :disabled="rowSize >= 4" data-testid="taller" @click="resizeHeight(1)">
            <AppIcon :icon="Plus" :size="22" />
          </button>
        </div>

        <div v-if="rowCount > 1" class="group" role="group" aria-label="Row order">
          <span class="group-label">Row</span>
          <button type="button" class="icon" aria-label="Move the row up" title="Row up" :disabled="at.row === 0" data-testid="row-up" @click="shiftRow('up')">
            <AppIcon :icon="ArrowUp" :size="22" />
          </button>
          <button type="button" class="icon" aria-label="Move the row down" title="Row down" :disabled="at.row === rowCount - 1" data-testid="row-down" @click="shiftRow('down')">
            <AppIcon :icon="ArrowDown" :size="22" />
          </button>
        </div>
      </div>

      <SettingsPillButton v-if="which === 'portrait'" data-testid="reset-portrait" @click="draft = resetPortrait(draft)">
        <AppIcon :icon="RotateCcw" :size="20" />
        Start again from landscape
      </SettingsPillButton>
    </SettingsCard>

    <SettingsNotice v-if="serverError" tone="error" data-testid="layout-server-error">
      {{ serverError }}
    </SettingsNotice>

    <div class="actions">
      <p v-if="isDirty && saved" class="unsaved" data-testid="unsaved">
        Unsaved changes
      </p>
      <div class="buttons">
        <SettingsPillButton type="submit" variant="primary" :disabled="!canSave" data-testid="layout-save">
          {{ busy === 'save' ? 'Saving…' : saved ? 'Save' : 'Add layout' }}
        </SettingsPillButton>
        <template v-if="saved">
          <SettingsPillButton class="compact" :disabled="busy !== null" data-testid="layout-duplicate" @click="emit('duplicate')">
            <AppIcon :icon="Copy" :size="20" />
            Duplicate
          </SettingsPillButton>
          <SettingsPillButton class="compact danger" :disabled="busy !== null" data-testid="layout-delete" @click="confirmingDelete = true">
            <AppIcon :icon="Trash2" :size="20" />
            Delete
          </SettingsPillButton>
        </template>
      </div>
      <div v-if="saved && displays.length > 0" class="show">
        <span v-if="displays.length > 1" class="sd-select">
          <select :value="target?.id" class="sd-input" aria-label="Show on" data-testid="show-display" @change="pickedDisplay = ($event.target as HTMLSelectElement).value">
            <option v-for="display in displays" :key="display.id" :value="display.id">
              {{ display.name }}
            </option>
          </select>
          <AppIcon :icon="ChevronDown" :size="22" />
        </span>
        <SettingsPillButton
          class="compact"
          :disabled="busy !== null || isDirty || target === null"
          :title="isDirty ? 'Save your changes first' : undefined"
          data-testid="layout-show"
          @click="target && emit('show', target.id)"
        >
          <AppIcon :icon="Monitor" :size="20" />
          Show on {{ displays.length > 1 ? 'wall' : target?.name }}
        </SettingsPillButton>
      </div>
    </div>

    <SettingsConfirmDialog
      v-if="confirmingDelete && saved"
      :title="`Delete ${saved.name}?`"
      message="It goes from the list and from every display. A wall showing it falls back to the month. This can't be undone."
      confirm-label="Delete"
      tone="danger"
      @confirm="confirmDelete"
      @cancel="confirmingDelete = false"
    />
  </form>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}

code {
  font-size: 0.95em;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 18px;
  border: 2px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  touch-action: manipulation;
}

.chip[aria-pressed='true'] {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}

.chip:disabled {
  opacity: 0.6;
  cursor: default;
}

.not-set-up {
  font-size: 12px;
  font-weight: 600;
}

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

.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
}

.selection {
  display: flex;
  flex: 1 0 100%;
  align-items: baseline;
  gap: 10px;
  margin: 0;
  font-size: 17px;
}

.selection span {
  color: var(--muted);
  font-size: 14px;
  font-weight: 600;
}

.group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.group-label {
  min-width: 5.5em;
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
}

.icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 2px solid var(--line);
  border-radius: 50%;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  touch-action: manipulation;
}

.icon:disabled {
  opacity: 0.4;
  cursor: default;
}

.chip:focus-visible,
.seg:focus-visible,
.icon:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 3px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
  padding: 12px 16px;
  border-radius: 32px;
  background: var(--surface);
  box-shadow: var(--shadow-soft);
}

.buttons,
.show {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.show {
  margin-left: auto;
}

.actions .compact {
  padding: 0 14px;
  gap: 6px;
}

.actions .danger {
  border-color: var(--accent-ink);
  color: var(--accent-ink);
}

.unsaved {
  flex: 1 0 100%;
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
}
</style>
