<script setup lang="ts">
import { greetingSize } from '~/utils/specialDays'

// The week's title, and a takeover's greeting at its right (on a line of its own
// in portrait). The full title is the range with the year muted; a pane's short
// one is the range with, muted, where the week is in time. Either goes when the
// pane's options turn the title off, and the greeting is drawn alone then. The
// parent leaves this out altogether when it would hold neither.
defineProps<{
  /** Whether the title is drawn at all. */
  showTitle: boolean
  /** As a pane of a hybrid view: the short title. */
  pane?: boolean
  /** `26 October – 1 November` and `2026`; the year is empty when there is none to mute. */
  title: { range: string, year: string }
  /** `26 Oct – 1 Nov` and "This week" and the like. */
  shortTitle: { range: string, label: string }
  /** A takeover's greeting, if there is one. */
  greeting?: string | null
}>()
</script>

<template>
  <header class="header">
    <h1 v-if="showTitle && pane" class="title" data-testid="week-title">
      <span class="range">{{ shortTitle.range }}</span>{{ ' ' }}<span class="year" data-testid="week-label">{{ shortTitle.label }}</span>
    </h1>
    <h1 v-else-if="showTitle" class="title" data-testid="week-title">
      <!-- The space is for the text ("26 October – 1 November 2026"); between flex items it takes no room. -->
      <span class="range">{{ title.range }}</span>{{ ' ' }}<span v-if="title.year" class="year">{{ title.year }}</span>
    </h1>
    <div
      v-if="greeting"
      class="greeting"
      data-testid="greeting"
      :style="{ fontSize: `${greetingSize(greeting)}px` }"
    >
      {{ greeting }}
    </div>
  </header>
</template>

<style scoped>
/* `.portrait` and `.pane` are classes of the week's root. */
.header {
  display: flex;
  flex: none;
  align-items: baseline;
  justify-content: space-between;
  gap: 48px;
  padding-left: 12px;
}

.title {
  display: flex;
  align-items: baseline;
  gap: 20px;
  margin: 0;
  font-family: var(--font-display);
  font-weight: 400;
  line-height: 1;
  white-space: nowrap;
}

.range {
  font-size: 88px;
  letter-spacing: -0.02em;
}

.year {
  color: var(--muted);
  font-size: 44px;
}

/* At the right of the title, where the month view's panel has its own. The size is set from the length of the greeting. */
.greeting {
  min-width: 0;
  font-family: var(--font-display);
  line-height: 1.05;
  text-align: right;
  text-wrap: balance;
}

.portrait .header {
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
}

.portrait .title {
  gap: 18px;
}

.portrait .range {
  font-size: 76px;
}

.portrait .year {
  font-size: 40px;
}

/* The short title of a pane (mock 4k): the range in the display face, the label muted beside it. */
.pane .range {
  font-size: 56px;
  letter-spacing: -0.02em;
}

.pane .year {
  font-size: 32px;
}

/* On a line of its own, as long as the stage is wide. */
.portrait .greeting {
  text-align: left;
}
</style>
