<script setup lang="ts">
import { AlarmClock } from 'lucide-vue-next'
import { formatTime } from '~/utils/format'
import { nightAlarm, nightFirstEvent, nightPosition } from '~/utils/night'
import type { ViewProps } from '../../utils/views'

// The night view (architecture §4.1): a very dim clock on pure black, for a
// room that is dark but where the screen should stay on. It is black whatever
// the theme or palette (a takeover never reaches it, see isCalendarView), and
// the clock is dim enough to read in the dark without lighting the room. Under
// it, one even dimmer line if the display asks for one (`nightText`): the first
// timed event of the next 24 hours, or the next alarm. There is no weather and
// no person colour; it is meant to be forgotten about.
//
// Bright-ish static glyphs on black are the worst case for burn-in, so unless
// the display turns `burn_in` off the whole block moves to a new spot every five
// minutes (see nightPosition), a long way compared with the nudge the rest of the
// wall gets, and does it as a slow drift rather than a jump.
//
// It has a portrait layout (PR 5.10): the same block, centred on the taller
// stage, drifting along the long side. The 360 px clock is about 970 px wide,
// which fits the 1440 px of the portrait stage with its drift to spare.
const props = defineProps<ViewProps>()

const time = computed(() => formatTime(props.now, props.timezone))

/** The line under the clock, or null for none. An icon is there for the alarm only. */
const line = computed(() => {
  if (props.nightText === 'first_event') {
    const first = nightFirstEvent(props.events, props.now, props.timezone)
    return first ? { icon: false, words: `${first.day === 'Tomorrow' ? 'Tomorrow ' : ''}${first.time} · ${first.event.display_title}` } : null
  }
  if (props.nightText === 'next_alarm') {
    const alarm = nightAlarm(props.alarm, props.now, props.timezone)
    return alarm ? { icon: true, words: `${alarm.day === 'Tomorrow' ? 'Tomorrow ' : ''}${alarm.time}` } : null
  }
  return null
})

const position = computed(() => props.burnIn ? nightPosition(props.now, props.stage.orientation) : { x: 0, y: 0 })
</script>

<template>
  <section class="view" data-testid="night-view">
    <div class="block" :style="{ transform: `translate(${position.x}px, ${position.y}px)` }">
      <div class="clock" data-testid="night-clock">
        {{ time }}
      </div>

      <div v-if="line" class="text" data-testid="night-text">
        <AppIcon v-if="line.icon" :icon="AlarmClock" :size="64" />
        <span class="words">{{ line.words }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Black, not the theme's ground: the stage's own colour must not show through, so a light theme is as dark as a dark one. */
.view {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #000;
}

/* A slow drift to the next spot, long enough that nobody sees it move. */
.block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  /* Leaves room for the drift (160 px either way across on the portrait stage) and 64 px of margin beyond it, so a long line is cut, not pushed off the stage. */
  max-width: min(1600px, 100% - 448px);
  transition: transform 20s ease-in-out;
}

/* Dim but readable in a dark room: the warm white of the clock, at about a fifth of its strength. */
.clock {
  color: rgba(255, 236, 220, 0.22);
  font-family: var(--font-display);
  font-size: 360px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.text {
  display: flex;
  align-items: center;
  gap: 24px;
  max-width: 100%;
  color: rgba(255, 236, 220, 0.16);
  font-size: 72px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.text svg {
  flex: none;
}

/* One line, cut with an ellipsis. */
.words {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
