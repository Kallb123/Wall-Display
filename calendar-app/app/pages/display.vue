<script setup lang="ts">
import { Eye } from 'lucide-vue-next'
import type { Component } from 'vue'
import { currentMonth, DEFAULT_DAY_PARTS, DEFAULT_WEEK_HOURS, displayStateSchema, firstDayOfWeek } from '../../shared/display'
import type { DisplaySettings, DisplayState, NextAlarm, View } from '../../shared/display'
import { DEFAULT_PANE_OPTIONS, layoutSummary, paneOptions } from '../../shared/layouts'
import type { CustomLayout } from '../../shared/layouts'
import type { StarChart } from '../../shared/stars'
import { specialDayArtUrl } from '../../shared/special-days'
import type { SpecialDaysResolution } from '../../shared/special-days'
import type { CalendarEvent, EventsResponse } from '../../shared/types/events'
import type { WeatherSnapshot } from '../../shared/weather'
import AgendaView from '~/components/views/AgendaView.vue'
import MonthSoftView from '~/components/views/MonthSoftView.vue'
import CustomLayoutView from '~/components/views/CustomLayoutView.vue'
import NightView from '~/components/views/NightView.vue'
import PhotoView from '~/components/views/PhotoView.vue'
import WeekPartsView from '~/components/views/WeekPartsView.vue'
import WeekPhotoView from '~/components/views/WeekPhotoView.vue'
import WeekView from '~/components/views/WeekView.vue'
import { burnInOffset, pillCorner } from '~/utils/burnIn'
import { browserStorage, loadCache, loadLastDisplayId, saveCache, saveLastDisplayId } from '~/utils/displayCache'
import { dayGridRanges, displayEventRanges, todayIn } from '~/utils/eventRanges'
import { layoutPanes, photoPillAtTopRight } from '~/utils/layouts'
import { isOverlayShowing } from '~/utils/overlay'
import { photoPills } from '~/utils/photoOverlay'
import { deviceOrientation, orientationQuery, stageScale } from '~/utils/stage'
import { activePreview, isEvening, takeoverArt, takeoverInForce } from '~/utils/specialDays'
import { themeStyle, themeTokens } from '~/utils/themes'
import { NO_SPECIAL_DAYS, stageFor } from '~/utils/views'
import type { ViewProps } from '~/utils/views'

// The wall. A fixed stage scaled to fit the window, showing the view the server
// chose (architecture §4.1). The page never picks a view or a month itself: it
// shows the state it is sent, and keeps the last it knew in localStorage so a
// reload with the server out of reach still shows something.
//
// There are two stages (architecture §4.2): 2560×1440 for landscape and
// 1440×2560 for portrait. The device's orientation comes from `?orientation=`,
// else the display's setting (`auto` follows the window's shape). The stage is
// portrait only when the device is and the view being shown has a portrait
// layout; any other view stays on the landscape stage, letterboxed in the
// window with black bars, exactly as on a landscape screen. The banner, badges,
// dimmer and burn-in layer all sit on whichever stage is in use.
//
// Special days (architecture §6) are the server's to work out: the page draws
// the resolution it is sent. What it does decide is what is in force right now:
// a takeover only on a calendar view and only on its own date (so it never
// outlives its midnight, even from the cache), and a preview in place of the
// real days while one runs.
//
// Against burn-in (PR 5.3, architecture §4.2), unless the display turns it off,
// everything but the dimmer sits in one `.shift` layer that the page nudges in
// a slow orbit, and the photo frame's pill is told which corner to be in.
useHead({ title: 'Display' })

// Each view.
const viewComponents: Record<View, Component> = {
  // The Soft style, which is the one with a portrait layout (PR 5.12). The Classic one arrives in PR 5.7, will be chosen here by `month_style`, and would need a portrait layout of its own.
  month: MonthSoftView,
  week: WeekView,
  week_parts: WeekPartsView,
  week_photo: WeekPhotoView,
  agenda: AgendaView,
  photo: PhotoView,
  night: NightView,
  custom: CustomLayoutView,
}
const viewFor = (view: View): Component => viewComponents[view]

const route = useRoute()
const storage = browserStorage()
const now = useNow()
const viewport = useViewport()

const requestedId = [route.query.id].flat()[0] || null
const displayId = ref<string | null>(null)
const settings = ref<DisplaySettings | null>(null)
const state = ref<DisplayState>(displayStateSchema.parse({}))
const events = ref<CalendarEvent[]>([])
const weather = ref<WeatherSnapshot | null>(null)
/** The next alarm the server last sent, or null for none (the night view's, if the display shows it). */
const alarm = ref<NextAlarm>(null)
/** The special days the server last sent for the real today (never a preview's), or null for none. */
const specialDays = ref<SpecialDaysResolution | null>(null)
/** The library of custom layouts the server last sent (the cache's until then). */
const layouts = ref<CustomLayout[]>([])
/** The star chart the server last sent (the cache's until then), or null for none. */
const stars = ref<StarChart | null>(null)
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
  alarm.value = cached?.alarm ?? null
  specialDays.value = cached?.special_days ?? null
  layouts.value = cached?.layouts ?? []
  stars.value = cached?.stars ?? null
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

// The query is for one device and wins over the display's setting. Settings cached before PR 5.10 have no word on it, and the default is auto.
const orientation = computed(() => orientationQuery(route.query.orientation) ?? settings.value?.orientation ?? 'auto')
const device = computed(() => deviceOrientation(orientation.value, viewport.value.width, viewport.value.height))
const stage = computed(() => stageFor(state.value.view, device.value))
/** The layout the custom view shows, or null for none: not chosen, deleted, or not heard of yet. */
const currentLayout = computed(() => layouts.value.find(layout => layout.id === state.value.layout) ?? null)
const scale = computed(() => stageScale(viewport.value.width, viewport.value.height, stage.value.orientation))

// Installable (PR 5.8): the manifest names this display, so "Install" or "Add to
// Home Screen" opens it, fullscreen where the platform allows. iOS ignores the
// manifest's `fullscreen` and reads the apple metas instead (standalone, with a
// status bar that overlays the page). The theme-color is left to the manifest.
useHead({
  meta: [
    // `viewport-fit=cover` lets the page draw under a notch; the wall is a fixed stage, so nothing needs the safe areas.
    { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
    { name: 'apple-mobile-web-app-capable', content: 'yes' },
    { name: 'mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
    { name: 'apple-mobile-web-app-title', content: () => settings.value?.name || 'Display' },
  ],
  link: [
    { rel: 'apple-touch-icon', href: '/icons/display-apple-touch-icon.png' },
    { rel: 'manifest', href: () => displayId.value ? `/display.webmanifest?id=${encodeURIComponent(displayId.value)}` : undefined },
  ],
})

useWakeLock()

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

// The week view shows the previewed date's week while a preview runs, else the week the server pinned in `state.week`, else today's.
const weekOf = computed(() => (previewing.value ? previewDays.value?.today : null) ?? state.value.week ?? today.value)

// The week's first day, which is what the events are fetched for. A pinned week can be far from the month grid, so it may need a request of its own.
const shownWeek = computed(() => settings.value && weekOf.value ? firstDayOfWeek(weekOf.value, settings.value.week_start) : null)

/** The takeover in force, which sets the palette, the art behind the view and the greeting. */
const takeover = computed(() => takeoverInForce({
  resolution: activeSpecialDays.value,
  view: state.value.view,
  today: today.value,
  previewing: previewing.value,
  layout: currentLayout.value ? layoutSummary(currentLayout.value) : null,
}))

/** The takeover's art cut for this stage's shape. */
const fullArt = computed(() => takeoverArt(takeover.value, stage.value.orientation).full)
const extraArt = computed(() => takeoverArt(takeover.value, stage.value.orientation).extra)

// Burn-in shifting is on unless the display says otherwise. Settings cached before PR 5.3 have no word on it, and the default is on. Until there are settings at all nothing moves, so a display that has it off never starts out nudged and slides back.
const burnIn = computed(() => settings.value !== null && settings.value.burn_in !== false)
// The first offset is put in place at once; only the steps after it are slow. (The wait is for the browser to have drawn it: turning the transition on in the same frame would slide it in.)
const shiftSlow = ref(false)
let slowTimer: ReturnType<typeof setTimeout> | undefined
watch(() => settings.value !== null, (known) => {
  if (known && !shiftSlow.value) slowTimer = setTimeout(() => { shiftSlow.value = true }, 1000)
}, { immediate: true })
onScopeDispose(() => clearTimeout(slowTimer))
const shift = computed(() => burnIn.value ? burnInOffset(now.value) : { x: 0, y: 0 })
/** The banner is at the bottom centre and the pill must keep out of its way. */
const overlayShowing = computed(() => isOverlayShowing(state.value.overlay, now.value))
const photoCorner = computed(() => burnIn.value ? pillCorner(now.value, { overlay: overlayShowing.value }) : 'top-left')
/** The corners the photo frame's pills are in: the walking corner on the photo frame and the week and photo view, and wherever the layout puts the time and the date in a custom layout. */
const photoPillCorners = computed(() => {
  const options = state.value.view === 'custom' ? paneOptions(currentLayout.value, 'photo') : DEFAULT_PANE_OPTIONS
  return photoPills(options, photoCorner.value, overlayShowing.value).map(pill => pill.corner)
})
/** The offline badge is top right, which a pill may have, and then it takes the other side. The pill's pane reaches the stage's top right corner on the photo frame, on the portrait stage of the week and photo view, where the photo is on top (on the landscape stage the photo is on the left), and in a custom layout whose photo pane is there. */
const offlineSide = computed(() => {
  const view = state.value.view
  if (view === 'custom') {
    if (!currentLayout.value) return 'right'
    const arrangement = stage.value.orientation === 'portrait' ? currentLayout.value.portrait : currentLayout.value.landscape
    return photoPillAtTopRight(layoutPanes(arrangement, stage.value), stage.value.width, photoPillCorners.value) ? 'left' : 'right'
  }
  const pillAtTopRight = view === 'photo' || (view === 'week_photo' && stage.value.orientation === 'portrait')
  return pillAtTopRight && photoPillCorners.value.includes('top-right') ? 'left' : 'right'
})
/** The sliver the layer uncovers at an edge when it moves: black for the views that are black or a photo, and the stage's own ground otherwise. */
const shiftStyle = computed(() => ({
  transform: shift.value.x || shift.value.y ? `translate(${shift.value.x}px, ${shift.value.y}px)` : 'none',
  transition: shiftSlow.value ? undefined : 'none',
  '--shift-fill': state.value.view === 'photo' || state.value.view === 'night' ? '#000' : 'transparent',
}))

/** What each view is given, or null until the settings (and so the time zone and week start) have arrived. */
const viewProps = computed<ViewProps | null>(() => {
  const display = settings.value
  const month = shownMonth.value
  const weekDate = weekOf.value
  if (!display || !month || !weekDate) return null
  return {
    view: state.value.view,
    stage: stage.value,
    layout: currentLayout.value,
    stars: stars.value,
    events: events.value,
    now: now.value,
    timezone: display.timezone,
    month,
    weekStart: display.week_start,
    // Settings cached before week_hours existed lack it.
    weekHours: display.week_hours ?? DEFAULT_WEEK_HOURS,
    // Settings cached before day_parts existed lack it.
    dayParts: display.day_parts ?? DEFAULT_DAY_PARTS,
    weekOf: weekDate,
    weather: weather.value,
    specialDays: activeSpecialDays.value ? { tiles: activeSpecialDays.value.tiles, takeover: takeover.value } : NO_SPECIAL_DAYS,
    displayId: displayId.value,
    photoNext: socket.photoNext.value,
    socketOpens: socket.opens.value,
    photoCorner: photoCorner.value,
    overlayShowing: overlayShowing.value,
    nightText: display.night_text,
    alarm: alarm.value,
    burnIn: burnIn.value,
  }
})

// A slow answer to an old request must not replace a newer one.
let loadCount = 0

// The day grids of the layout in use need their own days, which can run well past the month grid. Only the custom view shows them, so no other view asks.
const dayGridNeeds = computed(() => {
  if (state.value.view !== 'custom' || !currentLayout.value || !settings.value || !today.value) return []
  return dayGridRanges(currentLayout.value, today.value, settings.value.week_start)
})

/** Fetches what the shown month, the shown week and the next days need, and keeps the last good events if that fails. */
async function loadEvents() {
  if (!shownMonth.value || !today.value) return
  const id = ++loadCount
  try {
    const responses = await Promise.all(
      displayEventRanges(shownMonth.value, today.value, shownWeek.value ?? undefined, dayGridNeeds.value).map(range => $fetch<EventsResponse>('/api/events', { query: range })),
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

// The settings arriving, the month or week changing and midnight passing each change what to ask for.
watch([shownMonth, shownWeek, today, () => JSON.stringify(dayGridNeeds.value)], () => void loadEvents(), { immediate: true })

// Likewise the next alarm (null for none).
watch(socket.alarm, (next) => {
  if (next !== undefined) alarm.value = next
})

// The library of layouts, likewise.
watch(socket.layouts, (next) => {
  if (next !== undefined) layouts.value = next
})

// The star chart, likewise: undefined is not heard yet, and the cache's chart stays on show.
watch(socket.stars, (next) => {
  if (next !== undefined) stars.value = next
})

// Like the weather, sent after the state on every connect and again when it changes.
watch(socket.specialDays, (next) => {
  if (next !== undefined) specialDays.value = next
})

// The server sends this display's settings on every connect and again when the settings page changes them, so the theme, week start, week hours, burn-in and night text follow at once. The cache saves them with the rest (below).
watch(socket.settings, (next) => {
  if (next !== undefined) settings.value = next
})

// Tomorrow's art is loaded in the evening so the switch at midnight is instant. Not during a preview, which has no tomorrow.
const evening = computed(() => timezone.value !== null && isEvening(now.value, timezone.value))
useArtPreload(() => previewing.value ? [] : specialDays.value?.tomorrow_art ?? [], evening)

watch([settings, state, events, weather, specialDays, alarm, layouts, stars], () => {
  if (!displayId.value || !settings.value) return
  saveCache(storage, displayId.value, { settings: settings.value, state: state.value, events: events.value, weather: weather.value, special_days: specialDays.value, alarm: alarm.value, layouts: layouts.value, stars: stars.value, saved_at: new Date().toISOString() })
  saveLastDisplayId(storage, displayId.value)
})

onMounted(() => {
  // Keeps the app shell for an installed display to open without the server. Never in dev, where a worker would serve stale modules.
  if (!import.meta.dev && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/display-sw.js', { scope: '/display' }).catch(() => {})
  }
  const id = requestedId ?? loadLastDisplayId(storage)
  if (id) select(id)
  void loadSettings()
})

// The palette replaces the display's theme for the day: the same tokens, so no view knows.
const tokens = computed(() => themeTokens(settings.value?.theme ?? 'light', takeover.value?.palette))
const stageStyle = computed(() => ({
  ...themeStyle(tokens.value),
  width: `${stage.value.width}px`,
  height: `${stage.value.height}px`,
  transform: `translate(-50%, -50%) scale(${scale.value})`,
}))

// 100 is full brightness and 0 is as dark as the overlay can make it; "off" is black.
// This doubles as the Pi agent's `black` screen back end, so it is not tied to the back end the agent uses: with `cec` or `output` it still covers a panel that ignores the command, or a Pi whose agent is down.
const dimming = computed(() => state.value.screen === 'off' ? 1 : (100 - state.value.brightness) / 100)
</script>

<template>
  <div class="letterbox">
    <div
      class="stage"
      data-testid="stage"
      :data-orientation="stage.orientation"
      :data-theme="settings?.theme ?? 'light'"
      :data-palette="takeover?.palette"
      :data-preview="previewing || undefined"
      :style="stageStyle"
    >
      <!-- Everything the burn-in shift moves. The dimmer is outside it, so it covers the whole stage whatever the offset. -->
      <div class="shift" data-testid="shift" :style="shiftStyle">
        <!-- Behind the view, which is solid where it has text, so the art shows in the margins and the gaps. -->
        <!-- Each stage draws the art cut for its shape (2560×1440 or 1440×2560), never the other: cropped to the wrong one it wouldn't hold up. A portrait wall whose day has none shows no art. -->
        <img
          v-if="fullArt"
          class="takeover-art"
          :src="specialDayArtUrl(fullArt)"
          alt=""
          draggable="false"
          data-testid="takeover-full"
        >
        <img
          v-if="extraArt"
          class="takeover-art"
          :src="specialDayArtUrl(extraArt)"
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

        <OfflineBadge :status="socket.status.value" :side="offlineSide" />
      </div>

      <div class="dimmer" data-testid="dimmer" :style="{ opacity: dimming }" />
    </div>

    <FullscreenHint />
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

/* Laid out at the stage's own size (2560×1440, or 1440×2560 for portrait) and centred, then scaled to fit the window. */
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
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  font-family: var(--font-display);
  font-size: 96px;
  text-align: center;
}

/* Fills the stage and moves as one (see the burn-in note above). The step is a few pixels every few minutes, so it takes several seconds to get there and nobody sees it go. The shadow paints the strip the move uncovers at an edge; it is outside the stage, and clipped, while the layer is still. */
.shift {
  position: absolute;
  inset: 0;
  box-shadow: 0 0 0 16px var(--shift-fill, transparent);
  transition: transform 8s ease-in-out;
}

/* Both fill the stage and are cropped to it, the art being the same shape as the stage it is drawn on. They never take a click. */
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
