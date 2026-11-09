<script setup lang="ts">
import { MAX_STAR_GOAL, STAR_PERIODS } from '../../../shared/stars'
import type { StarPeriod, StarSettingsBody, StarSettingsEntry } from '../../../shared/stars'
import PersonBadge from '~/components/settings/PersonBadge.vue'
import '~/assets/special-days-form.css'

// One person's line on the Stars tab: whether they have a star chart, whether
// it counts over a day or a week, and an optional goal. The switch and the
// period save as soon as they are chosen; the goal saves when its field is
// left or Enter is pressed, so a half-typed number is never sent. The page owns
// the request (and the PIN it may need) and hands back the person as the
// server has them, which is what this shows. When a save fails the draft is
// put back to what the server last said, so the line never claims more than it
// is.

const props = defineProps<{
  entry: StarSettingsEntry
  /** A save is in progress somewhere on the page, so the controls rest. */
  busy?: boolean
}>()

const emit = defineEmits<{
  save: [personId: string, body: StarSettingsBody]
}>()

const id = useId()
const enabled = ref(props.entry.enabled)
const period = ref<StarPeriod>(props.entry.period)
/** The goal field's text: blank for no goal. */
const goalText = ref(props.entry.goal === null ? '' : String(props.entry.goal))
const goalError = ref<string | null>(null)

// What the server says wins, after a save or a failed one.
watch(() => props.entry, (next) => {
  enabled.value = next.enabled
  period.value = next.period
  goalText.value = next.goal === null ? '' : String(next.goal)
  goalError.value = null
})

const PERIOD_LABELS: Record<StarPeriod, string> = { day: 'Daily', week: 'Weekly' }

/** The goal as a number (null when blank), or undefined when what was typed is not a whole number from 1 up to the limit. */
function parseGoal(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (!/^\d+$/.test(trimmed)) return undefined
  const goal = Number(trimmed)
  return goal >= 1 && goal <= MAX_STAR_GOAL ? goal : undefined
}

/** Sends the draft, unless the goal is not a goal. */
function commit() {
  const goal = parseGoal(goalText.value)
  if (goal === undefined) {
    goalError.value = `A goal is a whole number from 1 to ${MAX_STAR_GOAL}, or blank for none`
    return
  }
  goalError.value = null
  const same = enabled.value === props.entry.enabled && period.value === props.entry.period && goal === props.entry.goal
  if (same) return
  emit('save', props.entry.id, { enabled: enabled.value, period: period.value, goal })
}

function toggle() {
  enabled.value = !enabled.value
  commit()
}

function choose(next: StarPeriod) {
  period.value = next
  commit()
}
</script>

<template>
  <li class="person" :data-testid="`star-person-${entry.id}`">
    <div class="who">
      <PersonBadge :person="entry" :size="44" />
      <span :id="`${id}-name`" class="name">{{ entry.name }}</span>
    </div>

    <button
      type="button"
      class="sd-switch"
      role="switch"
      :aria-checked="enabled"
      :aria-labelledby="`${id}-name`"
      :disabled="busy"
      data-testid="star-enabled"
      @click="toggle"
    >
      <span class="track" aria-hidden="true"><span class="knob" /></span>
      <span>{{ enabled ? 'Star chart on' : 'Star chart off' }}</span>
    </button>

    <fieldset class="period" :disabled="busy || !enabled" :aria-label="`Count ${entry.name}'s stars`">
      <label v-for="choice in STAR_PERIODS" :key="choice" class="sd-pill">
        <input
          type="radio"
          :name="`${id}-period`"
          :value="choice"
          :checked="period === choice"
          :data-testid="`star-period-${choice}`"
          @change="choose(choice)"
        >
        <span class="face">{{ PERIOD_LABELS[choice] }}</span>
      </label>
    </fieldset>

    <div class="goal">
      <label :for="`${id}-goal`" class="goal-label">Goal</label>
      <input
        :id="`${id}-goal`"
        v-model="goalText"
        class="sd-input"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        :placeholder="period === 'day' ? 'Per day' : 'Per week'"
        :disabled="busy || !enabled"
        :aria-invalid="goalError ? 'true' : undefined"
        :aria-describedby="goalError ? `${id}-goal-error` : undefined"
        data-testid="star-goal"
        @change="commit"
        @keydown.enter.prevent="commit"
      >
    </div>
    <p v-if="goalError" :id="`${id}-goal-error`" class="sd-error full" data-testid="star-goal-error">
      {{ goalError }}
    </p>
  </li>
</template>

<style scoped>
.person {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 24px;
  padding: 16px 0;
  list-style: none;
}

.person + .person {
  border-top: 2px solid var(--line);
}

.who {
  display: flex;
  flex: 1 1 180px;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.name {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 19px;
  font-weight: 700;
}

.period {
  display: flex;
  gap: 8px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.period:disabled {
  opacity: 0.5;
}

.goal {
  display: flex;
  align-items: center;
  gap: 10px;
}

.goal-label {
  font-size: 15px;
  font-weight: 700;
}

.goal .sd-input {
  width: 8.5em;
}

.full {
  flex: 1 0 100%;
}
</style>
