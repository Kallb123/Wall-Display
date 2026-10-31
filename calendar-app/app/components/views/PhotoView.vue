<script setup lang="ts">
import { ImageOff } from 'lucide-vue-next'
import { photoResponseSchema } from '../../../shared/photos'
import type { PhotoInfo } from '../../../shared/photos'
import { currentWeather, formatTemperature, weatherLabel } from '../../../shared/weather'
import { formatTime } from '~/utils/format'
import { nextEvent } from '~/utils/nextEvent'
import { weatherIcon } from '~/utils/weather'
import type { ViewProps } from '../../utils/views'

// The photo frame (architecture §4.1, §5): one photo fullscreen at a time, and
// a small pill in the top-left corner with the clock, the weather and the next
// event. The server owns the rotation: it sends `photo.next` (counted by the
// socket and handed down as `photoNext`) when it is time, and this view then
// asks `GET /api/photos/next` for the photo to show. The image is already
// rendered to 2560×1440 on the server, so it is only drawn with `cover`.
//
// Two <img> layers are stacked. The next photo is loaded and `decode()`d off
// screen first, so the Pi never decodes in the middle of a fade, then it is put
// on the hidden layer and faded in over the old one, which stays solid beneath
// it until the fade is done (two half-transparent photos would show the
// background through). A photo that fails, or an answer of "none", leaves what
// is on show alone; with nothing on show there is a calm message and the view
// tries again now and then. A photo is shown whatever the special days say, and
// the pill has its own dark glass colours, so it reads on any photo and takes
// nothing from the theme or a palette. The overlay banner is at the bottom
// centre, well clear of the corner.
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
  // The first photo has nothing beneath it to protect, so a skip straight after it need not wait.
  if (previous === null) return
  fading = new Promise<void>((resolve) => {
    fadeTimer = setTimeout(() => {
      under.value = null
      // Out of sight now, so let go of its picture.
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
  const id = ++latest
  inflight++
  try {
    let photo: PhotoInfo | null = null
    try {
      const answer = photoResponseSchema.parse(await $fetch('/api/photos/next', { query: { display }, timeout: REQUEST_TIMEOUT_MS }))
      photo = answer.photo
    } catch {
      // Offline or busy: what is on show stays.
    }
    if (id !== latest || disposed) return
    // The only photo there is, or the same again: no use fading to itself.
    if (photo && photo.url !== shownUrl.value) await show(photo, id)
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
watch(() => props.photoNext, (next, before) => {
  if ((next ?? 0) > (before ?? 0)) void fetchNext()
})
// A reconnect is the chance to recover from a start with the server out of reach. A photo on show needs nothing.
watch(() => props.socketOpens, () => {
  if (top.value === null && inflight === 0) void fetchNext()
})

const time = computed(() => formatTime(props.now, props.timezone))

const weatherNow = computed(() => {
  const current = currentWeather(props.weather, props.now)
  if (!current) return null
  const icon = weatherIcon(current.condition)
  const temperature = current.temperature === null ? null : formatTemperature(current.temperature)
  return icon || temperature ? { icon, temperature, label: weatherLabel(current.condition) } : null
})

const upcoming = computed(() => nextEvent(props.events, props.now, props.timezone))
</script>

<template>
  <section class="view" data-testid="photo-view">
    <img
      v-for="(url, index) in layers"
      :key="index"
      class="layer"
      :class="{ top: top === index, under: under === index }"
      :src="url ?? undefined"
      alt=""
      draggable="false"
      :data-testid="`photo-layer-${index}`"
    >

    <div v-if="top === null" class="empty" data-testid="photo-empty">
      <AppIcon :icon="ImageOff" :size="140" />
      <p class="calm">
        No photos yet
      </p>
    </div>

    <div class="pill" data-testid="photo-pill">
      <div class="line">
        <span class="clock" data-testid="photo-clock">{{ time }}</span>
        <span v-if="weatherNow" class="weather" :title="weatherNow.label ?? undefined" data-testid="photo-weather">
          <AppIcon v-if="weatherNow.icon" :icon="weatherNow.icon" :size="64" />
          <span v-if="weatherNow.temperature">{{ weatherNow.temperature }}</span>
        </span>
      </div>

      <div v-if="upcoming" class="next" data-testid="photo-next-event">
        <span class="marker" :style="{ background: upcoming.event.people[0]?.colour ?? 'rgba(255, 255, 255, 0.6)' }" />
        <span class="when" data-testid="photo-next-time">{{ upcoming.time }}</span>
        <span class="what" data-testid="photo-next-title">{{ upcoming.event.display_title }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.view {
  position: absolute;
  inset: 0;
  overflow: hidden;
  /* Its own stacking context, so the layers' and the pill's z-indexes stay inside it and the overlay banner and the dimmer, which come after it in the stage, still paint over all of it. */
  isolation: isolate;
}

/* Every layer fills the stage. The server already made the photo 16:9, so `cover` crops nothing worth having. */
.layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 1.5s ease-in-out;
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

/* Dark glass in white, not the theme's colours: it has to read on a snowfield as well as a night sky. Top left, because the overlay banner is at the bottom and the preview badge at the top centre. */
.pill {
  position: absolute;
  z-index: 3;
  top: 64px;
  left: 64px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  box-sizing: border-box;
  max-width: 1400px;
  padding: 28px 52px 28px 44px;
  border-radius: var(--radius-md);
  background: rgba(20, 18, 16, 0.55);
  -webkit-backdrop-filter: blur(28px);
  backdrop-filter: blur(28px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  color: #fff;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
}

.line {
  display: flex;
  align-items: center;
  gap: 48px;
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
