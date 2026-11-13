<script setup lang="ts">
import { Settings } from 'lucide-vue-next'
import type { CommandInput } from '../../../shared/display'

// The "More" section: the panel's brightness, a refresh of the calendars, and the
// way to the settings page.

const props = defineProps<{
  /** The brightness the wall is at, in per cent. */
  level: number
  /** Sends a command; true if the wall accepted it. */
  send: (command: CommandInput) => Promise<boolean>
}>()

// The slider shows what the finger is doing while it is down, not the state:
// a state arriving mid-drag would otherwise snatch it back. The command is
// sent when it is let go (`change`), not on every step (`input`).
const draftBrightness = ref<number | null>(null)
const brightness = computed(() => draftBrightness.value ?? props.level)

async function sendBrightness(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  draftBrightness.value = value
  await props.send({ type: 'set_brightness', brightness: value })
  draftBrightness.value = null
}

const refresh = ref<'idle' | 'sending' | 'asked'>('idle')
const REFRESH_LABELS = { idle: 'Refresh calendars', sending: 'Refreshing…', asked: 'Asked' } as const
let refreshTimer: ReturnType<typeof setTimeout> | undefined
onScopeDispose(() => clearTimeout(refreshTimer))

async function refreshCalendars() {
  refresh.value = 'sending'
  const sent = await props.send({ type: 'refresh' })
  clearTimeout(refreshTimer)
  if (!sent) {
    refresh.value = 'idle'
    return
  }
  // The sync runs on the server and takes as long as it takes: say it was asked, then go back.
  refresh.value = 'asked'
  refreshTimer = setTimeout(() => {
    refresh.value = 'idle'
  }, 2500)
}
</script>

<template>
  <section aria-labelledby="more-title">
    <h2 id="more-title" class="label">
      More
    </h2>
    <div class="card more">
      <div class="slider-head">
        <label for="brightness" class="slider-label">Brightness</label>
        <output for="brightness" class="hint" data-testid="brightness-value">{{ brightness }}%</output>
      </div>
      <input
        id="brightness"
        type="range"
        min="0"
        max="100"
        step="1"
        :value="brightness"
        data-testid="brightness"
        @input="draftBrightness = Number(($event.target as HTMLInputElement).value)"
        @change="sendBrightness"
      >
      <button
        type="button"
        class="button"
        :disabled="refresh === 'sending'"
        data-testid="refresh"
        @click="refreshCalendars"
      >
        {{ REFRESH_LABELS[refresh] }}
      </button>
      <NuxtLink to="/settings" class="button settings-link" data-testid="settings-link">
        <AppIcon :icon="Settings" :size="22" />
        Settings
      </NuxtLink>
    </div>
  </section>
</template>

<style scoped src="../../assets/remote-base.css"></style>

<style scoped>
.more {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px;
}

.slider-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.slider-label {
  font-size: 17px;
  font-weight: 700;
}

.slider-head .hint {
  margin: 0;
}

input[type='range'] {
  width: 100%;
  height: 44px;
  margin: 0;
  accent-color: var(--accent);
}

/* To the settings page: a link that looks like the button above it. */
.settings-link {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text);
  text-decoration: none;
}
</style>
