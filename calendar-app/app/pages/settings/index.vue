<script setup lang="ts">
// /settings is not a page of its own: it opens on the first tab. The router
// redirects (replacing the entry, so Back leaves settings instead of bouncing off this).
definePageMeta({ redirect: '/settings/calendars' })
</script>

<template>
  <div />
</template>
