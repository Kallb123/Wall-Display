<script setup lang="ts">
import { Plus, X } from 'lucide-vue-next'
import { STARTER_SCENES, starterTileUrl } from '../../../shared/starter-scenes'
import { PALETTE_LABELS } from '~/utils/specialDayEditor'

// The ready-made scenes (shared/starter-scenes.ts), in a dialog over the
// special days page: each with its tile art, its palette and a line about it,
// and a button to add it. The page does the adding, so this only asks. Adding
// copies the starter into the scene library, so the same one can be added
// again. Rendered with `v-if`; Esc and the close button cancel, and Tab stays
// inside while it is open.
defineProps<{
  /** An add is running: the buttons rest, and the one pressed says so. */
  adding: string | null
}>()

const emit = defineEmits<{
  add: [id: string]
  close: []
}>()

const id = useId()
const dialog = useTemplateRef<HTMLElement>('dialog')
const close = useTemplateRef<HTMLButtonElement>('close')

onMounted(() => close.value?.focus())

/** Keeps Tab inside the dialog: the page behind the scrim is not for using. */
function keepFocus(event: KeyboardEvent) {
  const focusable = Array.from(dialog.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
  const first = focusable[0]
  const last = focusable.at(-1)
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <div class="scrim" data-testid="starter-picker" @keydown.esc="emit('close')" @keydown.tab="keepFocus" @click.self="emit('close')">
    <div ref="dialog" class="dialog" role="dialog" aria-modal="true" :aria-labelledby="`${id}-title`" :aria-describedby="`${id}-intro`">
      <div class="head">
        <h2 :id="`${id}-title`" class="title">
          Add a starter scene
        </h2>
        <button ref="close" type="button" class="close" aria-label="Close" data-testid="starter-close" @click="emit('close')">
          <AppIcon :icon="X" :size="22" />
        </button>
      </div>
      <p :id="`${id}-intro`" class="intro">
        Ready-made looks with their art. Adding one puts a copy in your scenes, for you to use, change or delete.
      </p>
      <ul class="starters">
        <li v-for="starter in STARTER_SCENES" :key="starter.id" class="starter" :data-id="starter.id" data-testid="starter">
          <span class="thumb">
            <img :src="starterTileUrl(starter.id)" alt="">
          </span>
          <span class="text">
            <span class="name">{{ starter.scene.name }}</span>
            <span class="palette">{{ PALETTE_LABELS[starter.scene.palette] }} palette</span>
            <span class="description">{{ starter.description }}</span>
          </span>
          <SettingsPillButton
            class="add"
            :disabled="adding !== null"
            :aria-label="`Add ${starter.scene.name}`"
            data-testid="starter-add"
            @click="emit('add', starter.id)"
          >
            <AppIcon :icon="Plus" :size="20" />
            {{ adding === starter.id ? 'Adding…' : 'Add' }}
          </SettingsPillButton>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: color-mix(in oklch, var(--text) 45%, transparent);
}

.dialog {
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-sizing: border-box;
  width: 100%;
  max-width: 600px;
  max-height: 100%;
  overflow-y: auto;
  padding: 32px;
  border-radius: 32px;
  background: var(--surface);
  box-shadow: var(--shadow-lift);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 400;
  line-height: 1.15;
}

.close {
  display: grid;
  flex: none;
  place-items: center;
  width: 48px;
  height: 48px;
  border: 0;
  border-radius: 50%;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  touch-action: manipulation;
}

.close:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 3px;
}

.intro {
  margin: 0;
  color: var(--muted);
  font-size: 16px;
  font-weight: 500;
  line-height: 1.45;
}

.starters {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.starter {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px 12px 12px;
  border-radius: 24px;
  background: var(--bg);
}

.thumb {
  display: grid;
  flex: none;
  place-items: center;
  width: 72px;
  height: 72px;
  border-radius: 18px;
  background: var(--surface);
}

.thumb img {
  width: 56px;
  height: 56px;
  object-fit: contain;
}

.text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.name {
  font-size: 18px;
  font-weight: 700;
}

.palette {
  color: var(--accent-ink);
  font-size: 13px;
  font-weight: 700;
}

.description {
  color: var(--muted);
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;
}

.add {
  flex: none;
}

@media (max-width: 520px) {
  .dialog {
    padding: 24px 20px;
  }

  .starter {
    flex-wrap: wrap;
  }

  .add {
    width: 100%;
  }
}
</style>
