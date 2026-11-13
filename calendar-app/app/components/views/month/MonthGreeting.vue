<script setup lang="ts">
import { greetingSize } from '~/utils/specialDays'

// A takeover's greeting (architecture §6): in the panel, in the portrait band or,
// with no panel, in the header row. The size is set from the length of the
// greeting. A parent can place it with a class of its own, which falls through
// to the root.
defineProps<{
  greeting: string
}>()
</script>

<template>
  <div class="greeting" data-testid="greeting" :style="{ fontSize: `${greetingSize(greeting)}px` }">
    {{ greeting }}
  </div>
</template>

<style scoped>
/* Pulled up a little: the display face's line box leaves a gap above the date. */
.greeting {
  margin-bottom: -12px;
  font-family: var(--font-display);
  line-height: 1.05;
  overflow-wrap: anywhere;
  text-wrap: balance;
}
</style>
