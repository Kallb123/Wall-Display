<script setup lang="ts">
import { Lock } from 'lucide-vue-next'

// The PIN question on the settings pages: the remote's bottom sheet, as a card
// in the middle of the screen. The page owns what happens to the answer
// (`usePinRequest`), so this only collects it. Rendered with `v-if`, it starts
// empty and focused each time it opens.
defineProps<{
  /** What the last PIN tried got, or null. */
  message: string | null
  checking: boolean
}>()

const emit = defineEmits<{
  submit: [pin: string]
  cancel: []
}>()

const pin = ref('')
const input = useTemplateRef<HTMLInputElement>('input')

onMounted(() => input.value?.focus())
</script>

<template>
  <div class="scrim" data-testid="pin-dialog" @keydown.esc="emit('cancel')">
    <form class="dialog" role="dialog" aria-modal="true" aria-labelledby="pin-title" @submit.prevent="emit('submit', pin)">
      <span class="lock">
        <AppIcon :icon="Lock" :size="26" />
      </span>
      <h2 id="pin-title" class="title">
        Enter the PIN
      </h2>
      <p class="hint">
        Changes are protected, as the remote is. Ask whoever set up the wall for the PIN.
      </p>
      <input
        ref="input"
        v-model="pin"
        class="pin"
        type="text"
        inputmode="numeric"
        pattern="[0-9]*"
        autocomplete="off"
        minlength="4"
        maxlength="12"
        aria-label="PIN"
        data-testid="pin-input"
      >
      <p v-if="message" class="problem" role="alert" data-testid="pin-message">
        {{ message }}
      </p>
      <SettingsPillButton type="submit" variant="primary" :disabled="checking" data-testid="pin-submit">
        Unlock
      </SettingsPillButton>
      <button type="button" class="link" data-testid="pin-cancel" @click="emit('cancel')">
        Not now
      </button>
    </form>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: color-mix(in oklch, var(--text) 45%, transparent);
}

.dialog {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  box-sizing: border-box;
  width: 100%;
  max-width: 420px;
  padding: 32px;
  border-radius: 32px;
  background: var(--surface);
  box-shadow: var(--shadow-lift);
}

.lock {
  display: grid;
  align-self: flex-start;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--panel);
  color: var(--panel-text);
}

.title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 400;
}

.hint {
  margin: -6px 0 4px;
  color: var(--muted);
  font-size: 15px;
  font-weight: 500;
}

.pin {
  box-sizing: border-box;
  width: 100%;
  height: 56px;
  border: 2px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.3em;
  text-align: center;
  /* A PIN is not shown on the screen as it is typed. */
  -webkit-text-security: disc;
}

.pin:focus-visible,
.link:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 3px;
}

.problem {
  margin: 0;
  color: var(--accent-ink);
  font-weight: 700;
  text-align: center;
}

.link {
  align-self: center;
  min-height: 44px;
  padding: 0 12px;
  border: 0;
  background: none;
  color: var(--accent-ink);
  font: inherit;
  font-size: 16px;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 4px;
  cursor: pointer;
}
</style>
