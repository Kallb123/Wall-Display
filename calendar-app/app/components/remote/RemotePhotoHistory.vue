<script setup lang="ts">
import { ChevronDown, Image as ImageIcon } from 'lucide-vue-next'
import { photoHistoryResponseSchema } from '../../../shared/photoHistory'
import type { PhotoHistoryEntry } from '../../../shared/photoHistory'
import { detailRows, historySubtitle, historyTitle, onDisplayLabel } from '~/utils/photoHistory'

// The "Photo history" section: the photos the wall has shown lately, newest
// first, each with the time it was on show, a thumbnail while the server still
// has the picture, and a panel of what the source knows about it (architecture
// §7.5). The list is read from the server, not the socket, so it is fetched
// when the section appears, a moment after the page says the wall has changed
// (the wall asks for its next photo a little after the command), every half
// minute while the page is in view, and when the phone comes back to it. A
// failed refresh keeps what is on show; only a first load that fails says so.

const props = defineProps<{
  displayId: string
  /** The display's IANA time zone, which every time here is read in. */
  timezone: string
  /** Whether a photo pane is on the wall now, so the open entry is "On the wall". */
  photosShown: boolean
  /** Bumped by the page when it wants the list read again. */
  refreshKey: number
}>()

/** How many entries are asked for, how many show at first, and how many each "Show more" adds. */
const FETCH_LIMIT = 50
const FIRST_SHOWN = 5
const MORE_STEP = 10
/** The wait after a refresh is asked for, so the wall has had time to choose its next photo. */
const REFRESH_DELAY_MS = 1500
const POLL_MS = 30_000

const now = useNow(60_000)
const entries = ref<PhotoHistoryEntry[]>([])
/** Whether a read has ever worked, and whether the last one failed. */
const loaded = ref(false)
const failed = ref(false)
const shown = ref(FIRST_SHOWN)
const openId = ref<number | null>(null)
/** The entries whose picture would not load, so they show the placeholder. */
const brokenImages = ref(new Set<number>())

let reading = 0
async function load() {
  const mine = ++reading
  try {
    const answer = await $fetch<unknown>(`/api/displays/${encodeURIComponent(props.displayId)}/photo-history`, { query: { limit: FETCH_LIMIT } })
    const parsed = photoHistoryResponseSchema.safeParse(answer)
    // An answer that has been overtaken by a later read is stale.
    if (mine !== reading) return
    if (!parsed.success) throw new Error('Unexpected answer')
    entries.value = parsed.data.entries
    loaded.value = true
    failed.value = false
  } catch {
    if (mine === reading) failed.value = true
  }
}

let delayTimer: ReturnType<typeof setTimeout> | undefined
let pollTimer: ReturnType<typeof setInterval> | undefined
const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'

function onVisibility() {
  if (visible()) void load()
}

onMounted(() => {
  void load()
  pollTimer = setInterval(() => {
    if (visible()) void load()
  }, POLL_MS)
  document.addEventListener('visibilitychange', onVisibility)
})
onScopeDispose(() => {
  clearTimeout(delayTimer)
  clearInterval(pollTimer)
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
})

watch(() => props.refreshKey, () => {
  clearTimeout(delayTimer)
  delayTimer = setTimeout(() => void load(), REFRESH_DELAY_MS)
})
watch(() => props.displayId, () => {
  entries.value = []
  loaded.value = false
  openId.value = null
  void load()
})

const visibleEntries = computed(() => entries.value.slice(0, shown.value))
const hiddenCount = computed(() => Math.max(0, entries.value.length - shown.value))
/** The entry on the wall now: the newest that hasn't ended, if a photo pane is showing. */
const liveId = computed(() => props.photosShown ? entries.value.find(entry => entry.ended_at === null)?.id ?? null : null)

function toggle(id: number) {
  openId.value = openId.value === id ? null : id
}

function pictureFailed(id: number) {
  brokenImages.value = new Set(brokenImages.value).add(id)
}
</script>

<template>
  <section aria-labelledby="photo-history-title" data-testid="photo-history">
    <h2 id="photo-history-title" class="label">
      Photo history
    </h2>
    <div class="card history">
      <p v-if="!loaded && failed" class="hint note" data-testid="photo-history-error">
        Couldn't load the photo history
      </p>
      <p v-else-if="!loaded" class="hint note" data-testid="photo-history-loading">
        Loading&hellip;
      </p>
      <p v-else-if="entries.length === 0" class="hint note" data-testid="photo-history-empty">
        Photos the wall shows will be listed here.
      </p>

      <ul v-else class="entries">
        <li v-for="entry in visibleEntries" :key="entry.id" class="entry" data-testid="photo-history-entry">
          <button
            type="button"
            class="row"
            :aria-expanded="openId === entry.id"
            :aria-controls="`photo-history-details-${entry.id}`"
            @click="toggle(entry.id)"
          >
            <span class="thumb">
              <img
                v-if="entry.image_url && !brokenImages.has(entry.id)"
                :src="entry.image_url"
                alt=""
                loading="lazy"
                @error="pictureFailed(entry.id)"
              >
              <AppIcon v-else :icon="ImageIcon" :size="26" />
            </span>
            <span class="text">
              <span class="title">{{ historyTitle(entry) }}</span>
              <span class="when">
                {{ onDisplayLabel(entry, now, timezone) }}
                <span v-if="liveId === entry.id" class="pill" data-testid="photo-history-live">On the wall</span>
              </span>
              <span class="subtitle">{{ historySubtitle(entry) }}</span>
            </span>
            <AppIcon class="chevron" :class="{ turned: openId === entry.id }" :icon="ChevronDown" :size="22" />
          </button>

          <div
            v-if="openId === entry.id"
            :id="`photo-history-details-${entry.id}`"
            class="details"
            data-testid="photo-history-details"
          >
            <dl>
              <div v-for="row in detailRows(entry, now, timezone)" :key="row.label" class="detail">
                <dt>{{ row.label }}</dt>
                <dd>
                  <a v-if="row.href" :href="row.href" target="_blank" rel="noopener noreferrer">{{ row.value }}</a>
                  <template v-else>
                    {{ row.value }}
                  </template>
                </dd>
              </div>
            </dl>
          </div>
        </li>
      </ul>

      <button v-if="hiddenCount > 0" type="button" class="button more" data-testid="photo-history-more" @click="shown += MORE_STEP">
        Show more
      </button>
    </div>
  </section>
</template>

<style scoped src="../../assets/remote-base.css"></style>

<style scoped>
.history {
  padding: 6px 0 0;
  overflow: hidden;
}

.note {
  margin: 0;
  padding: 18px 20px 20px;
  text-align: center;
}

.entries {
  margin: 0;
  padding: 0;
  list-style: none;
}

.entry + .entry {
  border-top: 1px solid var(--line);
}

/* The whole row is the button, so the target is as tall as the thumbnail and its padding. */
.row {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  box-sizing: border-box;
  width: 100%;
  min-height: 44px;
  padding: 12px 16px;
  text-align: left;
}

.thumb {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  overflow: hidden;
  border-radius: 16px;
  background: var(--bg);
  color: var(--muted);
}

.thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.title {
  overflow: hidden;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.when,
.subtitle {
  color: var(--muted);
  font-size: 14px;
  font-weight: 500;
  line-height: 1.3;
}

.subtitle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pill {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.5;
  white-space: nowrap;
}

.chevron {
  color: var(--muted);
  transition: transform 0.2s ease;
}

.chevron.turned {
  transform: rotate(180deg);
}

.details {
  margin: 0 16px 14px;
  padding: 12px 16px;
  border-radius: 18px;
  background: var(--bg);
}

dl {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
}

.detail {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 12px;
  font-size: 15px;
  line-height: 1.35;
}

dt {
  color: var(--muted);
  font-weight: 600;
}

dd {
  margin: 0;
  font-weight: 500;
  overflow-wrap: anywhere;
}

/* A link in the panel: padded up to a finger's size without making the line taller. */
dd a {
  display: inline-block;
  margin: -10px 0;
  padding: 10px 0;
  color: var(--accent-ink);
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 4px;
}

.more {
  display: block;
  width: calc(100% - 32px);
  margin: 4px 16px 16px;
}
</style>
