<script setup lang="ts">
import { Video } from 'lucide-vue-next'

// The "Camera" section: the camera on the wall (the doorbell rang, say), so it
// can be taken down once the door is answered. A tap is only a request (`close`).

defineProps<{
  name: string
}>()

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <section aria-labelledby="camera-title" data-testid="camera">
    <h2 id="camera-title" class="label">
      Camera
    </h2>
    <div class="card note">
      <div class="current" data-testid="camera-current">
        <span class="power live">
          <AppIcon :icon="Video" :size="26" />
        </span>
        <div class="current-text">
          <p class="current-message" data-testid="camera-current-name">
            {{ name }}
          </p>
          <p class="hint">
            On the wall now
          </p>
        </div>
        <button type="button" class="button small" data-testid="camera-close" @click="emit('close')">
          Close
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped src="../../assets/remote-base.css"></style>

<style scoped>
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
</style>
