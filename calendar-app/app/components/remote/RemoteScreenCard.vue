<script setup lang="ts">
import { Power } from 'lucide-vue-next'

// The screen card: whether the panel is on, and the switch that turns it on or
// off. A tap is only a request (`toggle`); the page sends it.

defineProps<{
  screenOn: boolean
}>()

const emit = defineEmits<{
  toggle: []
}>()
</script>

<template>
  <section class="card screen" aria-labelledby="screen-title">
    <span class="power" :class="{ off: !screenOn }">
      <AppIcon :icon="Power" :size="26" />
    </span>
    <div class="screen-text">
      <h2 id="screen-title" class="screen-title">
        Screen
      </h2>
      <p class="hint" data-testid="screen-state">
        {{ screenOn ? 'On' : 'Off, panel in standby' }}
      </p>
    </div>
    <button
      type="button"
      class="switch"
      role="switch"
      :aria-checked="screenOn"
      aria-labelledby="screen-title"
      data-testid="screen-toggle"
      @click="emit('toggle')"
    >
      <span class="track"><span class="knob" /></span>
    </button>
  </section>
</template>

<style scoped src="../../assets/remote-base.css"></style>

<style scoped>
.screen {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 16px 16px 18px;
}

.screen-text {
  flex: 1;
  min-width: 0;
}

.screen-title {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
}

/* The button is the 44 px target; the track inside it is what is drawn. */
.switch {
  display: grid;
  flex: none;
  place-items: center;
  width: 68px;
  height: 48px;
}

.track {
  position: relative;
  width: 56px;
  height: 32px;
  border-radius: 999px;
  background: var(--line);
  transition: background 0.2s ease;
}

.knob {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--muted);
  transition: transform 0.2s ease, background 0.2s ease;
}

.switch[aria-checked='true'] .track {
  background: var(--accent);
}

.switch[aria-checked='true'] .knob {
  background: var(--on-accent);
  transform: translateX(24px);
}
</style>
