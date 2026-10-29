<script setup lang="ts">
import type { Component } from 'vue'
import { CalendarDays, Images, Monitor, PartyPopper } from 'lucide-vue-next'
import type { ConnectionsStatus } from '../../shared/settings'
import { homeAssistantChip, mqttChip } from '~/utils/settings'
import type { ChipStatus } from '~/utils/settings'
import { THEMES, themeStyle } from '~/utils/themes'

// The admin area (architecture §7.6), for a laptop or tablet: a header with
// the state of the app's two outside links, a row of tabs, and the tab's page
// below. Like the remote it follows the device's light or dark setting, not
// a display's theme. This page only reads: each tab's writes (Refresh now,
// Republish discovery) ask for the remote's PIN when there is one.

const route = useRoute()
const scheme = useColourScheme()
const theme = computed(() => THEMES[scheme.value])

// On <html> as well as the page, so the background reaches the edges of the
// window and its overscroll (tokens.css makes the wall's page black).
useHead({
  title: 'Settings',
  htmlAttrs: {
    'data-settings': () => scheme.value,
    'style': () => ({ ...themeStyle(theme.value), 'color-scheme': scheme.value }),
  },
})

const TABS: { to: string, label: string, icon: Component }[] = [
  { to: '/settings/calendars', label: 'Calendars', icon: CalendarDays },
  { to: '/settings/photos', label: 'Photos', icon: Images },
  { to: '/settings/special-days', label: 'Special days', icon: PartyPopper },
  { to: '/settings/displays', label: 'Displays', icon: Monitor },
]

const { data: connections, failed } = usePolledFetch<ConnectionsStatus>('/api/settings/connections', 15_000)

/** Until the first answer there is nothing to report; if there never is one, the chips say they don't know. */
function chip(from: (connections: ConnectionsStatus) => ChipStatus): ChipStatus {
  if (connections.value) return from(connections.value)
  return { label: failed.value ? 'Unknown' : 'Checking…', tone: 'off', detail: null }
}

const mqtt = computed(() => chip(({ mqtt }) => mqttChip(mqtt)))
const homeAssistant = computed(() => chip(({ homeassistant }) => homeAssistantChip(homeassistant)))
</script>

<template>
  <div class="settings" data-testid="settings">
    <main class="page">
      <header class="header">
        <h1 class="title">
          Settings
        </h1>
        <div class="chips" role="group" aria-label="Connections">
          <SettingsStatusChip name="MQTT" :status="mqtt" data-testid="chip-mqtt" />
          <SettingsStatusChip name="Home Assistant" :status="homeAssistant" data-testid="chip-homeassistant" />
        </div>
      </header>

      <nav class="tabs" aria-label="Settings">
        <NuxtLink
          v-for="tab in TABS"
          :key="tab.to"
          :to="tab.to"
          class="tab"
          :aria-current="route.path === tab.to ? 'page' : undefined"
          :data-testid="`tab-${tab.to.split('/').at(-1)}`"
        >
          <AppIcon :icon="tab.icon" :size="22" />
          {{ tab.label }}
        </NuxtLink>
      </nav>

      <NuxtPage />
    </main>
  </div>
</template>

<style scoped>
/* Laptop and tablet sized: the wall's radius tokens are made for 2560 px, so this page has its own. */
.settings {
  box-sizing: border-box;
  min-height: 100dvh;
  padding: 40px 32px 64px;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 16px;
}

.page {
  display: flex;
  flex-direction: column;
  gap: 28px;
  max-width: 1100px;
  margin: 0 auto;
}

.header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px 24px;
}

.title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 56px;
  font-weight: 400;
  line-height: 1.05;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 10px;
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 0 22px;
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--text);
  font-size: 17px;
  font-weight: 700;
  text-decoration: none;
  transition: background 0.2s ease, color 0.2s ease;
}

.tab[aria-current='page'] {
  background: var(--accent);
  color: var(--on-accent);
}

.tab:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 3px;
}
</style>

<style>
/* The page's theme is set on <html> (see useHead above), so the background
   reaches the window's edges and its overscroll. tokens.css makes the wall black. */
html[data-settings],
html[data-settings] body {
  background: var(--bg);
}
</style>
