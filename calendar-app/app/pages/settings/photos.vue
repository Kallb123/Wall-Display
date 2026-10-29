<script setup lang="ts">
import { Images } from 'lucide-vue-next'

useHead({ title: 'Photos · Settings' })
</script>

<template>
  <SettingsPlaceholder :icon="Images" title="Photos" data-testid="photos-placeholder">
    Photos arrive with photo frame mode. Once it is set up, this tab will show where the photos come from, how much is cached on the server, and the Google Photos picker.
  </SettingsPlaceholder>
</template>
