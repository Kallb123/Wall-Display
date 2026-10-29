<script setup lang="ts">
import type { Overlay } from '../../shared/display'
import { isOverlayShowing, overlayIcon } from '~/utils/overlay'

// A message over whatever view is showing (architecture §7.1): a large pill at
// the bottom of the stage, in the accent so it reads from across the room. The
// server removes an overlay when it expires, but `now` lets a wall running from
// its cache drop one by itself.
const props = defineProps<{
  overlay: Overlay | null
  now: Date
}>()

const showing = computed(() => isOverlayShowing(props.overlay, props.now))
const icon = computed(() => overlayIcon(props.overlay?.icon ?? null))
</script>

<template>
  <Transition name="overlay-rise">
    <div v-if="showing && overlay" class="overlay">
      <div class="banner" role="status" data-testid="overlay-banner">
        <AppIcon :icon="icon" :size="72" />
        <span class="text" data-testid="overlay-text">{{ overlay.text }}</span>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* The full-width strip centres the pill, so the transition can move the strip without fighting a centring transform. */
.overlay {
  position: absolute;
  right: 0;
  bottom: 64px;
  left: 0;
  display: flex;
  justify-content: center;
  pointer-events: none;
}

.banner {
  display: flex;
  align-items: center;
  gap: 32px;
  box-sizing: border-box;
  max-width: 2200px;
  padding: 28px 64px 28px 56px;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--on-accent);
  box-shadow: var(--shadow-lift);
  font-size: 60px;
  font-weight: 700;
  line-height: 1.15;
}

.banner :deep(svg) {
  flex: none;
}

/* Two lines at most, then an ellipsis. */
.text {
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.overlay-rise-enter-active,
.overlay-rise-leave-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}

.overlay-rise-enter-from,
.overlay-rise-leave-to {
  opacity: 0;
  transform: translateY(24px);
}
</style>
