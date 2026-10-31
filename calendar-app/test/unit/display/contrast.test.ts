import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONTRAST_PAIRS, contrastRatio } from '../../../app/utils/contrast'
import type { Rgb } from '../../../app/utils/contrast'
import { PALETTES, THEME_TOKENS, THEMES } from '../../../app/utils/themes'
import type { ThemeTokens } from '../../../app/utils/themes'

describe('contrastRatio', () => {
  it('is 21 for black on white, and 1 for a colour on itself', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5)
    expect(contrastRatio([201, 90, 40], [201, 90, 40])).toBe(1)
  })

  it('does not depend on which is the text', () => {
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBe(contrastRatio([0, 0, 0], [255, 255, 255]))
    expect(contrastRatio([32, 30, 29], [245, 234, 216])).toBe(contrastRatio([245, 234, 216], [32, 30, 29]))
  })

  it('gives the figures WCAG publishes', () => {
    // #767676 is the lightest grey that passes 4.5:1 on white; #777 just misses.
    expect(contrastRatio([0x76, 0x76, 0x76], [255, 255, 255])).toBeCloseTo(4.54, 2)
    expect(contrastRatio([0x77, 0x77, 0x77], [255, 255, 255])).toBeLessThan(4.5)
    // Mid grey on white, from the WCAG definition: (1 + 0.05) / (0.2158 + 0.05).
    expect(contrastRatio([128, 128, 128], [255, 255, 255])).toBeCloseTo(3.95, 2)
  })

  it('gives the figures for the warm themes\' main pairs', () => {
    // The page text on the cream ground (#201e1d on #f5ead8).
    expect(contrastRatio([0x20, 0x1e, 0x1d], [0xf5, 0xea, 0xd8])).toBeCloseTo(13.95, 1)
  })
})

describe('CONTRAST_PAIRS', () => {
  it('names only tokens that exist, each pair once', () => {
    const names = CONTRAST_PAIRS.map(pair => `${pair.fg}/${pair.bg}`)
    expect(new Set(names).size).toBe(names.length)
    for (const pair of CONTRAST_PAIRS) {
      expect(THEME_TOKENS).toContain(pair.fg)
      expect(THEME_TOKENS).toContain(pair.bg)
    }
  })

  it('asks for AA: 4.5 for text, 3 only for large type', () => {
    expect(new Set(CONTRAST_PAIRS.map(pair => pair.min))).toEqual(new Set([4.5, 3]))
    expect(CONTRAST_PAIRS.filter(pair => pair.min === 3).map(pair => `${pair.fg}/${pair.bg}`)).toEqual(['todayNumFg/todayNumBg', 'onAccent/accent'])
  })
})

// Tokens are CSS variables, and a few use color-mix, so the real check, over every set, is test/visual/contrast.spec.ts
// in a browser. This one holds the sets made only of ramp colours to the same pairs, so a bad edit fails fast.
const css = readFileSync(join(import.meta.dirname, '../../../app/assets/tokens.css'), 'utf8')
const ramp = new Map([...css.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(match => [match[1]!, match[2]!]))

/** The colour of a token that is a ramp colour (`var(--color-plum-100)`) or a hex, or null for anything that needs a browser (`color-mix`, `transparent`). */
function resolve(value: string): Rgb | null {
  const name = /^var\((--[\w-]+)\)$/.exec(value)?.[1]
  const hex = name ? ramp.get(name) : /^#[0-9a-f]{6}$/i.test(value) ? value : undefined
  if (!hex) return null
  return [1, 3, 5].map(at => Number.parseInt(hex.slice(at, at + 2), 16)) as unknown as Rgb
}

function ratios(tokens: ThemeTokens) {
  return CONTRAST_PAIRS.flatMap((pair) => {
    const fg = resolve(tokens[pair.fg])
    const bg = resolve(tokens[pair.bg])
    return fg && bg ? [{ ...pair, ratio: contrastRatio(fg, bg) }] : []
  })
}

describe('the sets made of ramp colours', () => {
  const sets = { light: THEMES.light, ...PALETTES }

  it.each(Object.entries(sets))('%s passes every pair', (_name, tokens) => {
    const checked = ratios(tokens)
    // Every pair was resolved, so none is skipped by accident.
    expect(checked).toHaveLength(CONTRAST_PAIRS.length)
    for (const pair of checked) {
      expect(pair.ratio, `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(pair.min)
    }
  })

  it('checks what it can of dark, whose tile and today\'s cell are mixes', () => {
    const checked = ratios(THEMES.dark)

    expect(checked.length).toBeGreaterThan(5)
    for (const pair of checked) {
      expect(pair.ratio, `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(pair.min)
    }
  })

  it('has the palettes clear 4.5 even where only 3 is asked', () => {
    for (const tokens of Object.values(PALETTES)) {
      for (const pair of ratios(tokens)) expect(pair.ratio, `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
