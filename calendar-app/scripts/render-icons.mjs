// Draws the remote's icons into public/icons/: the SVG source and the PNGs the
// web app manifest and iOS need (architecture §7.5). The PNGs are committed, so
// nothing runs this at build time; rerun it after changing the design below:
//
//   cd calendar-app && node scripts/render-icons.mjs
//
// It needs a Chromium that playwright-core can launch (`pnpm exec playwright
// install chromium` if there isn't one, or set CHROMIUM_PATH to one). Colours
// are the Organic tokens in app/assets/tokens.css: `--color-accent` and `--color-bg`.

import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const outDir = fileURLToPath(new URL('../public/icons/', import.meta.url))
const terracotta = '#c67139'
const cream = '#f5ead8'

// Lucide's `calendar-days` on a 24-unit grid, drawn at a heavy stroke. The
// dots are zero-length lines, which round caps turn into dots. The rule across
// the top has square ends, so at this weight it doesn't poke out of the corners.
const glyph = `
  <rect x="3" y="4" width="18" height="18" rx="2.5" />
  <path d="M8 2v4M16 2v4" />
  <path d="M3 10h18" stroke-linecap="butt" />
  <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />`

/**
 * One icon on a 512 grid. `rounded` is a terracotta rounded square on cream
 * (for the plain icons); otherwise the terracotta runs to the edge, for icons
 * the system crops itself (maskable, Apple). The glyph is centred and sized to
 * sit well inside the central 80% safe zone.
 */
function icon({ rounded }) {
  const scale = 14.5
  const offset = 256 - 12 * scale
  const background = rounded
    ? `<rect width="512" height="512" fill="${cream}" /><rect x="40" y="40" width="432" height="432" rx="104" fill="${terracotta}" />`
    : `<rect width="512" height="512" fill="${terracotta}" />`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  ${background}
  <g transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="${cream}" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">${glyph}
  </g>
</svg>
`
}

const targets = [
  { file: 'remote-192.png', size: 192, rounded: true },
  { file: 'remote-512.png', size: 512, rounded: true },
  { file: 'remote-maskable-512.png', size: 512, rounded: false },
  { file: 'apple-touch-icon.png', size: 180, rounded: false },
]

await mkdir(outDir, { recursive: true })
await writeFile(`${outDir}remote.svg`, icon({ rounded: true }))

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
try {
  for (const { file, size, rounded } of targets) {
    const page = await browser.newPage({ viewport: { width: size, height: size } })
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${icon({ rounded })}`)
    await page.screenshot({ path: `${outDir}${file}`, omitBackground: false })
    await page.close()
  }
}
finally {
  await browser.close()
}
