<script setup lang="ts">
import { Bell, Pause, Timer } from 'lucide-vue-next'
import type { WallTimer } from '../../shared/display'
import { msToNextSecond, timerView, visibleTimers } from '~/utils/timers'
import type { TimerPhase } from '~/utils/timers'

// The kitchen timers (architecture §7.1, like the banner): a column of cards at
// the bottom right of the stage, over whatever view is showing and clear of the
// banner under it, the offline badge above it and the preview badge at the top.
// The server sends a timer when it changes, never each second, so the stack
// counts down by itself, on a tick that lands just after each whole second of
// the wall clock and that runs only while there are timers. At most three
// cards show, the rest being counted in a chip. `quiet` is for the night view,
// where it is dimmed so it doesn't glare in a dark room.
const props = defineProps<{
  timers: WallTimer[]
  /** The stage's shape: the portrait stage is narrower, so the cards sit nearer its edge. */
  orientation?: 'landscape' | 'portrait'
  /** Dim it for a dark room. */
  quiet?: boolean
}>()

/** A little after the second, so the clock has certainly moved on when the tick reads it. */
const TICK_SLACK_MS = 15

const now = ref(Date.now())
let tick: ReturnType<typeof setTimeout> | undefined

function schedule() {
  tick = setTimeout(() => {
    now.value = Date.now()
    schedule()
  }, msToNextSecond(Date.now()) + TICK_SLACK_MS)
}

function stop() {
  clearTimeout(tick)
  tick = undefined
}

watch(() => props.timers.length > 0, (any) => {
  stop()
  if (any) {
    now.value = Date.now()
    schedule()
  }
}, { immediate: true })

onScopeDispose(stop)

const cards = computed(() => {
  const { shown, more } = visibleTimers(props.timers)
  return { more, list: shown.map(timer => ({ id: timer.id, ...timerView(timer, now.value) })) }
})

const icons: Record<TimerPhase, typeof Bell> = { running: Timer, paused: Pause, finished: Bell }
</script>

<template>
  <div v-if="timers.length > 0" class="timers" :class="[`is-${orientation ?? 'landscape'}`, { quiet }]" data-testid="timer-stack">
    <TransitionGroup name="timer" tag="div" class="column">
      <div
        v-for="card in cards.list"
        :key="card.id"
        class="card"
        :class="`phase-${card.phase}`"
        role="timer"
        data-testid="timer-card"
        :data-phase="card.phase"
      >
        <div class="head">
          <AppIcon :icon="icons[card.phase]" :size="44" />
          <span class="label" data-testid="timer-label">{{ card.label }}</span>
          <span v-if="card.phase === 'paused'" class="state">Paused</span>
        </div>
        <div class="time" data-testid="timer-time">
          {{ card.text }}
        </div>
        <div v-if="card.progress !== null && card.phase !== 'finished'" class="track">
          <div class="fill" data-testid="timer-bar" :style="{ width: `${card.progress * 100}%` }" />
        </div>
      </div>
    </TransitionGroup>
    <div v-if="cards.more > 0" class="more" data-testid="timer-more">
      +{{ cards.more }} more
    </div>
  </div>
</template>

<style scoped>
/* Bottom right, 232 px up: the overlay banner is the bottom 64 to about 200 px, so the two never meet. */
.timers {
  position: absolute;
  right: 64px;
  bottom: 232px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 20px;
  pointer-events: none;
}

/* The portrait stage is 1440 px wide, so the cards sit a little nearer its edge. */
.is-portrait {
  right: 48px;
}

/* Dimmer, not just fainter: a light card at half opacity on black is still bright. */
.quiet {
  filter: brightness(0.4);
}

.column {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.card {
  box-sizing: border-box;
  width: 560px;
  padding: 21px 37px 29px;
  border-radius: var(--radius-md);
  border: 3px solid var(--line);
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-lift);
}

.head {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 40px;
  font-weight: 700;
  line-height: 1.2;
}

.head :deep(svg) {
  flex: none;
}

.label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.state {
  margin-left: auto;
  flex: none;
}

/* Tabular numerals, so the digits don't shift sideways as the seconds change. */
.time {
  font-family: var(--font-display);
  font-size: 128px;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
  white-space: nowrap;
}

.track {
  height: 14px;
  margin-top: 12px;
  overflow: hidden;
  border-radius: var(--radius-pill);
  background: color-mix(in oklch, currentcolor 18%, transparent);
}

.fill {
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--accent);
}

.phase-paused {
  color: var(--muted);
  box-shadow: var(--shadow-soft);
}

.phase-paused .fill {
  background: var(--muted);
}

.phase-finished {
  border-color: transparent;
  background: var(--accent);
  color: var(--on-accent);
  animation: timer-pulse 1.6s ease-in-out infinite;
}

.more {
  padding: 12px 32px;
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--muted);
  box-shadow: var(--shadow-soft);
  font-size: 40px;
  font-weight: 700;
}

@keyframes timer-pulse {
  50% {
    transform: scale(1.03);
    box-shadow: 0 0 0 16px color-mix(in oklch, var(--accent) 30%, transparent);
  }
}

/* A finished card is still told apart by its colours and its bell, so it loses only the pulse. */
@media (prefers-reduced-motion: reduce) {
  .phase-finished {
    animation: none;
  }
}

.timer-enter-active,
.timer-leave-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}

.timer-leave-active {
  position: absolute;
}

.timer-move {
  transition: transform 0.4s ease;
}

.timer-enter-from,
.timer-leave-to {
  opacity: 0;
  transform: translateX(48px);
}
</style>
