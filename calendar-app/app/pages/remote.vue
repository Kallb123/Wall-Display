<script setup lang="ts">
import type { Component } from 'vue'
import { CalendarDays, CalendarRange, ChevronDown, ChevronLeft, ChevronRight, Images, ListTodo, Lock, MessageCircle, Moon, Power, SkipForward, X } from 'lucide-vue-next'
import { MONTH_RANGE, currentMonth, monthDiff } from '../../shared/display'
import type { DisplaySettings, DisplayState, PhotoSource, View } from '../../shared/display'
import { reconnectDelay } from '~/utils/backoff'
import { DEFAULT_OVERLAY_DURATION, OVERLAY_DURATIONS, OVERLAY_ICON_CHOICES, isOverlayShowing, overlayEndLabel, overlayIcon } from '~/utils/overlay'
import { PHOTO_SOURCE_CHOICES, SKIPPED_MS, effectivePhotoSource, monthCommandFor, monthOptions } from '~/utils/remote'
import { THEMES, themeStyle } from '~/utils/themes'

// The phone remote (architecture §7.5). Like the wall it never decides
// anything: it shows the state the server sends over its socket and turns
// every tap into a command. A command answers with the new state, which is
// shown at once; the socket confirms it, and keeps the page right when
// something else (a button, Home Assistant, another phone) changes the wall.
// It follows the phone's light or dark setting, not the display's theme.

const route = useRoute()
const now = useNow(60_000)
const scheme = useColourScheme()

const requestedId = [route.query.id].flat()[0] || null
const settings = ref<DisplaySettings | null>(null)
const state = ref<DisplayState | null>(null)
/** The server answered and has no such display. */
const unknown = ref(false)

let retryTimer: ReturnType<typeof setTimeout> | undefined
let refreshTimer: ReturnType<typeof setTimeout> | undefined
let skippedTimer: ReturnType<typeof setTimeout> | undefined
let attempt = 0

async function loadSettings() {
  let displays: DisplaySettings[]
  try {
    displays = await $fetch<DisplaySettings[]>('/api/displays')
  } catch {
    // The server is out of reach (a phone waking up on a poor connection): try again.
    retryTimer = setTimeout(loadSettings, reconnectDelay(attempt++))
    return
  }
  const found = requestedId ? displays.find(display => display.id === requestedId) : displays[0]
  if (found) settings.value = found
  else unknown.value = true
}

const displayId = computed(() => settings.value?.id ?? null)

const socket = useDisplaySocket(displayId, { role: 'remote' })
watch(socket.state, (next) => {
  if (next) state.value = next
})
const connection = useConnectionState(socket.status)
const CONNECTION_LABELS = { connected: 'Connected', reconnecting: 'Reconnecting', offline: 'Offline' } as const

const commands = useRemoteCommands(displayId, (next) => {
  state.value = next
})

onMounted(() => {
  void loadSettings()
  void commands.load()
})
onScopeDispose(() => {
  clearTimeout(retryTimer)
  clearTimeout(refreshTimer)
  clearTimeout(skippedTimer)
})

const ready = computed(() => settings.value !== null && state.value !== null)
const name = computed(() => settings.value?.name ?? '')
const screenOn = computed(() => state.value?.screen !== 'off')
const view = computed(() => state.value?.view)
const pinnedMonth = computed(() => state.value?.month ?? null)

// The page's own theme, on <html> so the background reaches the edges of the
// screen, including where it overscrolls (tokens.css makes the wall's page black).
const theme = computed(() => THEMES[scheme.value])
useHead({
  title: () => name.value ? `${name.value} remote` : 'Remote',
  htmlAttrs: {
    'data-remote': () => scheme.value,
    'style': () => ({ ...themeStyle(theme.value), 'color-scheme': scheme.value }),
  },
  meta: [
    // `viewport-fit=cover` lets the page draw under the notch, and the safe-area insets keep its content clear.
    { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
    // The browser's bar, which can't read CSS variables: the light theme's `bg` and the dark theme's.
    { name: 'theme-color', content: '#f5ead8', media: '(prefers-color-scheme: light)' },
    { name: 'theme-color', content: '#2e2b25', media: '(prefers-color-scheme: dark)' },
    { name: 'apple-mobile-web-app-capable', content: 'yes' },
    { name: 'mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-title', content: () => name.value || 'Remote' },
    { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
  ],
  link: [
    { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
    // For "Add to Home Screen": the manifest opens the display this page is for.
    { rel: 'manifest', href: () => displayId.value ? `/remote.webmanifest?id=${encodeURIComponent(displayId.value)}` : undefined },
  ],
})

const TILES: { view: View, label: string, icon: Component }[] = [
  { view: 'agenda', label: 'Agenda', icon: ListTodo },
  { view: 'month', label: 'Month', icon: CalendarDays },
  { view: 'week', label: 'Week', icon: CalendarRange },
  { view: 'night', label: 'Night', icon: Moon },
]

function setView(next: View) {
  void commands.send({ type: 'set_view', view: next })
}

// The photo frame (architecture §7.5). The server says which sources it has set
// up; with none (no `photos` block) the wall has nothing to show, so the tile
// and the "Photos from" section are left out, unless the wall is on the photo
// view anyway (Home Assistant put it there), when the tile stays to show it.
const photoSources = computed(() => settings.value?.photo_sources ?? [])
const photosConfigured = computed(() => photoSources.value.length > 0)
const showPhotoTile = computed(() => photosConfigured.value || view.value === 'photo')
/** The source the wall really uses: the server falls back when the chosen one isn't set up. */
const photoSource = computed(() => effectivePhotoSource(state.value?.photo_source ?? 'immich', photoSources.value))
const photoViewOn = computed(() => view.value === 'photo')

function setPhotoSource(source: PhotoSource) {
  void commands.send({ type: 'set_photo_source', photo_source: source })
}

const skipped = ref(false)
async function nextPhoto() {
  const sent = await commands.send({ type: 'photo_next' })
  if (!sent) return
  // The wall changes by itself a moment later: say it was asked, then go back.
  skipped.value = true
  clearTimeout(skippedTimer)
  skippedTimer = setTimeout(() => {
    skipped.value = false
  }, SKIPPED_MS)
}

function toggleScreen() {
  void commands.send({ type: 'set_screen', screen: screenOn.value ? 'off' : 'on' })
}

const currentMonthKey = computed(() => settings.value ? currentMonth(now.value, settings.value.timezone) : null)
const shownMonth = computed(() => pinnedMonth.value ?? currentMonthKey.value)
const options = computed(() => currentMonthKey.value ? monthOptions(currentMonthKey.value) : [])
const offset = computed(() => currentMonthKey.value && shownMonth.value ? monthDiff(currentMonthKey.value, shownMonth.value) : 0)

function pickMonth(event: Event) {
  if (!currentMonthKey.value) return
  const target = (event.target as HTMLSelectElement).value
  void commands.send({ type: 'set_month', month: monthCommandFor(target, currentMonthKey.value) })
}

// The slider shows what the finger is doing while it is down, not the state:
// a state arriving mid-drag would otherwise snatch it back. The command is
// sent when it is let go (`change`), not on every step (`input`).
const draftBrightness = ref<number | null>(null)
const brightness = computed(() => draftBrightness.value ?? state.value?.brightness ?? 100)

async function sendBrightness(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  draftBrightness.value = value
  await commands.send({ type: 'set_brightness', brightness: value })
  draftBrightness.value = null
}

// The message on the wall, if there is one. `now` ticks each minute, so one that
// has run out goes from here too if the socket is slow to say so.
const overlay = computed(() => state.value && isOverlayShowing(state.value.overlay, now.value) ? state.value.overlay : null)
const overlayUntil = computed(() => overlay.value && settings.value ? overlayEndLabel(overlay.value, now.value, settings.value.timezone) : '')

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
  const sent = await commands.send({
    type: 'set_overlay',
    overlay: { text, ...(draftIcon.value ? { icon: draftIcon.value } : {}), ...(ttl === undefined ? {} : { ttl }) },
  })
  sendingOverlay.value = false
  // A refused one keeps its text, so it can be sent again.
  if (sent) draftText.value = ''
}

function clearOverlay() {
  void commands.send({ type: 'set_overlay', overlay: null })
}

const refresh = ref<'idle' | 'sending' | 'asked'>('idle')
const REFRESH_LABELS = { idle: 'Refresh calendars', sending: 'Refreshing…', asked: 'Asked' } as const
async function refreshCalendars() {
  refresh.value = 'sending'
  const sent = await commands.send({ type: 'refresh' })
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

const pin = ref('')
const pinInput = useTemplateRef<HTMLInputElement>('pin-input')

watch(commands.pinNeeded, async (open) => {
  if (!open) return
  pin.value = ''
  await nextTick()
  pinInput.value?.focus()
})

function submitPin() {
  void commands.submitPin(pin.value)
}
</script>

<template>
  <div class="remote" data-testid="remote">
    <p v-if="unknown" class="message">
      Unknown display
    </p>
    <p v-else-if="!ready" class="message">
      Connecting&hellip;
    </p>

    <main v-else class="page">
      <header class="header">
        <h1 class="name" data-testid="display-name">
          {{ name }}
        </h1>
        <p class="pill" :data-state="connection" data-testid="connection-pill">
          <span class="dot" />
          {{ CONNECTION_LABELS[connection] }}
        </p>
      </header>

      <section class="card screen" aria-labelledby="screen-title">
        <span class="power" :class="{ off: !screenOn }">
          <AppIcon :icon="Power" :size="26" />
        </span>
        <div class="screen-text">
          <h2 id="screen-title" class="screen-title">
            Screen
          </h2>
          <p class="hint" data-testid="screen-state">
            {{ screenOn ? 'On' : 'Off, panel in standby' }}
          </p>
        </div>
        <button
          type="button"
          class="switch"
          role="switch"
          :aria-checked="screenOn"
          aria-labelledby="screen-title"
          data-testid="screen-toggle"
          @click="toggleScreen"
        >
          <span class="track"><span class="knob" /></span>
        </button>
      </section>

      <div class="controls" :class="{ dimmed: !screenOn }" data-testid="controls">
        <section aria-labelledby="wall-title">
          <h2 id="wall-title" class="label">
            On the wall
          </h2>
          <div class="tiles">
            <button
              v-for="tile in TILES"
              :key="tile.view"
              type="button"
              class="tile"
              :class="{ active: view === tile.view }"
              :aria-pressed="view === tile.view"
              :data-testid="`tile-${tile.view}`"
              @click="setView(tile.view)"
            >
              <AppIcon :icon="tile.icon" :size="32" />
              {{ tile.label }}
            </button>
            <!-- The Photo frame tile sits under the 2x2 grid, full width. -->
            <button
              v-if="showPhotoTile"
              type="button"
              class="tile wide"
              :class="{ active: photoViewOn }"
              :aria-pressed="photoViewOn"
              data-testid="tile-photo"
              @click="setView('photo')"
            >
              <AppIcon :icon="Images" :size="32" />
              Photo frame
            </button>
          </div>
        </section>

        <section v-if="view === 'month'" aria-labelledby="month-title" data-testid="month-picker">
          <h2 id="month-title" class="label">
            Month shown
          </h2>
          <div class="card picker">
            <div class="picker-row">
              <button
                type="button"
                class="arrow"
                aria-label="Previous month"
                :disabled="offset <= -MONTH_RANGE"
                data-testid="month-prev"
                @click="commands.send({ type: 'set_month', month: 'prev' })"
              >
                <AppIcon :icon="ChevronLeft" :size="26" />
              </button>
              <span class="select">
                <select
                  :value="shownMonth"
                  aria-label="Month"
                  data-testid="month-select"
                  @change="pickMonth"
                >
                  <option v-for="option in options" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
                <AppIcon class="caret" :icon="ChevronDown" :size="22" />
              </span>
              <button
                type="button"
                class="arrow"
                aria-label="Next month"
                :disabled="offset >= MONTH_RANGE"
                data-testid="month-next"
                @click="commands.send({ type: 'set_month', month: 'next' })"
              >
                <AppIcon :icon="ChevronRight" :size="26" />
              </button>
            </div>
            <button
              v-if="pinnedMonth"
              type="button"
              class="link"
              data-testid="month-current"
              @click="commands.send({ type: 'set_month', month: 'current' })"
            >
              Back to this month
            </button>
          </div>
        </section>

        <section v-if="photosConfigured" aria-labelledby="photos-title" data-testid="photos-from">
          <h2 id="photos-title" class="label">
            Photos from
          </h2>
          <div class="card photos">
            <div class="segments" role="group" aria-labelledby="photos-title">
              <button
                v-for="choice in PHOTO_SOURCE_CHOICES"
                :key="choice.source"
                type="button"
                class="segment"
                :class="{ active: photoSource === choice.source }"
                :aria-pressed="photoSource === choice.source"
                :disabled="!photoSources.includes(choice.source)"
                :data-testid="`photo-source-${choice.source}`"
                @click="setPhotoSource(choice.source)"
              >
                {{ choice.label }}
                <span v-if="!photoSources.includes(choice.source)" class="not-set-up">Not set up</span>
              </button>
            </div>
            <button
              type="button"
              class="button next-photo"
              :disabled="!photoViewOn"
              :aria-describedby="photoViewOn ? undefined : 'next-photo-reason'"
              aria-live="polite"
              data-testid="photo-next"
              @click="nextPhoto"
            >
              <AppIcon :icon="SkipForward" :size="22" />
              {{ skipped ? 'Skipped' : 'Next photo' }}
            </button>
            <p v-if="!photoViewOn" id="next-photo-reason" class="hint reason" data-testid="photo-next-reason">
              Turn on the photo frame to skip photos.
            </p>
          </div>
        </section>

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
                  {{ overlayUntil }}
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
          </div>
        </section>
      </div>
    </main>

    <div v-if="commands.error.value" class="toast" role="status" data-testid="error">
      <span>{{ commands.error.value }}</span>
      <button type="button" class="dismiss" aria-label="Dismiss" @click="commands.dismissError">
        <AppIcon :icon="X" :size="22" />
      </button>
    </div>

    <div v-if="commands.pinNeeded.value" class="scrim" data-testid="pin-sheet">
      <form class="sheet" role="dialog" aria-modal="true" aria-labelledby="pin-title" @submit.prevent="submitPin">
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
        <p v-if="commands.pinMessage.value" class="problem" role="alert" data-testid="pin-message">
          {{ commands.pinMessage.value }}
        </p>
        <button type="submit" class="button primary" :disabled="commands.checkingPin.value" data-testid="pin-submit">
          Unlock
        </button>
        <button type="button" class="link" @click="commands.cancelPin">
          Not now
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
/* Phone-sized: the wall's radius tokens are made for 2560 px, so this page has its own. */
.remote {
  --card-radius: 28px;
  box-sizing: border-box;
  min-height: 100dvh;
  padding:
    max(20px, env(safe-area-inset-top))
    max(20px, env(safe-area-inset-right))
    max(32px, env(safe-area-inset-bottom))
    max(20px, env(safe-area-inset-left));
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 16px;
  -webkit-tap-highlight-color: transparent;
}

.page {
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 480px;
  margin: 0 auto;
}

.message {
  margin: 0;
  padding-top: 40vh;
  color: var(--muted);
  font-family: var(--font-display);
  font-size: 32px;
  text-align: center;
}

button,
select,
input {
  font: inherit;
  color: inherit;
}

button {
  border: 0;
  background: none;
  cursor: pointer;
  touch-action: manipulation;
}

button:disabled {
  cursor: default;
}

:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 3px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 8px;
}

.name {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-display);
  font-size: 40px;
  font-weight: 400;
  line-height: 1.05;
}

.pill {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  margin: 0;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--surface);
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent2);
}

.pill[data-state='reconnecting'] .dot {
  background: var(--accent);
  animation: pulse 1.2s ease-in-out infinite;
}

.pill[data-state='offline'] .dot {
  box-sizing: border-box;
  border: 2px solid var(--muted);
  background: none;
}

@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}

.card {
  border-radius: var(--card-radius);
  background: var(--surface);
  box-shadow: var(--shadow-soft);
}

.screen {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 16px 16px 18px;
}

.power {
  display: grid;
  flex: none;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--panel);
  color: var(--panel-text);
  transition: background 0.2s ease, color 0.2s ease;
}

.power.off {
  background: var(--line);
  color: var(--muted);
}

.screen-text {
  flex: 1;
  min-width: 0;
}

.screen-title {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
}

.hint {
  margin: 2px 0 0;
  color: var(--muted);
  font-size: 15px;
  font-weight: 500;
}

/* The button is the 44 px target; the track inside it is what is drawn. */
.switch {
  display: grid;
  flex: none;
  place-items: center;
  width: 68px;
  height: 48px;
}

.track {
  position: relative;
  width: 56px;
  height: 32px;
  border-radius: 999px;
  background: var(--line);
  transition: background 0.2s ease;
}

.knob {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--muted);
  transition: transform 0.2s ease, background 0.2s ease;
}

.switch[aria-checked='true'] .track {
  background: var(--accent);
}

.switch[aria-checked='true'] .knob {
  background: var(--on-accent);
  transform: translateX(24px);
}

.controls {
  display: flex;
  flex-direction: column;
  gap: 24px;
  transition: opacity 0.25s ease;
}

/* With the screen off the controls still work, they just look asleep. */
.controls.dimmed {
  opacity: 0.5;
}

.label {
  margin: 0 0 12px 4px;
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 400;
}

.tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  min-height: 112px;
  padding: 18px;
  border-radius: var(--card-radius);
  background: var(--surface);
  box-shadow: var(--shadow-soft);
  font-size: 19px;
  font-weight: 700;
  text-align: left;
  transition: background 0.2s ease, color 0.2s ease;
}

.tile.active {
  background: var(--accent);
  color: var(--on-accent);
}

.tile.wide {
  grid-column: 1 / -1;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 16px;
  min-height: 72px;
  padding: 0 22px;
}

.photos {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
}

/* One pill cut into three, the picked source filled in the accent like an active tile. */
.segments {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  background: var(--bg);
}

.segment {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.15;
  transition: background 0.2s ease, color 0.2s ease;
}

.segment.active {
  background: var(--accent);
  color: var(--on-accent);
}

.segment:disabled {
  color: var(--muted);
}

.not-set-up {
  font-size: 12px;
  font-weight: 600;
}

.next-photo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.reason {
  margin: -6px 0 0;
  font-size: 14px;
  text-align: center;
}

.picker {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding: 14px;
}

.picker-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.arrow {
  display: grid;
  flex: none;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--bg);
  color: var(--text);
}

.arrow:disabled {
  opacity: 0.35;
}

.select {
  position: relative;
  flex: 1;
  min-width: 0;
}

select {
  appearance: none;
  box-sizing: border-box;
  width: 100%;
  height: 48px;
  padding: 0 40px 0 20px;
  border: 2px solid var(--line);
  border-radius: 999px;
  background: var(--bg);
  font-size: 17px;
  font-weight: 700;
  text-align: center;
  text-align-last: center;
}

.caret {
  position: absolute;
  top: 13px;
  right: 14px;
  color: var(--muted);
  pointer-events: none;
}

.link {
  min-height: 44px;
  padding: 0 12px;
  align-self: center;
  color: var(--accent-ink);
  font-size: 16px;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 4px;
}

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

/* The same round badge as the screen card's, in the accent: this is what is on the wall now. */
.power.live {
  background: var(--accent);
  color: var(--on-accent);
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

.button.small {
  flex: none;
  min-height: 44px;
  padding: 0 18px;
}

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

.button {
  min-height: 48px;
  padding: 0 20px;
  border: 2px solid var(--line);
  border-radius: 999px;
  background: var(--bg);
  font-size: 16px;
  font-weight: 700;
}

.button:disabled {
  opacity: 0.6;
}

.button.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}

.toast {
  position: fixed;
  right: max(16px, env(safe-area-inset-right));
  bottom: max(16px, env(safe-area-inset-bottom));
  left: max(16px, env(safe-area-inset-left));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  max-width: 448px;
  margin: 0 auto;
  padding: 4px 4px 4px 20px;
  border-radius: 999px;
  background: var(--text);
  color: var(--bg);
  box-shadow: var(--shadow-lift);
  font-weight: 700;
}

.dismiss {
  display: grid;
  flex: none;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
}

.scrim {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: color-mix(in oklch, var(--text) 45%, transparent);
}

.sheet {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  box-sizing: border-box;
  width: 100%;
  max-width: 480px;
  padding: 28px 24px max(24px, env(safe-area-inset-bottom));
  border-radius: 28px 28px 0 0;
  background: var(--surface);
  box-shadow: var(--shadow-lift);
}

.sheet .lock {
  align-self: flex-start;
}

.sheet-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 400;
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

<style>
/* The page's theme is set on <html> (see useHead above), so the background
   reaches the screen's edges and its overscroll. tokens.css makes the wall black. */
html[data-remote],
html[data-remote] body {
  background: var(--bg);
}
</style>
