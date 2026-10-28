<script setup lang="ts">
import type { Component } from 'vue'

// Every icon on the wall goes through here, so they all share the design
// system's heavy 2.75 stroke (architecture §4.3). Pass a Lucide component.
withDefaults(defineProps<{
  icon: Component
  size?: number
}>(), { size: 24 })
</script>

<template>
  <component :is="icon" :size="size" :stroke-width="2.75" aria-hidden="true" />
</template>
