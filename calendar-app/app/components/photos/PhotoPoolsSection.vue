<script setup lang="ts">
import { Pencil, Plus, Shapes, Trash2 } from 'lucide-vue-next'
import { POOL_SOURCE_LABELS, poolSourceSummary } from '../../../shared/photoPools'
import type { PhotoPool, PhotoPoolInput, PhotoPoolWithStatus, PhotoPoolsResponse } from '../../../shared/photoPools'
import { requestFailure } from '~/utils/remote'
import { SERVER_UNREACHABLE } from '~/utils/settings'
import { sourceStatusLine } from '~/utils/photoPools'
import { writeFailure } from '~/utils/specialDayEditor'
import PhotoPoolEditor from './PhotoPoolEditor.vue'

// "Your pools" on Settings → Photos: the photo pools a person makes, each a
// name with several sources (Unsplash searches, collections and topics, Immich
// albums, and the feeds in the config). A layout's photo pane can then show a
// pool. It reads the pools every 15 seconds, and again after each write; adds,
// changes and deletes go behind the shared PIN like the rest of settings. One
// pool is edited at a time, in a form that replaces its card (or comes first
// for a new one).

const { data: response, failed, reload } = usePolledFetch<PhotoPoolsResponse>('/api/photo-pools', 15_000)

const pin = usePinRequest(SERVER_UNREACHABLE)

/** What is open: a pool's id, `new`, or nothing. */
const editing = ref<string | 'new' | null>(null)
const busy = ref(false)
const serverError = ref<string | null>(null)
const note = ref<{ tone: 'note' | 'error', text: string } | null>(null)
const deleting = ref<PhotoPoolWithStatus | null>(null)

const editedPool = computed(() => editing.value && editing.value !== 'new' ? response.value?.pools.find(pool => pool.id === editing.value) ?? null : null)

function open(which: string | 'new') {
  note.value = null
  serverError.value = null
  editing.value = which
}

function close() {
  editing.value = null
  serverError.value = null
}

const encode = encodeURIComponent

/** Saves the pool open in the editor: a new one, or the changes to a saved one. A refusal is worded under the form. */
async function save(input: PhotoPoolInput) {
  if (busy.value) return
  busy.value = true
  serverError.value = null
  const id = editedPool.value?.id ?? null
  try {
    const done = await pin.guard(headers => $fetch<PhotoPool>(id ? `/api/photo-pools/${encode(id)}` : '/api/photo-pools', { method: id ? 'PUT' : 'POST', headers, body: input }), () => save(input))
    if (done) {
      editing.value = null
      note.value = { tone: 'note', text: id ? `Saved ${done.value.name}.` : `Added ${done.value.name}.` }
      await reload()
    }
  } catch (caught) {
    serverError.value = writeFailure(caught, 'The server couldn\'t save the pool')
  } finally {
    busy.value = false
  }
}

async function remove() {
  const pool = deleting.value
  if (!pool || busy.value) return
  busy.value = true
  try {
    const done = await pin.guard(headers => $fetch(`/api/photo-pools/${encode(pool.id)}`, { method: 'DELETE', headers }), remove)
    if (done) {
      deleting.value = null
      note.value = { tone: 'note', text: `Deleted ${pool.name}.` }
      await reload()
    }
  } catch (caught) {
    deleting.value = null
    const { status } = requestFailure(caught)
    note.value = { tone: 'error', text: status === 409 ? writeFailure(caught, 'The pool is in use') : writeFailure(caught, 'The server couldn\'t delete the pool') }
  } finally {
    busy.value = false
  }
}

const usedBy = (pool: PhotoPoolWithStatus) => `Used by layout ${pool.used_by.join(', ')}`
</script>

<template>
  <section class="pools" aria-labelledby="pools-title" data-testid="pools-section">
    <header class="top">
      <div class="titles">
        <h2 id="pools-title" class="title">
          Your pools
        </h2>
        <p class="intro">
          Mix Unsplash searches, Immich albums and the feeds in your config, then pick a pool for a layout's photo pane.
        </p>
      </div>
      <SettingsPillButton variant="primary" :disabled="!response || editing === 'new'" data-testid="new-pool" @click="open('new')">
        <AppIcon :icon="Plus" :size="20" />
        New pool
      </SettingsPillButton>
    </header>

    <SettingsNotice v-if="note" :tone="note.tone" data-testid="pools-note">
      {{ note.text }}
    </SettingsNotice>
    <SettingsNotice v-if="failed && !response" tone="error" data-testid="pools-unreachable">
      {{ SERVER_UNREACHABLE }}
    </SettingsNotice>

    <template v-if="response">
      <PhotoPoolEditor
        v-if="editing === 'new'"
        :response="response"
        :pool="null"
        :busy="busy"
        :server-error="serverError"
        @save="save"
        @cancel="close"
      />

      <template v-for="pool in response.pools" :key="pool.id">
        <PhotoPoolEditor
          v-if="editedPool && editedPool.id === pool.id"
          :response="response"
          :pool="pool"
          :busy="busy"
          :server-error="serverError"
          @save="save"
          @cancel="close"
        />
        <SettingsCard v-else :data-pool="pool.id" data-testid="pool-card">
          <header class="head">
            <div class="names">
              <h3 class="name" data-testid="pool-card-name">
                {{ pool.name }}
              </h3>
              <p class="id" data-testid="pool-card-id">
                Pool id: <code>{{ pool.id }}</code>
              </p>
            </div>
            <div class="buttons">
              <SettingsPillButton :disabled="busy" :aria-label="`Edit ${pool.name}`" data-testid="pool-edit" @click="open(pool.id)">
                <AppIcon :icon="Pencil" :size="20" />
                Edit
              </SettingsPillButton>
              <SettingsPillButton
                :disabled="busy || pool.used_by.length > 0"
                :title="pool.used_by.length > 0 ? usedBy(pool) : undefined"
                :aria-label="`Delete ${pool.name}`"
                data-testid="pool-delete"
                @click="deleting = pool"
              >
                <AppIcon :icon="Trash2" :size="20" />
                Delete
              </SettingsPillButton>
            </div>
          </header>
          <p v-if="pool.used_by.length > 0" class="used" data-testid="pool-used-by">
            {{ usedBy(pool) }}
          </p>

          <ul class="sources">
            <li v-for="(source, index) in pool.sources" :key="index" class="source" data-testid="pool-source">
              <div class="what">
                <p class="kind" data-testid="source-kind">
                  {{ POOL_SOURCE_LABELS[source.kind] }}
                </p>
                <p class="summary" data-testid="source-summary">
                  {{ poolSourceSummary(source, response.feeds) }}
                </p>
              </div>
              <div class="state">
                <SettingsStatusChip :status="sourceStatusLine(pool.status[index]).chip" data-testid="source-status" />
                <p class="line" :data-tone="sourceStatusLine(pool.status[index]).chip.tone" data-testid="source-line">
                  {{ sourceStatusLine(pool.status[index]).text }}
                </p>
              </div>
            </li>
          </ul>
        </SettingsCard>
      </template>

      <SettingsPlaceholder v-if="response.pools.length === 0 && editing !== 'new'" :icon="Shapes" title="No pools yet" data-testid="pools-empty">
        A pool is a mix of photo sources under one name. Make one, then choose it as "Photos from" in a layout.
      </SettingsPlaceholder>
    </template>

    <SettingsConfirmDialog
      v-if="deleting"
      title="Delete this pool?"
      :message="`${deleting.name} will be deleted. The photos stay where they are; only the pool goes.`"
      confirm-label="Delete"
      tone="danger"
      :busy="busy"
      @confirm="remove"
      @cancel="deleting = null"
    />

    <SettingsPinDialog
      v-if="pin.pinNeeded.value"
      :message="pin.pinMessage.value"
      :checking="pin.checkingPin.value"
      @submit="pin.submitPin"
      @cancel="pin.cancelPin"
    />
  </section>
</template>

<style scoped>
.pools {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;
}

.titles {
  flex: 1;
  min-width: 260px;
}

.title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 32px;
  font-weight: 400;
  line-height: 1.1;
}

.intro {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 16px;
  font-weight: 500;
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;
}

.names {
  min-width: 0;
}

.name {
  margin: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 400;
  line-height: 1.1;
}

.id {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 14px;
  font-weight: 600;
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.used {
  margin: 0;
  color: var(--muted);
  font-size: 15px;
  font-weight: 600;
}

.sources {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.source {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 20px;
  padding: 12px 18px;
  border-radius: 20px;
  background: var(--bg);
}

.what {
  min-width: 0;
}

.kind {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  font-weight: 700;
}

.summary {
  margin: 2px 0 0;
  font-size: 18px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
}

.line {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.line[data-tone='bad'] {
  color: var(--accent-ink);
}
</style>
