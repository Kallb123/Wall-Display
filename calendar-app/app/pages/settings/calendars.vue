<script setup lang="ts">
import { House, RefreshCw, Rss, WifiOff } from 'lucide-vue-next'
import type { CalendarStatus } from '../../../shared/settings'
import { requestFailure } from '~/utils/remote'
import {
  SERVER_UNREACHABLE,
  detectionIsOff,
  detectionLabel,
  fallbackDateLabel,
  fullDateTime,
  lastSyncLabel,
  occurrencesLabel,
  pollLabel,
  relativeTime,
  sourceLabel,
} from '~/utils/settings'

// The Calendars tab (architecture §7.6): how each calendar is doing, and the
// recent events that fell through to its default person, so a missing name,
// alias or rule is easy to spot. It reads what the server reports and asks
// again every 15 seconds while the tab is open. "Refresh now" is the one write.

useHead({ title: 'Calendars · Settings' })

const now = useNow(15_000)
const timezone = useWallTimezone()
const { data: calendars, failed, reload } = usePolledFetch<CalendarStatus[]>('/api/settings/calendars', 15_000)

const pin = usePinRequest(SERVER_UNREACHABLE)
const refreshing = ref(false)
const refreshError = ref<string | null>(null)

/** Syncs every calendar now, waits for the server to finish, then shows what it found. */
async function refreshNow() {
  if (refreshing.value) return
  refreshing.value = true
  refreshError.value = null
  try {
    // Refused for want of a PIN: the dialog is open, and this runs again once a PIN is accepted.
    const done = await pin.guard(headers => $fetch('/api/refresh', { method: 'POST', headers }), refreshNow)
    if (done) await reload()
  } catch (caught) {
    refreshError.value = requestFailure(caught).status === null ? SERVER_UNREACHABLE : 'The server couldn\'t refresh the calendars'
  } finally {
    refreshing.value = false
  }
}

const SOURCE_ICONS = { ics: Rss, homeassistant: House } as const

function lastSyncTitle(calendar: CalendarStatus): string | undefined {
  return calendar.last_success_at ? fullDateTime(calendar.last_success_at, timezone.value) : undefined
}
</script>

<template>
  <div class="calendars">
    <div class="toolbar">
      <p class="intro">
        How each calendar is syncing, and which recent events no name or rule picked up.
      </p>
      <p v-if="failed" class="unreachable" role="status" data-testid="unreachable">
        <AppIcon :icon="WifiOff" :size="20" />
        {{ SERVER_UNREACHABLE }}
      </p>
      <SettingsPillButton variant="primary" :disabled="refreshing" data-testid="refresh" @click="refreshNow">
        <AppIcon :icon="RefreshCw" :size="20" :class="{ spinning: refreshing }" />
        {{ refreshing ? 'Refreshing…' : 'Refresh now' }}
      </SettingsPillButton>
    </div>

    <SettingsNotice v-if="refreshError" tone="error" data-testid="refresh-error">
      {{ refreshError }}
    </SettingsNotice>

    <p v-if="!calendars && !failed" class="empty" data-testid="loading">
      Loading&hellip;
    </p>
    <p v-else-if="calendars?.length === 0" class="empty" data-testid="no-calendars">
      No calendars are set up in the config.
    </p>

    <SettingsCard v-for="calendar in calendars ?? []" :key="calendar.id" :data-calendar="calendar.id" data-testid="calendar-card">
      <header class="head">
        <div class="titles">
          <h2 class="name" data-testid="calendar-name">
            {{ calendar.name }}
          </h2>
          <p class="source" data-testid="calendar-source">
            <AppIcon :icon="SOURCE_ICONS[calendar.source_type]" :size="18" />
            {{ sourceLabel(calendar.source_type) }}
          </p>
        </div>
        <p class="person" data-testid="calendar-person">
          <SettingsPersonBadge :person="calendar.person" :size="40" />
          <span class="person-text">
            <span class="person-name">{{ calendar.person.name }}</span>
            <span class="person-role">Default person</span>
          </span>
        </p>
      </header>

      <dl class="facts">
        <div class="fact">
          <dt>Name detection</dt>
          <dd data-testid="calendar-detection">
            {{ detectionLabel(calendar.detect_people, calendar.detect_in) }}
          </dd>
        </div>
        <div class="fact">
          <dt>Checks</dt>
          <dd data-testid="calendar-poll">
            {{ calendar.syncing ? pollLabel(calendar.poll_seconds) : 'Not polled' }}
          </dd>
        </div>
        <div class="fact">
          <dt>Last sync</dt>
          <dd :title="lastSyncTitle(calendar)" data-testid="calendar-last-sync">
            {{ lastSyncLabel(calendar, now) }}
          </dd>
        </div>
        <div class="fact">
          <dt>Events</dt>
          <dd data-testid="calendar-events">
            {{ calendar.event_count }}
          </dd>
        </div>
      </dl>

      <SettingsNotice v-if="calendar.last_error" tone="error" data-testid="calendar-error">
        <p class="error-title">
          Last sync failed<template v-if="calendar.last_attempt_at">
            · {{ relativeTime(calendar.last_attempt_at, now) }}
          </template>
        </p>
        <p class="error-message">
          {{ calendar.last_error }}
        </p>
      </SettingsNotice>

      <p v-if="detectionIsOff(calendar)" class="detection-off" data-testid="calendar-detection-off">
        Name detection is off, so every event goes to {{ calendar.person.name }}.
      </p>
      <section v-else class="fallbacks" data-testid="calendar-fallbacks">
        <h3 class="subhead">
          Fell back to {{ calendar.person.name }}
        </h3>
        <ul v-if="calendar.fallbacks.length" class="list">
          <li v-for="fallback in calendar.fallbacks" :key="`${fallback.title}|${fallback.start}`" class="row" data-testid="fallback">
            <span class="row-title">{{ fallback.title }}</span>
            <span class="row-date">
              {{ fallbackDateLabel(fallback, now, timezone) }}
              <span v-if="fallback.occurrences > 1" class="row-times">{{ occurrencesLabel(fallback.occurrences) }}</span>
            </span>
          </li>
        </ul>
        <p v-else class="none" data-testid="no-fallbacks">
          Every recent event matched a name or a rule.
        </p>
      </section>
    </SettingsCard>

    <SettingsPinDialog
      v-if="pin.pinNeeded.value"
      :message="pin.pinMessage.value"
      :checking="pin.checkingPin.value"
      @submit="pin.submitPin"
      @cancel="pin.cancelPin"
    />
  </div>
</template>

<style scoped>
.calendars {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
}

.intro {
  flex: 1;
  min-width: 260px;
  margin: 0;
  color: var(--muted);
  font-size: 17px;
  font-weight: 500;
}

.unreachable {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinning {
    animation: none;
  }
}

.empty {
  margin: 0;
  padding: 48px 0;
  color: var(--muted);
  font-family: var(--font-display);
  font-size: 28px;
  text-align: center;
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;
}

.titles {
  min-width: 0;
}

.name {
  margin: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-display);
  font-size: 32px;
  font-weight: 400;
  line-height: 1.1;
}

.source {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 15px;
  font-weight: 700;
}

.person {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0;
}

.person-text {
  display: flex;
  flex-direction: column;
}

.person-name {
  font-size: 18px;
  font-weight: 700;
}

.person-role {
  color: var(--muted);
  font-size: 14px;
  font-weight: 600;
}

.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 16px;
  margin: 0;
  padding: 18px 24px;
  border-radius: 24px;
  background: var(--bg);
}

.fact {
  min-width: 0;
}

dt {
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
}

dd {
  margin: 4px 0 0;
  font-size: 18px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.error-title,
.error-message {
  margin: 0;
}

.error-title {
  font-weight: 700;
}

.error-message {
  margin-top: 2px;
  font-weight: 500;
}

.detection-off,
.none {
  margin: 0;
  color: var(--muted);
  font-size: 16px;
  font-weight: 600;
}

.subhead {
  margin: 0 0 8px;
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 400;
}

.list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 24px;
  padding: 12px 0;
  /* The page colour, not `--line`: on a dark card the line colour is the card's own. */
  border-top: 2px solid var(--bg);
  font-size: 17px;
}

.row-title {
  min-width: 0;
  overflow: hidden;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-date {
  flex: none;
  color: var(--muted);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.row-times {
  margin-left: 4px;
}
</style>
