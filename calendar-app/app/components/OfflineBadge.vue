<script setup lang="ts">
import { WifiOff } from 'lucide-vue-next'
import type { SocketStatus } from '~/composables/useDisplaySocket'

// A small "Offline" pill, shown once the socket has gone `delayMs` without
// being open. A normal page load, or a reconnect that takes a moment, never
// flashes it. It goes again as soon as the socket opens. It is top right, and
// `side="left"` moves it top left, for when the photo frame's pill has the
// right-hand corner (utils/burnIn.ts).
const props = withDefaults(defineProps<{
  status: SocketStatus
  delayMs?: number
  side?: 'left' | 'right'
}>(), { delayMs: 3000, side: 'right' })

const visible = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

watch(() => props.status, (status) => {
  if (status === 'open') {
    clearTimeout(timer)
    timer = undefined
    visible.value = false
  } else if (!visible.value && timer === undefined) {
    // Connecting and closed count the same: the wait is for the socket to be open again.
    timer = setTimeout(() => {
      timer = undefined
      visible.value = true
    }, props.delayMs)
  }
}, { immediate: true })

onScopeDispose(() => clearTimeout(timer))
</script>

<template>
  <div v-if="visible" class="offline" :class="`side-${side}`" data-testid="offline-badge">
    <AppIcon :icon="WifiOff" :size="40" />
    Offline
  </div>
</template>

<style scoped>
.offline {
  position: absolute;
  top: 48px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 32px;
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--muted);
  box-shadow: var(--shadow-soft);
  font-size: 40px;
  font-weight: 700;
}

.side-right {
  right: 64px;
}

.side-left {
  left: 64px;
}
</style>
