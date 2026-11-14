<script setup lang="ts">
import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2 } from 'lucide-vue-next'
import { MAX_POOL_SOURCES, POOL_SOURCE_LABELS, UNSPLASH_ORIENTATIONS } from '../../../shared/photoPools'
import type { PhotoPoolInput, PhotoPoolSourceKind, PhotoPoolWithStatus, PhotoPoolsResponse } from '../../../shared/photoPools'
import {
  COUNT_PLACEHOLDER,
  addSource,
  availableKinds,
  poolDraftOf,
  emptyDraft,
  inputOfDraft,
  isUnsplashKind,
  moveSource,
  newSource,
  poolErrors,
  removeSource,
  sourceFieldPath,
} from '~/utils/photoPools'
import type { DraftSource, PoolDraft } from '~/utils/photoPools'
import '~/assets/special-days-form.css'

// The form for one photo pool (Settings → Photos): its name and its sources.
// Each source is a row with the fields its kind takes, and can be moved or
// removed; "Add source" offers only the kinds the config can run (Unsplash
// needs its block for the access key, Immich its block for the address and
// key, a feed needs at least one feed set up). What is wrong with the form is
// found with the server's own schema and shown by the field once Save has been
// tried. The page owns the request: this only hands the input up.

const props = defineProps<{
  /** What the config can offer: which blocks are set up, and the feeds. */
  response: PhotoPoolsResponse
  /** The pool being changed, or null for a new one. */
  pool: PhotoPoolWithStatus | null
  /** A save is under way. */
  busy?: boolean
  /** Why the server refused the last save. */
  serverError?: string | null
}>()

const emit = defineEmits<{
  save: [input: PhotoPoolInput]
  cancel: []
}>()

const id = useId()
const draft = ref<PoolDraft>(props.pool ? poolDraftOf(props.pool) : emptyDraft())
const submitted = ref(false)

const errors = computed(() => poolErrors(draft.value))
const visible = computed(() => submitted.value ? errors.value : {})
const kinds = computed(() => availableKinds(props.response, draft.value.sources.length))

const needsUnsplash = computed(() => !props.response.unsplash_available)
const needsImmich = computed(() => !props.response.immich_available)
const noFeeds = computed(() => props.response.feeds.length === 0)

const pending = ref<string>('')

function add(kind: PhotoPoolSourceKind) {
  draft.value = addSource(draft.value, newSource(kind, props.response.feeds[0]?.id ?? ''))
}

function addPicked() {
  if (!pending.value) return
  add(pending.value as PhotoPoolSourceKind)
  pending.value = ''
}

const patch = (source: DraftSource, changes: Partial<DraftSource>) => Object.assign(source, changes)

/** The feeds on offer for a feed source, with one the config no longer has kept so the select shows what is saved. */
function feedChoices(source: DraftSource) {
  const feeds = props.response.feeds.map(feed => ({ value: feed.id, label: feed.name }))
  if (source.text && !feeds.some(feed => feed.value === source.text)) feeds.push({ value: source.text, label: `${source.text} (not set up)` })
  return feeds
}

const TEXT_LABELS: Record<PhotoPoolSourceKind, { label: string, placeholder: string }> = {
  unsplash_search: { label: 'Search for', placeholder: 'mountain lake' },
  unsplash_collection: { label: 'Collection id', placeholder: '317099' },
  unsplash_topic: { label: 'Topic', placeholder: 'nature' },
  immich_album: { label: 'Album id', placeholder: 'From the album\'s address in Immich' },
  feed: { label: 'Feed', placeholder: '' },
}

const hasUnsplash = computed(() => draft.value.sources.some(source => isUnsplashKind(source.kind)))

function save() {
  submitted.value = true
  if (Object.keys(errors.value).length > 0) return
  emit('save', inputOfDraft(draft.value))
}

const errorOf = (index: number, source: DraftSource, field: 'text' | 'orientation' | 'count') => visible.value[sourceFieldPath(index, source.kind, field)]
/** A source that is the same as another has its error on the row itself. */
const rowError = (index: number) => visible.value[`sources.${index}`]
</script>

<template>
  <form class="editor" novalidate data-testid="pool-editor" @submit.prevent="save">
    <SettingsCard>
      <div class="sd-field">
        <label :for="`${id}-name`" class="sd-label">Name</label>
        <input
          :id="`${id}-name`"
          v-model="draft.name"
          class="sd-input"
          type="text"
          autocomplete="off"
          placeholder="Mountains and the family"
          :aria-invalid="visible.name ? 'true' : undefined"
          :aria-describedby="visible.name ? `${id}-name-error` : undefined"
          data-testid="pool-name"
        >
        <p v-if="visible.name" :id="`${id}-name-error`" class="sd-error" data-testid="pool-name-error">
          Name {{ visible.name }}
        </p>
        <p v-else-if="pool" class="sd-hint" data-testid="pool-id">
          Its id is <code>{{ pool.id }}</code>. It stays the same if you rename the pool.
        </p>
      </div>

      <section class="sources" aria-label="Sources" data-testid="pool-sources">
        <h3 class="subhead">
          Sources
        </h3>
        <p v-if="draft.sources.length === 0" class="sd-hint" data-testid="pool-no-sources">
          Add at least one source. The pool shows photos from all of them, mixed.
        </p>

        <ol v-if="draft.sources.length > 0" class="rows">
          <li v-for="(source, index) in draft.sources" :key="source.key" class="row" :data-kind="source.kind" data-testid="source-row">
            <div class="row-head">
              <p class="kind">
                {{ POOL_SOURCE_LABELS[source.kind] }}
              </p>
              <div class="tools">
                <button type="button" class="tool" :disabled="index === 0" :aria-label="`Move source ${index + 1} up`" data-testid="source-up" @click="draft = moveSource(draft, index, -1)">
                  <AppIcon :icon="ArrowUp" :size="20" />
                </button>
                <button type="button" class="tool" :disabled="index === draft.sources.length - 1" :aria-label="`Move source ${index + 1} down`" data-testid="source-down" @click="draft = moveSource(draft, index, 1)">
                  <AppIcon :icon="ArrowDown" :size="20" />
                </button>
                <button type="button" class="tool" :aria-label="`Remove source ${index + 1}`" data-testid="source-remove" @click="draft = removeSource(draft, index)">
                  <AppIcon :icon="Trash2" :size="20" />
                </button>
              </div>
            </div>

            <div class="fields">
              <div class="sd-field wide">
                <label :for="`${id}-${source.key}-text`" class="sd-label">{{ TEXT_LABELS[source.kind].label }}</label>
                <span v-if="source.kind === 'feed'" class="sd-select">
                  <select
                    :id="`${id}-${source.key}-text`"
                    :value="source.text"
                    class="sd-input"
                    :aria-invalid="errorOf(index, source, 'text') ? 'true' : undefined"
                    data-testid="source-feed"
                    @change="patch(source, { text: ($event.target as HTMLSelectElement).value })"
                  >
                    <option v-for="choice in feedChoices(source)" :key="choice.value" :value="choice.value">
                      {{ choice.label }}
                    </option>
                  </select>
                  <AppIcon :icon="ChevronDown" :size="22" />
                </span>
                <input
                  v-else
                  :id="`${id}-${source.key}-text`"
                  v-model="source.text"
                  class="sd-input"
                  type="text"
                  autocomplete="off"
                  autocapitalize="off"
                  :placeholder="TEXT_LABELS[source.kind].placeholder"
                  :aria-invalid="errorOf(index, source, 'text') ? 'true' : undefined"
                  :aria-describedby="errorOf(index, source, 'text') ? `${id}-${source.key}-text-error` : undefined"
                  data-testid="source-text"
                >
                <p v-if="errorOf(index, source, 'text')" :id="`${id}-${source.key}-text-error`" class="sd-error" data-testid="source-error">
                  {{ TEXT_LABELS[source.kind].label }} {{ errorOf(index, source, 'text') }}
                </p>
              </div>

              <template v-if="isUnsplashKind(source.kind)">
                <div class="sd-field">
                  <label :for="`${id}-${source.key}-orientation`" class="sd-label">Shape</label>
                  <span class="sd-select">
                    <select :id="`${id}-${source.key}-orientation`" :value="source.orientation" class="sd-input" data-testid="source-orientation" @change="patch(source, { orientation: ($event.target as HTMLSelectElement).value })">
                      <option value="">
                        Any
                      </option>
                      <option v-for="orientation in UNSPLASH_ORIENTATIONS" :key="orientation" :value="orientation">
                        {{ orientation[0]!.toUpperCase() + orientation.slice(1) }}
                      </option>
                    </select>
                    <AppIcon :icon="ChevronDown" :size="22" />
                  </span>
                </div>
                <div class="sd-field">
                  <label :for="`${id}-${source.key}-count`" class="sd-label">How many</label>
                  <input
                    :id="`${id}-${source.key}-count`"
                    v-model="source.count"
                    class="sd-input"
                    type="number"
                    inputmode="numeric"
                    min="1"
                    step="1"
                    :placeholder="COUNT_PLACEHOLDER"
                    :aria-invalid="errorOf(index, source, 'count') ? 'true' : undefined"
                    :aria-describedby="errorOf(index, source, 'count') ? `${id}-${source.key}-count-error` : undefined"
                    data-testid="source-count"
                  >
                  <p v-if="errorOf(index, source, 'count')" :id="`${id}-${source.key}-count-error`" class="sd-error" data-testid="source-error">
                    How many {{ errorOf(index, source, 'count') }}
                  </p>
                </div>
              </template>
            </div>
            <p v-if="rowError(index)" class="sd-error" data-testid="source-error">
              Source {{ index + 1 }} {{ rowError(index) }}
            </p>
          </li>
        </ol>

        <p v-if="visible.sources" class="sd-error" data-testid="sources-error">
          This pool {{ visible.sources }}
        </p>

        <p v-if="hasUnsplash" class="sd-hint" data-testid="unsplash-note">
          Each Unsplash source uses one Unsplash request per 30 photos when it is listed (an app in demo mode gets 50 an hour), so keep the counts small.
        </p>

        <div v-if="kinds.length > 0" class="add">
          <span class="sd-select">
            <select v-model="pending" class="sd-input" aria-label="Kind of source to add" data-testid="add-kind">
              <option value="" disabled>
                Add a source…
              </option>
              <option v-for="kind in kinds" :key="kind" :value="kind">
                {{ POOL_SOURCE_LABELS[kind] }}
              </option>
            </select>
            <AppIcon :icon="ChevronDown" :size="22" />
          </span>
          <SettingsPillButton :disabled="!pending" data-testid="add-source" @click="addPicked">
            <AppIcon :icon="Plus" :size="20" />
            Add source
          </SettingsPillButton>
        </div>
        <p v-else-if="draft.sources.length >= MAX_POOL_SOURCES" class="sd-hint" data-testid="sources-full">
          A pool can have at most {{ MAX_POOL_SOURCES }} sources.
        </p>

        <ul v-if="needsUnsplash || needsImmich || noFeeds" class="unavailable" data-testid="unavailable">
          <li v-if="needsUnsplash" data-testid="unavailable-unsplash">
            Unsplash searches, collections and topics aren't offered: the config has no <code>photos.unsplash</code> block with an access key.
          </li>
          <li v-if="needsImmich" data-testid="unavailable-immich">
            Immich albums aren't offered: the config has no <code>photos.immich</code> block with the server's address and key.
          </li>
          <li v-if="noFeeds" data-testid="unavailable-feeds">
            Feeds aren't offered: the config has no photo source set up.
          </li>
        </ul>
      </section>

      <SettingsNotice v-if="serverError" tone="error" data-testid="pool-server-error">
        {{ serverError }}
      </SettingsNotice>

      <div class="actions">
        <SettingsPillButton variant="primary" type="submit" :disabled="busy" data-testid="pool-save">
          {{ busy ? 'Saving…' : 'Save pool' }}
        </SettingsPillButton>
        <SettingsPillButton :disabled="busy" data-testid="pool-cancel" @click="emit('cancel')">
          Cancel
        </SettingsPillButton>
      </div>
    </SettingsCard>
  </form>
</template>

<style scoped>
.editor {
  min-width: 0;
}

.sources {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.subhead {
  margin: 0;
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 400;
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px;
  border-radius: 24px;
  background: var(--bg);
}

.row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.kind {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}

.tools {
  display: flex;
  gap: 4px;
}

.tool {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--text);
  cursor: pointer;
  touch-action: manipulation;
}

.tool:hover:not(:disabled) {
  background: var(--surface);
}

.tool:disabled {
  opacity: 0.35;
  cursor: default;
}

.tool:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}

.fields {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}

.wide {
  min-width: 0;
}

.add {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.add .sd-select {
  flex: 1;
  min-width: 220px;
}

.unavailable {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  color: var(--muted);
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;
  list-style: none;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

@media (max-width: 700px) {
  .fields {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .wide {
    grid-column: 1 / -1;
  }
}
</style>
