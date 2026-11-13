<script setup lang="ts">
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-vue-next'

// The "Month shown" and "Week shown" sections, which are the same control: step
// back or forward, pick one from the list, or return to the current one. A tap is
// only a request (`step`, `pick`); the page works out the command and sends it.

const props = defineProps<{
  /** Which one this is; it names the section, its label and its test ids. */
  kind: 'month' | 'week'
  /** What the list offers. */
  options: { value: string, label: string }[]
  /** The one on the wall (or this one, if none is pinned). */
  value: string | null
  /** The wall can't step any earlier, or any later. */
  atStart: boolean
  atEnd: boolean
  /** Whether the wall is pinned to one, and so can go back to the current. */
  pinned: boolean
}>()

const emit = defineEmits<{
  step: [to: 'prev' | 'next' | 'current']
  pick: [event: Event]
}>()

const title = props.kind === 'month' ? 'Month' : 'Week'
</script>

<template>
  <section :aria-labelledby="`${kind}-title`" :data-testid="`${kind}-picker`">
    <h2 :id="`${kind}-title`" class="label">
      {{ title }} shown
    </h2>
    <div class="card picker">
      <div class="picker-row">
        <button
          type="button"
          class="arrow"
          :aria-label="`Previous ${kind}`"
          :disabled="atStart"
          :data-testid="`${kind}-prev`"
          @click="emit('step', 'prev')"
        >
          <AppIcon :icon="ChevronLeft" :size="26" />
        </button>
        <span class="select">
          <select
            :value="value"
            :aria-label="title"
            :data-testid="`${kind}-select`"
            @change="emit('pick', $event)"
          >
            <option v-for="option in options" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
          <AppIcon class="caret" :icon="ChevronDown" :size="22" />
        </span>
        <button
          type="button"
          class="arrow"
          :aria-label="`Next ${kind}`"
          :disabled="atEnd"
          :data-testid="`${kind}-next`"
          @click="emit('step', 'next')"
        >
          <AppIcon :icon="ChevronRight" :size="26" />
        </button>
      </div>
      <button
        v-if="pinned"
        type="button"
        class="link"
        :data-testid="`${kind}-current`"
        @click="emit('step', 'current')"
      >
        Back to this {{ kind }}
      </button>
    </div>
  </section>
</template>

<style scoped src="../../assets/remote-base.css"></style>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding: 14px;
}

.picker-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.arrow {
  display: grid;
  flex: none;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--bg);
  color: var(--text);
}

.arrow:disabled {
  opacity: 0.35;
}
</style>
