import createDOMPurify from 'dompurify'
import type { DOMPurify } from 'dompurify'
import { JSDOM } from 'jsdom'
import sharp from 'sharp'
import { ART_LIMITS, ArtError } from './art-errors'
import type { ArtSlot } from './art-errors'
import { joinList } from './errors'

export { ART_LIMITS, ArtError } from './art-errors'
export type { ArtSlot } from './art-errors'

// Turns an uploaded image into what is stored (architecture §6.5). Free of h3,
// so it can be tested alone: `server/utils/specialDayArt.ts` turns an
// ArtError into the HTTP error.
//
// The type comes from the bytes and never from the client's MIME or file
// name. Every SVG goes through the sanitiser before anything else reads it,
// including sharp when it rasterises it for the full-screen slots.

const MB = 1024 * 1024

/** The size every full-screen and extra image is cropped to, so the two line up. */
const FULL = { width: 2560, height: 1440 } as const

/** The box a tile is fitted inside. */
const TILE_BOX = 512

/** The most dpi an SVG is rasterised at: a tiny logo still comes out sharp, but a stray 1×1 SVG can't ask for a huge render. */
const MAX_DENSITY = 2400

const SLOT_LABEL: Record<ArtSlot, string> = { tile: 'Tile art', full: 'Full-screen art', extra: 'Extra art' }

/** The bytes to store, and the extension to name and serve them by. */
export interface ProcessedArt {
  data: Buffer
  ext: 'webp' | 'svg'
}

// ---------------------------------------------------------------------------
// Sniffing

// An SVG is optional whitespace, any of an XML declaration, comments and a
// doctype (with an internal subset, if it has one), then the root `<svg`.
const SVG_START = /^\s*(?:<\?xml[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>\s*)*<svg[\s/>]/

/** How much of the start of a file is looked at for the root element; a long comment or doctype can push it past a few KB. */
const SNIFF_BYTES = 64 * 1024

/** Whether the bytes start like an SVG document. */
function looksLikeSvg(input: Buffer | string): boolean {
  const head = typeof input === 'string' ? input.slice(0, SNIFF_BYTES) : input.subarray(0, SNIFF_BYTES).toString('utf8')
  return SVG_START.test(head.replace(/^\uFEFF/, ''))
}

// ---------------------------------------------------------------------------
// The SVG sanitiser

/** Elements that run code, load other documents or embed HTML. Finding one rejects the file. */
const DANGEROUS_ELEMENTS: Record<string, string> = {
  script: 'a script',
  foreignobject: 'a foreignObject',
  iframe: 'an iframe',
  object: 'an object',
  embed: 'an embed',
  applet: 'an applet',
  handler: 'a handler',
  listener: 'a listener',
  link: 'a link element',
  base: 'a base element',
  meta: 'a meta element',
  audio: 'an audio element',
  video: 'a video element',
}

/** What counts as a CSS reference that leaves the file, in a `<style>` or a `style` attribute. */
const CSS_IMPORT = /@import/i
const CSS_EXPRESSION = /expression\s*\(|-moz-binding|behaviou?r\s*:/i
const CSS_URL = /url\s*\(\s*(?:['"]\s*)?([^)'"]*)/gi

let purifier: DOMPurify | undefined
let window: InstanceType<typeof JSDOM>['window'] | undefined
let findings: string[] = []

function note(finding: string): void {
  if (!findings.includes(finding)) findings.push(finding)
}

/** Shortens a value for a message, so a huge data: URL doesn't fill it. */
function shown(value: string): string {
  const flat = value.trim().replace(/\s+/g, ' ')
  return flat.length > 60 ? `${flat.slice(0, 57)}…` : flat
}

/** Notes a stylesheet or a `style` value that imports, runs code or loads a URL that isn't `#something`. */
function checkCss(css: string): void {
  // Comments can sit inside a keyword; escapes can spell one (`\75rl(`), and
  // nothing a wall needs uses one.
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '')
  if (plain.includes('\\')) note('a CSS escape')
  if (CSS_IMPORT.test(plain)) note('a CSS @import')
  if (CSS_EXPRESSION.test(plain)) note('CSS that runs code')
  for (const match of plain.matchAll(CSS_URL)) {
    const target = match[1]!.trim()
    if (!target.startsWith('#')) note(`an external reference (${shown(target)})`)
  }
}

/** Notes a link that doesn't point at something in the same file. */
function checkLink(value: string): void {
  if (!value.trim().startsWith('#')) note(`an external reference (${shown(value)})`)
}

/** The one DOMPurify, over one jsdom window; the window is slow to build, so this waits for the first SVG. */
function getPurifier(): { purify: DOMPurify, window: NonNullable<typeof window> } {
  if (!purifier || !window) {
    window = new JSDOM('').window
    purifier = createDOMPurify(window as unknown as Window & typeof globalThis)

    // DOMPurify strips what it doesn't allow. These hooks only watch, to tell
    // the editor leftovers it strips quietly from the things that mean the
    // file isn't safe, which reject it. The hooks belong to this instance and
    // `findings` is reset for each call.
    purifier.addHook('uponSanitizeElement', (node, data) => {
      const name = data.tagName.toLowerCase().split(':').pop()!
      const dangerous = DANGEROUS_ELEMENTS[name]
      if (dangerous) note(dangerous)
      if (name === 'style') checkCss(node.textContent ?? '')
      // DOMPurify drops animations, but a file that animates a link or an
      // event handler is not a file to keep.
      if (name === 'animate' || name === 'set') {
        const target = ((node as Element).getAttribute('attributeName') ?? '').trim().toLowerCase().replace(/^xlink:/, '')
        if (target === 'href' || target.startsWith('on')) note(`an animated ${target}`)
      }
    })
    purifier.addHook('uponSanitizeAttribute', (_node, data) => {
      const name = data.attrName.toLowerCase()
      if (name.startsWith('on')) note(`an event handler (${name})`)
      else if (name === 'href' || name.endsWith(':href') || name === 'src') checkLink(data.attrValue)
      else if (name === 'style') checkCss(data.attrValue)
      // fill="url(…)", filter, mask, clip-path and the rest can name a file too.
      if (name !== 'style' && /url\s*\(/i.test(data.attrValue)) checkCss(data.attrValue)
    })
  }
  return { purify: purifier, window }
}

/**
 * Cleans an SVG for storing and serving: the result is well-formed XML with an
 * `<svg>` root in the SVG namespace, and nothing in it runs or loads anything.
 * Editor leftovers (Inkscape and Sodipodi attributes, `<metadata>`, comments)
 * are dropped without complaint. Scripts, `<foreignObject>`, event handlers,
 * and any link or URL that doesn't point at an `#id` in the same file, throw a
 * 400 ArtError that names what was found, because stripping them would not
 * leave the picture the person drew.
 */
export function sanitiseSvg(input: Buffer | string): string {
  const text = typeof input === 'string' ? input : input.toString('utf8')
  if (!looksLikeSvg(text)) throw new ArtError(400, 'The file is not an SVG')

  const { purify, window } = getPurifier()
  findings = []
  const body = purify.sanitize(text, {
    USE_PROFILES: { svg: true, svgFilters: true },
    RETURN_DOM: true,
    // <use> is how editors share shapes; with every link held to `#id`, it can
    // only point inside the file. Editors' <metadata> brings text with it.
    ADD_TAGS: ['use'],
    FORBID_TAGS: ['metadata'],
    ADD_FORBID_CONTENTS: ['metadata', 'rdf:rdf', 'sodipodi:namedview'],
  }) as Element

  if (findings.length > 0) {
    const [first, second, ...rest] = findings
    const named = rest.length > 0 ? `${first}, ${second} and ${rest.length} more` : joinList(findings)
    const plural = findings.length > 1
    throw new ArtError(400, `The SVG has ${named}, which ${plural ? 'aren\'t' : 'isn\'t'} allowed`)
  }

  const roots = Array.from(body.children)
  const root = roots.length === 1 ? roots[0] : undefined
  if (!root || root.localName !== 'svg') throw new ArtError(400, 'The file is not an SVG')
  return new window.XMLSerializer().serializeToString(root)
}

/** Sanitises an SVG and checks sharp can read what is left. */
async function cleanSvg(input: Buffer): Promise<{ svg: Buffer, width: number, height: number }> {
  const svg = Buffer.from(sanitiseSvg(input), 'utf8')
  try {
    const { format, width, height } = await sharp(svg).metadata()
    if (format !== 'svg' || !width || !height) throw new Error('not an SVG')
    return { svg, width, height }
  }
  catch {
    throw new ArtError(400, 'The SVG can\'t be drawn, it may be broken or have no size')
  }
}

// ---------------------------------------------------------------------------
// Raster work

/** Formats the full-screen art may be in. Others sharp can sometimes open, such as PDF, aren't pictures to a wall. */
const FULL_FORMATS: ReadonlySet<string> = new Set(['jpeg', 'png', 'webp', 'gif', 'heif', 'tiff', 'jp2', 'svg'])
const ALPHA_FORMATS: ReadonlySet<string> = new Set(['png', 'webp', 'svg'])

/** What type the bytes are: `svg` (by our own sniff), a raster format sharp names, or undefined if sharp can't tell. */
async function sniff(input: Buffer): Promise<string | undefined> {
  if (looksLikeSvg(input)) return 'svg'
  try {
    const { format } = await sharp(input, { failOn: 'error' }).metadata()
    // Sharp calls anything with an <svg> near the start an SVG. If it isn't one by
    // our reading, it has not been through the sanitiser and so is not one.
    return format === 'svg' ? undefined : format
  }
  catch {
    return undefined
  }
}

type Pipeline = ReturnType<typeof sharp>

/** Runs an encode and calls its failure an unreadable image, since the type was already right. */
async function encode(slot: ArtSlot, pipeline: Pipeline): Promise<Buffer> {
  try {
    return await pipeline.toBuffer()
  }
  catch {
    throw new ArtError(400, `${SLOT_LABEL[slot]} can't be read, the image may be damaged`)
  }
}

/** The input for a crop to full-screen size: a raster as it is, an SVG sanitised and drawn large enough not to blur. */
async function fullSource(input: Buffer, type: string): Promise<Pipeline> {
  if (type !== 'svg') return sharp(input, { failOn: 'error' }).rotate()
  const { svg, width, height } = await cleanSvg(input)
  const scale = Math.max(FULL.width / width, FULL.height / height)
  const density = Math.min(MAX_DENSITY, Math.max(1, Math.ceil(72 * scale)))
  return sharp(svg, { density })
}

/**
 * Checks and converts an upload for a slot. Throws an ArtError: 413 if it is too
 * large (checked first, before the bytes are read as anything), 415 if the
 * bytes aren't a type the slot takes, 400 if they are but can't be used (a
 * damaged image, an SVG with a script, or an extra layer with no transparency).
 *
 * - `tile`: PNG, WebP or SVG. A raster is fitted inside 512×512, never
 *   enlarged, with its transparency kept, and saved as WebP. An SVG is
 *   sanitised and kept as SVG.
 * - `full`: any common image format, or SVG. Turned upright by its EXIF,
 *   cropped to fill 2560×1440 and saved as WebP.
 * - `extra`: PNG, WebP or SVG that has transparency, cropped like `full` so
 *   the two line up, and saved as WebP with the transparency kept.
 *
 * Only the first frame of an animated image is used.
 */
export async function processArt(slot: ArtSlot, input: Buffer): Promise<ProcessedArt> {
  const label = SLOT_LABEL[slot]
  const limit = ART_LIMITS[slot]
  if (input.length > limit) throw new ArtError(413, `${label} must be at most ${limit / MB} MB`)

  const type = await sniff(input)

  if (slot === 'tile') {
    if (type === 'svg') return { data: (await cleanSvg(input)).svg, ext: 'svg' }
    if (type !== 'png' && type !== 'webp') throw new ArtError(415, `${label} must be PNG, WebP or SVG`)
    const data = await encode(slot, sharp(input, { failOn: 'error' })
      .rotate()
      .resize(TILE_BOX, TILE_BOX, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 90 }))
    return { data, ext: 'webp' }
  }

  if (slot === 'full') {
    if (!type || !FULL_FORMATS.has(type)) throw new ArtError(415, `${label} must be an image, such as JPEG, PNG, WebP or SVG`)
    const source = await fullSource(input, type)
    const data = await encode(slot, source
      .resize(FULL.width, FULL.height, { fit: 'cover', position: 'centre' })
      .webp({ quality: 85 }))
    return { data, ext: 'webp' }
  }

  if (!type || !ALPHA_FORMATS.has(type)) throw new ArtError(415, `${label} must be PNG, WebP or SVG with a transparent background`)
  const source = await fullSource(input, type)
  const data = await encode(slot, source
    .resize(FULL.width, FULL.height, { fit: 'cover', position: 'centre' })
    .webp({ quality: 85, alphaQuality: 100 }))
  if (await isOpaque(data)) throw new ArtError(400, `${label} must have a transparent background, this image has none`)
  return { data, ext: 'webp' }
}

/** Whether every pixel is solid. Checked on what will be stored, so a transparent part that was cropped away doesn't count. */
async function isOpaque(image: Buffer): Promise<boolean> {
  const { channels } = await sharp(image).stats()
  // No fourth channel is no alpha at all; otherwise the lowest alpha has to be below solid.
  return channels.length < 4 || channels[3]!.min === 255
}
