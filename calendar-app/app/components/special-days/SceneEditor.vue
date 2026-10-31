<script setup lang="ts">
import { Check, Copy, Eye, Trash2 } from 'lucide-vue-next'
import { MAX_SPECIAL_DAY_GREETING, MAX_SPECIAL_DAY_NAME } from '../../../shared/special-days'
import type { GreetingPlaceholder, SpecialDay, SpecialDayLead, SpecialDayScene } from '../../../shared/special-days'
import type { ArtSlot } from '~/utils/artUpload'
import {
  daysUsing,
  newSceneDraft,
  sceneBody,
  sceneDraftFrom,
  sceneGreetingPreview,
  sceneIsDirty,
  usedByLabel,
  validateScene,
} from '~/utils/specialDayEditor'
import type { SceneDraft, SceneFieldErrors } from '~/utils/specialDayEditor'
import '~/assets/special-days-form.css'

// The right-hand column of the special days page for one scene, new or saved
// (architecture §7.6): a whole look with no date, and the days that use it.
// Like the day editor it holds only the draft the form edits, and asks the page
// for everything else with events. A scene has no marks (it is the thing the
// days are compared with) and no extra layer (that is a day's own). Saving a
// scene changes every day that uses it and has not set that part itself, which
// is why "Used by" is on the page and the page says how many days a save changes.

const props = withDefaults(defineProps<{
  /** The scene as saved, or null for a new one. */
  saved: SpecialDayScene | null
  /** Every day, to list the ones that use this scene. */
  days: readonly SpecialDay[]
  /** Today at the wall, `YYYY-MM-DD`. */
  today: string
  /** Which action is running (`save`, `delete`, `duplicate` or `preview`), or null. */
  busy: string | null
  /** The art uploads in progress or refused, by slot. */
  uploads: Partial<Record<ArtSlot, { progress: number | null, error: string | null }>>
  /** What the server said about the last save. */
  serverError?: string | null
}>(), { serverError: null })

const emit = defineEmits<{
  'dirty': [dirty: boolean]
  'save': [body: Record<string, unknown>]
  'delete': []
  'duplicate': []
  'preview': []
  'upload': [slot: ArtSlot, file: File]
  'clear-art': [slot: ArtSlot]
  'open-day': [id: string]
}>()

const fresh = (): SceneDraft => props.saved ? sceneDraftFrom(props.saved) : newSceneDraft()

const draft = ref<SceneDraft>(fresh())
/** Save has been tried: from then on the problems show, and stay up to date as they are fixed. */
const attempted = ref(false)

// Back to the saved scene when it is a different one or what it holds changed
// (a save). An upload changes only the art, which isn't in the draft.
const savedKey = computed(() => props.saved ? `${props.saved.id}|${JSON.stringify(sceneBody(sceneDraftFrom(props.saved)))}` : '')
watch(savedKey, () => {
  draft.value = fresh()
  attempted.value = false
})

const dirty = computed(() => sceneIsDirty(draft.value, props.saved))
watch(dirty, value => emit('dirty', value), { immediate: true })

const users = computed(() => props.saved ? daysUsing(props.saved.id, props.days) : [])

const errors = computed<SceneFieldErrors>(() => attempted.value ? validateScene(draft.value) : {})

/** The id of the control that holds each field, so the first problem can take focus. */
const CONTROL_IDS: Partial<Record<keyof SceneDraft, string>> = {
  name: 'scene-name',
  lead_days: 'scene-lead-days',
  greeting: 'scene-greeting',
}
/** The fields in the order they are on the page. */
const FIELD_ORDER: (keyof SceneDraft)[] = ['name', 'lead', 'lead_days', 'takeover', 'greeting', 'palette']

const invalid = (field: keyof SceneDraft) => errors.value[field] ? 'true' : undefined
/** The ids of the lines that describe a field: its hint, then its problem. */
function describedby(field: keyof SceneDraft, hint?: string): string | undefined {
  return [hint, errors.value[field] ? `scene-${field}-error` : null].filter(Boolean).join(' ') || undefined
}

function setLead(lead: SpecialDayLead) {
  draft.value.lead = lead
  if (lead !== 'days') draft.value.lead_days = ''
}

/** What a placeholder a day can't fill needs: the fields that fill them are Who and Since. */
function missingText(missing: readonly GreetingPlaceholder[]): string {
  return missing.map(name => name === 'who' ? 'needs Who' : 'needs Since').join(', ')
}

const preview = computed(() => sceneGreetingPreview(draft.value, props.days, props.saved?.id ?? null, props.today))
/** The line under the greeting: how it reads on the first day that uses it, or that it is filled in for each. */
const previewLine = computed(() => {
  if (draft.value.greeting.trim() === '') return null
  const value = preview.value
  if (!value) return 'Placeholders are filled in for each day that uses this scene'
  const warning = value.missing.length > 0 ? ` (${value.day} ${missingText(value.missing)})` : ''
  return `On ${value.day}: ${value.text}${warning}`
})

async function submit() {
  attempted.value = true
  const found = errors.value
  const first = FIELD_ORDER.find(field => found[field])
  if (first || found.form) {
    await nextTick()
    if (first) document.getElementById(CONTROL_IDS[first] ?? '')?.focus()
    return
  }
  emit('save', sceneBody(draft.value))
}

const running = (action: string) => props.busy === action
</script>

<template>
  <form class="editor" novalidate data-testid="scene-editor" @submit.prevent="submit">
    <SettingsCard aria-labelledby="scene-heading-scene">
      <h2 id="scene-heading-scene" class="sd-heading">
        The scene
      </h2>

      <div class="sd-field">
        <label for="scene-name" class="sd-label">Name</label>
        <input
          id="scene-name"
          v-model="draft.name"
          class="sd-input"
          type="text"
          autocomplete="off"
          placeholder="Birthday"
          :maxlength="MAX_SPECIAL_DAY_NAME"
          :aria-invalid="invalid('name')"
          :aria-describedby="describedby('name')"
          data-testid="scene-name"
        >
        <p v-if="errors.name" id="scene-name-error" class="sd-error" data-testid="field-error-name">
          {{ errors.name }}
        </p>
      </div>

      <SpecialDaysArtDrop
        label="Tile art"
        art-slot="tile"
        :art="saved?.tile_art ?? null"
        aspect="square"
        :progress="uploads.tile?.progress ?? null"
        :error="uploads.tile?.error ?? null"
        :disabled="saved === null"
        :hint="saved === null ? 'Save the scene first to add art' : 'PNG, WebP or SVG, up to 2 MB'"
        :clearable="saved?.tile_art != null"
        @file="emit('upload', 'tile', $event)"
        @clear="emit('clear-art', 'tile')"
      />

      <div class="sd-field">
        <span class="sd-label">Show on the calendar from</span>
        <SpecialDaysLeadPicker
          :model-value="draft.lead"
          :lead-days="draft.lead_days"
          label="Show on the calendar from"
          input-id="scene-lead-days"
          :invalid="Boolean(errors.lead_days)"
          :describedby="describedby('lead_days')"
          @update:model-value="setLead"
          @update:lead-days="draft.lead_days = $event"
        />
        <p v-if="errors.lead_days" id="scene-lead_days-error" class="sd-error" data-testid="field-error-lead_days">
          {{ errors.lead_days }}
        </p>
      </div>

      <div class="sd-field">
        <span class="sd-label">Palette</span>
        <SpecialDaysPaletteSwatches v-model="draft.palette" label="Palette" />
        <p class="sd-hint">
          Tints the tile, and the whole wall when it takes over.
        </p>
      </div>
    </SettingsCard>

    <SettingsCard aria-labelledby="scene-takeover-label">
      <button
        type="button"
        class="sd-switch"
        role="switch"
        :aria-checked="draft.takeover"
        aria-labelledby="scene-takeover-label"
        aria-describedby="scene-takeover-hint"
        data-testid="takeover"
        @click="draft.takeover = !draft.takeover"
      >
        <span class="track" aria-hidden="true"><span class="knob" /></span>
        <span id="scene-takeover-label">Full-screen takeover</span>
      </button>
      <p id="scene-takeover-hint" class="sd-hint hint-flush">
        On the day itself, the wall shows the scene's picture across the whole screen, with a greeting.
      </p>

      <div class="takeover-body" :class="{ faded: !draft.takeover }" :inert="draft.takeover ? undefined : true" data-testid="takeover-body">
        <SpecialDaysArtDrop
          label="Full-screen art"
          art-slot="full"
          :art="saved?.full_art ?? null"
          aspect="wide"
          :progress="uploads.full?.progress ?? null"
          :error="uploads.full?.error ?? null"
          :disabled="saved === null"
          :hint="saved === null ? 'Save the scene first to add art' : 'Any picture, up to 20 MB'"
          :clearable="saved?.full_art != null"
          @file="emit('upload', 'full', $event)"
          @clear="emit('clear-art', 'full')"
        />

        <div class="sd-field">
          <label for="scene-greeting" class="sd-label">Greeting</label>
          <input
            id="scene-greeting"
            v-model="draft.greeting"
            class="sd-input"
            type="text"
            autocomplete="off"
            placeholder="Happy {nth} birthday, {who}!"
            :maxlength="MAX_SPECIAL_DAY_GREETING"
            :aria-invalid="invalid('greeting')"
            :aria-describedby="describedby('greeting', 'scene-greeting-hint')"
            data-testid="scene-greeting"
          >
          <p id="scene-greeting-hint" class="sd-hint">
            Use {who}, {years} and {nth} to fill in each day's name and years.
          </p>
          <p v-if="previewLine" class="preview" aria-live="polite" data-testid="greeting-preview">
            {{ previewLine }}
          </p>
          <p v-if="errors.greeting" id="scene-greeting-error" class="sd-error" data-testid="field-error-greeting">
            {{ errors.greeting }}
          </p>
        </div>
      </div>
    </SettingsCard>

    <SettingsCard aria-labelledby="scene-heading-used">
      <h2 id="scene-heading-used" class="sd-heading">
        Used by
      </h2>
      <p v-if="users.length === 0" class="none" data-testid="scene-unused">
        No days use this scene yet.
      </p>
      <template v-else>
        <p class="count" data-testid="scene-used-count">
          {{ usedByLabel(users.length) }}. Saving the scene changes each of them, except for anything a day has changed itself.
        </p>
        <ul class="users">
          <li v-for="day in users" :key="day.id">
            <button type="button" class="user" :data-id="day.id" data-testid="scene-day" @click="emit('open-day', day.id)">
              {{ day.name }}
            </button>
          </li>
        </ul>
      </template>
    </SettingsCard>

    <SettingsNotice v-if="errors.form" tone="error" data-testid="field-error-form">
      {{ errors.form }}
    </SettingsNotice>
    <SettingsNotice v-if="serverError" tone="error" data-testid="server-error">
      {{ serverError }}
    </SettingsNotice>

    <div class="actions" role="group" aria-label="Actions">
      <SettingsPillButton v-if="saved" class="compact danger" :disabled="busy !== null" data-testid="scene-delete" @click="emit('delete')">
        <AppIcon :icon="Trash2" :size="20" />
        {{ running('delete') ? 'Deleting…' : users.length > 0 ? 'Copy into days and delete' : 'Delete' }}
      </SettingsPillButton>
      <p v-if="dirty" class="unsaved" data-testid="unsaved">
        <span class="unsaved-dot" aria-hidden="true" />
        Unsaved changes
      </p>
      <span class="spacer" />
      <template v-if="saved">
        <SettingsPillButton class="compact" :disabled="busy !== null || dirty" :title="dirty ? 'Save first to copy this scene' : undefined" data-testid="scene-duplicate" @click="emit('duplicate')">
          <AppIcon :icon="Copy" :size="20" />
          {{ running('duplicate') ? 'Copying…' : 'Duplicate' }}
        </SettingsPillButton>
        <SettingsPillButton class="compact" :disabled="busy !== null || dirty" :title="dirty ? 'Save first to preview' : undefined" data-testid="scene-preview" @click="emit('preview')">
          <AppIcon :icon="Eye" :size="20" />
          {{ running('preview') ? 'Sending…' : 'Preview on wall' }}
        </SettingsPillButton>
      </template>
      <SettingsPillButton class="compact" type="submit" variant="primary" :disabled="busy !== null || (!dirty && saved !== null)" data-testid="scene-save">
        <AppIcon :icon="Check" :size="20" />
        {{ running('save') ? 'Saving…' : 'Save' }}
      </SettingsPillButton>
    </div>
  </form>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}

.sd-heading {
  margin: 0;
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 400;
}

.hint-flush {
  margin-top: -12px;
}

.takeover-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  transition: opacity 0.2s ease;
}

/* Off: still there, so a greeting or a picture is not lost by flicking the switch, but not for using. */
.takeover-body.faded {
  opacity: 0.45;
}

.preview {
  margin: 0;
  padding: 10px 16px;
  border-radius: 16px;
  background: var(--bg);
  font-size: 16px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.none,
.count {
  margin: 0;
  color: var(--muted);
  font-size: 16px;
  font-weight: 600;
}

.users {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.user {
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

.user:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 3px;
}

/* Under the cards while the form is long, so Save is never off the screen. */
.actions {
  position: sticky;
  bottom: 16px;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 14px 20px;
  border-radius: 32px;
  background: var(--surface);
  box-shadow: var(--shadow-lift);
}

.spacer {
  flex: 1;
}

.actions .compact {
  padding: 0 16px;
  gap: 8px;
}

.actions .danger {
  border-color: var(--accent-ink);
  color: var(--accent-ink);
}

.unsaved {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 0 12px;
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
}

.unsaved-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
}

@media (prefers-reduced-motion: reduce) {
  .takeover-body {
    transition: none;
  }
}
</style>
