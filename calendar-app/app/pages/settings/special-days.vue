<script setup lang="ts">
import { PartyPopper, WifiOff } from 'lucide-vue-next'
import { todayIn } from '../../../shared/dates'
import type { DisplaySettings } from '../../../shared/display'
import type { SpecialDay, SpecialDayScene } from '../../../shared/special-days'
import { ART_SLOT_LABELS, artFileProblem, uploadArt, uploadFailure } from '~/utils/artUpload'
import type { ArtSlot } from '~/utils/artUpload'
import { SERVER_UNREACHABLE, listNames } from '~/utils/settings'
import { daysUsing, sceneSavedMessage, writeFailure } from '~/utils/specialDayEditor'

// The Special days tab (architecture §7.6): birthdays, holidays and one-off
// dates, and the scenes (shared looks) they can use. A list on the left, the
// editor for the chosen day or scene on the right. This page owns everything
// that happens: it loads the days and scenes, makes every write (behind the
// shared PIN), uploads the art, and decides what unsaved changes allow. The
// editors only hold the form. What is open lives in the address (`?day=`,
// `?scene=` or `?new=day|scene`) so a link to a day works and Back goes back.

useHead({ title: 'Special days · Settings' })

type Kind = 'day' | 'scene'
interface Selection { kind: Kind, id: string | null }
type Uploads = Partial<Record<ArtSlot, { progress: number | null, error: string | null }>>

const SLOTS: readonly ArtSlot[] = ['tile', 'full', 'extra']

const route = useRoute()
const router = useRouter()
const pin = usePinRequest(SERVER_UNREACHABLE)
const timezone = useWallTimezone()
const now = useNow(60_000)
/** Today at the wall, which is where "the next time it falls" is counted from. */
const today = computed(() => todayIn(now.value, timezone.value))

// Loading

const days = ref<SpecialDay[]>([])
const scenes = ref<SpecialDayScene[]>([])
/** The first load has been tried. */
const loaded = ref(false)
const unreachable = ref(false)

/** Reads the days and the scenes again. The server's answer is what the page shows after every write. */
async function load() {
  try {
    const [nextDays, nextScenes] = await Promise.all([
      $fetch<SpecialDay[]>('/api/special-days'),
      $fetch<SpecialDayScene[]>('/api/special-day-scenes'),
    ])
    days.value = nextDays
    scenes.value = nextScenes
    unreachable.value = false
  } catch {
    unreachable.value = true
  } finally {
    loaded.value = true
  }
}

onMounted(load)

// What is open

const selected = computed<Selection | null>(() => {
  const { day, scene, new: add } = route.query
  if (typeof day === 'string' && day !== '') return { kind: 'day', id: day }
  if (typeof scene === 'string' && scene !== '') return { kind: 'scene', id: scene }
  if (add === 'day' || add === 'scene') return { kind: add, id: null }
  return null
})

/** Names what is open, for keeping a note or an error with the thing it is about. */
const keyOf = (selection: Selection | null): string => selection ? `${selection.kind}:${selection.id ?? 'new'}` : ''
const selectionKey = computed(() => keyOf(selected.value))

const queryOf = (selection: Selection | null): Record<string, string> =>
  selection === null ? {} : selection.id === null ? { new: selection.kind } : { [selection.kind]: selection.id }

function navigate(selection: Selection | null, replace = false) {
  return replace ? router.replace({ query: queryOf(selection) }) : router.push({ query: queryOf(selection) })
}

const mode = ref<'days' | 'scenes'>(selected.value?.kind === 'scene' ? 'scenes' : 'days')
watch(selected, (current) => {
  if (current) mode.value = current.kind === 'scene' ? 'scenes' : 'days'
})

const savedDay = computed(() => selected.value?.kind === 'day' && selected.value.id !== null ? days.value.find(day => day.id === selected.value!.id) ?? null : null)
const savedScene = computed(() => selected.value?.kind === 'scene' && selected.value.id !== null ? scenes.value.find(scene => scene.id === selected.value!.id) ?? null : null)

/** Each new day or scene starts a fresh form, even when another new one was open. */
const newCount = ref(0)
const editorKey = computed(() => selected.value?.id === null ? `${selectionKey.value}:${newCount.value}` : selectionKey.value)

// With nothing open, open the first (of the days or the scenes, whichever is shown). A link to something that has gone, such as a deleted day, opens nothing.
watch([loaded, selected, days, scenes], () => {
  if (!loaded.value || unreachable.value) return
  const current = selected.value
  if (current?.id && !(current.kind === 'day' ? savedDay.value : savedScene.value)) {
    void navigate(null, true)
    return
  }
  if (current) return
  const first = mode.value === 'days' ? days.value[0] : scenes.value[0]
  if (first) void navigate({ kind: mode.value === 'days' ? 'day' : 'scene', id: first.id }, true)
}, { immediate: true })

// Unsaved changes

/** The open editor has changes that are not saved. */
const dirty = ref(false)
watch(editorKey, () => {
  dirty.value = false
})

interface Question {
  title: string
  message: string
  confirmLabel: string
  tone: 'danger' | 'plain'
  answer: (confirmed: boolean) => void
}
const question = ref<Question | null>(null)

/** Asks the question in a dialog, and answers whether it was confirmed. */
function ask(options: Omit<Question, 'answer'>): Promise<boolean> {
  question.value?.answer(false)
  return new Promise((resolve) => {
    question.value = { ...options, answer: resolve }
  })
}

function answer(confirmed: boolean) {
  const open = question.value
  question.value = null
  open?.answer(confirmed)
}

/** Whether to go on: yes when nothing is unsaved, otherwise as the person answers. Saying yes lets go of the changes. */
async function mayLeave(): Promise<boolean> {
  if (!dirty.value) return true
  const name = savedDay.value?.name ?? savedScene.value?.name ?? `this new ${selected.value?.kind ?? 'day'}`
  const confirmed = await ask({
    title: 'Discard changes?',
    message: `You have unsaved changes to ${name}.`,
    confirmLabel: 'Discard',
    tone: 'danger',
  })
  if (confirmed) dirty.value = false
  return confirmed
}

// Back, a link, or another tab: the same question. What this page navigates to itself is asked first, so it is not asked twice.
onBeforeRouteLeave(mayLeave)
onBeforeRouteUpdate(mayLeave)

function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', warnBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnBeforeUnload))

async function select(kind: Kind, id: string) {
  if (selected.value?.kind === kind && selected.value.id === id) return
  if (await mayLeave()) await navigate({ kind, id })
}

async function add(kind: Kind) {
  if (!(await mayLeave())) return
  newCount.value++
  if (selected.value?.kind === kind && selected.value.id === null) return
  await navigate({ kind, id: null })
}

async function switchMode(next: 'days' | 'scenes') {
  if (next === mode.value || !(await mayLeave())) return
  mode.value = next
  const first = next === 'days' ? days.value[0] : scenes.value[0]
  await navigate(first ? { kind: next === 'days' ? 'day' : 'scene', id: first.id } : null)
}

// Notes

/** A line at the top of the editor column. It belongs to what was open (`key`), and goes when something else is. */
const note = ref<{ key: string, tone: 'note' | 'error', text: string } | null>(null)
const shownNote = computed(() => note.value?.key === selectionKey.value ? note.value : null)
/** What the server said about the last save, kept with the thing it was about. */
const serverError = ref<{ key: string, text: string } | null>(null)
const shownServerError = computed(() => serverError.value?.key === selectionKey.value ? serverError.value.text : null)

function say(text: string, tone: 'note' | 'error' = 'note', key = selectionKey.value) {
  note.value = { key, tone, text }
}

watch(selectionKey, (key) => {
  if (note.value && note.value.key !== key) note.value = null
  if (serverError.value && serverError.value.key !== key) serverError.value = null
})
// Typing again leaves "Saved." behind.
watch(dirty, (changed) => {
  if (changed) note.value = null
})

// Writes

/** Which action is running, so the buttons rest and the one pressed says so. */
const busy = ref<string | null>(null)

/**
 * Runs one write behind the PIN: `request` with the PIN this browser has, then
 * `done` with what the server answered. If the server asks for a PIN the dialog
 * opens, and `retry` runs once one is accepted. A failure is worded in a note,
 * or, for a save, under the form (`to: 'form'`), where the server's reason
 * for refusing it, such as a greeting it can't fill, belongs.
 */
async function write<T>(action: string, request: (headers: Record<string, string>) => Promise<T>, done: (value: T) => Promise<void>, failure: string, retry: () => Promise<unknown>, to: 'note' | 'form' = 'note') {
  if (busy.value) return
  busy.value = action
  const key = selectionKey.value
  if (to === 'form') serverError.value = null
  try {
    const result = await pin.guard(request, retry)
    if (result) await done(result.value)
  } catch (caught) {
    const text = writeFailure(caught, failure)
    if (to === 'form') serverError.value = { key, text }
    else say(text, 'error', key)
  } finally {
    busy.value = null
  }
}

const encode = encodeURIComponent
const pathOf = (kind: Kind, id: string): string => kind === 'day' ? `/api/special-days/${encode(id)}` : `/api/special-day-scenes/${encode(id)}`

async function saveDay(body: Record<string, unknown>) {
  const id = savedDay.value?.id ?? null
  await write('save', headers => $fetch<SpecialDay>(id ? pathOf('day', id) : '/api/special-days', { method: id ? 'PUT' : 'POST', headers, body }), async (day) => {
    await load()
    say('Saved.', 'note', keyOf({ kind: 'day', id: day.id }))
    if (id === null) {
      dirty.value = false
      await navigate({ kind: 'day', id: day.id })
    }
  }, 'The server couldn\'t save the day', () => saveDay(body), 'form')
}

async function saveScene(body: Record<string, unknown>) {
  const id = savedScene.value?.id ?? null
  await write('save', headers => $fetch<SpecialDayScene>(id ? pathOf('scene', id) : '/api/special-day-scenes', { method: id ? 'PUT' : 'POST', headers, body }), async (scene) => {
    await load()
    say(sceneSavedMessage(daysUsing(scene.id, days.value).length), 'note', keyOf({ kind: 'scene', id: scene.id }))
    if (id === null) {
      dirty.value = false
      await navigate({ kind: 'scene', id: scene.id })
    }
  }, 'The server couldn\'t save the scene', () => saveScene(body), 'form')
}

/** What to open after `id` has gone: the one that followed it in the list, else the one before, else nothing. */
function neighbour<T extends { id: string }>(list: readonly T[], id: string): T | null {
  const index = list.findIndex(item => item.id === id)
  const rest = list.filter(item => item.id !== id)
  return rest[index] ?? rest.at(-1) ?? null
}

async function removeDay() {
  const day = savedDay.value
  if (!day) return
  const confirmed = await ask({
    title: `Delete ${day.name}?`,
    message: 'It goes from the wall and the list. This can\'t be undone.',
    confirmLabel: 'Delete',
    tone: 'danger',
  })
  if (confirmed) await deleteDay(day)
}

async function deleteDay(day: SpecialDay) {
  await write('delete', headers => $fetch(pathOf('day', day.id), { method: 'DELETE', headers }), async () => {
    const next = neighbour(days.value, day.id)
    const target: Selection | null = next ? { kind: 'day', id: next.id } : null
    dirty.value = false
    say(`Deleted ${day.name}.`, 'note', keyOf(target))
    await navigate(target, true)
    await load()
  }, 'The server couldn\'t delete the day', () => deleteDay(day))
}

async function removeScene() {
  const scene = savedScene.value
  if (!scene) return
  const using = daysUsing(scene.id, days.value).length
  const confirmed = await ask(using === 0
    ? { title: `Delete ${scene.name}?`, message: 'The scene goes from the list. This can\'t be undone.', confirmLabel: 'Delete', tone: 'danger' }
    : {
        title: 'Copy into days and delete?',
        message: `${using} ${using === 1 ? 'day uses' : 'days use'} ${scene.name}. ${using === 1 ? 'It gets' : 'Each gets'} the scene's look as its own, so the wall doesn't change, and then the scene is deleted.`,
        confirmLabel: 'Copy and delete',
        tone: 'danger',
      })
  if (confirmed) await deleteScene(scene, using > 0)
}

async function deleteScene(scene: SpecialDayScene, detach: boolean) {
  await write('delete', headers => $fetch(`${pathOf('scene', scene.id)}${detach ? '?detach=true' : ''}`, { method: 'DELETE', headers }), async () => {
    const next = neighbour(scenes.value, scene.id)
    const target: Selection | null = next ? { kind: 'scene', id: next.id } : null
    dirty.value = false
    say(`Deleted ${scene.name}.`, 'note', keyOf(target))
    await navigate(target, true)
    await load()
  }, 'The server couldn\'t delete the scene', () => deleteScene(scene, detach))
}

async function duplicate(kind: Kind, id: string) {
  await write('duplicate', headers => $fetch<SpecialDay | SpecialDayScene>(`${pathOf(kind, id)}/duplicate`, { method: 'POST', headers }), async (copy) => {
    await load()
    say(kind === 'day' ? 'Copied. Give it its own name and date.' : 'Copied.', 'note', keyOf({ kind, id: copy.id }))
    await navigate({ kind, id: copy.id })
  }, `The server couldn't copy the ${kind}`, () => duplicate(kind, id))
}

async function saveAsScene(id: string) {
  await write('save-as-scene', headers => $fetch<{ scene: SpecialDayScene, day: SpecialDay }>(`${pathOf('day', id)}/save-as-scene`, { method: 'POST', headers }), async ({ scene }) => {
    await load()
    say(`Saved as the scene "${scene.name}". The day now uses it.`, 'note', keyOf({ kind: 'day', id }))
  }, 'The server couldn\'t make a scene from the day', () => saveAsScene(id))
}

/** Shows what is open on every display for a minute: the wall that matters is whichever the person is looking at. */
async function preview(target: Selection) {
  if (busy.value || target.id === null) return
  busy.value = 'preview'
  const key = keyOf(target)
  const body = target.kind === 'day' ? { type: 'preview_special_day', id: target.id } : { type: 'preview_special_day', scene: target.id }
  try {
    const displays = await $fetch<DisplaySettings[]>('/api/displays')
    if (displays.length === 0) {
      say('There is no display to show it on.', 'error', key)
      return
    }
    for (const display of displays) {
      // Refused for want of a PIN: the dialog is open, and the whole preview runs again once a PIN is accepted.
      const sent = await pin.guard(headers => $fetch(`/api/displays/${encode(display.id)}/commands`, { method: 'POST', headers, body }), () => preview(target))
      if (!sent) return
    }
    say(`Showing on ${listNames(displays.map(display => display.name))} for a minute.`, 'note', key)
  } catch (caught) {
    say(writeFailure(caught, 'The server couldn\'t show it on the wall'), 'error', key)
  } finally {
    busy.value = null
  }
}

// Art

/** Where each upload has got to, by what it is for (`day:isla|tile`), so a switch to another day does not show this one's bar. */
const uploadState = reactive<Record<string, { progress: number | null, error: string | null }>>({})
const slotKey = (slot: ArtSlot): string => `${selectionKey.value}|${slot}`

const uploads = computed<Uploads>(() => {
  const found: Uploads = {}
  for (const slot of SLOTS) {
    const state = uploadState[slotKey(slot)]
    if (state) found[slot] = state
  }
  return found
})

/** Puts the record the server sent back in the list, so the draft being typed in the editor is left alone. */
function replace(kind: Kind, record: SpecialDay | SpecialDayScene) {
  if (kind === 'day') days.value = days.value.map(day => day.id === record.id ? record as SpecialDay : day)
  else scenes.value = scenes.value.map(scene => scene.id === record.id ? record as SpecialDayScene : scene)
}

async function upload(slot: ArtSlot, file: File) {
  const target = selected.value
  if (!target || target.id === null) return
  const { kind, id } = target
  const key = `${keyOf(target)}|${slot}`
  const problem = artFileProblem(slot, file)
  if (problem) {
    uploadState[key] = { progress: null, error: problem }
    return
  }
  uploadState[key] = { progress: 0, error: null }
  try {
    const done = await pin.guard(
      headers => uploadArt<SpecialDay | SpecialDayScene>(`${pathOf(kind, id)}/art/${slot}`, file, headers, (progress) => {
        uploadState[key] = { progress, error: null }
      }),
      () => upload(slot, file),
    )
    if (done) replace(kind, done.value)
    uploadState[key] = { progress: null, error: null }
  } catch (caught) {
    uploadState[key] = { progress: null, error: uploadFailure(slot, caught) }
  }
}

async function clearArt(slot: ArtSlot) {
  const target = selected.value
  if (!target || target.id === null) return
  const { kind, id } = target
  const key = `${keyOf(target)}|${slot}`
  uploadState[key] = { progress: null, error: null }
  try {
    const done = await pin.guard(headers => $fetch<SpecialDay | SpecialDayScene>(`${pathOf(kind, id)}/art/${slot}`, { method: 'DELETE', headers }), () => clearArt(slot))
    if (done) replace(kind, done.value)
  } catch (caught) {
    uploadState[key] = { progress: null, error: writeFailure(caught, `Couldn't remove the ${ART_SLOT_LABELS[slot].toLowerCase()}`) }
  }
}
</script>

<template>
  <div class="special-days" data-testid="special-days-page">
    <div class="toolbar">
      <p class="intro">
        Birthdays, holidays and one-off dates, each with a picture for its tile and, if you like, the whole wall for the day.
      </p>
      <p v-if="unreachable" class="unreachable" role="status" data-testid="unreachable">
        <AppIcon :icon="WifiOff" :size="20" />
        {{ SERVER_UNREACHABLE }}
      </p>
    </div>

    <p v-if="!loaded" class="loading" data-testid="loading">
      Loading&hellip;
    </p>

    <div v-else class="layout">
      <SpecialDaysList
        :mode="mode"
        :days="days"
        :scenes="scenes"
        :selected="selected"
        :dirty="dirty"
        @update:mode="switchMode"
        @select="select"
        @add="add"
      />

      <div class="column">
        <SettingsNotice v-if="shownNote" :tone="shownNote.tone" data-testid="editor-note">
          {{ shownNote.text }}
        </SettingsNotice>

        <SpecialDaysDayEditor
          v-if="selected?.kind === 'day' && (selected.id === null || savedDay)"
          :key="editorKey"
          :saved="savedDay"
          :scenes="scenes"
          :today="today"
          :busy="busy"
          :uploads="uploads"
          :server-error="shownServerError"
          @dirty="dirty = $event"
          @save="saveDay"
          @delete="removeDay"
          @duplicate="savedDay && duplicate('day', savedDay.id)"
          @save-as-scene="savedDay && saveAsScene(savedDay.id)"
          @preview="selected && preview(selected)"
          @upload="upload"
          @clear-art="clearArt"
          @open-scene="select('scene', $event)"
        />
        <SpecialDaysSceneEditor
          v-else-if="selected?.kind === 'scene' && (selected.id === null || savedScene)"
          :key="editorKey"
          :saved="savedScene"
          :days="days"
          :today="today"
          :busy="busy"
          :uploads="uploads"
          :server-error="shownServerError"
          @dirty="dirty = $event"
          @save="saveScene"
          @delete="removeScene"
          @duplicate="savedScene && duplicate('scene', savedScene.id)"
          @preview="selected && preview(selected)"
          @upload="upload"
          @clear-art="clearArt"
          @open-day="select('day', $event)"
        />
        <SettingsCard v-else class="empty" data-testid="nothing-selected">
          <span class="badge">
            <AppIcon :icon="PartyPopper" :size="30" />
          </span>
          <p class="empty-text">
            Pick a day or a scene, or add one.
          </p>
        </SettingsCard>
      </div>
    </div>

    <SettingsConfirmDialog
      v-if="question"
      :title="question.title"
      :message="question.message"
      :confirm-label="question.confirmLabel"
      :tone="question.tone"
      @confirm="answer(true)"
      @cancel="answer(false)"
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
.special-days {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
}

.intro {
  flex: 1;
  min-width: 260px;
  margin: 0;
  color: var(--muted);
  font-size: 17px;
  font-weight: 500;
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
  padding: 48px 0;
  color: var(--muted);
  font-family: var(--font-display);
  font-size: 28px;
  text-align: center;
}

/* The list beside the editor; one above the other on a narrow screen. */
.layout {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}

.column {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}

.empty {
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

.empty-text {
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
