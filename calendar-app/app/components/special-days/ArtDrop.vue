<script setup lang="ts">
import { ImagePlus } from 'lucide-vue-next'
import { specialDayArtUrl } from '../../../shared/special-days'
import type { ArtSlot } from '~/utils/artUpload'
import '~/assets/special-days-form.css'

// A place to drop a picture, or click to choose one: the art for a day's tile,
// the wall's full-screen takeover, or a day's own extra layer. It shows the art
// there is, or what to do, a bar while one uploads and the reason an upload was
// refused. It does not check or send the file: the editor hands it to the page,
// which does both. On a day that uses a scene, art of its own is marked
// "Changed" and Reset goes back to the scene's; otherwise art can be removed.
const props = withDefaults(defineProps<{
  label: string
  artSlot: ArtSlot
  /** The art's file name, or null for none. */
  art: string | null
  aspect: 'square' | 'wide'
  /** 0 to 1 while a file uploads, else null. */
  progress: number | null
  /** Why the last upload was refused, or null. */
  error: string | null
  /** Nothing to upload to yet (a day that is not saved). */
  disabled?: boolean
  hint?: string
  /** Where the art shown comes from, on a day with a scene. */
  origin?: 'scene' | 'own' | null
  sceneName?: string
  /** The day or scene has art of its own in this slot that can be cleared. */
  clearable: boolean
}>(), { hint: undefined, origin: null, sceneName: '' })

const emit = defineEmits<{
  file: [file: File]
  clear: []
}>()

const id = useId()
const input = useTemplateRef<HTMLInputElement>('input')
const over = ref(false)

/** Only the formats the server takes for the slot (the full-screen art is converted there, so any image goes). */
const accept = computed(() => props.artSlot === 'full' ? 'image/*' : 'image/png,image/webp,image/svg+xml')
const uploading = computed(() => props.progress !== null)
const inert = computed(() => props.disabled || uploading.value)
const percent = computed(() => Math.round((props.progress ?? 0) * 100))
const describedby = computed(() => [props.hint ? `${id}-hint` : null, props.error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined)

function choose() {
  if (!inert.value) input.value?.click()
}

function picked(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  // Cleared, so choosing the same file again (after fixing it) still counts.
  target.value = ''
  if (file && !inert.value) emit('file', file)
}

function dropped(event: DragEvent) {
  over.value = false
  const file = event.dataTransfer?.files[0]
  if (file && !inert.value) emit('file', file)
}

function dragOver() {
  if (!inert.value) over.value = true
}
</script>

<template>
  <div class="art" :class="[aspect, { over, disabled }]" :data-testid="`art-${artSlot}`">
    <div class="head">
      <span class="sd-label">
        <span :id="`${id}-label`">{{ label }}</span>
        <SpecialDaysFieldMark v-if="origin" :origin="origin" :scene-name="sceneName" @reset="emit('clear')" />
      </span>
    </div>

    <button
      type="button"
      class="drop"
      :disabled="inert"
      :aria-labelledby="`${id}-label`"
      :aria-describedby="describedby"
      :aria-busy="uploading"
      :data-testid="`art-${artSlot}-drop`"
      @click="choose"
      @dragenter.prevent="dragOver"
      @dragover.prevent="dragOver"
      @dragleave="over = false"
      @drop.prevent="dropped"
    >
      <img v-if="art" class="picture" :src="specialDayArtUrl(art)" alt="" :data-testid="`art-${artSlot}-image`">
      <span v-else class="empty">
        <AppIcon :icon="ImagePlus" :size="28" />
        <span class="empty-text">Drop a picture here, or choose one</span>
      </span>
      <span v-if="art && !inert" class="replace">Replace</span>
    </button>

    <input
      ref="input"
      type="file"
      hidden
      tabindex="-1"
      :accept="accept"
      :data-testid="`art-${artSlot}-input`"
      @change="picked"
    >

    <div
      v-if="uploading"
      class="bar"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="percent"
      :aria-label="`Uploading ${label.toLowerCase()}`"
      :data-testid="`art-${artSlot}-progress`"
    >
      <span class="fill" :style="{ width: `${percent}%` }" />
    </div>

    <p v-if="hint && !error" :id="`${id}-hint`" class="sd-hint">
      {{ hint }}
    </p>
    <p v-if="error" :id="`${id}-error`" class="sd-error" role="alert" :data-testid="`art-${artSlot}-error`">
      {{ error }}
    </p>

    <button
      v-if="clearable && origin !== 'own'"
      type="button"
      class="remove"
      :disabled="inert"
      :aria-label="`Remove ${label.toLowerCase()}`"
      :data-testid="`art-${artSlot}-remove`"
      @click="emit('clear')"
    >
      Remove
    </button>
  </div>
</template>

<style scoped>
.art {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.art.wide {
  align-items: stretch;
}

.drop {
  position: relative;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  overflow: hidden;
  border: 2px dashed var(--line);
  border-radius: 20px;
  background: var(--bg);
  color: var(--muted);
  font: inherit;
  cursor: pointer;
  touch-action: manipulation;
}

.square .drop {
  width: 160px;
  aspect-ratio: 1;
}

.wide .drop {
  width: 100%;
  max-width: 360px;
  aspect-ratio: 16 / 9;
}

.drop:disabled {
  cursor: default;
}

.disabled .drop {
  opacity: 0.6;
}

.over .drop {
  border-color: var(--accent);
  background: color-mix(in oklch, var(--accent) 12%, var(--bg));
}

.drop:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 3px;
}

.picture {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px;
  text-align: center;
}

.empty-text {
  font-size: 14px;
  font-weight: 700;
  line-height: 1.3;
}

/* Over the picture, at the corner, so it is clear that dropping another replaces this one. */
.replace {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 4px 12px;
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  box-shadow: var(--shadow-soft);
}

.bar {
  width: 100%;
  max-width: 360px;
  height: 8px;
  overflow: hidden;
  border-radius: var(--radius-pill);
  background: var(--bg);
}

.square .bar {
  max-width: 160px;
}

.fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--accent);
  transition: width 0.15s ease;
}

.remove {
  min-height: 32px;
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--accent-ink);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
  touch-action: manipulation;
}

.remove:disabled {
  opacity: 0.6;
  cursor: default;
}

.remove:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
</style>
