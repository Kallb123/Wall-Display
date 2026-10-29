<script setup lang="ts">
import type { Component } from 'vue'
import { currentMonth, displayStateSchema } from '../../shared/display'
import type { DisplaySettings, DisplayState, View } from '../../shared/display'
import type { CalendarEvent, EventsResponse } from '../../shared/types/events'
import AgendaView from '~/components/views/AgendaView.vue'
import MonthSoftView from '~/components/views/MonthSoftView.vue'
import PlaceholderView from '~/components/views/PlaceholderView.vue'
import { browserStorage, loadCache, loadLastDisplayId, saveCache, saveLastDisplayId } from '~/utils/displayCache'
import { displayEventRanges, todayIn } from '~/utils/eventRanges'
import { STAGE_HEIGHT, STAGE_WIDTH } from '~/utils/stage'
import { THEMES, themeStyle } from '~/utils/themes'
import type { ViewProps } from '~/utils/views'

// The wall. A fixed 2560×1440 stage scaled to fit the window, showing the view
// the server chose (architecture §4.1). The page never picks a view or a month
// itself: it shows the state it is sent, and keeps the last it knew in
// localStorage so a reload with the server out of reach still shows something.
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
/** The server answered and has no such display. */
const unknown = ref(false)

/** Shows `id`, starting from what was cached for it. */
function select(id: string) {
  displayId.value = id
  const cached = loadCache(storage, id)
  settings.value = cached?.settings ?? null
  state.value = cached?.state ?? displayStateSchema.parse({})
  events.value = cached?.events ?? []
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
const shownMonth = computed(() => timezone.value ? (state.value.month ?? currentMonth(now.value, timezone.value)) : null)
const today = computed(() => timezone.value ? todayIn(now.value, timezone.value) : null)

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

const socket = useDisplaySocket(() => unknown.value ? null : displayId.value, {
  onOpen: () => void loadEvents(),
  onEventsUpdated: () => void loadEvents(),
})

watch(socket.state, (next) => {
  if (next) state.value = next
})

// The settings arriving, the month changing and midnight passing each change what to ask for.
watch([shownMonth, today], () => void loadEvents(), { immediate: true })

watch([settings, state, events], () => {
  if (!displayId.value || !settings.value) return
  saveCache(storage, displayId.value, { settings: settings.value, state: state.value, events: events.value, saved_at: new Date().toISOString() })
  saveLastDisplayId(storage, displayId.value)
})

onMounted(() => {
  const id = requestedId ?? loadLastDisplayId(storage)
  if (id) select(id)
  void loadSettings()
})

const theme = computed(() => THEMES[settings.value?.theme ?? 'light'])
const stageStyle = computed(() => ({
  ...themeStyle(theme.value),
  width: `${STAGE_WIDTH}px`,
  height: `${STAGE_HEIGHT}px`,
  transform: `translate(-50%, -50%) scale(${scale.value})`,
}))

// 100 is full brightness and 0 is as dark as the overlay can make it; "off" is black.
const dimming = computed(() => state.value.screen === 'off' ? 1 : (100 - state.value.brightness) / 100)
</script>

<template>
  <div class="letterbox">
    <div class="stage" data-testid="stage" :data-theme="settings?.theme ?? 'light'" :style="stageStyle">
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
