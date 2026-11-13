<script setup lang="ts">
import { ChevronDown, MessageCircle } from 'lucide-vue-next'
import type { CommandInput, DisplayState } from '../../../shared/display'
import { DEFAULT_OVERLAY_DURATION, OVERLAY_DURATIONS, OVERLAY_ICON_CHOICES, overlayIcon } from '~/utils/overlay'

// The "Message" section: the message on the wall, if there is one, and a form to
// put up another. What is being typed is this form's own; the wall's message
// comes from the page.

const props = defineProps<{
  /** The message on the wall, if there is one. */
  overlay: DisplayState['overlay'] | null
  /** When it ends, in words. */
  until: string
  /** Sends a command; true if the wall accepted it. */
  send: (command: CommandInput) => Promise<boolean>
}>()

const draftText = ref('')
/** The picked icon's name, or '' for none (the wall then shows its plain message icon). */
const draftIcon = ref('')
const draftDuration = ref(DEFAULT_OVERLAY_DURATION)
const sendingOverlay = ref(false)
const canShow = computed(() => draftText.value.trim() !== '' && !sendingOverlay.value)

async function showOverlay() {
  const text = draftText.value.trim()
  if (!canShow.value) return
  const ttl = OVERLAY_DURATIONS.find(duration => duration.key === draftDuration.value)?.ttl
  sendingOverlay.value = true
  const sent = await props.send({
    type: 'set_overlay',
    overlay: { text, ...(draftIcon.value ? { icon: draftIcon.value } : {}), ...(ttl === undefined ? {} : { ttl }) },
  })
  sendingOverlay.value = false
  // A refused one keeps its text, so it can be sent again.
  if (sent) draftText.value = ''
}

function clearOverlay() {
  void props.send({ type: 'set_overlay', overlay: null })
}
</script>

<template>
  <section aria-labelledby="message-title" data-testid="message">
    <h2 id="message-title" class="label">
      Message
    </h2>
    <div class="card note">
      <div v-if="overlay" class="current" data-testid="overlay-current">
        <span class="power live">
          <AppIcon :icon="overlayIcon(overlay.icon)" :size="26" />
        </span>
        <div class="current-text">
          <p class="current-message" data-testid="overlay-current-text">
            {{ overlay.text }}
          </p>
          <p class="hint" data-testid="overlay-current-until">
            {{ until }}
          </p>
        </div>
        <button type="button" class="button small" data-testid="overlay-clear" @click="clearOverlay">
          Clear
        </button>
      </div>

      <form class="compose" :class="{ divided: overlay }" data-testid="overlay-form" @submit.prevent="showOverlay">
        <label for="overlay-text" class="slider-label">{{ overlay ? 'Change the message' : 'Put a message on the wall' }}</label>
        <input
          id="overlay-text"
          v-model="draftText"
          class="text"
          type="text"
          maxlength="200"
          placeholder="Bins out tonight"
          autocomplete="off"
          enterkeyhint="send"
          data-testid="overlay-input"
        >

        <div class="icons" role="radiogroup" aria-label="Icon">
          <label class="icon-choice">
            <input v-model="draftIcon" type="radio" name="overlay-icon" value="" aria-label="No icon" data-testid="overlay-icon-none">
            <span class="face"><AppIcon :icon="MessageCircle" :size="26" /></span>
          </label>
          <label v-for="choice in OVERLAY_ICON_CHOICES" :key="choice.name" class="icon-choice">
            <input v-model="draftIcon" type="radio" name="overlay-icon" :value="choice.name" :aria-label="choice.label" :data-testid="`overlay-icon-${choice.name}`">
            <span class="face"><AppIcon :icon="overlayIcon(choice.name)" :size="26" /></span>
          </label>
        </div>

        <label for="overlay-duration" class="slider-label">Show for</label>
        <span class="select">
          <select id="overlay-duration" v-model="draftDuration" data-testid="overlay-duration">
            <option v-for="duration in OVERLAY_DURATIONS" :key="duration.key" :value="duration.key">
              {{ duration.label }}
            </option>
          </select>
          <AppIcon class="caret" :icon="ChevronDown" :size="22" />
        </span>

        <button type="submit" class="button primary" :disabled="!canShow" data-testid="overlay-submit">
          Show on the wall
        </button>
      </form>
    </div>
  </section>
</template>

<style scoped src="../../assets/remote-base.css"></style>

<style scoped>
.note {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px;
}

.current {
  display: flex;
  align-items: center;
  gap: 14px;
}

.current-text {
  flex: 1;
  min-width: 0;
}

.current-message {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.25;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.compose {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.compose.divided {
  padding-top: 16px;
  border-top: 2px solid var(--line);
}

.slider-label {
  font-size: 17px;
  font-weight: 700;
}

.text {
  box-sizing: border-box;
  width: 100%;
  height: 48px;
  padding: 0 20px;
  border: 2px solid var(--line);
  border-radius: 999px;
  background: var(--bg);
  font-size: 17px;
  font-weight: 600;
}

.text::placeholder {
  color: var(--muted);
  opacity: 0.8;
}

.icons {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  justify-items: center;
  gap: 8px 0;
  margin: 4px 0 8px;
}

/* A real radio, laid invisibly over its round face, so the arrow keys and the screen reader work as they should. */
.icon-choice {
  position: relative;
  isolation: isolate;
  display: grid;
  width: 48px;
  height: 48px;
}

.icon-choice input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.face {
  display: grid;
  place-items: center;
  border: 2px solid var(--line);
  border-radius: 50%;
  background: var(--bg);
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
}

.icon-choice input:checked + .face {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}

.icon-choice input:focus-visible + .face {
  outline: 3px solid var(--accent);
  outline-offset: 3px;
}

.compose .select {
  margin-bottom: 8px;
}
</style>
