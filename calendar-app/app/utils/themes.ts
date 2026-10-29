// The themes as data: a named set of tokens for each, built from the ramps in
// app/assets/tokens.css. The stage applies the set it is given as CSS
// variables, so everything inside reads `var(--bg)`, `var(--text)` and so on
// and never knows which theme it is in. A special day's palette (architecture
// §6.4) is just another `ThemeTokens` passed to `themeStyle` instead of one of these.
// Pure: no Nuxt or Vue imports.

export const THEME_TOKENS = [
  'bg', 'surface', 'text', 'muted',
  // The dimmest text: a date number outside the month shown.
  'faint',
  'line', 'accent', 'accent2', 'onAccent',
  // Accent-coloured text, darker than `accent` on light so it reads on a tile ("+3 more").
  'accentInk',
  'todayCell',
  // The pill behind today's date number in the grid, and the text on it.
  'todayNumBg', 'todayNumFg',
  // The side panel that holds today's date, with its text and its secondary text.
  'panel', 'panelText', 'panelMuted',
  // A day tile in the month, and a day outside it (transparent on dark).
  'tile', 'tileOut',
  // The text on a person's bar.
  'barText',
  'veil', 'barMix',
] as const
export type ThemeToken = (typeof THEME_TOKENS)[number]
export type ThemeTokens = Record<ThemeToken, string>

// Both follow the Soft month mock's light and dark themes.
export const THEMES: Record<'light' | 'dark', ThemeTokens> = {
  // Warm cream, the default.
  light: {
    bg: 'var(--color-bg)',
    surface: 'var(--color-surface)',
    text: 'var(--color-text)',
    muted: 'var(--color-neutral-700)',
    faint: 'var(--color-neutral-500)',
    line: 'var(--color-neutral-300)',
    accent: 'var(--color-accent)',
    accent2: 'var(--color-accent-2-600)',
    onAccent: 'var(--color-neutral-100)',
    accentInk: 'var(--color-accent-700)',
    todayCell: 'var(--color-accent-200)',
    todayNumBg: 'var(--color-accent-600)',
    todayNumFg: 'var(--color-neutral-100)',
    // The sage panel that holds today's date.
    panel: 'var(--color-accent-2-200)',
    panelText: 'var(--color-accent-2-900)',
    panelMuted: 'var(--color-accent-2-700)',
    tile: 'var(--color-surface)',
    tileOut: 'var(--color-neutral-200)',
    barText: 'var(--color-text)',
    // Over past days: the page background, translucent, so what is under it still shows.
    veil: 'color-mix(in oklch, var(--color-bg) 58%, transparent)',
    barMix: '36%',
  },
  // Warm charcoal. Bars need more of the person's colour to show against a dark ground.
  dark: {
    bg: 'var(--color-neutral-900)',
    surface: 'var(--color-neutral-800)',
    text: 'var(--color-neutral-100)',
    muted: 'var(--color-neutral-400)',
    faint: 'var(--color-neutral-600)',
    line: 'var(--color-neutral-800)',
    accent: 'var(--color-accent-400)',
    accent2: 'var(--color-accent-2-400)',
    onAccent: 'var(--color-neutral-900)',
    accentInk: 'var(--color-accent-300)',
    todayCell: 'color-mix(in oklch, var(--color-accent-800) 70%, var(--color-neutral-900))',
    todayNumBg: 'var(--color-accent-400)',
    todayNumFg: 'var(--color-neutral-900)',
    panel: 'var(--color-accent-2-900)',
    panelText: 'var(--color-accent-2-100)',
    panelMuted: 'var(--color-accent-2-300)',
    tile: 'color-mix(in oklch, var(--color-neutral-800) 70%, var(--color-neutral-900))',
    tileOut: 'transparent',
    barText: 'var(--color-neutral-100)',
    veil: 'color-mix(in oklch, var(--color-neutral-900) 58%, transparent)',
    barMix: '52%',
  },
}

/** `todayCell` as `today-cell`, for a CSS variable name. */
function kebab(name: string): string {
  return name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
}

/** A token set as inline CSS variables: `{ '--bg': …, '--today-cell': … }`. */
export function themeStyle(tokens: ThemeTokens): Record<string, string> {
  return Object.fromEntries(THEME_TOKENS.map(token => [`--${kebab(token)}`, tokens[token]]))
}

/**
 * The fill for a person's bar: their colour mixed into the page background,
 * so the text on it keeps its contrast. How much colour is the theme's
 * `--bar-mix` (36% light, 52% dark). Mixed in OKLab, not OKLCH: OKLCH
 * interpolates hue, and the near-grey background's hue would swing a blue
 * towards green.
 */
export function personFill(colour: string): string {
  return `color-mix(in oklab, ${colour} var(--bar-mix), var(--bg))`
}
