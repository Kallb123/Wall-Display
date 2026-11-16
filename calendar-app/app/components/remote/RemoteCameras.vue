<script setup lang="ts">
import { Video } from 'lucide-vue-next'
import type { CameraRow } from '~/utils/camera'

// The "Cameras" section: each camera in the config, with a button to put it on
// the wall or, for the one already there (the doorbell rang, say), to take it
// down once the door is answered. A tap is only a request (`show` or `hide`).

defineProps<{
  cameras: CameraRow[]
}>()

const emit = defineEmits<{
  show: [id: string]
  hide: []
}>()
</script>

<template>
  <section aria-labelledby="cameras-title" data-testid="cameras">
    <h2 id="cameras-title" class="label">
      Cameras
    </h2>
    <ul class="card list">
      <li v-for="camera in cameras" :key="camera.id" class="row" :data-testid="`camera-${camera.id}`">
        <span class="power" :class="camera.live ? 'live' : 'off'">
          <AppIcon :icon="Video" :size="26" />
        </span>
        <div class="text">
          <p class="name" data-testid="camera-name">
            {{ camera.name }}
          </p>
          <p v-if="camera.live" class="hint" data-testid="camera-live">
            On the wall now
          </p>
        </div>
        <button
          v-if="camera.live"
          type="button"
          class="button small primary"
          :aria-label="`Hide ${camera.name}`"
          data-testid="camera-hide"
          @click="emit('hide')"
        >
          Hide
        </button>
        <button
          v-else
          type="button"
          class="button small"
          :aria-label="`Show ${camera.name}`"
          data-testid="camera-show"
          @click="emit('show', camera.id)"
        >
          Show
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped src="../../assets/remote-base.css"></style>

<style scoped>
.list {
  margin: 0;
  padding: 4px 18px;
  list-style: none;
}

.row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 0;
}

.row + .row {
  border-top: 1px solid var(--line);
}

.text {
  flex: 1;
  min-width: 0;
}

.name {
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
</style>
