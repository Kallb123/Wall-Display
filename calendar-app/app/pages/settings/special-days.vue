<script setup lang="ts">
import { PartyPopper } from 'lucide-vue-next'

useHead({ title: 'Special days · Settings' })
</script>

<template>
  <SettingsPlaceholder :icon="PartyPopper" title="Special days" data-testid="special-days-placeholder">
    Special days arrive with their own update. You will add birthdays, holidays and one-off dates here, with a drawing for the day's tile and an optional takeover of the whole wall.
  </SettingsPlaceholder>
</template>
