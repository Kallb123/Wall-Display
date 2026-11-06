// Draws the app's icons: the remote's and the display's into public/icons/ (the
// SVG source and the PNGs the web app manifests and iOS need; architecture §7.5
// and PR 5.8), and the favicon into public/ (favicon.svg, favicon-32.png and a
// favicon.ico holding 16, 32 and 48 px). The PNGs are committed, so nothing
// runs this at build time; rerun it after changing the design below:
//
//   cd calendar-app && node scripts/render-icons.mjs
//
// It needs a Chromium that playwright-core can launch (`pnpm exec playwright
// install chromium` if there isn't one, or set CHROMIUM_PATH to one). Colours
// are the Organic tokens in app/assets/tokens.css: `--color-accent` and `--color-bg`
// for the remote, and the dark theme's ground for the display. After a run, check
// that the remote's files are unchanged (`git diff --stat public/icons`): a
// different Chromium can anti-alias slightly differently, and then the remote's
// PNGs should be put back with `git checkout`.

import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const publicDir = fileURLToPath(new URL('../public/', import.meta.url))
const outDir = `${publicDir}icons/`
const terracotta = '#c67139'
const cream = '#f5ead8'
// The display's palette: the wall's dark ground, a cream glyph and the same terracotta, so it reads as the wall's icon next to the remote's.
const charcoal = '#2e2b25'

// Lucide's `calendar-days` on a 24-unit grid, drawn at a heavy stroke. The
// dots are zero-length lines, which round caps turn into dots. The rule across
// the top has square ends, so at this weight it doesn't poke out of the corners.
const glyph = `
  <rect x="3" y="4" width="18" height="18" rx="2.5" />
  <path d="M8 2v4M16 2v4" />
  <path d="M3 10h18" stroke-linecap="butt" />
  <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />`

/**
 * One icon on a 512 grid. `rounded` is a coloured rounded square on a plain
 * ground (for the plain icons); otherwise the colour runs to the edge, for icons
 * the system crops itself (maskable, Apple). The glyph is centred and sized to
 * sit well inside the central 80% safe zone. `palette` is the remote's (cream
 * glyph on terracotta) or the display's (cream glyph on charcoal, with a
 * terracotta rule across the top of the calendar).
 */
function icon({ rounded, palette }) {
  const scale = 14.5
  const offset = 256 - 12 * scale
  const { ground, tile, stroke, accent } = palette
  const background = rounded
    ? `<rect width="512" height="512" fill="${ground}" /><rect x="40" y="40" width="432" height="432" rx="104" fill="${tile}" />`
    : `<rect width="512" height="512" fill="${tile}" />`
  // The display's accent: the rule across the calendar's top, drawn over the cream one.
  const rule = accent ? `\n  <path d="M3 10h18" stroke="${accent}" stroke-linecap="butt" />` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  ${background}
  <g transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="${stroke}" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">${glyph}${rule}
  </g>
</svg>
`
}

const remote = { ground: cream, tile: terracotta, stroke: cream }
const display = { ground: charcoal, tile: charcoal, stroke: cream, accent: terracotta }

/**
 * The favicon: the same calendar on the display's ground, redrawn so it reads at
 * 16 px, where an outline and six dots turn to mush. The body is solid cream
 * with a terracotta header and the rings above it, and the dots are cut out of
 * the body in the ground's colour (three, not six).
 */
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="7" fill="${charcoal}" />
  <rect x="5" y="7" width="22" height="20" rx="3.5" fill="${cream}" />
  <path d="M5 10.5a3.5 3.5 0 0 1 3.5-3.5h15a3.5 3.5 0 0 1 3.5 3.5V14H5z" fill="${terracotta}" />
  <path d="M10.5 4v6M21.5 4v6" stroke="${cream}" stroke-width="3" stroke-linecap="round" />
  <path d="M11 20.5h.01M16 20.5h.01M21 20.5h.01" stroke="${charcoal}" stroke-width="3.4" stroke-linecap="round" />
</svg>
`

const targets = [
  { file: 'remote-192.png', size: 192, rounded: true, palette: remote },
  { file: 'remote-512.png', size: 512, rounded: true, palette: remote },
  { file: 'remote-maskable-512.png', size: 512, rounded: false, palette: remote },
  { file: 'apple-touch-icon.png', size: 180, rounded: false, palette: remote },
  { file: 'display-192.png', size: 192, rounded: true, palette: display },
  { file: 'display-512.png', size: 512, rounded: true, palette: display },
  { file: 'display-maskable-512.png', size: 512, rounded: false, palette: display },
  { file: 'display-apple-touch-icon.png', size: 180, rounded: false, palette: display },
]

/**
 * An .ico holding the given PNGs (PNG inside ICO, which every current browser
 * reads): a 6-byte header, a 16-byte entry per image, then the images.
 */
function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)
  let offset = 6 + 16 * images.length
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size, 0) // width (0 would mean 256)
    entry.writeUInt8(size, 1)
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    return entry
  })
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)])
}

await mkdir(outDir, { recursive: true })
await writeFile(`${outDir}remote.svg`, icon({ rounded: true, palette: remote }))
await writeFile(`${outDir}display.svg`, icon({ rounded: true, palette: display }))
await writeFile(`${publicDir}favicon.svg`, favicon)

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
try {
  /** The svg drawn at `size` px as a PNG, with a transparent background if asked. */
  async function render(svg, size, transparent = false) {
    const page = await browser.newPage({ viewport: { width: size, height: size } })
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`)
    const png = await page.screenshot({ omitBackground: transparent })
    await page.close()
    return png
  }

  for (const { file, size, rounded, palette } of targets) {
    await writeFile(`${outDir}${file}`, await render(icon({ rounded, palette }), size))
  }

  // The favicon's corners are transparent, so a tab in any theme shows the rounded tile.
  const pngs = []
  for (const size of [16, 32, 48]) pngs.push({ size, png: await render(favicon, size, true) })
  await writeFile(`${publicDir}favicon-32.png`, pngs[1].png)
  await writeFile(`${publicDir}favicon.ico`, ico(pngs))
}
finally {
  await browser.close()
}
