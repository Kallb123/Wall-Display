<script setup lang="ts">
// "Tap for fullscreen", for a display open in a plain browser tab (PR 5.8). An
// installed display, and the Pi's kiosk, already report `fullscreen` or
// `standalone` as their display mode, so only a tab (`browser`) ever shows it.
// It is drawn in window coordinates, outside the scaled stage, so it is the same
// size on every screen, and goes once the page is fullscreen. Browsers only
// allow fullscreen from a tap or click, hence the button.
const browserTab = ref(false)
const fullscreen = ref(false)
const supported = ref(false)

const visible = computed(() => browserTab.value && supported.value && !fullscreen.value)

let query: MediaQueryList | null = null
function sync() {
  browserTab.value = query?.matches ?? false
  fullscreen.value = document.fullscreenElement !== null
}

onMounted(() => {
  query = window.matchMedia('(display-mode: browser)')
  supported.value = document.fullscreenEnabled === true
  sync()
  query.addEventListener('change', sync)
  document.addEventListener('fullscreenchange', sync)
})

onBeforeUnmount(() => {
  query?.removeEventListener('change', sync)
  document.removeEventListener('fullscreenchange', sync)
})

function enter() {
  document.documentElement.requestFullscreen().catch(() => {})
}
</script>

<template>
  <button v-if="visible" type="button" class="hint" data-testid="fullscreen-hint" @click="enter">
    Tap for fullscreen
  </button>
</template>

<style scoped>
.hint {
  position: fixed;
  bottom: max(16px, env(safe-area-inset-bottom));
  left: 50%;
  z-index: 10;
  padding: 10px 20px;
  /* Light on dark, because it usually sits on the black letterbox; the border keeps it apart from a light stage too. */
  border: 1px solid rgb(255 255 255 / 0.35);
  border-radius: 999px;
  background: rgb(40 40 40 / 0.75);
  color: #fff;
  font: 600 15px/1.2 var(--font-body, sans-serif);
  cursor: pointer;
  transform: translateX(-50%);
  -webkit-tap-highlight-color: transparent;
}
</style>
