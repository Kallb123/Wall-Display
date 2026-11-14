<script setup lang="ts">
import { ArrowLeft, LayoutGrid, Plus, WifiOff } from 'lucide-vue-next'
import type { CustomLayout, CustomLayoutInput } from '../../../shared/layouts'
import type { PhotoFeedChoice } from '../../../shared/settings'
import { componentsOf } from '~/utils/layoutEditor'
import LayoutEditor from './LayoutEditor.vue'
import LayoutPreview from './LayoutPreview.vue'
import { SERVER_UNREACHABLE, listNames } from '~/utils/settings'
import { writeFailure } from '~/utils/specialDayEditor'

// The layouts library, to read and change (PR 5.17): the list of layouts, each
// with a picture and the displays showing it, and the editor for the one chosen.
// It owns every request (the list, the writes behind the shared PIN, and the
// `set_layout` that puts a layout on a display), so the settings tab and the
// remote's sheet are the same thing in two sizes. `compact` is the phone's: the
// list and the editor take turns instead of sitting side by side.
// `live` is the list the socket last sent, which replaces ours whenever it
// changes, so an edit made on another device appears here too.

const props = withDefaults(defineProps<{
  /** The phone's layout: the list, or the editor with a way back to the list. */
  compact?: boolean
  /** The displays a layout can be shown on, and the layout each is showing now (null when it is not on a custom layout). */
  displays?: readonly { id: string, name: string, layout: string | null }[]
  /** A photo source is set up, so the photo pane can be added to a layout. */
  photosConfigured?: boolean
  /** The photo feeds that are set up, for a layout's "Photos from". Null where they are not known, which leaves that choice out. */
  photoFeeds?: readonly PhotoFeedChoice[] | null
  /** The list from the socket, when there is one. */
  live?: readonly CustomLayout[] | null
}>(), { compact: false, displays: () => [], photosConfigured: true, photoFeeds: null, live: null })

const emit = defineEmits<{
  /** The list changed, after a load or a write. */
  changed: [layouts: CustomLayout[]]
}>()

const pin = usePinRequest(SERVER_UNREACHABLE)

const layouts = ref<CustomLayout[]>([])
const loaded = ref(false)
const unreachable = ref(false)

/** Reads the list again. The server's answer is what is shown after every write. */
async function load() {
  try {
    layouts.value = await $fetch<CustomLayout[]>('/api/layouts')
    unreachable.value = false
    emit('changed', layouts.value)
  } catch {
    unreachable.value = true
  } finally {
    loaded.value = true
  }
}

onMounted(load)
watch(() => props.live, (next) => {
  if (next) layouts.value = [...next]
})

/** What is open: a saved layout's id, `new` for one not yet saved, or nothing. */
const selected = ref<string | 'new' | null>(null)
const saved = computed(() => selected.value && selected.value !== 'new' ? layouts.value.find(layout => layout.id === selected.value) ?? null : null)
/** Each new layout starts a fresh form. */
const newCount = ref(0)
const editorKey = computed(() => selected.value === 'new' ? `new:${newCount.value}` : selected.value ?? '')

// With nothing open on a roomy screen, open the first; a layout that has gone (deleted elsewhere) opens nothing.
watch([loaded, layouts, selected], () => {
  if (!loaded.value) return
  if (selected.value && selected.value !== 'new' && !saved.value) selected.value = null
  if (selected.value === null && !props.compact && layouts.value[0]) selected.value = layouts.value[0].id
}, { immediate: true })

// Unsaved changes

const dirty = ref(false)
watch(editorKey, () => {
  dirty.value = false
})

interface Question {
  title: string
  message: string
  confirmLabel: string
  answer: (confirmed: boolean) => void
}
const question = ref<Question | null>(null)

/** Whether to go on: yes when nothing is unsaved, otherwise as the person answers. */
async function mayLeave(): Promise<boolean> {
  if (!dirty.value) return true
  question.value?.answer(false)
  const confirmed = await new Promise<boolean>((resolve) => {
    question.value = {
      title: 'Discard changes?',
      message: `You have unsaved changes to ${saved.value?.name ?? 'this new layout'}.`,
      confirmLabel: 'Discard',
      answer: resolve,
    }
  })
  question.value = null
  if (confirmed) dirty.value = false
  return confirmed
}

function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', warnBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnBeforeUnload))

async function select(id: string) {
  if (selected.value === id || !(await mayLeave())) return
  selected.value = id
}

async function add() {
  if (!(await mayLeave())) return
  newCount.value++
  selected.value = 'new'
}

async function back() {
  if (await mayLeave()) selected.value = null
}

// Notes

const note = ref<{ tone: 'note' | 'error', text: string } | null>(null)
const serverError = ref<string | null>(null)
watch(editorKey, () => {
  note.value = null
  serverError.value = null
})
watch(dirty, (changed) => {
  if (changed) note.value = null
})

// Writes

const busy = ref<string | null>(null)
const encode = encodeURIComponent

/**
 * Runs one write behind the PIN: `request` with the PIN this browser has, then
 * `done` with what the server answered. If the server asks for a PIN the dialog
 * opens and `retry` runs once one is accepted. A failure is worded in a note, or
 * under the form for a save, where the server's reason for refusing belongs.
 */
async function write<T>(action: string, request: (headers: Record<string, string>) => Promise<T>, done: (value: T) => Promise<void>, failure: string, retry: () => Promise<unknown>, to: 'note' | 'form' = 'note') {
  if (busy.value) return
  busy.value = action
  if (to === 'form') serverError.value = null
  try {
    const result = await pin.guard(request, retry)
    if (result) await done(result.value)
  } catch (caught) {
    const text = writeFailure(caught, failure)
    if (to === 'form') serverError.value = text
    else note.value = { tone: 'error', text }
  } finally {
    busy.value = null
  }
}

async function save(body: CustomLayoutInput) {
  const id = saved.value?.id ?? null
  await write('save', headers => $fetch<CustomLayout>(id ? `/api/layouts/${encode(id)}` : '/api/layouts', { method: id ? 'PUT' : 'POST', headers, body }), async (layout) => {
    await load()
    dirty.value = false
    selected.value = layout.id
    note.value = { tone: 'note', text: 'Saved.' }
  }, 'The server couldn\'t save the layout', () => save(body), 'form')
}

async function remove() {
  const layout = saved.value
  if (!layout) return
  await write('delete', headers => $fetch(`/api/layouts/${encode(layout.id)}`, { method: 'DELETE', headers }), async () => {
    const index = layouts.value.findIndex(candidate => candidate.id === layout.id)
    const rest = layouts.value.filter(candidate => candidate.id !== layout.id)
    dirty.value = false
    selected.value = props.compact ? null : (rest[index] ?? rest.at(-1))?.id ?? null
    await load()
    note.value = { tone: 'note', text: `Deleted ${layout.name}.` }
  }, 'The server couldn\'t delete the layout', remove)
}

async function duplicate() {
  const layout = saved.value
  if (!layout) return
  await write('duplicate', headers => $fetch<CustomLayout>(`/api/layouts/${encode(layout.id)}/duplicate`, { method: 'POST', headers }), async (copy) => {
    await load()
    selected.value = copy.id
    note.value = { tone: 'note', text: 'Copied. Give it a name of its own.' }
  }, 'The server couldn\'t copy the layout', duplicate)
}

async function show(displayId: string) {
  const layout = saved.value
  if (!layout) return
  const target = props.displays.find(display => display.id === displayId)
  await write('show', headers => $fetch(`/api/displays/${encode(displayId)}/commands`, { method: 'POST', headers, body: { type: 'set_layout', layout: layout.id } }), async () => {
    note.value = { tone: 'note', text: `Showing ${layout.name} on ${target?.name ?? 'the wall'}.` }
  }, 'The wall didn\'t accept that', () => show(displayId))
}

/** Which displays are showing the layout now, for the list. */
const shownOn = (layout: CustomLayout): string[] => props.displays.filter(display => display.layout === layout.id).map(display => display.name)

const showList = computed(() => !props.compact || selected.value === null)
const showEditor = computed(() => selected.value !== null && (selected.value === 'new' || saved.value !== null))
</script>

<template>
  <div class="manager" :class="{ compact }" data-testid="layouts-manager">
    <p v-if="unreachable" class="unreachable" role="status" data-testid="unreachable">
      <AppIcon :icon="WifiOff" :size="20" />
      {{ SERVER_UNREACHABLE }}
    </p>

    <p v-if="!loaded" class="loading" data-testid="loading">
      Loading&hellip;
    </p>

    <div v-else class="layout">
      <section v-if="showList" class="list" aria-label="Layouts" data-testid="layouts-list">
        <SettingsPillButton data-testid="add-layout" @click="add">
          <AppIcon :icon="Plus" :size="20" />
          Add a layout
        </SettingsPillButton>

        <ul class="rows">
          <li v-if="selected === 'new'">
            <div class="row current" aria-current="true" data-testid="new-row">
              <span class="thumb"><AppIcon :icon="LayoutGrid" :size="22" /></span>
              <span class="text">
                <span class="name">New layout</span>
                <span class="summary">Not saved yet</span>
              </span>
            </div>
          </li>
          <li v-for="layout in layouts" :key="layout.id">
            <button
              type="button"
              class="row"
              :class="{ current: selected === layout.id }"
              :aria-current="selected === layout.id ? 'true' : undefined"
              :data-id="layout.id"
              data-testid="layout-row"
              @click="select(layout.id)"
            >
              <span class="thumb"><LayoutPreview :arrangement="layout.landscape" :labels="false" /></span>
              <span class="text">
                <span class="name">{{ layout.name }}</span>
                <span v-if="shownOn(layout).length > 0" class="shown" data-testid="shown-on">Shown on {{ listNames(shownOn(layout)) }}</span>
                <span v-else class="summary">{{ componentsOf(layout).length }} {{ componentsOf(layout).length === 1 ? 'view' : 'views' }}</span>
              </span>
              <span v-if="dirty && selected === layout.id" class="dot" role="img" aria-label="Unsaved changes" data-testid="row-unsaved" />
            </button>
          </li>
        </ul>

        <p v-if="layouts.length === 0 && selected !== 'new'" class="empty" data-testid="list-empty">
          No layouts yet. A layout puts the month, week, agenda, days or photos side by side on the wall.
        </p>
      </section>

      <div v-if="showEditor || !compact" class="column">
        <button v-if="compact && showEditor" type="button" class="back" data-testid="layouts-back" @click="back">
          <AppIcon :icon="ArrowLeft" :size="20" />
          All layouts
        </button>

        <SettingsNotice v-if="note" :tone="note.tone" data-testid="layouts-note">
          {{ note.text }}
        </SettingsNotice>

        <LayoutEditor
          v-if="showEditor"
          :key="editorKey"
          :saved="saved"
          :photos-configured="photosConfigured"
          :busy="busy"
          :server-error="serverError"
          :displays="displays"
          :photo-feeds="photoFeeds"
          @dirty="dirty = $event"
          @save="save"
          @delete="remove"
          @duplicate="duplicate"
          @show="show"
        />
        <SettingsCard v-else class="nothing" data-testid="nothing-selected">
          <span class="badge"><AppIcon :icon="LayoutGrid" :size="30" /></span>
          <p class="nothing-text">
            Pick a layout, or add one.
          </p>
        </SettingsCard>
      </div>
    </div>

    <SettingsConfirmDialog
      v-if="question"
      :title="question.title"
      :message="question.message"
      :confirm-label="question.confirmLabel"
      tone="danger"
      @confirm="question.answer(true)"
      @cancel="question.answer(false)"
    />

    <SettingsPinDialog
      v-if="pin.pinNeeded.value"
      :message="pin.pinMessage.value"
      :checking="pin.checkingPin.value"
      @submit="pin.submitPin"
      @cancel="pin.cancelPin"
    />
  </div>
</template>

<style scoped>
.manager {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.unreachable {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
}

.loading {
  margin: 0;
  padding: 32px 0;
  color: var(--muted);
  font-family: var(--font-display);
  font-size: 24px;
  text-align: center;
}

/* The list beside the editor; one above the other on a narrow screen, and on the phone's sheet they take turns. */
.layout {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}

.compact .layout {
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}

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

.compact .list {
  padding: 16px;
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

.row:focus-visible,
.back:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 3px;
}

.thumb {
  display: grid;
  flex: none;
  place-items: center;
  width: 72px;
  color: var(--muted);
}

.text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.name,
.summary,
.shown {
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

/* Which walls show it: a chip in the accent, so it stands out in the list. */
.shown {
  align-self: flex-start;
  max-width: 100%;
  padding: 1px 10px;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--on-accent);
  font-size: 12px;
  font-weight: 700;
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
  padding: 8px 0;
  color: var(--muted);
  font-size: 15px;
  font-weight: 600;
  text-align: center;
}

.column {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.back {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: flex-start;
  min-height: 44px;
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
}

.nothing {
  flex-direction: row;
  align-items: center;
  gap: 20px;
}

.badge {
  display: grid;
  flex: none;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--panel);
  color: var(--panel-text);
}

.nothing-text {
  margin: 0;
  color: var(--muted);
  font-size: 17px;
  font-weight: 500;
}

@media (max-width: 900px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
