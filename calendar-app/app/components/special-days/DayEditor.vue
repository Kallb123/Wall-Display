<script setup lang="ts">
import { Check, ChevronDown, Copy, Eye, Layers, Trash2 } from 'lucide-vue-next'
import {
  MAX_SPECIAL_DAY_GREETING,
  MAX_SPECIAL_DAY_NAME,
  MAX_SPECIAL_DAY_WHO,
} from '../../../shared/special-days'
import type { GreetingPlaceholder, SpecialDay, SpecialDayLead, SpecialDayScene } from '../../../shared/special-days'
import type { ArtSlot } from '~/utils/artUpload'
import {
  MONTH_OPTIONS,
  REPEAT_OPTIONS,
  dayBody,
  dayDraftFrom,
  dayIsDirty,
  dayOptions,
  draftLook,
  fieldOrigin,
  greetingPreview,
  newDayDraft,
  resetField,
  validateDay,
  withScene,
} from '~/utils/specialDayEditor'
import type { DayDraft, FieldErrors, MarkedField } from '~/utils/specialDayEditor'
import '~/assets/special-days-form.css'

// The right-hand column of the special days page for one day, new or saved
// (architecture §7.6): the form, and the actions under it. It holds the draft
// the form edits and nothing else: saving, deleting and uploading are the
// page's, which this asks for with events. On a day that uses a scene, each part
// of the look says whether it is the scene's or the day's own, and Reset gives
// the scene's back. A new day has no id to upload art to yet, so art waits for
// the first save.

const props = withDefaults(defineProps<{
  /** The day as saved, or null for a new one. */
  saved: SpecialDay | null
  scenes: readonly SpecialDayScene[]
  /** Today at the wall, `YYYY-MM-DD`: the next time the day falls is worked out from it. */
  today: string
  /** Which action is running (`save`, `delete`, `duplicate`, `save-as-scene` or `preview`), or null. */
  busy: string | null
  /** The art uploads in progress or refused, by slot. */
  uploads: Partial<Record<ArtSlot, { progress: number | null, error: string | null }>>
  /** What the server said about the last save, such as a greeting it can't fill. */
  serverError?: string | null
}>(), { serverError: null })

const emit = defineEmits<{
  'dirty': [dirty: boolean]
  'save': [body: Record<string, unknown>]
  'delete': []
  'duplicate': []
  'save-as-scene': []
  'preview': []
  'upload': [slot: ArtSlot, file: File]
  'clear-art': [slot: ArtSlot]
  'open-scene': [id: string]
}>()

const fresh = (): DayDraft => props.saved ? dayDraftFrom(props.saved) : newDayDraft(props.today)

const draft = ref<DayDraft>(fresh())
/** Save has been tried: from then on the problems show, and stay up to date as they are fixed. */
const attempted = ref(false)

// Back to the saved day when it is a different one, or when what it holds
// changed (a save, a "Save as scene"). An upload changes only its art, which
// isn't in the draft, so whatever is typed is kept.
const savedKey = computed(() => props.saved ? `${props.saved.id}|${JSON.stringify(dayBody(dayDraftFrom(props.saved)))}` : '')
watch(savedKey, () => {
  draft.value = fresh()
  attempted.value = false
})

const dirty = computed(() => dayIsDirty(draft.value, props.saved, props.today))
watch(dirty, value => emit('dirty', value), { immediate: true })

const scene = computed(() => props.scenes.find(candidate => candidate.id === draft.value.scene_id) ?? null)
const sceneName = computed(() => scene.value?.name ?? '')
const look = computed(() => draftLook(draft.value, props.saved, scene.value))

function origin(field: MarkedField) {
  return fieldOrigin(draft.value, props.saved, field)
}

function reset(field: Exclude<MarkedField, 'tile_art' | 'full_art'>) {
  draft.value = resetField(draft.value, field)
}

// Date

const days = computed(() => dayOptions(draft.value.month, draft.value.repeat, draft.value.year))

/** A shorter month takes the day with it: 31 January becomes 28 or 29 February, not a date that isn't there. */
function monthChanged() {
  const last = days.value.at(-1)
  if (last !== undefined && draft.value.day > last) draft.value.day = last
}

function chooseScene(event: Event) {
  const id = (event.target as HTMLSelectElement).value
  draft.value = withScene(draft.value, id === '' ? null : id, props.scenes)
}

// Look

/** The lead days as shown: the scene's while the day follows it. */
const leadDays = computed(() => draft.value.lead !== null ? draft.value.lead_days : look.value.lead_days === null ? '' : String(look.value.lead_days))

function setLead(lead: SpecialDayLead) {
  const shown = leadDays.value
  draft.value.lead = lead
  draft.value.lead_days = lead === 'days' ? shown : ''
}

function setLeadDays(value: string) {
  // Typing days while the day follows a scene whose lead is days makes the day's lead its own.
  if (draft.value.lead === null) draft.value.lead = look.value.lead
  draft.value.lead_days = value
}

const greeting = computed(() => draft.value.greeting ?? look.value.greeting ?? '')

/** `Sun 14 Mar 2027`, built from its parts so it reads the same whichever ICU version draws it. */
const dateFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
function dateLabel(date: string): string {
  const fields: Record<string, string> = {}
  for (const part of dateFormat.formatToParts(new Date(`${date}T00:00:00Z`))) fields[part.type] = part.value
  return `${fields.weekday} ${fields.day} ${fields.month} ${fields.year}`
}

/** What a placeholder the day can't fill needs: the fields that fill them are Who and Since. */
function missingText(missing: readonly GreetingPlaceholder[], repeat: DayDraft['repeat']): string {
  return missing
    .map((name) => {
      if (name === 'who') return 'Add Who to fill {who}'
      return repeat === 'once' ? `{${name}} needs a day that repeats every year` : `Add Since to fill {${name}}`
    })
    .join(' · ')
}

const preview = computed(() => greetingPreview(draft.value, scene.value, props.today))
/** The line under the greeting: the greeting as the wall will show it, or what stops it being filled. */
const previewLine = computed(() => {
  const value = preview.value
  if (!value) return null
  if (value.missing.length > 0) return { warning: true, text: missingText(value.missing, draft.value.repeat) }
  return { warning: false, text: value.date ? `${value.text} · on ${dateLabel(value.date)}` : value.text }
})

// Checking

/** The form's problems by field, once Save has been tried. The server can't fill a placeholder the day has nothing for, so that is refused here too. */
const errors = computed<FieldErrors>(() => {
  if (!attempted.value) return {}
  const found = validateDay(draft.value)
  if (!found.greeting && preview.value && preview.value.missing.length > 0) found.greeting = missingText(preview.value.missing, draft.value.repeat)
  return found
})

/** The id of the control that holds each field, so the first problem can take focus. */
const CONTROL_IDS: Partial<Record<keyof DayDraft, string>> = {
  name: 'day-name',
  month: 'day-month',
  day: 'day-day',
  year: 'day-year',
  who: 'day-who',
  since_year: 'day-since',
  lead_days: 'day-lead-days',
  greeting: 'day-greeting',
}
/** The fields in the order they are on the page. */
const FIELD_ORDER: (keyof DayDraft)[] = ['name', 'month', 'day', 'year', 'repeat', 'scene_id', 'who', 'since_year', 'lead', 'lead_days', 'takeover', 'greeting', 'palette']

const invalid = (field: keyof DayDraft) => errors.value[field] ? 'true' : undefined
/** The ids of the lines that describe a field: its hint, then its problem. */
function describedby(field: keyof DayDraft, hint?: string): string | undefined {
  return [hint, errors.value[field] ? `day-${field}-error` : null].filter(Boolean).join(' ') || undefined
}

async function submit() {
  attempted.value = true
  const found = errors.value
  const first = FIELD_ORDER.find(field => found[field])
  if (first || found.form) {
    await nextTick()
    if (first) document.getElementById(CONTROL_IDS[first] ?? '')?.focus()
    return
  }
  emit('save', dayBody(draft.value))
}

const running = (action: string) => props.busy === action
</script>

<template>
  <form class="editor" novalidate data-testid="day-editor" @submit.prevent="submit">
    <SettingsCard aria-labelledby="day-heading-day">
      <h2 id="day-heading-day" class="sd-heading">
        The day
      </h2>

      <div class="sd-field">
        <label for="day-name" class="sd-label">Name</label>
        <input
          id="day-name"
          v-model="draft.name"
          class="sd-input"
          type="text"
          autocomplete="off"
          placeholder="Isla's birthday"
          :maxlength="MAX_SPECIAL_DAY_NAME"
          :aria-invalid="invalid('name')"
          :aria-describedby="describedby('name')"
          data-testid="day-name"
        >
        <p v-if="errors.name" id="day-name-error" class="sd-error" data-testid="field-error-name">
          {{ errors.name }}
        </p>
      </div>

      <div class="date">
        <div class="sd-field">
          <label for="day-month" class="sd-label">Month</label>
          <span class="sd-select">
            <select
              id="day-month"
              v-model.number="draft.month"
              class="sd-input"
              :aria-invalid="invalid('month')"
              :aria-describedby="describedby('month')"
              data-testid="day-month"
              @change="monthChanged"
            >
              <option v-for="month in MONTH_OPTIONS" :key="month.value" :value="month.value">{{ month.label }}</option>
            </select>
            <AppIcon :icon="ChevronDown" :size="20" />
          </span>
          <p v-if="errors.month" id="day-month-error" class="sd-error" data-testid="field-error-month">
            {{ errors.month }}
          </p>
        </div>

        <div class="sd-field">
          <label for="day-day" class="sd-label">Day</label>
          <span class="sd-select">
            <select
              id="day-day"
              v-model.number="draft.day"
              class="sd-input"
              :aria-invalid="invalid('day')"
              :aria-describedby="describedby('day')"
              data-testid="day-day"
            >
              <option v-for="day in days" :key="day" :value="day">{{ day }}</option>
            </select>
            <AppIcon :icon="ChevronDown" :size="20" />
          </span>
          <p v-if="errors.day" id="day-day-error" class="sd-error" data-testid="field-error-day">
            {{ errors.day }}
          </p>
        </div>

        <div v-if="draft.repeat === 'once'" class="sd-field">
          <label for="day-year" class="sd-label">Year</label>
          <input
            id="day-year"
            v-model="draft.year"
            class="sd-input"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            placeholder="2027"
            :aria-invalid="invalid('year')"
            :aria-describedby="describedby('year')"
            data-testid="day-year"
          >
          <p v-if="errors.year" id="day-year-error" class="sd-error" data-testid="field-error-year">
            {{ errors.year }}
          </p>
        </div>
      </div>

      <div class="sd-field">
        <span id="day-repeat-label" class="sd-label">Repeats</span>
        <div class="sd-pills" role="radiogroup" aria-labelledby="day-repeat-label">
          <label v-for="option in REPEAT_OPTIONS" :key="option.value" class="sd-pill">
            <input v-model="draft.repeat" type="radio" name="day-repeat" :value="option.value" :data-testid="`repeat-${option.value}`">
            <span class="face">{{ option.label }}</span>
          </label>
        </div>
      </div>
    </SettingsCard>

    <SettingsCard aria-labelledby="day-heading-scene">
      <h2 id="day-heading-scene" class="sd-heading">
        Scene and person
      </h2>

      <div class="sd-field">
        <span class="sd-label">
          <label for="day-scene">Scene</label>
          <button v-if="scene" type="button" class="link" data-testid="edit-scene" @click="emit('open-scene', scene.id)">
            Edit scene
          </button>
        </span>
        <span class="sd-select">
          <select id="day-scene" class="sd-input" :value="draft.scene_id ?? ''" data-testid="day-scene" @change="chooseScene">
            <option value="">None</option>
            <option v-for="option in scenes" :key="option.id" :value="option.id">{{ option.name }}</option>
          </select>
          <AppIcon :icon="ChevronDown" :size="20" />
        </span>
        <p id="day-scene-hint" class="sd-hint">
          A scene is a look shared by days, such as Birthday. Anything you change here is this day's own.
        </p>
      </div>

      <div class="pair">
        <div class="sd-field">
          <label for="day-who" class="sd-label">Who</label>
          <input
            id="day-who"
            v-model="draft.who"
            class="sd-input"
            type="text"
            autocomplete="off"
            placeholder="Isla"
            :maxlength="MAX_SPECIAL_DAY_WHO"
            :aria-invalid="invalid('who')"
            :aria-describedby="describedby('who', 'day-who-hint')"
            data-testid="day-who"
          >
          <p id="day-who-hint" class="sd-hint">
            Fills {who} in the greeting.
          </p>
          <p v-if="errors.who" id="day-who-error" class="sd-error" data-testid="field-error-who">
            {{ errors.who }}
          </p>
        </div>

        <div class="sd-field">
          <label for="day-since" class="sd-label">Since</label>
          <input
            id="day-since"
            v-model="draft.since_year"
            class="sd-input"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            placeholder="2020"
            :disabled="draft.repeat === 'once'"
            :aria-invalid="invalid('since_year')"
            :aria-describedby="describedby('since_year', 'day-since-hint')"
            data-testid="day-since"
          >
          <p id="day-since-hint" class="sd-hint">
            {{ draft.repeat === 'once' ? 'Only for a day that repeats every year.' : 'The first year, such as a birth year. Fills {years} and {nth}.' }}
          </p>
          <p v-if="errors.since_year" id="day-since_year-error" class="sd-error" data-testid="field-error-since_year">
            {{ errors.since_year }}
          </p>
        </div>
      </div>
    </SettingsCard>

    <SettingsCard aria-labelledby="day-heading-calendar">
      <h2 id="day-heading-calendar" class="sd-heading">
        On the calendar
      </h2>

      <SpecialDaysArtDrop
        label="Day tile art"
        art-slot="tile"
        :art="look.tile_art"
        aspect="square"
        :progress="uploads.tile?.progress ?? null"
        :error="uploads.tile?.error ?? null"
        :disabled="saved === null"
        :hint="saved === null ? 'Save the day first to add art' : 'PNG, WebP or SVG, up to 2 MB'"
        :origin="origin('tile_art')"
        :scene-name="sceneName"
        :clearable="saved?.tile_art != null"
        @file="emit('upload', 'tile', $event)"
        @clear="emit('clear-art', 'tile')"
      />

      <div class="sd-field">
        <span class="sd-label">
          Show on the calendar from
          <SpecialDaysFieldMark :origin="origin('lead')" :scene-name="sceneName" @reset="reset('lead')" />
        </span>
        <SpecialDaysLeadPicker
          :model-value="look.lead"
          :lead-days="leadDays"
          label="Show on the calendar from"
          input-id="day-lead-days"
          :invalid="Boolean(errors.lead_days)"
          :describedby="describedby('lead_days')"
          @update:model-value="setLead"
          @update:lead-days="setLeadDays"
        />
        <p v-if="errors.lead_days" id="day-lead_days-error" class="sd-error" data-testid="field-error-lead_days">
          {{ errors.lead_days }}
        </p>
        <p v-if="errors.lead" id="day-lead-error" class="sd-error" data-testid="field-error-lead">
          {{ errors.lead }}
        </p>
      </div>

      <div class="sd-field">
        <span class="sd-label">
          Palette
          <SpecialDaysFieldMark :origin="origin('palette')" :scene-name="sceneName" @reset="reset('palette')" />
        </span>
        <SpecialDaysPaletteSwatches :model-value="look.palette" label="Palette" @update:model-value="draft.palette = $event" />
        <p class="sd-hint">
          Tints the day's tile, and the whole wall when it takes over.
        </p>
      </div>
    </SettingsCard>

    <SettingsCard aria-labelledby="day-takeover-label">
      <div class="takeover-head">
        <button
          type="button"
          class="sd-switch"
          role="switch"
          :aria-checked="look.takeover"
          aria-labelledby="day-takeover-label"
          aria-describedby="day-takeover-hint"
          data-testid="takeover"
          @click="draft.takeover = !look.takeover"
        >
          <span class="track" aria-hidden="true"><span class="knob" /></span>
          <span id="day-takeover-label">Full-screen takeover</span>
        </button>
        <SpecialDaysFieldMark :origin="origin('takeover')" :scene-name="sceneName" @reset="reset('takeover')" />
      </div>
      <p id="day-takeover-hint" class="sd-hint hint-flush">
        On the day itself, the wall shows this day's picture across the whole screen, with a greeting.
      </p>

      <div class="takeover-body" :class="{ faded: !look.takeover }" :inert="look.takeover ? undefined : true" data-testid="takeover-body">
        <SpecialDaysArtDrop
          label="Full-screen art"
          art-slot="full"
          :art="look.full_art"
          aspect="wide"
          :progress="uploads.full?.progress ?? null"
          :error="uploads.full?.error ?? null"
          :disabled="saved === null"
          :hint="saved === null ? 'Save the day first to add art' : 'Any picture, up to 20 MB'"
          :origin="origin('full_art')"
          :scene-name="sceneName"
          :clearable="saved?.full_art != null"
          @file="emit('upload', 'full', $event)"
          @clear="emit('clear-art', 'full')"
        />

        <SpecialDaysArtDrop
          label="Extra layer"
          art-slot="extra"
          :art="saved?.extra_art ?? null"
          aspect="wide"
          :progress="uploads.extra?.progress ?? null"
          :error="uploads.extra?.error ?? null"
          :disabled="saved === null"
          :hint="saved === null ? 'Save the day first to add art' : 'A transparent layer drawn over the art, just for this day'"
          :clearable="saved?.extra_art != null"
          @file="emit('upload', 'extra', $event)"
          @clear="emit('clear-art', 'extra')"
        />

        <div class="sd-field">
          <span class="sd-label">
            <label for="day-greeting">Greeting</label>
            <SpecialDaysFieldMark :origin="origin('greeting')" :scene-name="sceneName" @reset="reset('greeting')" />
          </span>
          <input
            id="day-greeting"
            class="sd-input"
            type="text"
            autocomplete="off"
            :value="greeting"
            :placeholder="scene?.greeting ?? 'Happy {nth} birthday, {who}!'"
            :maxlength="MAX_SPECIAL_DAY_GREETING"
            :aria-invalid="invalid('greeting')"
            :aria-describedby="describedby('greeting', 'day-greeting-hint')"
            data-testid="day-greeting"
            @input="draft.greeting = ($event.target as HTMLInputElement).value"
          >
          <p id="day-greeting-hint" class="sd-hint">
            Use {who}, {years} and {nth} to fill in the name and the years.
          </p>
          <p
            v-if="previewLine"
            class="preview"
            :class="{ warning: previewLine.warning }"
            aria-live="polite"
            data-testid="greeting-preview"
          >
            {{ previewLine.text }}
          </p>
          <p v-if="errors.greeting" id="day-greeting-error" class="sd-error" data-testid="field-error-greeting">
            {{ errors.greeting }}
          </p>
        </div>
      </div>
    </SettingsCard>

    <SettingsNotice v-if="errors.form" tone="error" data-testid="field-error-form">
      {{ errors.form }}
    </SettingsNotice>
    <SettingsNotice v-if="serverError" tone="error" data-testid="server-error">
      {{ serverError }}
    </SettingsNotice>

    <div class="actions" role="group" aria-label="Actions">
      <div class="side">
        <SettingsPillButton v-if="saved" class="compact danger" :disabled="busy !== null" data-testid="day-delete" @click="emit('delete')">
          <AppIcon :icon="Trash2" :size="20" />
          {{ running('delete') ? 'Deleting…' : 'Delete' }}
        </SettingsPillButton>
        <p v-if="dirty" class="unsaved" data-testid="unsaved">
          <span class="unsaved-dot" aria-hidden="true" />
          Unsaved changes
        </p>
      </div>
      <div class="side end">
        <template v-if="saved">
          <SettingsPillButton class="compact" :disabled="busy !== null || dirty" :title="dirty ? 'Save first to copy this day' : undefined" data-testid="day-duplicate" @click="emit('duplicate')">
            <AppIcon :icon="Copy" :size="20" />
            {{ running('duplicate') ? 'Copying…' : 'Duplicate' }}
          </SettingsPillButton>
          <SettingsPillButton class="compact" :disabled="busy !== null || dirty" :title="dirty ? 'Save first to make a scene from this day' : undefined" data-testid="day-save-as-scene" @click="emit('save-as-scene')">
            <AppIcon :icon="Layers" :size="20" />
            {{ running('save-as-scene') ? 'Saving…' : 'Save as scene' }}
          </SettingsPillButton>
          <SettingsPillButton class="compact" :disabled="busy !== null || dirty" :title="dirty ? 'Save first to preview' : undefined" data-testid="day-preview" @click="emit('preview')">
            <AppIcon :icon="Eye" :size="20" />
            {{ running('preview') ? 'Sending…' : 'Preview on wall' }}
          </SettingsPillButton>
        </template>
        <SettingsPillButton class="compact" type="submit" variant="primary" :disabled="busy !== null || (!dirty && saved !== null)" data-testid="day-save">
          <AppIcon :icon="Check" :size="20" />
          {{ running('save') ? 'Saving…' : 'Save' }}
        </SettingsPillButton>
      </div>
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

.date {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 16px;
}

.pair {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}

.link {
  min-height: 26px;
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--accent-ink);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.link:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}

.takeover-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
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

.preview.warning {
  color: var(--accent-ink);
}

/* Under the cards while the form is long, so Save is never off the screen. */
.actions {
  position: sticky;
  bottom: 16px;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 12px;
  padding: 12px 16px;
  border-radius: 32px;
  background: var(--surface);
  box-shadow: var(--shadow-lift);
}

/* Delete and the unsaved flag on the left, the rest on the right with Save last. At 1280px it all fits on one line; when it can't, the right group drops under the left, still on the right. */
.side {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.side.end {
  justify-content: flex-end;
  margin-left: auto;
}

/* A little tighter than the page's buttons, so the five of a day fit. */
.actions .compact {
  padding: 0 12px;
  gap: 6px;
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

@media (max-width: 600px) {
  .actions {
    padding: 12px;
    border-radius: 28px;
  }

  .side,
  .side.end {
    flex: 1 1 100%;
  }

  .side.end > * {
    flex: 1 1 auto;
    justify-content: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .takeover-body {
    transition: none;
  }
}
</style>
