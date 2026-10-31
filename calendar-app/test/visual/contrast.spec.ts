import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { BODY_TEXT_CONTRAST, CONTRAST_PAIRS, contrastRatio } from '../../app/utils/contrast'
import type { Rgb } from '../../app/utils/contrast'
import { PALETTES, THEMES, paletteAccent, themeStyle, tileTint } from '../../app/utils/themes'
import type { ThemeToken, ThemeTokens } from '../../app/utils/themes'
import { SPECIAL_DAY_PALETTES } from '../../shared/special-days'
import { playServer } from './helpers'

// The text colours of every theme and special day palette against what they sit
// on, at the ratios in app/utils/contrast.ts. The tokens are CSS variables and
// `color-mix`, which only a browser can resolve, so each set is applied to an
// element on a real /display page (where tokens.css is loaded), every colour is
// painted on a canvas and read back, and the ratio is worked out from those
// pixels: what the wall really draws. No screenshots.

const SETS: Record<string, ThemeTokens> = { ...THEMES, ...PALETTES }

/** `todayCell` as `--today-cell`, the name `themeStyle` gives it. */
const variable = (token: ThemeToken): string => `var(--${token.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)})`

/**
 * Each of `expressions` (any CSS colour) as the 8-bit sRGB colour the browser
 * paints, with `tokens` applied as CSS variables on the element they are
 * resolved in. Throws for one that is not a colour, or is not opaque, instead
 * of reading whatever the canvas had before.
 */
async function paintedColours(page: Page, tokens: Record<string, string>, expressions: Record<string, string>): Promise<Record<string, Rgb>> {
  return page.evaluate(({ tokens, expressions }) => {
    const host = document.createElement('div')
    // What an expression that does not resolve (a variable that is not set) falls back to, which is how it is told apart.
    host.style.color = 'rgb(1, 2, 3)'
    for (const [name, value] of Object.entries(tokens)) host.style.setProperty(name, value)
    const probe = document.createElement('div')
    host.append(probe)
    document.body.append(host)

    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })!

    const painted: Record<string, [number, number, number]> = {}
    for (const [name, expression] of Object.entries(expressions)) {
      probe.style.color = expression
      const resolved = getComputedStyle(probe).color
      if (resolved === 'rgb(1, 2, 3)') throw new Error(`${name}: ${expression} does not resolve to a colour`)
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = resolved
      context.fillRect(0, 0, 1, 1)
      const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
      if (alpha !== 255) throw new Error(`${name}: ${expression} is not opaque (${resolved})`)
      painted[name] = [red!, green!, blue!]
    }
    host.remove()
    return painted
  }, { tokens, expressions })
}

test.describe('text keeps its contrast', () => {
  test.beforeEach(async ({ page }) => {
    await playServer(page)
    await page.goto('/display?id=hallway')
    await expect(page.getByTestId('stage')).toBeVisible()
  })

  for (const [name, tokens] of Object.entries(SETS)) {
    test(`${name}: every text pair`, async ({ page }) => {
      const expressions = Object.fromEntries(CONTRAST_PAIRS.flatMap(({ fg, bg }) => [[fg, variable(fg)], [bg, variable(bg)]]))
      const colours = await paintedColours(page, themeStyle(tokens), expressions)

      const failures = CONTRAST_PAIRS.flatMap(({ fg, bg, min }) => {
        const ratio = contrastRatio(colours[fg]!, colours[bg]!)
        return ratio < min ? [`${name}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`] : []
      })
      expect(failures).toEqual([])
    })

    test(`${name}: text on a tile tinted by each palette`, async ({ page }) => {
      const tinted = Object.fromEntries(SPECIAL_DAY_PALETTES.map(palette => [palette, tileTint(paletteAccent(palette), variable('tile'))]))
      const colours = await paintedColours(page, themeStyle(tokens), { text: variable('text'), ...tinted })

      const failures = SPECIAL_DAY_PALETTES.flatMap((palette) => {
        const ratio = contrastRatio(colours.text!, colours[palette]!)
        return ratio < BODY_TEXT_CONTRAST ? [`${name}: text on a tile tinted by ${palette} is ${ratio.toFixed(2)}:1, needs ${BODY_TEXT_CONTRAST}:1`] : []
      })
      expect(failures).toEqual([])
    })
  }
})
