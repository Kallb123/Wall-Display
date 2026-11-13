<script setup lang="ts">
// The now line: a rule across today's column with a dot at its left end. In the
// hours it sits at `top` (a percentage of the hour scale); when now is in a folded
// band it is on the band's edge towards the hours instead (`edge` is the band's).
defineProps<{
  top?: string
  edge?: 'early' | 'late'
}>()
</script>

<template>
  <div
    class="now-line"
    :class="edge ? (edge === 'early' ? 'at-bottom' : 'at-top') : undefined"
    :style="top ? { top } : undefined"
    data-testid="now-line"
  >
    <span class="now-dot" />
  </div>
</template>

<style scoped>
/* Now: a rule across today's column with a dot at its left end, and the time in the gutter. */
.now-line {
  position: absolute;
  right: 0;
  left: 0;
  z-index: 2;
  height: 4px;
  border-radius: 2px;
  background: var(--accent);
  transform: translateY(-50%);
  pointer-events: none;
}

.now-line.at-bottom {
  top: auto;
  bottom: 0;
  transform: translateY(50%);
}

.now-line.at-top {
  top: 0;
}

.now-dot {
  position: absolute;
  top: 50%;
  left: 6px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent);
  transform: translateY(-50%);
}

.portrait .now-dot {
  left: 4px;
}
</style>
