<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'
import { NIGHT_TEXTS, ORIENTATIONS } from '../../../shared/display'
import { DISPLAY_PREFERENCE_KEYS } from '../../../shared/settings'
import type { DisplayPreferenceKey, DisplayPreferences, DisplayPreferencesEntry, PreferencesUpdate } from '../../../shared/settings'
import {
  MONTH_STYLE_LABELS,
  NIGHT_TEXT_LABELS,
  ORIENTATION_LABELS,
  THEME_LABELS,
  WEEK_START_LABELS,
  draftOf,
  editedKeys,
  hourLabel,
  numberOrNull,
  preferenceText,
  refreshedDraft,
  resetUpdate,
  saveUpdate,
} from '~/utils/preferences'
import '~/assets/special-days-form.css'

// One display's preferences (PR 5.6): theme, month style, orientation
// (PR 5.10), week start, how long a pinned month stays, the hours the week
// view draws, burn-in shifting and the night view's text. The form edits a draft; Save sends only the keys
// that were edited and Reset (beside a key with a saved change) drops that
// change. The page does the sending, and tells the form what the server
// refused in `errors`.
const props = defineProps<{
  entry: DisplayPreferencesEntry
  /** The config has an `alarm` block, so the night view can show the next alarm. */
  alarmConfigured: boolean
  saving: boolean
  /** A message per refused key, from a 400. */
  errors: Record<string, string>
}>()

const emit = defineEmits<{
  submit: [update: PreferencesUpdate<DisplayPreferences>]
}>()

const draft = ref<DisplayPreferences>(draftOf(props.entry.values))
/** The keys of the last thing sent, so the draft knows which to take from the answer. */
let sent: string[] = []

watch(() => props.entry, (next, before) => {
  draft.value = refreshedDraft(draft.value, before.values, next.values, DISPLAY_PREFERENCE_KEYS, sent)
  sent = []
})

const edited = computed(() => editedKeys(draft.value, props.entry.values, DISPLAY_PREFERENCE_KEYS))
const dirty = computed(() => edited.value.length > 0)

function save() {
  const update = saveUpdate(draft.value, props.entry.values, DISPLAY_PREFERENCE_KEYS)
  if (!update) return
  sent = Object.keys(update.set ?? {})
  emit('submit', update)
}

function reset(key: DisplayPreferenceKey) {
  sent = [key]
  emit('submit', resetUpdate<DisplayPreferences>(key))
}

function discard() {
  draft.value = draftOf(props.entry.values)
}

const id = (key: string) => `${props.entry.id}-${key}`
const changed = (key: DisplayPreferenceKey) => props.entry.changed.includes(key)
const configText = (key: DisplayPreferenceKey) => preferenceText(key, props.entry.config[key])
const invalid = (key: string) => Boolean(props.errors[key])
const describedby = (key: string, hint = false) => [hint ? `pref-${props.entry.id}-${key}-hint` : null, props.errors[key] ? `pref-${props.entry.id}-${key}-error` : null].filter(Boolean).join(' ') || undefined

const FROM_HOURS = Array.from({ length: 24 }, (_, hour) => hour)
const TO_HOURS = Array.from({ length: 24 }, (_, hour) => hour + 1)

function setMinutes(event: Event) {
  // A blank box is null, which the server turns away with a message of its own.
  draft.value.month_return_minutes = numberOrNull((event.target as HTMLInputElement).value) as number
}
</script>

<template>
  <form class="prefs" :data-preferences="entry.id" novalidate @submit.prevent="save">
    <p v-if="errors._" class="sd-error" role="alert" data-testid="field-error-form">
      {{ errors._ }}
    </p>

    <div class="grid">
      <SettingsPreferenceField :scope="entry.id" name="theme" label="Theme" :changed="changed('theme')" :config-text="configText('theme')" :error="errors.theme" @reset="reset('theme')">
        <div class="sd-pills" role="radiogroup" aria-label="Theme">
          <label v-for="(label, value) in THEME_LABELS" :key="value" class="sd-pill">
            <input v-model="draft.theme" type="radio" :name="id('theme')" :value="value" :data-testid="`theme-${value}`">
            <span class="face">{{ label }}</span>
          </label>
        </div>
      </SettingsPreferenceField>

      <SettingsPreferenceField
        :scope="entry.id"
        name="month_style"
        label="Month style"
        :changed="changed('month_style')"
        :config-text="configText('month_style')"
        hint="Classic isn't built yet, so for now it shows Soft."
        :error="errors.month_style"
        @reset="reset('month_style')"
      >
        <div class="sd-pills" role="radiogroup" aria-label="Month style">
          <label v-for="(label, value) in MONTH_STYLE_LABELS" :key="value" class="sd-pill">
            <input v-model="draft.month_style" type="radio" :name="id('month_style')" :value="value" :data-testid="`month_style-${value}`">
            <span class="face">{{ label }}</span>
          </label>
        </div>
      </SettingsPreferenceField>

      <SettingsPreferenceField
        :scope="entry.id"
        name="orientation"
        label="Orientation"
        :changed="changed('orientation')"
        :config-text="configText('orientation')"
        hint="Auto is portrait when the screen is taller than it is wide. A link can set it for one device."
        :error="errors.orientation"
        @reset="reset('orientation')"
      >
        <div class="sd-pills" role="radiogroup" aria-label="Orientation">
          <label v-for="value in ORIENTATIONS" :key="value" class="sd-pill">
            <input v-model="draft.orientation" type="radio" :name="id('orientation')" :value="value" :data-testid="`orientation-${value}`">
            <span class="face">{{ ORIENTATION_LABELS[value] }}</span>
          </label>
        </div>
      </SettingsPreferenceField>

      <SettingsPreferenceField :scope="entry.id" name="week_start" label="Week starts on" :changed="changed('week_start')" :config-text="configText('week_start')" :error="errors.week_start" @reset="reset('week_start')">
        <div class="sd-pills" role="radiogroup" aria-label="Week starts on">
          <label v-for="(label, value) in WEEK_START_LABELS" :key="value" class="sd-pill">
            <input v-model="draft.week_start" type="radio" :name="id('week_start')" :value="value" :data-testid="`week_start-${value}`">
            <span class="face">{{ label }}</span>
          </label>
        </div>
      </SettingsPreferenceField>

      <SettingsPreferenceField
        :scope="entry.id"
        name="month_return_minutes"
        label="Month returns after"
        :label-for="id('month_return_minutes')"
        :changed="changed('month_return_minutes')"
        :config-text="configText('month_return_minutes')"
        hint="Minutes before a month someone paged to goes back to the current one."
        :error="errors.month_return_minutes"
        @reset="reset('month_return_minutes')"
      >
        <input
          :id="id('month_return_minutes')"
          class="sd-input"
          type="number"
          inputmode="numeric"
          min="1"
          max="1440"
          :value="draft.month_return_minutes ?? ''"
          :aria-invalid="invalid('month_return_minutes')"
          :aria-describedby="describedby('month_return_minutes', true)"
          data-testid="month_return_minutes"
          @input="setMinutes"
        >
      </SettingsPreferenceField>

      <SettingsPreferenceField
        :scope="entry.id"
        name="week_hours"
        label="Week view hours"
        label-id="week-hours-label"
        :changed="changed('week_hours')"
        :config-text="configText('week_hours')"
        hint="The hours the week view draws in full; the rest is folded away."
        :error="errors.week_hours"
        @reset="reset('week_hours')"
      >
        <div class="pair" role="group" aria-labelledby="week-hours-label">
          <span class="sd-select">
            <select v-model.number="draft.week_hours.from" class="sd-input" aria-label="From" :aria-invalid="invalid('week_hours')" data-testid="week_hours-from">
              <option v-for="hour in FROM_HOURS" :key="hour" :value="hour">{{ hourLabel(hour) }}</option>
            </select>
            <AppIcon :icon="ChevronDown" :size="20" />
          </span>
          <span class="to" aria-hidden="true">to</span>
          <span class="sd-select">
            <select v-model.number="draft.week_hours.to" class="sd-input" aria-label="To" :aria-invalid="invalid('week_hours')" data-testid="week_hours-to">
              <option v-for="hour in TO_HOURS" :key="hour" :value="hour">{{ hourLabel(hour) }}</option>
            </select>
            <AppIcon :icon="ChevronDown" :size="20" />
          </span>
        </div>
      </SettingsPreferenceField>

      <SettingsPreferenceField
        :scope="entry.id"
        name="burn_in"
        label="Burn-in shifting"
        label-id="burn-in-label"
        :changed="changed('burn_in')"
        :config-text="configText('burn_in')"
        hint="Moves the wall's content a little all day, so a still picture doesn't mark the screen."
        :error="errors.burn_in"
        @reset="reset('burn_in')"
      >
        <button
          type="button"
          class="sd-switch"
          role="switch"
          :aria-checked="draft.burn_in"
          aria-labelledby="burn-in-label"
          data-testid="burn_in"
          @click="draft.burn_in = !draft.burn_in"
        >
          <span class="track" aria-hidden="true"><span class="knob" /></span>
          <span>{{ draft.burn_in ? 'On' : 'Off' }}</span>
        </button>
      </SettingsPreferenceField>

      <SettingsPreferenceField
        :scope="entry.id"
        name="night_text"
        label="Night view text"
        :changed="changed('night_text')"
        :config-text="configText('night_text')"
        :hint="alarmConfigured ? 'Shown under the clock at night.' : 'Shown under the clock at night. Next alarm needs an alarm block in the config.'"
        :error="errors.night_text"
        @reset="reset('night_text')"
      >
        <div class="sd-pills" role="radiogroup" aria-label="Night view text">
          <label v-for="value in NIGHT_TEXTS" :key="value" class="sd-pill">
            <input v-model="draft.night_text" type="radio" :name="id('night_text')" :value="value" :disabled="value === 'next_alarm' && !alarmConfigured" :data-testid="`night_text-${value}`">
            <span class="face">{{ NIGHT_TEXT_LABELS[value] }}</span>
          </label>
        </div>
      </SettingsPreferenceField>
    </div>

    <SettingsPreferenceActions :dirty="dirty" :saving="saving" @save="save" @discard="discard" />
  </form>
</template>

<style scoped>
.prefs {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px 32px;
}

.pair {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pair .sd-select {
  flex: 1;
}

.to {
  color: var(--muted);
  font-size: 15px;
  font-weight: 700;
}

@media (max-width: 760px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
