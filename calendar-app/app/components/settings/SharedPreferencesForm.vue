<script setup lang="ts">
import { SHARED_PREFERENCE_KEYS } from '../../../shared/settings'
import type { NightAction, PreferencesEntry, PreferencesUpdate, SharedPreferenceKey, SharedPreferences } from '../../../shared/settings'
import {
  NIGHT_ACTION_LABELS,
  draftOf,
  editedKeys,
  numberOrNull,
  preferenceText,
  refreshedDraft,
  resetUpdate,
  saveUpdate,
} from '~/utils/preferences'
import '~/assets/special-days-form.css'

// The preferences every display shares (PR 5.6): the photo frame's interval and
// the two policies' thresholds. Like the per-display form, it edits a draft and
// sends only the keys that were edited. A number box left blank is null, which
// the server accepts for the lux thresholds and refuses (with a message here)
// for the rest.
const props = defineProps<{
  entry: PreferencesEntry<SharedPreferences>
  photosConfigured: boolean
  mqttConfigured: boolean
  saving: boolean
  errors: Record<string, string>
}>()

const emit = defineEmits<{
  submit: [update: PreferencesUpdate<SharedPreferences>]
}>()

const draft = ref<SharedPreferences>(draftOf(props.entry.values))
let sent: string[] = []

watch(() => props.entry, (next, before) => {
  draft.value = refreshedDraft(draft.value, before.values, next.values, SHARED_PREFERENCE_KEYS, sent)
  sent = []
})

const dirty = computed(() => editedKeys(draft.value, props.entry.values, SHARED_PREFERENCE_KEYS).length > 0)

function save() {
  const update = saveUpdate(draft.value, props.entry.values, SHARED_PREFERENCE_KEYS)
  if (!update) return
  sent = Object.keys(update.set ?? {})
  emit('submit', update)
}

function reset(key: SharedPreferenceKey) {
  sent = [key]
  emit('submit', resetUpdate<SharedPreferences>(key))
}

function discard() {
  draft.value = draftOf(props.entry.values)
}

type NumberKey = 'photo_interval_seconds' | 'off_after_minutes' | 'night_below_lux' | 'night_above_lux' | 'min_step' | 'smoothing_seconds'

function setNumber(key: NumberKey, event: Event) {
  // Blank is null; only the lux thresholds may be, and the server says so for the others.
  ;(draft.value as unknown as Record<NumberKey, number | null>)[key] = numberOrNull((event.target as HTMLInputElement).value)
}

const quietOn = computed(() => draft.value.quiet_hours !== null)

function toggleQuiet() {
  // Switching it on starts from the config's window if it has one, then from a typical night.
  draft.value.quiet_hours = quietOn.value ? null : { ...(props.entry.config.quiet_hours ?? { from: '22:00', to: '07:00' }) }
}

function setQuiet(side: 'from' | 'to', event: Event) {
  const quiet = draft.value.quiet_hours
  if (quiet) quiet[side] = (event.target as HTMLInputElement).value
}

const NIGHT_ACTIONS = Object.keys(NIGHT_ACTION_LABELS) as NightAction[]
const changed = (key: SharedPreferenceKey) => props.entry.changed.includes(key)
const configText = (key: SharedPreferenceKey) => preferenceText(key, props.entry.config[key])
const invalid = (key: string) => Boolean(props.errors[key])
const describedby = (key: string, hint = false) => [hint ? `pref-shared-${key}-hint` : null, props.errors[key] ? `pref-shared-${key}-error` : null].filter(Boolean).join(' ') || undefined
</script>

<template>
  <form class="prefs" data-preferences="shared" novalidate @submit.prevent="save">
    <p v-if="errors._" class="sd-error" role="alert" data-testid="field-error-form">
      {{ errors._ }}
    </p>

    <section class="group" aria-labelledby="shared-photos">
      <h3 id="shared-photos" class="subhead">
        Photo frame
      </h3>
      <div class="grid">
        <SettingsPreferenceField
          scope="shared"
          name="photo_interval_seconds"
          label="Each photo stays for"
          label-for="pref-photo_interval_seconds"
          :changed="changed('photo_interval_seconds')"
          :config-text="configText('photo_interval_seconds')"
          :hint="photosConfigured ? 'Seconds, at least 5.' : 'Photos are not set up: add a photos block to the config to change this.'"
          :error="errors.photo_interval_seconds"
          @reset="reset('photo_interval_seconds')"
        >
          <input
            id="pref-photo_interval_seconds"
            class="sd-input"
            type="number"
            inputmode="numeric"
            min="5"
            :value="draft.photo_interval_seconds ?? ''"
            :disabled="!photosConfigured"
            :aria-invalid="invalid('photo_interval_seconds')"
            :aria-describedby="describedby('photo_interval_seconds', true)"
            data-testid="photo_interval_seconds"
            @input="setNumber('photo_interval_seconds', $event)"
          >
        </SettingsPreferenceField>
      </div>
    </section>

    <p v-if="!mqttConfigured" class="sd-hint note" data-testid="mqtt-note">
      The auto presence and auto brightness policies only run when the config has an mqtt block, as the sensors report over MQTT. You can still set them here for when it does.
    </p>

    <section class="group" aria-labelledby="shared-presence">
      <h3 id="shared-presence" class="subhead">
        Auto presence
      </h3>
      <div class="grid">
        <SettingsPreferenceField
          scope="shared"
          name="off_after_minutes"
          label="Screen off after"
          label-for="pref-off_after_minutes"
          :changed="changed('off_after_minutes')"
          :config-text="configText('off_after_minutes')"
          hint="Minutes with nobody in the room."
          :error="errors.off_after_minutes"
          @reset="reset('off_after_minutes')"
        >
          <input
            id="pref-off_after_minutes"
            class="sd-input"
            type="number"
            inputmode="numeric"
            min="1"
            :value="draft.off_after_minutes ?? ''"
            :aria-invalid="invalid('off_after_minutes')"
            :aria-describedby="describedby('off_after_minutes', true)"
            data-testid="off_after_minutes"
            @input="setNumber('off_after_minutes', $event)"
          >
        </SettingsPreferenceField>

        <SettingsPreferenceField
          scope="shared"
          name="quiet_hours"
          label="Quiet hours"
          label-id="quiet-hours-label"
          :changed="changed('quiet_hours')"
          :config-text="configText('quiet_hours')"
          hint="The screen is left alone between these times."
          :error="errors.quiet_hours"
          @reset="reset('quiet_hours')"
        >
          <button type="button" class="sd-switch" role="switch" :aria-checked="quietOn" aria-labelledby="quiet-hours-label" data-testid="quiet_hours" @click="toggleQuiet">
            <span class="track" aria-hidden="true"><span class="knob" /></span>
            <span>{{ quietOn ? 'On' : 'Off' }}</span>
          </button>
          <div v-if="draft.quiet_hours" class="pair" role="group" aria-labelledby="quiet-hours-label">
            <input class="sd-input" type="time" aria-label="From" :value="draft.quiet_hours.from" :aria-invalid="invalid('quiet_hours')" data-testid="quiet_hours-from" @input="setQuiet('from', $event)">
            <span class="to" aria-hidden="true">to</span>
            <input class="sd-input" type="time" aria-label="To" :value="draft.quiet_hours.to" :aria-invalid="invalid('quiet_hours')" data-testid="quiet_hours-to" @input="setQuiet('to', $event)">
          </div>
        </SettingsPreferenceField>
      </div>
    </section>

    <section class="group" aria-labelledby="shared-brightness">
      <h3 id="shared-brightness" class="subhead">
        Auto brightness
      </h3>
      <div class="grid">
        <SettingsPreferenceField
          scope="shared"
          name="night_action"
          label="When the room is dark"
          :changed="changed('night_action')"
          :config-text="configText('night_action')"
          :error="errors.night_action"
          @reset="reset('night_action')"
        >
          <div class="sd-pills" role="radiogroup" aria-label="When the room is dark">
            <label v-for="value in NIGHT_ACTIONS" :key="value" class="sd-pill">
              <input v-model="draft.night_action" type="radio" name="night_action" :value="value" :data-testid="`night_action-${value}`">
              <span class="face">{{ NIGHT_ACTION_LABELS[value] }}</span>
            </label>
          </div>
        </SettingsPreferenceField>

        <SettingsPreferenceField
          scope="shared"
          name="night_below_lux"
          label="Dark below"
          label-for="pref-night_below_lux"
          :changed="changed('night_below_lux')"
          :config-text="configText('night_below_lux')"
          hint="Lux. Blank for no threshold."
          :error="errors.night_below_lux"
          @reset="reset('night_below_lux')"
        >
          <input
            id="pref-night_below_lux"
            class="sd-input"
            type="number"
            inputmode="decimal"
            min="0"
            step="any"
            :value="draft.night_below_lux ?? ''"
            :aria-invalid="invalid('night_below_lux')"
            :aria-describedby="describedby('night_below_lux', true)"
            data-testid="night_below_lux"
            @input="setNumber('night_below_lux', $event)"
          >
        </SettingsPreferenceField>

        <SettingsPreferenceField
          scope="shared"
          name="night_above_lux"
          label="Light again from"
          label-for="pref-night_above_lux"
          :changed="changed('night_above_lux')"
          :config-text="configText('night_above_lux')"
          hint="Lux. Blank for twice the dark level."
          :error="errors.night_above_lux"
          @reset="reset('night_above_lux')"
        >
          <input
            id="pref-night_above_lux"
            class="sd-input"
            type="number"
            inputmode="decimal"
            min="0"
            step="any"
            :value="draft.night_above_lux ?? ''"
            :aria-invalid="invalid('night_above_lux')"
            :aria-describedby="describedby('night_above_lux', true)"
            data-testid="night_above_lux"
            @input="setNumber('night_above_lux', $event)"
          >
        </SettingsPreferenceField>

        <SettingsPreferenceField
          scope="shared"
          name="min_step"
          label="Smallest change"
          label-for="pref-min_step"
          :changed="changed('min_step')"
          :config-text="configText('min_step')"
          hint="Brightness moves only when it would change by this many percent, 1 to 50."
          :error="errors.min_step"
          @reset="reset('min_step')"
        >
          <input
            id="pref-min_step"
            class="sd-input"
            type="number"
            inputmode="numeric"
            min="1"
            max="50"
            :value="draft.min_step ?? ''"
            :aria-invalid="invalid('min_step')"
            :aria-describedby="describedby('min_step', true)"
            data-testid="min_step"
            @input="setNumber('min_step', $event)"
          >
        </SettingsPreferenceField>

        <SettingsPreferenceField
          scope="shared"
          name="smoothing_seconds"
          label="Smoothing"
          label-for="pref-smoothing_seconds"
          :changed="changed('smoothing_seconds')"
          :config-text="configText('smoothing_seconds')"
          hint="Seconds of light readings averaged, 0 to 600."
          :error="errors.smoothing_seconds"
          @reset="reset('smoothing_seconds')"
        >
          <input
            id="pref-smoothing_seconds"
            class="sd-input"
            type="number"
            inputmode="numeric"
            min="0"
            max="600"
            :value="draft.smoothing_seconds ?? ''"
            :aria-invalid="invalid('smoothing_seconds')"
            :aria-describedby="describedby('smoothing_seconds', true)"
            data-testid="smoothing_seconds"
            @input="setNumber('smoothing_seconds', $event)"
          >
        </SettingsPreferenceField>
      </div>
    </section>

    <SettingsPreferenceActions :dirty="dirty" :saving="saving" @save="save" @discard="discard" />
  </form>
</template>

<style scoped>
.prefs {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.group {
  padding: 20px 24px;
  border-radius: 24px;
  background: var(--bg);
}

.subhead {
  margin: 0 0 12px;
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 400;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px 32px;
}

.note {
  margin: 0;
}

.pair {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pair .sd-input {
  flex: 1;
  min-width: 0;
  padding: 0 12px;
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
