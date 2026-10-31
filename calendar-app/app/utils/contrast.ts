import type { ThemeToken } from './themes'

// The contrast every theme and special day palette must keep (architecture
// §6.4: palettes are fixed in code, so they are checked once, in CI). The ratio
// is WCAG's; `CONTRAST_PAIRS` says which text sits on which surface, by token.
// Resolving a token to a colour needs a browser (they are CSS variables and
// `color-mix`), so that check is test/visual/contrast.spec.ts; this is the
// arithmetic and the list. Pure: no Nuxt or Vue imports.

/** An sRGB colour, each channel 0 to 255. */
export type Rgb = readonly [number, number, number]

/** WCAG's relative luminance: 0 for black, 1 for white. */
function luminance([red, green, blue]: Rgb): number {
  const linear = (channel: number) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
}

/** WCAG's contrast ratio of two opaque colours, from 1 (the same) to 21 (black on white). The order doesn't matter. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light! + 0.05) / (dark! + 0.05)
}

/** WCAG's AA for text: normal size, then large (from 24 px, or 18.66 px in bold). */
export const BODY_TEXT_CONTRAST = 4.5
export const LARGE_TEXT_CONTRAST = 3

export interface ContrastPair {
  /** The text (or the mark) colour. */
  fg: ThemeToken
  /** What it is drawn on. */
  bg: ThemeToken
  min: number
  /** Where on the wall it is, and why `min` is what it is. */
  why: string
}

/**
 * The text-on-surface pairs every theme and palette must pass. Everything is
 * body text (4.5) except the two that are only ever large: the number in
 * today's pill (27 px, bold) and the overlay and preview badges (30 px and up,
 * bold), which WCAG counts as large from 18.66 px. The light theme's own pairs
 * are 4.10 and 3.30, so 4.5 there would need new colours; the palettes all pass
 * 4.5 anyway. Leaves out `faint`, which is deliberately dim (a date number
 * outside the month) and `veil`, which isn't a surface for text.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { fg: 'text', bg: 'bg', min: BODY_TEXT_CONTRAST, why: 'the month title and anything else set straight on the page' },
  { fg: 'text', bg: 'surface', min: BODY_TEXT_CONTRAST, why: 'a card and an event with nobody on it' },
  { fg: 'text', bg: 'tile', min: BODY_TEXT_CONTRAST, why: 'a date number and an event in a day tile, and the agenda\'s tomorrow card' },
  { fg: 'muted', bg: 'bg', min: BODY_TEXT_CONTRAST, why: 'the year beside the month title, and the weekday names' },
  { fg: 'muted', bg: 'tile', min: BODY_TEXT_CONTRAST, why: 'the time on a timed event in a tile' },
  { fg: 'muted', bg: 'todayCell', min: BODY_TEXT_CONTRAST, why: 'the time on a timed event in today\'s tile' },
  { fg: 'panelText', bg: 'panel', min: BODY_TEXT_CONTRAST, why: 'the big date, the greeting and the events in the side panel' },
  { fg: 'panelMuted', bg: 'panel', min: BODY_TEXT_CONTRAST, why: 'the panel\'s times and weather' },
  { fg: 'accentInk', bg: 'tile', min: BODY_TEXT_CONTRAST, why: '"+3 more" in a tile' },
  { fg: 'todayNumFg', bg: 'todayNumBg', min: LARGE_TEXT_CONTRAST, why: 'the date in the pill for today: 27 px, bold' },
  { fg: 'onAccent', bg: 'accent', min: LARGE_TEXT_CONTRAST, why: 'the overlay banner (60 px, bold) and the preview badge (30 px, bold)' },
  { fg: 'text', bg: 'todayCell', min: BODY_TEXT_CONTRAST, why: 'an event in today\'s tile' },
  { fg: 'barText', bg: 'surface', min: BODY_TEXT_CONTRAST, why: 'the text on a bar for an event with nobody on it, which is filled with the surface (a person\'s bar is their colour mixed into the page, which depends on the colour)' },
]
