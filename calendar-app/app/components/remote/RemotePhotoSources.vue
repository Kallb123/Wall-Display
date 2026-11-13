<script setup lang="ts">
import { SkipForward } from 'lucide-vue-next'
import type { CommandInput, PhotoSource } from '../../../shared/display'
import { PHOTO_SOURCE_CHOICES, SKIPPED_MS } from '~/utils/remote'

// The "Photos from" section: which source the frame draws from, and a button to
// skip to the next photo. Only shown when the server has a photo source set up.

const props = defineProps<{
  /** The source the wall really uses. */
  photoSource: PhotoSource | null
  /** The sources the server has set up. */
  photoSources: PhotoSource[]
  /** Whether a photo pane is showing, so "Next photo" has something to skip. */
  photosShown: boolean
  /** Sends a command; true if the wall accepted it. */
  send: (command: CommandInput) => Promise<boolean>
}>()

const emit = defineEmits<{
  setSource: [source: PhotoSource]
}>()

const skipped = ref(false)
let skippedTimer: ReturnType<typeof setTimeout> | undefined
onScopeDispose(() => clearTimeout(skippedTimer))

async function nextPhoto() {
  const sent = await props.send({ type: 'photo_next' })
  if (!sent) return
  // The wall changes by itself a moment later: say it was asked, then go back.
  skipped.value = true
  clearTimeout(skippedTimer)
  skippedTimer = setTimeout(() => {
    skipped.value = false
  }, SKIPPED_MS)
}
</script>

<template>
  <section aria-labelledby="photos-title" data-testid="photos-from">
    <h2 id="photos-title" class="label">
      Photos from
    </h2>
    <div class="card photos">
      <div class="segments" role="group" aria-labelledby="photos-title">
        <button
          v-for="choice in PHOTO_SOURCE_CHOICES"
          :key="choice.source"
          type="button"
          class="segment"
          :class="{ active: photoSource === choice.source }"
          :aria-pressed="photoSource === choice.source"
          :disabled="!photoSources.includes(choice.source)"
          :data-testid="`photo-source-${choice.source}`"
          @click="emit('setSource', choice.source)"
        >
          {{ choice.label }}
          <span v-if="!photoSources.includes(choice.source)" class="not-set-up">Not set up</span>
        </button>
      </div>
      <button
        type="button"
        class="button next-photo"
        :disabled="!photosShown"
        :aria-describedby="photosShown ? undefined : 'next-photo-reason'"
        aria-live="polite"
        data-testid="photo-next"
        @click="nextPhoto"
      >
        <AppIcon :icon="SkipForward" :size="22" />
        {{ skipped ? 'Skipped' : 'Next photo' }}
      </button>
      <p v-if="!photosShown" id="next-photo-reason" class="hint reason" data-testid="photo-next-reason">
        Turn on the photo frame or the week and photo view to skip photos.
      </p>
    </div>
  </section>
</template>

<style scoped src="../../assets/remote-base.css"></style>

<style scoped>
.photos {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
}

/* One pill cut into three, the picked source filled in the accent like an active tile. */
.segments {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  background: var(--bg);
}

.segment {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.15;
  transition: background 0.2s ease, color 0.2s ease;
}

.segment.active {
  background: var(--accent);
  color: var(--on-accent);
}

.segment:disabled {
  color: var(--muted);
}

.not-set-up {
  font-size: 12px;
  font-weight: 600;
}

.next-photo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.reason {
  margin: -6px 0 0;
  font-size: 14px;
  text-align: center;
}
</style>
