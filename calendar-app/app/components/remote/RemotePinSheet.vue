<script setup lang="ts">
import { Lock } from 'lucide-vue-next'

// The PIN prompt, for a remote that is protected. It is on the page only while a
// PIN is wanted, so it starts empty and takes the focus each time it opens.

defineProps<{
  /** Why the last PIN was refused, if it was. */
  message: string | null
  /** The PIN is being checked. */
  checking: boolean
}>()

const emit = defineEmits<{
  submit: [pin: string]
  cancel: []
}>()

const pin = ref('')
const pinInput = useTemplateRef<HTMLInputElement>('pin-input')

onMounted(() => pinInput.value?.focus())
</script>

<template>
  <div class="scrim" data-testid="pin-sheet">
    <form class="sheet" role="dialog" aria-modal="true" aria-labelledby="pin-title" @submit.prevent="emit('submit', pin)">
      <span class="power lock">
        <AppIcon :icon="Lock" :size="26" />
      </span>
      <h2 id="pin-title" class="sheet-title">
        Enter the PIN
      </h2>
      <p class="hint">
        This remote is protected. Ask whoever set up the wall for the PIN.
      </p>
      <input
        ref="pin-input"
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
      <button type="submit" class="button primary" :disabled="checking" data-testid="pin-submit">
        Unlock
      </button>
      <button type="button" class="link" @click="emit('cancel')">
        Not now
      </button>
    </form>
  </div>
</template>

<style scoped src="../../assets/remote-base.css"></style>
<style scoped src="../../assets/remote-sheet.css"></style>

<style scoped>
.sheet .lock {
  align-self: flex-start;
}

.sheet .hint {
  margin: -6px 0 4px;
}

.pin {
  box-sizing: border-box;
  width: 100%;
  height: 56px;
  border: 2px solid var(--line);
  border-radius: 999px;
  background: var(--bg);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.3em;
  text-align: center;
  /* A PIN is not shown on the screen as it is typed. */
  -webkit-text-security: disc;
}

.problem {
  margin: 0;
  color: var(--accent-ink);
  font-weight: 700;
  text-align: center;
}
</style>
