import { describe, expect, it } from 'vitest'
import { SPECIAL_DAY_PALETTES } from '../../../shared/special-days'
import { PALETTES, THEME_TOKENS, THEMES, paletteAccent, personFill, themeStyle, themeTokens, tileTint } from '../../../app/utils/themes'

describe('THEMES', () => {
  it('gives light and dark every token', () => {
    for (const tokens of Object.values(THEMES)) {
      expect(Object.keys(tokens).sort()).toEqual([...THEME_TOKENS].sort())
    }
  })

  it('mixes more of the person into a bar on dark', () => {
    expect([THEMES.light.barMix, THEMES.dark.barMix]).toEqual(['36%', '52%'])
  })
})

describe('PALETTES', () => {
  it('has a palette for each one that replaces the theme, which is every one but warm', () => {
    expect(Object.keys(PALETTES).sort()).toEqual(SPECIAL_DAY_PALETTES.filter(name => name !== 'warm').sort())
  })

  it('gives each of them every token the themes have, and no others', () => {
    for (const tokens of Object.values(PALETTES)) {
      expect(Object.keys(tokens).sort()).toEqual([...THEME_TOKENS].sort())
    }
  })

  it('keeps the tiles solid, so the art behind the grid never shows through a tile', () => {
    for (const tokens of Object.values(PALETTES)) {
      expect(tokens.tile).not.toBe('transparent')
      expect(tokens.tileOut).not.toBe('transparent')
      expect(tokens.panel).not.toBe('transparent')
    }
  })

  it('takes every colour from the tokens, none of its own', () => {
    for (const tokens of Object.values(PALETTES)) {
      for (const [token, value] of Object.entries(tokens)) {
        if (token === 'barMix') expect(value).toMatch(/^\d+%$/)
        else expect(value, token).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|hsl/i)
      }
    }
  })

  it('makes night dark with terracotta, frost dark blue, and sage light', () => {
    expect(PALETTES.night.bg).toContain('plum')
    expect(PALETTES.night.accent).toContain('color-accent-')
    expect(PALETTES.frost.bg).toContain('frost')
    expect(PALETTES.sage.bg).toContain('accent-2')
  })
})

describe('themeTokens', () => {
  it('is the display\'s theme for no palette, and for warm', () => {
    expect(themeTokens('light', null)).toBe(THEMES.light)
    expect(themeTokens('dark', undefined)).toBe(THEMES.dark)
    expect(themeTokens('dark', 'warm')).toBe(THEMES.dark)
  })

  it('is the palette for any other, whatever the theme', () => {
    expect(themeTokens('light', 'night')).toBe(PALETTES.night)
    expect(themeTokens('dark', 'frost')).toBe(PALETTES.frost)
    expect(themeTokens('light', 'sage')).toBe(PALETTES.sage)
  })
})

describe('paletteAccent', () => {
  it('is the display\'s own accent for warm, and the palette\'s for the others', () => {
    expect(paletteAccent('warm')).toBe('var(--accent)')
    expect(paletteAccent('night')).toBe(PALETTES.night.accent)
    expect(paletteAccent('frost')).toBe(PALETTES.frost.accent)
    expect(paletteAccent('sage')).toBe(PALETTES.sage.accent)
  })
})

describe('tileTint', () => {
  it('mixes 26% of the accent into what the tile would have been', () => {
    expect(tileTint('var(--accent)', 'var(--tile)')).toBe('color-mix(in oklab, var(--accent) 26%, var(--tile))')
  })
})

describe('themeStyle', () => {
  it('turns each token into a CSS variable, in kebab case', () => {
    const style = themeStyle(THEMES.light)

    expect(style['--bg']).toBe(THEMES.light.bg)
    expect(style['--today-cell']).toBe(THEMES.light.todayCell)
    expect(style['--on-accent']).toBe(THEMES.light.onAccent)
    expect(style['--accent2']).toBe(THEMES.light.accent2)
    expect(style['--panel-text']).toBe(THEMES.light.panelText)
    expect(style['--today-num-bg']).toBe(THEMES.light.todayNumBg)
    expect(style['--bar-mix']).toBe('36%')
    expect(Object.keys(style)).toHaveLength(THEME_TOKENS.length)
  })

  it('takes any token set, such as a special day palette', () => {
    const palette = { ...THEMES.dark, bg: '#111111' }

    expect(themeStyle(palette)['--bg']).toBe('#111111')
  })
})

describe('personFill', () => {
  it('mixes the colour into the page background by the theme\'s bar mix', () => {
    expect(personFill('#C67139')).toBe('color-mix(in oklab, #C67139 var(--bar-mix), var(--bg))')
  })
})
