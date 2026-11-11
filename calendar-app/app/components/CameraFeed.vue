<script setup lang="ts">
import { Video, VideoOff } from 'lucide-vue-next'
import type { CameraState } from '../../shared/display'
import { cameraSecondsLeft, isCameraShowing } from '~/utils/camera'

// A camera's live feed over whatever view is showing, such as the front door
// when the doorbell rings: a large panel in the middle of the stage over a dark
// veil, with the camera's name and the seconds it has left. The feed is loaded
// by the browser straight from the address in the config (go2rtc, say), as a
// page in a frame, an MJPEG image or a video, as the camera's `kind` says. It is
// keyed on the address, so the same camera shown again for longer carries on
// playing instead of starting over.
const props = defineProps<{
  camera: CameraState | null
  now: Date
}>()

const showing = computed(() => isCameraShowing(props.camera, props.now))
const secondsLeft = computed(() => props.camera ? cameraSecondsLeft(props.camera, props.now) : 0)

/** The address whose image or video failed to load: the panel says so rather than show a blank box. */
const failedUrl = ref<string | null>(null)
const failed = computed(() => props.camera !== null && failedUrl.value === props.camera.url)
function onError() {
  if (props.camera) failedUrl.value = props.camera.url
}
</script>

<template>
  <Transition name="camera-fade">
    <div v-if="showing && camera" class="veil" data-testid="camera">
      <div class="panel" role="status" :aria-label="camera.name">
        <div class="heading">
          <AppIcon :icon="Video" :size="64" />
          <span class="name" data-testid="camera-name">{{ camera.name }}</span>
          <span class="left" data-testid="camera-left">{{ secondsLeft }} s</span>
        </div>
        <div class="feed" :data-kind="camera.kind">
          <div v-if="failed" class="unavailable" data-testid="camera-unavailable">
            <AppIcon :icon="VideoOff" :size="96" />
            Camera unavailable
          </div>
          <iframe
            v-else-if="camera.kind === 'page'"
            :key="camera.url"
            :src="camera.url"
            :title="camera.name"
            allow="autoplay; fullscreen"
            referrerpolicy="no-referrer"
            data-testid="camera-frame"
          />
          <img
            v-else-if="camera.kind === 'image'"
            :key="camera.url"
            :src="camera.url"
            :alt="camera.name"
            draggable="false"
            data-testid="camera-image"
            @error="onError"
          >
          <video
            v-else
            :key="camera.url"
            :src="camera.url"
            autoplay
            muted
            playsinline
            data-testid="camera-video"
            @error="onError"
          />
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Covers the view, which carries on underneath; the wall is not a touchscreen, so nothing here takes a click. */
.veil {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 0.7);
  pointer-events: none;
}

/* 16:9, as wide as the stage allows with 64 px clear at each side: 2048 px on the landscape stage, the full width less the margins on the portrait one. */
.panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: min(2048px, 100% - 128px);
}

.heading {
  display: flex;
  align-items: center;
  gap: 28px;
  align-self: flex-start;
  max-width: 100%;
  box-sizing: border-box;
  padding: 20px 48px 20px 40px;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--on-accent);
  box-shadow: var(--shadow-lift);
  font-size: 56px;
  font-weight: 700;
  line-height: 1.15;
}

.heading :deep(svg) {
  flex: none;
}

.name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.left {
  flex: none;
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

.feed {
  position: relative;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  border-radius: var(--radius-md);
  background: #000;
  box-shadow: var(--shadow-lift);
}

.feed iframe,
.feed img,
.feed video {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  object-fit: contain;
}

.unavailable {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 32px;
  color: #fff;
  font-size: 56px;
  font-weight: 700;
}

.camera-fade-enter-active,
.camera-fade-leave-active {
  transition: opacity 0.4s ease;
}

.camera-fade-enter-from,
.camera-fade-leave-to {
  opacity: 0;
}
</style>
