<script setup lang="ts">
import { Radio, WifiOff } from 'lucide-vue-next'
import type { ConnectionsStatus, DiscoveryResult, DisplayStatus } from '../../../shared/settings'
import { isOverlayShowing, overlayIcon } from '~/utils/overlay'
import { requestFailure } from '~/utils/remote'
import {
  SERVER_UNREACHABLE,
  discoveryBlockedReason,
  listNames,
  mqttLinkChip,
  photoSourceLabel,
  remotesChip,
  screenLabel,
  shownMonthLabel,
  viewLabel,
  wallPageChip,
} from '~/utils/settings'

// The Displays tab (architecture §7.6): what each display is showing and
// whether it is connected, read live from the server every 5 seconds, and
// "Republish discovery", the one write, which sends Home Assistant its
// discovery messages again (for when it has been reset or restarted without them).

useHead({ title: 'Displays · Settings' })

const now = useNow(30_000)
const { data: displays, failed } = usePolledFetch<DisplayStatus[]>('/api/settings/displays', 5_000)
// The header's chips have this too, but on a slower beat; the button needs it as fresh as the cards.
const { data: connections } = usePolledFetch<ConnectionsStatus>('/api/settings/connections', 5_000)

const blocked = computed(() => discoveryBlockedReason(connections.value))

const pin = usePinRequest(SERVER_UNREACHABLE)
const republishing = ref(false)
/** What the last try came to, shown under the toolbar until the next. */
const outcome = ref<{ tone: 'note' | 'error', text: string } | null>(null)

/** Asks for the discovery messages to be published again, and says for which displays. */
async function republish() {
  if (republishing.value || blocked.value) return
  republishing.value = true
  outcome.value = null
  try {
    // Refused for want of a PIN: the dialog is open, and this runs again once a PIN is accepted.
    const done = await pin.guard(headers => $fetch<DiscoveryResult>('/api/settings/discovery', { method: 'POST', headers }), republish)
    if (done) {
      const names = done.value.republished.map(id => displays.value?.find(display => display.id === id)?.name ?? id)
      outcome.value = {
        tone: 'note',
        text: names.length ? `Discovery published for ${listNames(names)}.` : 'Discovery was not published for any display.',
      }
    }
  } catch (caught) {
    const { status, message } = requestFailure(caught)
    // A 409 says why in the server's own words (MQTT or discovery is off).
    outcome.value = {
      tone: 'error',
      text: status === null ? SERVER_UNREACHABLE : status === 409 && message ? message : 'The server couldn\'t publish discovery',
    }
  } finally {
    republishing.value = false
  }
}

const THEME_LABELS = { light: 'Light', dark: 'Dark' } as const
const MONTH_STYLE_LABELS = { soft: 'Soft', classic: 'Classic' } as const

function overlayOf(display: DisplayStatus) {
  return isOverlayShowing(display.state.overlay, now.value) ? display.state.overlay : null
}
</script>

<template>
  <div class="displays">
    <div class="toolbar">
      <p class="intro">
        What each display is showing now, and whether it can be reached.
      </p>
      <p v-if="failed" class="unreachable" role="status" data-testid="unreachable">
        <AppIcon :icon="WifiOff" :size="20" />
        {{ SERVER_UNREACHABLE }}
      </p>
      <div class="republish">
        <SettingsPillButton
          :disabled="republishing || blocked !== null"
          :title="blocked ?? undefined"
          :aria-describedby="blocked ? 'republish-reason' : undefined"
          data-testid="republish"
          @click="republish"
        >
          <AppIcon :icon="Radio" :size="20" />
          {{ republishing ? 'Republishing…' : 'Republish discovery' }}
        </SettingsPillButton>
        <p v-if="blocked" id="republish-reason" class="reason" data-testid="republish-reason">
          {{ blocked }}
        </p>
      </div>
    </div>

    <SettingsNotice v-if="outcome" :tone="outcome.tone" data-testid="republish-outcome">
      {{ outcome.text }}
    </SettingsNotice>

    <p v-if="!displays && !failed" class="empty" data-testid="loading">
      Loading&hellip;
    </p>
    <p v-else-if="displays?.length === 0" class="empty" data-testid="no-displays">
      No displays are set up in the config.
    </p>

    <SettingsCard v-for="display in displays ?? []" :key="display.id" :data-display="display.id" data-testid="display-card">
      <header class="head">
        <div class="titles">
          <h2 class="name" data-testid="display-name">
            {{ display.name }}
          </h2>
          <p class="meta">
            <code class="id" data-testid="display-id">{{ display.id }}</code>
            {{ THEME_LABELS[display.theme] }} theme · {{ MONTH_STYLE_LABELS[display.month_style] }} month
          </p>
        </div>
      </header>

      <div class="panels">
        <section class="panel" aria-label="Connections">
          <h3 class="subhead">
            Connections
          </h3>
          <dl class="rows">
            <div class="row">
              <dt>Wall page</dt>
              <dd data-testid="display-wall">
                <SettingsStatusChip :status="wallPageChip(display.sockets.display)" />
              </dd>
            </div>
            <div class="row">
              <dt>Remotes</dt>
              <dd data-testid="display-remotes">
                <SettingsStatusChip :status="remotesChip(display.sockets.remote)" />
              </dd>
            </div>
            <div class="row">
              <dt>MQTT</dt>
              <dd data-testid="display-mqtt">
                <SettingsStatusChip :status="mqttLinkChip(display.mqtt, display.mqtt_error)" />
              </dd>
            </div>
          </dl>
        </section>

        <section class="panel" aria-label="On the wall now">
          <h3 class="subhead">
            On the wall now
          </h3>
          <dl class="rows">
            <div class="row">
              <dt>View</dt>
              <dd data-testid="display-view">
                {{ viewLabel(display.state.view) }}
              </dd>
            </div>
            <div class="row">
              <dt>Screen</dt>
              <dd data-testid="display-screen">
                {{ screenLabel(display.state.screen) }}
              </dd>
            </div>
            <div class="row">
              <dt>Brightness</dt>
              <dd data-testid="display-brightness">
                {{ display.state.brightness }}%
              </dd>
            </div>
            <div class="row">
              <dt>Month shown</dt>
              <dd data-testid="display-month">
                {{ shownMonthLabel(display.state.month) }}
              </dd>
            </div>
            <div class="row">
              <dt>Photos from</dt>
              <dd data-testid="display-photos">
                {{ photoSourceLabel(display.state.photo_source) }}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <div v-if="overlayOf(display)" class="message" data-testid="display-overlay">
        <span class="message-icon">
          <AppIcon :icon="overlayIcon(overlayOf(display)!.icon)" :size="24" />
        </span>
        <p class="message-text">
          <span class="message-label">Message on the wall</span>
          {{ overlayOf(display)!.text }}
        </p>
      </div>
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
.displays {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 12px 20px;
}

.intro {
  flex: 1;
  min-width: 260px;
  margin: 0;
  padding-top: 12px;
  color: var(--muted);
  font-size: 17px;
  font-weight: 500;
}

.unreachable {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding-top: 14px;
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
}

.republish {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.reason {
  max-width: 300px;
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  font-weight: 600;
  text-align: right;
}

.empty {
  margin: 0;
  padding: 48px 0;
  color: var(--muted);
  font-family: var(--font-display);
  font-size: 28px;
  text-align: center;
}

.name {
  margin: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-display);
  font-size: 32px;
  font-weight: 400;
  line-height: 1.1;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 15px;
  font-weight: 700;
}

.id {
  padding: 2px 12px;
  border-radius: var(--radius-pill);
  background: var(--bg);
  font-family: inherit;
  font-size: 14px;
}

.panels {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.panel {
  padding: 20px 24px;
  border-radius: 24px;
  background: var(--bg);
}

.subhead {
  margin: 0 0 8px;
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 400;
}

.rows {
  display: flex;
  flex-direction: column;
  margin: 0;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 48px;
  padding: 6px 0;
  border-top: 2px solid var(--line);
}

dt {
  color: var(--muted);
  font-size: 15px;
  font-weight: 700;
}

dd {
  min-width: 0;
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  text-align: right;
}

/* The chips sit on the page-coloured panel, so they take the card's colour to stand out from it. */
.row :deep(.chip) {
  align-items: flex-end;
}

.message {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 20px;
  border-radius: 24px;
  background: var(--panel);
  color: var(--panel-text);
}

.message-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--on-accent);
}

.message-text {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 17px;
  font-weight: 700;
}

.message-label {
  display: block;
  color: var(--panel-muted);
  font-size: 14px;
  font-weight: 700;
}

@media (max-width: 760px) {
  .panels {
    grid-template-columns: 1fr;
  }
}
</style>
