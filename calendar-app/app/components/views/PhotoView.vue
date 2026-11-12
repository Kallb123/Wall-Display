<script setup lang="ts">
import { ImageOff } from 'lucide-vue-next'
import { coversBox, photoResponseSchema } from '../../../shared/photos'
import type { PhotoInfo } from '../../../shared/photos'
import { DEFAULT_PANE_OPTIONS } from '../../../shared/layouts'
import { currentWeather, formatTemperature, weatherLabel } from '../../../shared/weather'
import { bleeds } from '~/utils/bleed'
import { formatLongDate, formatTime } from '~/utils/format'
import { eventLabel } from '~/utils/eventLabel'
import { driftSeconds, photoDrift } from '~/utils/motion'
import { nextEvent } from '~/utils/nextEvent'
import { photoPills } from '~/utils/photoOverlay'
import { weatherIcon } from '~/utils/weather'
import type { ViewProps } from '../../utils/views'

// The photo frame (architecture §4.1, §5): one photo fullscreen at a time, and
// a small pill in a corner with the clock, the weather and the next event. The server owns the rotation: it sends `photo.next` (counted by the
// socket and handed down as `photoNext`) when it is time, and this view then
// asks `GET /api/photos/next` for the photo to show. The image is already
// rendered on the server, so it is only drawn with `cover`. The request says
// the shape of the box this view fills (`orientation`, and `width` and `height`,
// which are the pane's own and not the stage's). A photo close to the box's
// shape (`coversBox`: a 4:3 phone photo in a 16:9 box) comes as the plain photo,
// which `cover` crops a little at two edges, so no strip of blurred backdrop is
// left at the edges. One of another shape (a portrait photo in a landscape box)
// comes fitted whole over its backdrop (PR 5.11). A change of orientation
// fetches again at once, since the photo on show is the wrong shape for the new
// box; so does a change of size that turns the photo on show from close to not
// close, or the other way, since it is then the wrong kind of file.
//
// Two <img> layers are stacked. The next photo is loaded and `decode()`d off
// screen first, so the Pi never decodes in the middle of a fade, then it is put
// on the hidden layer and faded in over the old one, which stays solid beneath
// it until the fade is done (two half-transparent photos would show the
// background through). A photo that fails, or an answer of "none", leaves what
// is on show alone; with nothing on show there is a calm message and the view
// tries again now and then. A photo is shown whatever the special days say, and
// the pill has its own dark glass colours, so it reads on any photo and takes
// nothing from the theme or a palette. The pill starts top left and, unless the
// display has turned burn-in shifting off, the page walks it round the four
// corners (`photoCorner`, PR 5.3) so no corner is lit for ever. It takes a top
// corner while the overlay banner, at the bottom centre, is showing, so the two
// never meet.
//
// With `motion` on (the display's setting, while the screen is on and not dimmed
// for the night, `motionRuns`) each photo drifts slowly while it is on show: a
// few percent of scale and about one percent of pan, over the whole interval
// (`driftSeconds`, from the interval the server answers with), zooming in on
// one photo and out on the next and leaning a different way each time. It is a
// CSS animation of `transform` alone, so the browser does it off the main
// thread and there is no layout work per frame. The photo beneath a crossfade
// keeps its own drift until the fade is over, so nothing snaps back to rest. When
// `motion` goes off while a photo is on show (the screen went off or was dimmed)
// the animation is paused where it is, and carries on when it comes back. A
// photo that was shown with motion off has no drift, so the drift of one that is
// on show when motion turns on begins then, from rest, and runs the length of an
// interval as ever. Only the layers move: the pill is a sibling and never does,
// so nothing moves under the text, and with `prefers-reduced-motion` there is
// no drift at all. Burn-in shifting moves the stage as a whole, so the two add.
//
// As a pane of the week and photo view (`pane`, PR 5.14, mock 4k) it fills the
// box it is given, which is a part of the stage, and the pill is the compact
// one from the mock, 48 px in from the pane's corner. The next event is left
// off, as the week beside it already shows it. Fetching is the same: the pane's
// own shape, not the stage's, decides which rendition is asked for and whether
// the photo covers it.
//
// As a pane of a custom layout its overlays are the layout's to choose
// (`paneOptions`, PR 5.21): the time, the weather and a date, each of which can
// be left off, and the corner the time (with the weather) and the date each
// sit in, or `auto` for the walking corner. Overlays in the same corner share a
// pill (`photoPills`); with all of them off there is no pill at all. A chosen
// bottom corner moves to the top while the overlay banner shows, as the walking
// one does. The next event, on a full-screen frame, rides under the clock. The
// full-screen frame and the week and photo view use the defaults: the time and
// the weather in the walking corner, and no date.
//
// A pane on the stage's edge is given a `bleed` while burn-in shifting is on:
// the photo is drawn that far past the sides on the edge, so the strip the
// shift uncovers there is photo and not the theme's ground (utils/bleed.ts).
// Only the photo reaches out: the pills and the empty message keep to the box,
// and the box is still what the photo is asked for at. The view no longer clips
// to its box then; the pane it is in clips to the box and the bleed.
const props = defineProps<ViewProps>()

/** The length of the crossfade. */
const FADE_MS = 1500
/** How long to wait before asking again when there is nothing on show. */
const RETRY_MS = 15_000
/** The longest to wait for the server: the wall must not hang on one bad request. */
const REQUEST_TIMEOUT_MS = 20_000

/** Two layers; the url is what each is showing (null for nothing). */
const layers = ref<[string | null, string | null]>([null, null])
/** The layer on top and fully shown, or null before the first photo. */
const top = ref<0 | 1 | null>(null)
/** The layer being faded out beneath it, or null once the fade is over. */
const under = ref<0 | 1 | null>(null)

let latest = 0
let inflight = 0
let disposed = false
let fading: Promise<void> = Promise.resolve()
let retry: ReturnType<typeof setTimeout> | undefined
let fadeTimer: ReturnType<typeof setTimeout> | undefined
/** The decoded image of the photo on show, held so the browser keeps it decoded. */
const held = new Set<HTMLImageElement>()

/**
 * How a layer's photo drifts, or null for still. `name` picks one of two
 * identical sets of keyframes: a layer given a new photo is given the other,
 * and a changed animation name restarts the animation from its beginning.
 */
interface LayerDrift {
  from: string
  to: string
  seconds: number
  name: 'a' | 'b'
}
const drifts = ref<[LayerDrift | null, LayerDrift | null]>([null, null])
/** The keyframes each layer used last, to give it the other next. */
const lastName: ['a' | 'b', 'a' | 'b'] = ['b', 'b']
/** The photos given a drift so far: it picks the drift (`photoDrift`), so successive photos differ. */
let drifted = 0
/** The server's photo interval, as of its latest answer. Not known until the first. */
let intervalSeconds: number | undefined

function setDrift(layer: 0 | 1, drift: LayerDrift | null) {
  drifts.value = layer === 0 ? [drift, drifts.value[1]] : [drifts.value[0], drift]
}

/** Gives `layer` a drift for the photo now on it. */
function startDrift(layer: 0 | 1) {
  const name = lastName[layer] === 'a' ? 'b' : 'a'
  lastName[layer] = name
  setDrift(layer, { ...photoDrift(drifted++), seconds: driftSeconds(intervalSeconds), name })
}

/** The style of a layer's drift: its two ends and its length for the keyframes, and paused while motion is off. Nothing at all for a layer with no drift, so a wall with motion off is drawn exactly as before. */
function driftStyle(layer: 0 | 1) {
  const drift = drifts.value[layer]
  if (!drift) return undefined
  return {
    '--drift-from': drift.from,
    '--drift-to': drift.to,
    '--drift-seconds': `${drift.seconds}s`,
    ...(props.motion ? {} : { animationPlayState: 'paused' }),
  }
}

/** The size of the box to ask for: whole pixels, at least 1 and at most 99999, which the server accepts. */
function boxOf() {
  const clamp = (value: number) => Math.min(99_999, Math.max(1, Math.round(value) || 1))
  return { width: clamp(props.stage.width), height: clamp(props.stage.height) }
}

/** Whether the photo, asked for with `box`, is the wrong kind of file for the box as it is now. */
function stale(photo: PhotoInfo, box: { width: number, height: number }): boolean {
  return coversBox(photo, boxOf()) !== coversBox(photo, box)
}

/** What the photo on show was asked for: its info and the box it was asked for, to tell when a new size makes it the wrong kind of file. */
let shownFor: { photo: PhotoInfo, box: { width: number, height: number } } | null = null

const shownUrl = computed(() => top.value === null ? null : layers.value[top.value])

/** Loads and decodes `url` off screen. Resolves false if it can't be had. */
async function preload(url: string): Promise<HTMLImageElement | null> {
  const image = new Image()
  image.src = url
  try {
    await image.decode()
    return image
  } catch {
    return null
  }
}

/** Puts `photo` on the hidden layer and fades it in. The caller has checked `id` is still the latest. */
async function show(photo: PhotoInfo, id: number) {
  const image = await preload(photo.url)
  if (!image || id !== latest || disposed) return
  // A fade still under way finishes first, so a quick run of skips shows each change as a fade.
  await fading
  if (id !== latest || disposed) return

  const target: 0 | 1 = top.value === 0 ? 1 : 0
  const previous = top.value
  layers.value = target === 0 ? [photo.url, layers.value[1]] : [layers.value[0], photo.url]
  under.value = previous
  top.value = target
  held.clear()
  held.add(image)
  if (props.motion) startDrift(target)
  // The first photo has nothing beneath it to protect, so a skip straight after it need not wait.
  if (previous === null) return
  fading = new Promise<void>((resolve) => {
    fadeTimer = setTimeout(() => {
      under.value = null
      // Out of sight now, so let go of its picture, and with it its drift.
      setDrift(previous, null)
      layers.value = previous === 0 ? [null, layers.value[1]] : [layers.value[0], null]
      resolve()
    }, FADE_MS)
  })
}

function scheduleRetry() {
  clearTimeout(retry)
  if (disposed || top.value !== null) return
  retry = setTimeout(() => void fetchNext(), RETRY_MS)
}

/** Asks the server for the display's next photo and shows it. A newer request makes an older answer void. */
async function fetchNext() {
  const display = props.displayId
  if (!display || disposed) return
  clearTimeout(retry)
  const orientation = props.stage.orientation
  const box = boxOf()
  const id = ++latest
  inflight++
  try {
    let photo: PhotoInfo | null = null
    try {
      const answer = photoResponseSchema.parse(await $fetch('/api/photos/next', { query: { display, orientation, ...box }, timeout: REQUEST_TIMEOUT_MS }))
      photo = answer.photo
      intervalSeconds = answer.interval_seconds
    } catch {
      // Offline or busy: what is on show stays.
    }
    if (id !== latest || disposed) return
    // The only photo there is, or the same again: no use fading to itself.
    if (photo && photo.url !== shownUrl.value) await show(photo, id)
    if (photo && id === latest && !disposed && photo.url === shownUrl.value) {
      shownFor = { photo, box }
      // The pane may have been resized while this was being asked for or shown.
      if (stale(photo, box)) void fetchNext()
    }
    if (id === latest) scheduleRetry()
  } finally {
    inflight--
  }
}

onMounted(() => void fetchNext())

onBeforeUnmount(() => {
  disposed = true
  clearTimeout(retry)
  clearTimeout(fadeTimer)
  held.clear()
})

watch(() => props.displayId, () => void fetchNext())
// The photo on show was rendered for the other shape. Asking bumps `latest`, so an answer to the old question is dropped.
watch(() => [props.stage.orientation, props.stage.width, props.stage.height] as const, ([orientation], [before]) => {
  if (orientation !== before) {
    void fetchNext()
    return
  }
  // A new size matters only if the photo on show is now close to the box where it wasn't, or the reverse: it was sent as the plain photo or as a composite accordingly.
  // With nothing on show yet, the answer to a fetch in flight is checked when it arrives.
  if (shownFor && stale(shownFor.photo, shownFor.box)) void fetchNext()
})
watch(() => props.photoNext, (next, before) => {
  if ((next ?? 0) > (before ?? 0)) void fetchNext()
})
// A reconnect is the chance to recover from a start with the server out of reach. A photo on show needs nothing.
watch(() => props.socketOpens, () => {
  if (top.value === null && inflight === 0) void fetchNext()
})

// Motion coming on with a photo on show that has no drift (it was shown while the screen was off or dimmed, or before the settings arrived): it begins now, from rest.
watch(() => props.motion, (on) => {
  if (on && top.value !== null && drifts.value[top.value] === null) startDrift(top.value)
})

const options = computed(() => props.paneOptions ?? DEFAULT_PANE_OPTIONS)

/** The bleed as the layers' offsets, or nothing at all for a frame that keeps to its box. */
const bleedStyle = computed(() => {
  const bleed = props.bleed
  if (!bleeds(bleed)) return undefined
  return {
    '--photo-bleed-top': `${bleed.top}px`,
    '--photo-bleed-right': `${bleed.right}px`,
    '--photo-bleed-bottom': `${bleed.bottom}px`,
    '--photo-bleed-left': `${bleed.left}px`,
  }
})

const time = computed(() => formatTime(props.now, props.timezone))
const date = computed(() => formatLongDate(props.now, props.timezone))

const weatherNow = computed(() => {
  if (!options.value.show_weather) return null
  const current = currentWeather(props.weather, props.now)
  if (!current) return null
  const icon = weatherIcon(current.condition)
  const temperature = current.temperature === null ? null : formatTemperature(current.temperature)
  return icon || temperature ? { icon, temperature, label: weatherLabel(current.condition) } : null
})

const upcoming = computed(() => props.pane || !options.value.show_time ? null : nextEvent(props.events, props.now, props.timezone))

/** The pills to draw, each in its corner. One with only the weather, and no weather to show, is left out. */
const pills = computed(() => photoPills(options.value, props.photoCorner ?? 'top-left', props.overlayShowing ?? false)
  .map(pill => ({ ...pill, time: pill.time && (options.value.show_time || weatherNow.value !== null) }))
  .filter(pill => pill.time || pill.date))
</script>

<template>
  <section class="view" :class="{ pane, bleeding: !!bleedStyle }" :style="bleedStyle" data-testid="photo-view">
    <img
      v-for="(url, index) in layers"
      :key="index"
      class="layer"
      :class="[{ top: top === index, under: under === index }, drifts[index] && `drift-${drifts[index].name}`]"
      :style="driftStyle(index as 0 | 1)"
      :src="url ?? undefined"
      alt=""
      draggable="false"
      :data-testid="`photo-layer-${index}`"
    >

    <div v-if="top === null" class="empty" data-testid="photo-empty">
      <AppIcon :icon="ImageOff" :size="pane ? 96 : 140" />
      <p class="calm">
        No photos yet
      </p>
    </div>

    <!-- Keyed by the corner and what is in it, so a move fades a pill out where it was and in where it goes. -->
    <TransitionGroup name="pill-move">
      <div
        v-for="pill in pills"
        :key="`${pill.corner}:${pill.time}:${pill.date}`"
        class="pill"
        :class="[`corner-${pill.corner}`, { compact: pane }]"
        :data-corner="pill.corner"
        data-testid="photo-pill"
      >
        <div v-if="pill.time" class="line">
          <span v-if="options.show_time" class="clock" data-testid="photo-clock">{{ time }}</span>
          <span v-if="weatherNow" class="weather" :title="weatherNow.label ?? undefined" data-testid="photo-weather">
            <AppIcon v-if="weatherNow.icon" :icon="weatherNow.icon" :size="pane ? 48 : 64" />
            <span v-if="weatherNow.temperature">{{ weatherNow.temperature }}</span>
          </span>
        </div>

        <div v-if="pill.date" class="date" data-testid="photo-date">
          {{ date }}
        </div>

        <div v-if="pill.time && upcoming" class="next" data-testid="photo-next-event">
          <span class="marker" :style="{ background: upcoming.event.people[0]?.colour ?? 'rgba(255, 255, 255, 0.6)' }" />
          <span class="when" data-testid="photo-next-time">{{ upcoming.time }}</span>
          <span class="what" data-testid="photo-next-title">{{ eventLabel(upcoming.event) }}</span>
        </div>
      </div>
    </TransitionGroup>
  </section>
</template>

<style scoped>
.view {
  position: absolute;
  inset: 0;
  overflow: hidden;
  /* Its own stacking context, so the layers' and the pill's z-indexes stay inside it and the overlay banner and the dimmer, which come after it in the stage, still paint over all of it. */
  isolation: isolate;
  /* So the pane's sizes could be asked of the box it is in rather than of the stage. */
  container-type: size;
}

/* Drawn past the box on the sides it bleeds over, and clipped by the pane it is in. */
.view.bleeding {
  overflow: visible;
}

/* Every layer fills the box, and the bleed if there is one. A photo of another shape was made the box's shape by the server, so `cover` crops nothing worth having; one close to its shape comes plain and `cover` crops it a little, centrally. */
.layer {
  position: absolute;
  top: calc(-1 * var(--photo-bleed-top, 0px));
  left: calc(-1 * var(--photo-bleed-left, 0px));
  width: calc(100% + var(--photo-bleed-left, 0px) + var(--photo-bleed-right, 0px));
  height: calc(100% + var(--photo-bleed-top, 0px) + var(--photo-bleed-bottom, 0px));
  object-fit: cover;
  opacity: 0;
  transition: opacity 1.5s ease-in-out;
}

/* The slow drift (see the header). Linear over a long time reads as a steady creep, where an ease would be a pause at each end that the eye catches. `both` holds the end if a photo outstays its interval. The two names are the same keyframes, so a layer given a new photo can restart by changing name. The compositor is told about the transform only while there is one to do. */
.layer.drift-a {
  animation: photo-drift-a var(--drift-seconds) linear both;
  will-change: transform;
}

.layer.drift-b {
  animation: photo-drift-b var(--drift-seconds) linear both;
  will-change: transform;
}

@keyframes photo-drift-a {
  from {
    transform: var(--drift-from);
  }

  to {
    transform: var(--drift-to);
  }
}

@keyframes photo-drift-b {
  from {
    transform: var(--drift-from);
  }

  to {
    transform: var(--drift-to);
  }
}

/* No drift at all for someone who has asked their device for less motion. */
@media (prefers-reduced-motion: reduce) {
  .layer.drift-a,
  .layer.drift-b {
    animation: none;
    will-change: auto;
  }
}

/* The new photo fades in over the old one, which stays solid until the fade is over. */
.layer.top {
  z-index: 2;
  opacity: 1;
}

.layer.under {
  z-index: 1;
  opacity: 1;
  transition: none;
}

.empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 32px;
  color: var(--muted);
}

.calm {
  margin: 0;
  font-family: var(--font-display);
  font-size: 96px;
}

/* Smaller in a pane of the hybrid view (mock 4k): less to give up of a photo that is only 1000 px high or 1100 px wide. */
.pane .empty {
  gap: 20px;
}

.pane .calm {
  font-size: 64px;
}

/* Dark glass in white, not the theme's colours: it has to read on a snowfield as well as a night sky. It sits in a corner, never the bottom centre where the overlay banner is or the top centre where the preview badge is. */
.pill {
  position: absolute;
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: 20px;
  box-sizing: border-box;
  /* The stage's width less a 64 px margin each side, which is 1312 px on the portrait stage. */
  max-width: min(1400px, calc(100% - 128px));
  padding: 28px 52px 28px 44px;
  border-radius: var(--radius-md);
  background: rgba(20, 18, 16, 0.55);
  -webkit-backdrop-filter: blur(28px);
  backdrop-filter: blur(28px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  color: #fff;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
}

/* Which corner the page has chosen for it (utils/burnIn.ts). */
.corner-top-left {
  top: 64px;
  left: 64px;
}

.corner-top-right {
  top: 64px;
  right: 64px;
}

.corner-bottom-right {
  right: 64px;
  bottom: 64px;
}

.corner-bottom-left {
  bottom: 64px;
  left: 64px;
}

.line {
  display: flex;
  align-items: center;
  gap: 48px;
}

/* The compact pill of the hybrid view, from the mock: one line, 48 px in from the pane's corner. */
.pill.compact {
  max-width: calc(100% - 96px);
  padding: 22px 40px 22px 34px;
  border-radius: 32px;
}

.pill.compact.corner-top-left {
  top: 48px;
  left: 48px;
}

.pill.compact.corner-top-right {
  top: 48px;
  right: 48px;
}

.pill.compact.corner-bottom-right {
  right: 48px;
  bottom: 48px;
}

.pill.compact.corner-bottom-left {
  bottom: 48px;
  left: 48px;
}

.compact .line {
  gap: 36px;
}

.compact .clock {
  font-size: 96px;
}

.compact .weather {
  gap: 12px;
  font-size: 54px;
}

.compact .date {
  font-size: 54px;
}

.clock {
  font-family: var(--font-display);
  font-size: 128px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.weather {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 72px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.weather svg {
  flex: none;
}

.date {
  overflow: hidden;
  font-size: 72px;
  font-weight: 700;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.next {
  display: flex;
  align-items: center;
  gap: 24px;
  min-width: 0;
  font-size: 52px;
  line-height: 1.2;
}

/* The person's colour as a short upright bar, as in the agenda. */
.marker {
  flex: none;
  width: 14px;
  height: 64px;
  border-radius: var(--radius-pill);
}

.when {
  flex: none;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* One line, cut with an ellipsis. */
.what {
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

<style>
.pill-move-enter-active,
.pill-move-leave-active {
  transition: opacity 0.8s ease;
}

.pill-move-enter-from,
.pill-move-leave-to {
  opacity: 0;
}
</style>
