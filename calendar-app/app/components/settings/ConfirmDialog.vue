<script setup lang="ts">
// A question the page needs answered before it goes on ("Discard changes?",
// "Delete Isla's birthday?"): PinDialog's centred card with two buttons. The
// page owns what each answer does, so this only asks. Rendered with `v-if`, it
// starts with the safe button (Cancel) focused each time it opens, and Esc is
// "Cancel". Tab stays between the two buttons while it is open.
withDefaults(defineProps<{
  title: string
  /** The explanation under the title. The default slot takes its place when it needs more than text. */
  message?: string
  confirmLabel: string
  /** `danger` is for something that can't be undone. */
  tone?: 'danger' | 'plain'
  /** An answer is being acted on: the buttons rest until it is done. */
  busy?: boolean
}>(), { message: undefined, tone: 'plain', busy: false })

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const id = useId()
// The buttons are components; their element is the <button>.
const cancelButton = useTemplateRef<{ $el: HTMLButtonElement }>('cancel')
const confirmButton = useTemplateRef<{ $el: HTMLButtonElement }>('confirm')

onMounted(() => cancelButton.value?.$el.focus())

/** Keeps Tab on the two buttons: the page behind the scrim is not for using. */
function keepFocus(event: KeyboardEvent) {
  const first = cancelButton.value?.$el
  const last = confirmButton.value?.$el
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <div class="scrim" data-testid="confirm-dialog" @keydown.esc="emit('cancel')" @keydown.tab="keepFocus">
    <div class="dialog" role="alertdialog" aria-modal="true" :aria-labelledby="`${id}-title`" :aria-describedby="`${id}-message`">
      <h2 :id="`${id}-title`" class="title" data-testid="confirm-title">
        {{ title }}
      </h2>
      <div :id="`${id}-message`" class="message" data-testid="confirm-message">
        <slot>{{ message }}</slot>
      </div>
      <div class="buttons">
        <SettingsPillButton ref="cancel" :disabled="busy" data-testid="confirm-cancel" @click="emit('cancel')">
          Cancel
        </SettingsPillButton>
        <SettingsPillButton
          ref="confirm"
          :variant="tone === 'danger' ? 'plain' : 'primary'"
          :class="{ danger: tone === 'danger' }"
          :disabled="busy"
          data-testid="confirm-ok"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </SettingsPillButton>
      </div>
    </div>
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
  gap: 12px;
  box-sizing: border-box;
  width: 100%;
  max-width: 460px;
  padding: 32px;
  border-radius: 32px;
  background: var(--surface);
  box-shadow: var(--shadow-lift);
}

.title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 400;
  line-height: 1.15;
}

.message {
  color: var(--muted);
  font-size: 16px;
  font-weight: 500;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}

/* A choice that can't be undone: the accent's ink on a plain button, so it is not the loudest thing on the card. */
.buttons .danger {
  border-color: var(--accent-ink);
  color: var(--accent-ink);
}
</style>
