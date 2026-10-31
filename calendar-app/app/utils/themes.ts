// The themes as data: a named set of tokens for each, built from the ramps in
// app/assets/tokens.css. The stage applies the set it is given as CSS
// variables, so everything inside reads `var(--bg)`, `var(--text)` and so on
// and never knows which theme it is in. A special day's palette (architecture
// §6.4) is just another `ThemeTokens` passed to `themeStyle` instead of one of
// these (`PALETTES`, chosen by `themeTokens`). Pure: no Nuxt or Vue imports.

import type { Theme } from '../../shared/display'
import type { SpecialDayPalette } from '../../shared/special-days'

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
export const THEMES: Record<Theme, ThemeTokens> = {
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

/** The palettes that replace the theme. `warm` is not here: it keeps whichever theme the display has. */
export type ReplacingPalette = Exclude<SpecialDayPalette, 'warm'>

// A palette is a complete token set, so no view has to know it is showing one
// (architecture §6.4). Each is built from one ramp in tokens.css, and the text
// pairs in app/utils/contrast.ts hold for every set here and in THEMES (a unit
// test checks the ones that are plain colours, and test/visual/contrast.spec.ts
// the rest in the browser).
//
// Unlike `dark`, `tileOut` is solid: a takeover's art is behind the grid, and
// tiles and panels stay solid so that text never depends on it (§6.3). The
// bar mix and the veil stay translucent, as they are over the tiles, not the art.
export const PALETTES: Record<ReplacingPalette, ThemeTokens> = {
  // Deep plum with terracotta: Halloween and Bonfire Night.
  night: {
    bg: 'var(--color-plum-900)',
    surface: 'var(--color-plum-800)',
    text: 'var(--color-plum-100)',
    muted: 'var(--color-plum-300)',
    faint: 'var(--color-plum-500)',
    line: 'var(--color-plum-800)',
    accent: 'var(--color-accent-400)',
    accent2: 'var(--color-accent-2-400)',
    onAccent: 'var(--color-plum-900)',
    accentInk: 'var(--color-accent-300)',
    todayCell: 'var(--color-accent-800)',
    todayNumBg: 'var(--color-accent-400)',
    todayNumFg: 'var(--color-plum-900)',
    panel: 'var(--color-plum-700)',
    panelText: 'var(--color-plum-100)',
    panelMuted: 'var(--color-plum-200)',
    tile: 'var(--color-plum-800)',
    tileOut: 'var(--color-plum-900)',
    barText: 'var(--color-plum-100)',
    veil: 'color-mix(in oklch, var(--color-plum-900) 58%, transparent)',
    barMix: '52%',
  },
  // Dark blue with icy highlights: Christmas and winter.
  frost: {
    bg: 'var(--color-frost-900)',
    surface: 'var(--color-frost-800)',
    text: 'var(--color-frost-100)',
    // As light as the ramp goes before it is the text colour: today's cell is a step lighter than the tile, and 300 on it is under 4.5:1.
    muted: 'var(--color-frost-200)',
    faint: 'var(--color-frost-500)',
    line: 'var(--color-frost-800)',
    accent: 'var(--color-frost-300)',
    accent2: 'var(--color-frost-400)',
    onAccent: 'var(--color-frost-900)',
    accentInk: 'var(--color-frost-200)',
    todayCell: 'var(--color-frost-700)',
    todayNumBg: 'var(--color-frost-300)',
    todayNumFg: 'var(--color-frost-900)',
    panel: 'var(--color-frost-700)',
    panelText: 'var(--color-frost-100)',
    panelMuted: 'var(--color-frost-200)',
    tile: 'var(--color-frost-800)',
    tileOut: 'var(--color-frost-900)',
    barText: 'var(--color-frost-100)',
    veil: 'color-mix(in oklch, var(--color-frost-900) 58%, transparent)',
    barMix: '52%',
  },
  // Light sage with deep green: gentle days such as moving day. The panel stays light, as in the light theme: a person's bar is their colour mixed into the page background, and the text on it is the panel's in the agenda's today card, so a dark panel on a light ground would put light text on a pale bar.
  sage: {
    bg: 'var(--color-accent-2-100)',
    surface: 'var(--color-accent-2-200)',
    text: 'var(--color-accent-2-900)',
    muted: 'var(--color-accent-2-700)',
    faint: 'var(--color-accent-2-500)',
    line: 'var(--color-accent-2-300)',
    accent: 'var(--color-accent-2-700)',
    accent2: 'var(--color-accent-600)',
    onAccent: 'var(--color-accent-2-100)',
    accentInk: 'var(--color-accent-2-800)',
    // The light theme's peach: a warm cell is what makes today stand out among green tiles.
    todayCell: 'var(--color-accent-200)',
    todayNumBg: 'var(--color-accent-2-700)',
    todayNumFg: 'var(--color-accent-2-100)',
    // A step darker than the tiles, with the deepest greens for text: step 700 on 300 is 4.4:1, just under.
    panel: 'var(--color-accent-2-300)',
    panelText: 'var(--color-accent-2-900)',
    panelMuted: 'var(--color-accent-2-800)',
    tile: 'var(--color-accent-2-200)',
    tileOut: 'var(--color-accent-2-100)',
    barText: 'var(--color-accent-2-900)',
    veil: 'color-mix(in oklch, var(--color-accent-2-100) 58%, transparent)',
    barMix: '36%',
  },
}

/**
 * The tokens to draw with: the special day's palette if one replaces the
 * theme, otherwise the display's own. `warm`, null and undefined (no special
 * day) are all "keep the theme".
 */
export function themeTokens(theme: Theme, palette: SpecialDayPalette | null | undefined): ThemeTokens {
  return palette && palette !== 'warm' ? PALETTES[palette] : THEMES[theme]
}

/**
 * The CSS colour a special day's decoration is tinted with (architecture §6.2):
 * the palette's accent. `warm` has no palette of its own, so it is the accent
 * of whichever theme the tile is drawn in.
 */
export function paletteAccent(palette: SpecialDayPalette): string {
  return palette === 'warm' ? 'var(--accent)' : PALETTES[palette].accent
}

/** How much of the palette accent a decorated tile is tinted with. */
export const TILE_TINT = '26%'

/** `base`, a tile's own background, with `accent` mixed into it. OKLab, as for a person's bar, so the hue doesn't swing. */
export function tileTint(accent: string, base: string): string {
  return `color-mix(in oklab, ${accent} ${TILE_TINT}, ${base})`
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
