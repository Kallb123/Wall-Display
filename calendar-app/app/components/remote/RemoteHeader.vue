<script setup lang="ts">
// The top of the remote: the display's name and how well the page is connected to it.

defineProps<{
  name: string
  connection: 'connected' | 'reconnecting' | 'offline'
}>()

const CONNECTION_LABELS = { connected: 'Connected', reconnecting: 'Reconnecting', offline: 'Offline' } as const
</script>

<template>
  <header class="header">
    <h1 class="name" data-testid="display-name">
      {{ name }}
    </h1>
    <p class="pill" :data-state="connection" data-testid="connection-pill">
      <span class="dot" />
      {{ CONNECTION_LABELS[connection] }}
    </p>
  </header>
</template>

<style scoped src="../../assets/remote-base.css"></style>

<style scoped>
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 8px;
}

.name {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-display);
  font-size: 40px;
  font-weight: 400;
  line-height: 1.05;
}

.pill {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  margin: 0;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--surface);
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent2);
}

.pill[data-state='reconnecting'] .dot {
  background: var(--accent);
  animation: pulse 1.2s ease-in-out infinite;
}

.pill[data-state='offline'] .dot {
  box-sizing: border-box;
  border: 2px solid var(--muted);
  background: none;
}

@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
</style>
