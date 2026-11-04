<script setup lang="ts">
// One preference in the Displays tab's forms: its label, the control (the
// slot), and beneath it a hint and the server's message if it refused the
// value. When the key has a saved change, "Changed" and Reset sit beside the
// label, and Reset goes back to what config.yaml says (`configText`).
// Nothing shows when the value is the config's.
defineProps<{
  label: string
  /** The id of the control the label names. Leave out for a group, which is named by `labelId`. */
  labelFor?: string
  labelId?: string
  changed: boolean
  /** The config's value in words, for the Reset button. */
  configText: string
  hint?: string | null
  error?: string | null
  /** The key, for test ids. */
  name: string
  /** Whose form it is (a display's id or `shared`), so the ids of the hint and error are unique on the page. */
  scope: string
}>()

const emit = defineEmits<{
  reset: []
}>()
</script>

<template>
  <div class="sd-field" :data-pref="name">
    <span class="sd-label">
      <label v-if="labelFor" :for="labelFor">{{ label }}</label>
      <span v-else :id="labelId">{{ label }}</span>
      <span v-if="changed" class="group">
        <span class="mark" data-testid="mark-changed">Changed</span>
        <button type="button" class="reset" :aria-label="`Reset ${label} to ${configText}`" data-testid="reset" @click="emit('reset')">Reset</button>
      </span>
    </span>
    <slot />
    <p v-if="hint" :id="`pref-${scope}-${name}-hint`" class="sd-hint">
      {{ hint }}
    </p>
    <p v-if="error" :id="`pref-${scope}-${name}-error`" class="sd-error" data-testid="field-error">
      {{ error }}
    </p>
  </div>
</template>

<style scoped>
.group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.mark {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: var(--radius-pill);
  background: color-mix(in oklch, var(--accent) 22%, var(--surface));
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}

.reset {
  min-height: 32px;
  padding: 0 8px;
  border: 0;
  background: none;
  color: var(--accent-ink);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
  touch-action: manipulation;
}

.reset:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
</style>
