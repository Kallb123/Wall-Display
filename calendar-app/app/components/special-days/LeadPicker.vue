<script setup lang="ts">
import type { SpecialDayLead } from '../../../shared/special-days'
import { LEAD_OPTIONS } from '~/utils/specialDayEditor'
import '~/assets/special-days-form.css'

// How early a day starts to show on the calendar: on the day, a week or a month
// before, or a number of days of its own. Four radio pills and, for the last,
// a number. `leadDays` stays text, as in the editor's draft, so a half-typed
// number is kept as typed.
defineProps<{
  disabled?: boolean
  /** Names the group for a screen reader. */
  label?: string
  /** The id of the number input, so an error can send focus to it. */
  inputId?: string
  invalid?: boolean
  describedby?: string
}>()

const lead = defineModel<SpecialDayLead>({ required: true })
const leadDays = defineModel<string>('leadDays', { required: true })

const name = useId()
</script>

<template>
  <div class="picker">
    <div class="sd-pills" role="radiogroup" :aria-label="label ?? 'Show on the calendar from'">
      <label v-for="option in LEAD_OPTIONS" :key="option.value" class="sd-pill">
        <input v-model="lead" type="radio" :name="name" :value="option.value" :disabled="disabled" :data-testid="`lead-${option.value}`">
        <span class="face">{{ option.label }}</span>
      </label>
    </div>
    <label v-if="lead === 'days'" class="days">
      <input
        :id="inputId"
        v-model="leadDays"
        class="sd-input days-input"
        type="text"
        inputmode="numeric"
        aria-label="Days before"
        :disabled="disabled"
        :aria-invalid="invalid ? 'true' : undefined"
        :aria-describedby="describedby"
        data-testid="lead-days"
      >
      <span class="unit">days before</span>
    </label>
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
}

.days {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.days-input {
  width: 96px;
  text-align: center;
}

.unit {
  color: var(--muted);
  font-size: 16px;
  font-weight: 700;
}
</style>
