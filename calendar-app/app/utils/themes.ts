// The themes as data: a named set of tokens for each, built from the ramps in
// app/assets/tokens.css. The stage applies the set it is given as CSS
// variables, so everything inside reads `var(--bg)`, `var(--text)` and so on
// and never knows which theme it is in. A special day's palette (architecture
// §6.4) is just another `ThemeTokens` passed to `themeStyle` instead of one of these.
// Pure: no Nuxt or Vue imports.

export const THEME_TOKENS = ['bg', 'surface', 'text', 'muted', 'line', 'accent', 'accent2', 'onAccent', 'todayCell', 'panel', 'tile', 'veil', 'barMix'] as const
export type ThemeToken = (typeof THEME_TOKENS)[number]
export type ThemeTokens = Record<ThemeToken, string>

export const THEMES: Record<'light' | 'dark', ThemeTokens> = {
  // Cream, the default.
  light: {
    bg: 'var(--color-cream-100)',
    surface: 'var(--color-cream-200)',
    text: 'var(--color-cream-900)',
    muted: 'var(--color-cream-700)',
    line: 'var(--color-cream-300)',
    accent: 'var(--color-terracotta-600)',
    accent2: 'var(--color-sage-600)',
    onAccent: 'var(--color-cream-100)',
    todayCell: 'var(--color-terracotta-100)',
    // The sage panel that holds today's date.
    panel: 'var(--color-sage-300)',
    tile: 'var(--color-cream-200)',
    // Over past days: a translucent cream, so what is under it still shows.
    veil: 'oklch(97% 0.02 85 / 0.55)',
    barMix: '36%',
  },
  // Warm charcoal. Bars need more of the person's colour to show against a dark ground.
  dark: {
    bg: 'var(--color-charcoal-900)',
    surface: 'var(--color-charcoal-800)',
    text: 'var(--color-cream-100)',
    muted: 'var(--color-charcoal-300)',
    line: 'var(--color-charcoal-700)',
    accent: 'var(--color-terracotta-400)',
    accent2: 'var(--color-sage-400)',
    onAccent: 'var(--color-charcoal-900)',
    todayCell: 'var(--color-terracotta-900)',
    panel: 'var(--color-sage-700)',
    tile: 'var(--color-charcoal-800)',
    veil: 'oklch(18% 0.008 60 / 0.55)',
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
 * `--bar-mix` (36% light, 52% dark).
 */
export function personFill(colour: string): string {
  return `color-mix(in oklch, ${colour} var(--bar-mix), var(--bg))`
}
