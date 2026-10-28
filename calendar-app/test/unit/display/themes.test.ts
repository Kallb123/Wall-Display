import { describe, expect, it } from 'vitest'
import { THEME_TOKENS, THEMES, personFill, themeStyle } from '../../../app/utils/themes'

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

describe('themeStyle', () => {
  it('turns each token into a CSS variable, in kebab case', () => {
    const style = themeStyle(THEMES.light)

    expect(style['--bg']).toBe(THEMES.light.bg)
    expect(style['--today-cell']).toBe(THEMES.light.todayCell)
    expect(style['--on-accent']).toBe(THEMES.light.onAccent)
    expect(style['--accent2']).toBe(THEMES.light.accent2)
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
