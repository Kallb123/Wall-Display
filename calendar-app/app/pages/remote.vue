<script setup lang="ts">
import type { DisplaySettings, DisplayState, PhotoSource, View } from '../../shared/display'
import { todayIn } from '../../shared/dates'
import { layoutShowsPhotos, layoutSummary, viewShowsMonth, viewShowsPhotos, viewShowsWeek } from '../../shared/layouts'
import type { CustomLayout } from '../../shared/layouts'
import { starChartSchema } from '../../shared/stars'
import type { StarChart } from '../../shared/stars'
import RemoteStars from '~/components/stars/RemoteStars.vue'
import { UNREACHABLE } from '~/composables/useRemoteCommands'
import { reconnectDelay } from '~/utils/backoff'
import { isCameraShowing } from '~/utils/camera'
import { isOverlayShowing, overlayEndLabel } from '~/utils/overlay'
import { requestFailure, effectivePhotoSource } from '~/utils/remote'
import { THEMES, themeStyle } from '~/utils/themes'

// The phone remote (architecture §7.5). Like the wall it never decides
// anything: it shows the state the server sends over its socket and turns
// every tap into a command. A command answers with the new state, which is
// shown at once; the socket confirms it, and keeps the page right when
// something else (a button, Home Assistant, another phone) changes the wall.
// It follows the phone's light or dark setting, not the display's theme.
// The sections are the components in components/remote; this page holds the
// state they show and sends what they ask for.

const route = useRoute()
const now = useNow(60_000)
const scheme = useColourScheme()

const requestedId = [route.query.id].flat()[0] || null
const settings = ref<DisplaySettings | null>(null)
const state = ref<DisplayState | null>(null)
/** The server answered and has no such display. */
const unknown = ref(false)

let retryTimer: ReturnType<typeof setTimeout> | undefined
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

const commands = useRemoteCommands(displayId, (next) => {
  state.value = next
})
const send = commands.send

onMounted(() => {
  void loadSettings()
  void commands.load()
  void loadLayouts()
  void loadStars()
})
onScopeDispose(() => {
  clearTimeout(retryTimer)
})

const ready = computed(() => settings.value !== null && state.value !== null)
const name = computed(() => settings.value?.name ?? '')
const screenOn = computed(() => state.value?.screen !== 'off')
const view = computed(() => state.value?.view)

// The custom layouts (PR 5.17): the socket sends the library on connect and
// whenever it changes; until it has, or if it never does, ask for it.
const fetchedLayouts = ref<CustomLayout[]>([])
const layouts = computed(() => socket.layouts.value ?? fetchedLayouts.value)
const currentLayout = computed(() => {
  const found = state.value?.view === 'custom' ? layouts.value.find(layout => layout.id === state.value?.layout) : undefined
  return found ? layoutSummary(found) : null
})
const monthViewOn = computed(() => view.value !== undefined && viewShowsMonth(view.value, currentLayout.value))
const weekViewOn = computed(() => view.value !== undefined && viewShowsWeek(view.value, currentLayout.value))

async function loadLayouts() {
  try {
    fetchedLayouts.value = await $fetch<CustomLayout[]>('/api/layouts')
  } catch {
    // Offline for now: the socket will send them, and the tiles come with them.
  }
}

// The star chart (PR 5.20): the socket sends it on connect and whenever it
// changes, and a tap on - or + answers with the new chart, which is shown at
// once. Until the socket has spoken, or if it never does, ask for it. The
// section is there only when somebody has a chart switched on.
const stars = ref<StarChart | null>(null)
watch(socket.stars, (next) => {
  if (next) stars.value = next
})
const starsToday = computed(() => settings.value ? todayIn(now.value, settings.value.timezone) : '')
const showStars = computed(() => stars.value !== null && stars.value.people.length > 0 && starsToday.value !== '')

async function loadStars() {
  try {
    const fetched = await $fetch<StarChart>('/api/stars')
    // The socket may have answered first, and its chart is the newer.
    if (!stars.value) stars.value = fetched
  } catch {
    // Offline for now: the socket will send it.
  }
}

/** One tap on a person's - or +, behind the same PIN as the commands. */
async function adjustStars(personId: string, delta: 1 | -1) {
  try {
    const sent = await commands.guard(headers => $fetch<unknown>(`/api/stars/${encodeURIComponent(personId)}`, { method: 'POST', body: { delta }, headers }), () => adjustStars(personId, delta))
    if (!sent) return
    commands.error.value = null
    const parsed = starChartSchema.safeParse(sent.value)
    if (parsed.success) stars.value = parsed.data
  } catch (caught) {
    commands.error.value = requestFailure(caught).status === null ? UNREACHABLE : 'The wall didn\'t accept that'
  }
}

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

function setView(next: View) {
  void send({ type: 'set_view', view: next })
}

// The layouts row: one tile for each custom layout. A layout with a photo pane
// is left out when there is no photo source, as the photo tiles are, unless it
// is the one on the wall.
const layoutTiles = computed(() => layouts.value
  .map(layout => ({ layout, active: view.value === 'custom' && state.value?.layout === layout.id }))
  .filter(({ layout, active }) => active || photosConfigured.value || !layoutShowsPhotos(layoutSummary(layout))))

function setLayout(id: string) {
  void send({ type: 'set_layout', layout: id })
}

// The edit sheet: the layouts manager, on a sheet that fills the screen.
const editingLayouts = ref(false)
/** What the manager marks as "shown on": this display, and the layout it is on. */
const layoutDisplays = computed(() => settings.value ? [{ id: settings.value.id, name: settings.value.name, layout: view.value === 'custom' ? state.value?.layout ?? null : null }] : [])

// The photo frame (architecture §7.5). The server says which sources it has set
// up; with none (no `photos` block) the wall has nothing to show, so the tile
// and the "Photos from" section are left out, unless the wall is on the photo
// view anyway (Home Assistant put it there), when the tile stays to show it.
// The week and photo view has a photo pane, so its tile follows the same rule.
const photoSources = computed(() => settings.value?.photo_sources ?? [])
const photosConfigured = computed(() => photoSources.value.length > 0)
const showPhotoTile = computed(() => photosConfigured.value || view.value === 'photo' || view.value === 'week_photo')
/** The source the wall really uses: the server falls back when the chosen one isn't set up. */
const photoSource = computed(() => effectivePhotoSource(state.value?.photo_source ?? 'immich', photoSources.value))
// "Next photo" works wherever a photo pane is showing: the photo frame and the week and photo view.
const photosShown = computed(() => view.value !== undefined && viewShowsPhotos(view.value, currentLayout.value))

function setPhotoSource(source: PhotoSource) {
  void send({ type: 'set_photo_source', photo_source: source })
}

function toggleScreen() {
  void send({ type: 'set_screen', screen: screenOn.value ? 'off' : 'on' })
}

// The month and week the wall is showing, and the lists to pick another from.
const pickers = useRemotePickers(settings, state, now, send)

// The message on the wall, if there is one. `now` ticks each minute, so one that
// has run out goes from here too if the socket is slow to say so.
const overlay = computed(() => state.value && isOverlayShowing(state.value.overlay, now.value) ? state.value.overlay : null)
const overlayUntil = computed(() => overlay.value && settings.value ? overlayEndLabel(overlay.value, now.value, settings.value.timezone) : '')

// The camera on the wall, if there is one (the doorbell rang, say), so it can be taken down once the door is answered.
const camera = computed(() => state.value && isCameraShowing(state.value.camera, now.value) ? state.value.camera : null)

function closeCamera() {
  void send({ type: 'set_camera', camera: null })
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
      <RemoteHeader :name="name" :connection="connection" />

      <RemoteScreenCard :screen-on="screenOn" @toggle="toggleScreen" />

      <div class="controls" :class="{ dimmed: !screenOn }" data-testid="controls">
        <RemoteViewTiles
          :view="view"
          :show-photo-tile="showPhotoTile"
          :layout-tiles="layoutTiles"
          @set-view="setView"
          @set-layout="setLayout"
          @edit="editingLayouts = true"
        />

        <section v-if="showStars && stars" aria-labelledby="stars-title" data-testid="stars">
          <h2 id="stars-title" class="label">
            Stars
          </h2>
          <RemoteStars :chart="stars" :today="starsToday" :week-start="settings!.week_start" @adjust="adjustStars" />
        </section>

        <RemotePicker
          v-if="monthViewOn"
          kind="month"
          :options="pickers.month.options.value"
          :value="pickers.month.shown.value"
          :at-start="pickers.month.atStart.value"
          :at-end="pickers.month.atEnd.value"
          :pinned="pickers.month.pinned.value"
          @step="pickers.month.step"
          @pick="pickers.month.pick"
        />

        <RemotePicker
          v-if="weekViewOn"
          kind="week"
          :options="pickers.week.options.value"
          :value="pickers.week.shown.value"
          :at-start="pickers.week.atStart.value"
          :at-end="pickers.week.atEnd.value"
          :pinned="pickers.week.pinned.value"
          @step="pickers.week.step"
          @pick="pickers.week.pick"
        />

        <RemotePhotoSources
          v-if="photosConfigured"
          :photo-source="photoSource"
          :photo-sources="photoSources"
          :photos-shown="photosShown"
          :send="send"
          @set-source="setPhotoSource"
        />

        <RemoteCamera v-if="camera" :name="camera.name" @close="closeCamera" />

        <RemoteMessage :overlay="overlay" :until="overlayUntil" :send="send" />

        <RemoteMore :level="state?.brightness ?? 100" :send="send" />
      </div>
    </main>

    <RemoteLayoutsSheet
      v-if="editingLayouts"
      :displays="layoutDisplays"
      :photos-configured="photosConfigured"
      :live="socket.layouts.value"
      @changed="fetchedLayouts = $event"
      @close="editingLayouts = false"
    />

    <RemoteToast v-if="commands.error.value" :message="commands.error.value" @dismiss="commands.dismissError" />

    <RemotePinSheet
      v-if="commands.pinNeeded.value"
      :message="commands.pinMessage.value"
      :checking="commands.checkingPin.value"
      @submit="commands.submitPin"
      @cancel="commands.cancelPin"
    />
  </div>
</template>

<style scoped src="../assets/remote-base.css"></style>

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
</style>

<style>
/* The page's theme is set on <html> (see useHead above), so the background
   reaches the screen's edges and its overscroll. tokens.css makes the wall black. */
html[data-remote],
html[data-remote] body {
  background: var(--bg);
}
</style>
