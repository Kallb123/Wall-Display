<script setup lang="ts">
import type { SpecialDayPalette } from '../../../shared/special-days'
import { PALETTES } from '~/utils/themes'
import { PALETTE_OPTIONS } from '~/utils/specialDayEditor'

// The four palettes (architecture §6.4) as round swatches: the palette's
// background with its accent as a dot, and its name beneath. A radio group: the
// chosen one is the tab stop, and the arrow keys move and choose, as native
// radios do. `warm` keeps the theme the display has, so it is drawn with the
// page's own colours.
const props = defineProps<{
  disabled?: boolean
  /** Names the group for a screen reader. */
  label?: string
}>()

const model = defineModel<SpecialDayPalette>({ required: true })

const buttons = useTemplateRef<HTMLButtonElement[]>('buttons')

/** The colours a swatch is drawn with. */
function colours(palette: SpecialDayPalette): { background: string, accent: string } {
  if (palette === 'warm') return { background: 'var(--bg)', accent: 'var(--accent)' }
  return { background: PALETTES[palette].bg, accent: PALETTES[palette].accent }
}

/** Arrow keys move to the next or previous swatch, wrapping round, and choose it. */
function move(event: KeyboardEvent, index: number) {
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
  if (step === 0 || props.disabled) return
  event.preventDefault()
  const next = (index + step + PALETTE_OPTIONS.length) % PALETTE_OPTIONS.length
  model.value = PALETTE_OPTIONS[next]!.value
  buttons.value?.[next]?.focus()
}
</script>

<template>
  <div class="swatches" role="radiogroup" :aria-label="label ?? 'Palette'">
    <button
      v-for="(option, index) in PALETTE_OPTIONS"
      ref="buttons"
      :key="option.value"
      type="button"
      class="swatch"
      role="radio"
      :aria-checked="model === option.value"
      :tabindex="model === option.value ? 0 : -1"
      :disabled="disabled"
      :data-testid="`palette-${option.value}`"
      @click="model = option.value"
      @keydown="move($event, index)"
    >
      <span class="disc" :style="{ background: colours(option.value).background }">
        <span class="dot" :style="{ background: colours(option.value).accent }" />
      </span>
      <span class="name">{{ option.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
}

.swatch {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 64px;
  padding: 4px 6px;
  border: 0;
  border-radius: 20px;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  touch-action: manipulation;
}

.swatch:disabled {
  opacity: 0.6;
  cursor: default;
}

.disc {
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: 52px;
  height: 52px;
  border: 2px solid var(--line);
  border-radius: 50%;
  transition: box-shadow 0.2s ease;
}

.dot {
  width: 24px;
  height: 24px;
  border-radius: 50%;
}

.swatch[aria-checked='true'] {
  color: var(--text);
}

.swatch[aria-checked='true'] .disc {
  border-color: var(--text);
  box-shadow: 0 0 0 3px var(--surface), 0 0 0 5px var(--accent);
}

.swatch:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
</style>
