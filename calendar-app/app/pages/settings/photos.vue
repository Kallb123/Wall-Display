<script setup lang="ts">
import { Cloud, FolderOpen, Images, RefreshCw, WifiOff } from 'lucide-vue-next'
import type { PhotoSource } from '../../../shared/display'
import type { PhotosSettingsStatus } from '../../../shared/settings'
import { requestFailure } from '~/utils/remote'
import {
  SERVER_UNREACHABLE,
  bytesLabel,
  cachePercent,
  fullDateTime,
  photoCount,
  photoSourceLabel,
  pollLabel,
  providerChip,
  providerDetail,
  relativeTime,
} from '~/utils/settings'

// The Photos tab (architecture §7.6): where the photo frame's pictures come
// from and how each source is doing, how full the cache is against its cap,
// and how the rotation is set. Read-only: the sources and the rotation are
// set in the config, and no secret is sent here. It reads what the server
// reports and asks again every 15 seconds while the tab is open. "Refresh now"
// lists every source again, and is the one write.

useHead({ title: 'Photos · Settings' })

const now = useNow(15_000)
const timezone = useWallTimezone()
const { data: photos, failed, reload } = usePolledFetch<PhotosSettingsStatus>('/api/settings/photos', 15_000)

const pin = usePinRequest(SERVER_UNREACHABLE)
const refreshing = ref(false)
const refreshError = ref<string | null>(null)

/** Lists every source again now, waits for the server to finish, then shows what it found. */
async function refreshNow() {
  if (refreshing.value) return
  refreshing.value = true
  refreshError.value = null
  try {
    // Refused for want of a PIN: the dialog is open, and this runs again once a PIN is accepted.
    const done = await pin.guard(headers => $fetch('/api/settings/photos/refresh', { method: 'POST', headers }), refreshNow)
    if (done) await reload()
  } catch (caught) {
    const { status, message } = requestFailure(caught)
    // A 409 says why in the server's own words (no photos block).
    refreshError.value = status === null ? SERVER_UNREACHABLE : status === 409 && message ? message : 'The server couldn\'t list the photos'
  } finally {
    refreshing.value = false
  }
}

const SOURCE_ICONS: Record<PhotoSource, typeof Cloud> = { immich: Cloud, google: Cloud, local: FolderOpen }

const configured = computed(() => photos.value?.configured ? photos.value : null)
const percent = computed(() => configured.value ? cachePercent(configured.value.cache_bytes, configured.value.cache_max_bytes) : 0)

function lastListing(success: string | null): string {
  return success ? relativeTime(success, now.value) : 'Never'
}

function lastListingTitle(success: string | null): string | undefined {
  return success ? fullDateTime(success, timezone.value) : undefined
}
</script>

<template>
  <div class="photos">
    <div class="toolbar">
      <p class="intro">
        Where the photo frame's pictures come from, and how much of the cache they use.
      </p>
      <p v-if="failed" class="unreachable" role="status" data-testid="unreachable">
        <AppIcon :icon="WifiOff" :size="20" />
        {{ SERVER_UNREACHABLE }}
      </p>
      <SettingsPillButton variant="primary" :disabled="refreshing || !configured" data-testid="refresh" @click="refreshNow">
        <AppIcon :icon="RefreshCw" :size="20" :class="{ spinning: refreshing }" />
        {{ refreshing ? 'Refreshing…' : 'Refresh now' }}
      </SettingsPillButton>
    </div>

    <SettingsNotice v-if="refreshError" tone="error" data-testid="refresh-error">
      {{ refreshError }}
    </SettingsNotice>

    <p v-if="!photos && !failed" class="empty" data-testid="loading">
      Loading&hellip;
    </p>

    <SettingsPlaceholder v-else-if="photos && !photos.configured" :icon="Images" title="Photo frame is off" data-testid="photos-off">
      The config has no photos block, so the photo frame has nothing to show. Add one to config.yaml with a folder of pictures or an Immich server, and restart the app. The sources and the cache will be listed here.
    </SettingsPlaceholder>

    <template v-if="configured">
      <SettingsNotice v-if="configured.google_ignored" data-testid="google-ignored">
        The google block in the config is ignored: Google Photos isn't supported yet.
      </SettingsNotice>

      <SettingsCard data-testid="cache-card">
        <header class="head">
          <h2 class="name">
            Cache
          </h2>
          <p class="size" data-testid="cache-size">
            {{ bytesLabel(configured.cache_bytes) }} of {{ bytesLabel(configured.cache_max_bytes) }}
          </p>
        </header>
        <div
          class="bar"
          role="meter"
          aria-label="Cache used"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="percent"
          :aria-valuetext="`${percent}% of the cache is used`"
          :data-full="percent >= 90"
          data-testid="cache-bar"
        >
          <span class="fill" :style="{ width: `${percent}%` }" />
        </div>
        <p class="hint">
          The photos are kept rendered, ready to show. When the cache is full, the ones shown longest ago are deleted first.
        </p>
        <dl class="facts">
          <div class="fact">
            <dt>Photo changes</dt>
            <dd data-testid="photo-interval">
              {{ pollLabel(configured.interval_seconds) }}
            </dd>
          </div>
          <div class="fact">
            <dt>Portrait photos</dt>
            <dd data-testid="photo-landscape">
              {{ configured.landscape_only ? 'Left out' : 'Shown' }}
            </dd>
          </div>
          <div class="fact">
            <dt>Cache limit</dt>
            <dd data-testid="photo-cache-limit">
              {{ bytesLabel(configured.cache_max_bytes) }}
            </dd>
          </div>
        </dl>
      </SettingsCard>

      <p v-if="configured.providers.length === 0" class="empty small" data-testid="no-providers">
        No photo source is available: set up an Immich server or a local folder in the config.
      </p>

      <SettingsCard v-for="provider in configured.providers" :key="provider.id" :data-provider="provider.id" data-testid="provider-card">
        <header class="head">
          <div class="titles">
            <h2 class="name" data-testid="provider-name">
              {{ photoSourceLabel(provider.id) }}
            </h2>
            <p class="source" data-testid="provider-detail">
              <AppIcon :icon="SOURCE_ICONS[provider.id]" :size="18" />
              {{ providerDetail(provider) }}
            </p>
          </div>
          <SettingsStatusChip :status="providerChip(provider)" data-testid="provider-status" />
        </header>

        <dl class="facts">
          <div class="fact">
            <dt>In the pool</dt>
            <dd data-testid="provider-photos">
              {{ photoCount(provider.photos) }}
            </dd>
          </div>
          <div class="fact">
            <dt>Cached</dt>
            <dd data-testid="provider-cached">
              {{ provider.cached }}
            </dd>
          </div>
          <div class="fact">
            <dt>Last listing</dt>
            <dd :title="lastListingTitle(provider.last_success_at)" data-testid="provider-last-success">
              {{ lastListing(provider.last_success_at) }}
            </dd>
          </div>
        </dl>

        <SettingsNotice v-if="provider.last_error" tone="error" data-testid="provider-error">
          <p class="error-title">
            Last try failed
          </p>
          <p class="error-message">
            {{ provider.last_error }}
          </p>
          <p v-if="provider.cached > 0" class="error-message">
            Photos already in the cache keep showing meanwhile.
          </p>
        </SettingsNotice>
      </SettingsCard>
    </template>

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
.photos {
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

.empty.small {
  padding: 16px 0;
  font-size: 22px;
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
  overflow-wrap: anywhere;
}

.size {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}

/* The cache against its cap. The accent fills the track; a nearly full one turns to the darker ink, so it is not told by colour alone: the figure beside it says it too. */
.bar {
  height: 16px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--bg);
}

.fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--accent2);
  transition: width 0.4s ease;
}

.bar[data-full='true'] .fill {
  background: var(--accent-ink);
}

.hint {
  margin: 0;
  color: var(--muted);
  font-size: 15px;
  font-weight: 500;
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
</style>
