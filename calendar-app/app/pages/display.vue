<script setup lang="ts">
import { Eye } from 'lucide-vue-next'
import type { Component } from 'vue'
import { currentMonth, displayStateSchema } from '../../shared/display'
import type { DisplaySettings, DisplayState, View } from '../../shared/display'
import { specialDayArtUrl } from '../../shared/special-days'
import type { SpecialDaysResolution } from '../../shared/special-days'
import type { CalendarEvent, EventsResponse } from '../../shared/types/events'
import type { WeatherSnapshot } from '../../shared/weather'
import AgendaView from '~/components/views/AgendaView.vue'
import MonthSoftView from '~/components/views/MonthSoftView.vue'
import PlaceholderView from '~/components/views/PlaceholderView.vue'
import { browserStorage, loadCache, loadLastDisplayId, saveCache, saveLastDisplayId } from '~/utils/displayCache'
import { displayEventRanges, todayIn } from '~/utils/eventRanges'
import { STAGE_HEIGHT, STAGE_WIDTH } from '~/utils/stage'
import { activePreview, isEvening, takeoverInForce } from '~/utils/specialDays'
import { themeStyle, themeTokens } from '~/utils/themes'
import { NO_SPECIAL_DAYS } from '~/utils/views'
import type { ViewProps } from '~/utils/views'

// The wall. A fixed 2560×1440 stage scaled to fit the window, showing the view
// the server chose (architecture §4.1). The page never picks a view or a month
// itself: it shows the state it is sent, and keeps the last it knew in
// localStorage so a reload with the server out of reach still shows something.
//
// Special days (architecture §6) are the server's to work out: the page draws
// the resolution it is sent. What it does decide is what is in force right now:
// a takeover only on a calendar view and only on its own date (so it never
// outlives its midnight, even from the cache), and a preview in place of the
// real days while one runs.
useHead({ title: 'Display' })

// Each view. The placeholder stands in for the ones not built yet.
const viewComponents: Record<View, Component> = {
  // The Soft style. The Classic one arrives in PR 5.7 and will be chosen here by `month_style`.
  month: MonthSoftView,
  week: PlaceholderView,
  agenda: AgendaView,
  photo: PlaceholderView,
  night: PlaceholderView,
}
const viewFor = (view: View): Component => viewComponents[view]

const route = useRoute()
const storage = browserStorage()
const now = useNow()
const scale = useStageScale()

const requestedId = [route.query.id].flat()[0] || null
const displayId = ref<string | null>(null)
const settings = ref<DisplaySettings | null>(null)
const state = ref<DisplayState>(displayStateSchema.parse({}))
const events = ref<CalendarEvent[]>([])
const weather = ref<WeatherSnapshot | null>(null)
/** The special days the server last sent for the real today (never a preview's), or null for none. */
const specialDays = ref<SpecialDaysResolution | null>(null)
/** The server answered and has no such display. */
const unknown = ref(false)

/** Shows `id`, starting from what was cached for it. */
function select(id: string) {
  displayId.value = id
  const cached = loadCache(storage, id)
  settings.value = cached?.settings ?? null
  state.value = cached?.state ?? displayStateSchema.parse({})
  events.value = cached?.events ?? []
  weather.value = cached?.weather ?? null
  specialDays.value = cached?.special_days ?? null
}

async function loadSettings() {
  let displays: DisplaySettings[]
  try {
    displays = await $fetch<DisplaySettings[]>('/api/displays')
  } catch {
    return // Keep what the cache gave us.
  }
  const found = requestedId ? displays.find(display => display.id === requestedId) : displays[0]
  if (!found) {
    unknown.value = true
    return
  }
  unknown.value = false
  if (found.id !== displayId.value) select(found.id)
  settings.value = found
}

const timezone = computed(() => settings.value?.timezone ?? null)
const today = computed(() => timezone.value ? todayIn(now.value, timezone.value) : null)

// Opened here, ahead of the page's own state, because the preview asks again when the socket sends special days. It loads events once it opens or is told to.
const socket = useDisplaySocket(() => unknown.value ? null : displayId.value, {
  onOpen: () => void loadEvents(),
  onEventsUpdated: () => void loadEvents(),
})

// A preview shows the special days of another date as if it were today. The
// state names the day or scene, and the server's answer says what that is.
const preview = computed(() => activePreview(state.value.preview, now.value))
const previewing = computed(() => preview.value !== null)
const previewDays = useSpecialDayPreview(preview, () => socket.specialDays.value).resolution

/** While previewing, the special days of the preview alone: the real ones must not show through it. */
const activeSpecialDays = computed(() => previewing.value ? previewDays.value : specialDays.value)

// A preview shows the month its date is in, whatever month is pinned: the server's word for the date, not one worked out here.
const shownMonth = computed(() => {
  if (!timezone.value) return null
  const previewed = previewing.value ? previewDays.value?.today.slice(0, 7) : null
  return previewed ?? state.value.month ?? currentMonth(now.value, timezone.value)
})

/** The takeover in force, which sets the palette, the art behind the view and the greeting. */
const takeover = computed(() => takeoverInForce({
  resolution: activeSpecialDays.value,
  view: state.value.view,
  today: today.value,
  previewing: previewing.value,
}))

/** What each view is given, or null until the settings (and so the time zone and week start) have arrived. */
const viewProps = computed<ViewProps | null>(() => {
  const display = settings.value
  const month = shownMonth.value
  if (!display || !month) return null
  return {
    view: state.value.view,
    events: events.value,
    now: now.value,
    timezone: display.timezone,
    month,
    weekStart: display.week_start,
    weather: weather.value,
    specialDays: activeSpecialDays.value ? { tiles: activeSpecialDays.value.tiles, takeover: takeover.value } : NO_SPECIAL_DAYS,
  }
})

// A slow answer to an old request must not replace a newer one.
let loadCount = 0

/** Fetches what the shown month and the next days need, and keeps the last good events if that fails. */
async function loadEvents() {
  if (!shownMonth.value || !today.value) return
  const id = ++loadCount
  try {
    const responses = await Promise.all(
      displayEventRanges(shownMonth.value, today.value).map(range => $fetch<EventsResponse>('/api/events', { query: range })),
    )
    if (id !== loadCount) return
    // The ranges can overlap, so the same event may come twice.
    const byId = new Map(responses.flatMap(response => response.events).map(event => [event.id, event]))
    events.value = [...byId.values()].sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id)
  } catch {
    // Offline or the server is busy: the next trigger tries again.
  }
}

watch(socket.state, (next) => {
  if (next) state.value = next
})

// The server sends the weather (or null, for none) after the state on every connect, and again when it changes.
watch(socket.weather, (next) => {
  if (next !== undefined) weather.value = next
})

// The settings arriving, the month changing and midnight passing each change what to ask for.
watch([shownMonth, today], () => void loadEvents(), { immediate: true })

// Like the weather, sent after the state on every connect and again when it changes.
watch(socket.specialDays, (next) => {
  if (next !== undefined) specialDays.value = next
})

// Tomorrow's art is loaded in the evening so the switch at midnight is instant. Not during a preview, which has no tomorrow.
const evening = computed(() => timezone.value !== null && isEvening(now.value, timezone.value))
useArtPreload(() => previewing.value ? [] : specialDays.value?.tomorrow_art ?? [], evening)

watch([settings, state, events, weather, specialDays], () => {
  if (!displayId.value || !settings.value) return
  saveCache(storage, displayId.value, { settings: settings.value, state: state.value, events: events.value, weather: weather.value, special_days: specialDays.value, saved_at: new Date().toISOString() })
  saveLastDisplayId(storage, displayId.value)
})

onMounted(() => {
  const id = requestedId ?? loadLastDisplayId(storage)
  if (id) select(id)
  void loadSettings()
})

// The palette replaces the display's theme for the day: the same tokens, so no view knows.
const tokens = computed(() => themeTokens(settings.value?.theme ?? 'light', takeover.value?.palette))
const stageStyle = computed(() => ({
  ...themeStyle(tokens.value),
  width: `${STAGE_WIDTH}px`,
  height: `${STAGE_HEIGHT}px`,
  transform: `translate(-50%, -50%) scale(${scale.value})`,
}))

// 100 is full brightness and 0 is as dark as the overlay can make it; "off" is black.
const dimming = computed(() => state.value.screen === 'off' ? 1 : (100 - state.value.brightness) / 100)
</script>

<template>
  <div class="letterbox">
    <div
      class="stage"
      data-testid="stage"
      :data-theme="settings?.theme ?? 'light'"
      :data-palette="takeover?.palette"
      :data-preview="previewing || undefined"
      :style="stageStyle"
    >
      <!-- Behind the view, which is solid where it has text, so the art shows in the margins and the gaps. -->
      <img
        v-if="takeover?.full_art"
        class="takeover-art"
        :src="specialDayArtUrl(takeover.full_art)"
        alt=""
        draggable="false"
        data-testid="takeover-full"
      >
      <img
        v-if="takeover?.extra_art"
        class="takeover-art"
        :src="specialDayArtUrl(takeover.extra_art)"
        alt=""
        draggable="false"
        data-testid="takeover-extra"
      >

      <p v-if="unknown" class="message">
        Unknown display
      </p>
      <p v-else-if="!viewProps" class="message">
        Connecting&hellip;
      </p>
      <Transition v-else name="view-fade" mode="out-in">
        <component
          :is="viewFor(state.view)"
          :key="state.view"
          v-bind="viewProps"
        />
      </Transition>

      <div v-if="previewing" class="preview-badge" data-testid="preview-badge">
        <AppIcon :icon="Eye" :size="32" />
        Preview
      </div>

      <!-- Outside the view's transition, so a view change doesn't fade it out and back. Under the dimmer, so screen off blacks it out too. -->
      <OverlayBanner v-if="!unknown" :overlay="state.overlay" :now="now" />

      <OfflineBadge :status="socket.status.value" />

      <div class="dimmer" data-testid="dimmer" :style="{ opacity: dimming }" />
    </div>
  </div>
</template>

<style scoped>
.letterbox {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: #000;
  cursor: none;
}

/* Laid out at 2560×1440 and centred, then scaled to fit the window. */
.stage {
  position: absolute;
  top: 50%;
  left: 50%;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
}

.message {
  margin: 0;
  padding-top: 600px;
  font-family: var(--font-display);
  font-size: 96px;
  text-align: center;
}

/* Both fill the stage and are cropped to it, 2560×1440 art being the same shape. They never take a click. */
.takeover-art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

/* Top centre, in the strip above the views' content (48 px of padding at least), so it covers nothing. */
.preview-badge {
  position: absolute;
  top: 4px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 2px 26px 2px 20px;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--on-accent);
  box-shadow: var(--shadow-soft);
  font-size: 30px;
  font-weight: 700;
  line-height: 1.3;
  transform: translateX(-50%);
  pointer-events: none;
}

/* Dims what is shown, not the backlight (architecture §4.2). */
.dimmer {
  position: absolute;
  inset: 0;
  background: #000;
  pointer-events: none;
  transition: opacity 1s ease;
}
</style>

<style>
.view-fade-enter-active,
.view-fade-leave-active {
  transition: opacity 0.4s ease;
}

.view-fade-enter-from,
.view-fade-leave-to {
  opacity: 0;
}
</style>
