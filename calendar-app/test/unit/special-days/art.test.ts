import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { ART_LIMITS, ArtError, processArt, sanitiseSvg } from '../../../server/special-days/art'

// Turning an upload into what is stored: the SVG sanitiser (with a hostile
// fixture and each hostile thing alone) and the three slots. Raster inputs are
// made with sharp, so there are no binary fixtures.

const FIXTURES = join(__dirname, '..', '..', 'fixtures', 'svg')
const fixture = (name: string): Buffer => readFileSync(join(FIXTURES, name))

/** An SVG with `inner` inside the root, and `rootAttrs` on it. */
function svg(inner: string, rootAttrs = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100" viewBox="0 0 100 100" ${rootAttrs}>${inner}</svg>`
}

/** Runs `run` and returns the ArtError it throws; fails if it doesn't throw one. */
async function artError(run: () => unknown): Promise<ArtError> {
  try {
    await run()
  }
  catch (error) {
    expect(error).toBeInstanceOf(ArtError)
    return error as ArtError
  }
  throw new Error('expected an ArtError')
}

/** A plain image: `width`×`height`, with a sixth of it a different colour so a crop shows. */
function raster(width: number, height: number, background: { r: number, g: number, b: number, alpha: number } = { r: 200, g: 60, b: 40, alpha: 1 }) {
  return sharp({ create: { width, height, channels: 4, background } })
}

async function meta(buffer: Buffer) {
  return sharp(buffer).metadata()
}

describe('sanitiseSvg', () => {
  it('rejects the hostile fixture, naming what it found', () => {
    const error = (() => {
      try {
        sanitiseSvg(fixture('hostile.svg'))
      }
      catch (e) {
        return e as ArtError
      }
    })()

    expect(error).toBeInstanceOf(ArtError)
    expect(error!.statusCode).toBe(400)
    expect(error!.message).toMatch(/^The SVG has .+, which aren't allowed$/)
    expect(error!.message).toContain('more')
  })

  // Each of these is the only thing wrong with the file.
  const hostile: Array<[string, string, string]> = [
    ['a script', svg('<script>alert(1)</script><rect width="5" height="5"/>'), 'a script'],
    ['a script in the svg namespace with a CDATA body', svg('<script type="text/ecmascript"><![CDATA[alert(1)]]></script>'), 'a script'],
    ['an onload on the root', svg('<rect width="5" height="5"/>', 'onload="alert(1)"'), 'an event handler (onload)'],
    ['an event handler on a shape', svg('<rect width="5" height="5" onclick="alert(1)"/>'), 'an event handler (onclick)'],
    ['an event handler in mixed case', svg('<rect width="5" height="5" OnMouseOver="alert(1)"/>'), 'an event handler (onmouseover)'],
    ['a foreignObject', svg('<foreignObject width="5" height="5"><p xmlns="http://www.w3.org/1999/xhtml">hi</p></foreignObject>'), 'a foreignObject'],
    ['an iframe', svg('<iframe src="https://example.com/"/>'), 'an iframe'],
    ['an image from the web', svg('<image href="https://example.com/x.png" width="5" height="5"/>'), 'an external reference (https://example.com/x.png)'],
    ['an image from a protocol-relative URL', svg('<image href="//example.com/x.png" width="5" height="5"/>'), 'an external reference (//example.com/x.png)'],
    ['an xlink:href to a local file', svg('<image xlink:href="file:///etc/passwd" width="5" height="5"/>'), 'an external reference (file:///etc/passwd)'],
    ['an xlink:href to a relative file', svg('<image xlink:href="secret.png" width="5" height="5"/>'), 'an external reference (secret.png)'],
    ['an image with a data: URL', svg('<image href="data:image/png;base64,AAAA" width="5" height="5"/>'), 'an external reference (data:image/png;base64,AAAA)'],
    ['a javascript: link', svg('<a href="javascript:alert(1)"><rect width="5" height="5"/></a>'), 'an external reference (javascript:alert(1))'],
    ['a javascript: link with leading whitespace', svg('<a xlink:href="  \n\tjavascript:alert(1)"><rect width="5" height="5"/></a>'), 'an external reference (javascript:alert(1))'],
    ['a javascript: link spelt with entities', svg('<a href="&#106;&#97;vascript&colon;alert(1)"><rect width="5" height="5"/></a>'), 'an external reference'],
    ['a link to the web', svg('<a href="https://example.com/"><rect width="5" height="5"/></a>'), 'an external reference (https://example.com/)'],
    ['a use of another file', svg('<use href="other.svg#shape"/>'), 'an external reference (other.svg#shape)'],
    ['a use of a data: SVG', svg('<use xlink:href="data:image/svg+xml;base64,AAAA#a"/>'), 'an external reference'],
    ['an animated href', svg('<a href="#x"><rect width="5" height="5"/><animate attributeName="href" to="javascript:alert(1)"/></a>'), 'an animated href'],
    ['an animated xlink:href', svg('<a href="#x"><rect width="5" height="5"/><set attributeName="xlink:href" to="javascript:alert(1)"/></a>'), 'an animated href'],
    ['an animated event handler', svg('<rect width="5" height="5"><set attributeName="onmouseover" to="alert(1)"/></rect>'), 'an animated onmouseover'],
    ['a style that imports', svg('<style>@import url(https://example.com/x.css);</style>'), 'a CSS @import'],
    ['a style that imports without url()', svg('<style>@import "https://example.com/x.css";</style>'), 'a CSS @import'],
    ['a style with a background from the web', svg('<style>rect { fill: url("https://example.com/x.svg#a") }</style>'), 'an external reference (https://example.com/x.svg#a)'],
    ['a style attribute with a URL', svg('<rect width="5" height="5" style="fill:url(https://example.com/x.svg#a)"/>'), 'an external reference (https://example.com/x.svg#a)'],
    ['a presentation attribute with a URL', svg('<rect width="5" height="5" fill="url(https://example.com/x.svg#a)"/>'), 'an external reference (https://example.com/x.svg#a)'],
    ['a filter from another file', svg('<rect width="5" height="5" filter="url(other.svg#f)"/>'), 'an external reference (other.svg#f)'],
    ['a style with a CSS escape', svg('<style>rect { fill: u\\72l(https://example.com/x.svg) }</style>'), 'a CSS escape'],
    ['a style that runs an expression', svg('<rect width="5" height="5" style="width:expression(alert(1))"/>'), 'CSS that runs code'],
  ]

  it.each(hostile)('rejects %s', (_name, source, found) => {
    let error: ArtError | undefined
    try {
      sanitiseSvg(source)
    }
    catch (e) {
      error = e as ArtError
    }
    expect(error).toBeInstanceOf(ArtError)
    expect(error!.statusCode).toBe(400)
    expect(error!.message).toContain(found)
  })

  it('names one finding in the singular and says "more" past two', () => {
    expect(() => sanitiseSvg(svg('<script/>'))).toThrow('The SVG has a script, which isn\'t allowed')
    expect(() => sanitiseSvg(svg('<script/><iframe/>'))).toThrow('The SVG has a script and an iframe, which aren\'t allowed')
    expect(() => sanitiseSvg(svg('<script/><iframe/><object/>'))).toThrow('The SVG has a script, an iframe and 1 more, which aren\'t allowed')
  })

  it('forgets what an earlier file had', () => {
    expect(() => sanitiseSvg(svg('<script/>'))).toThrow(ArtError)
    expect(() => sanitiseSvg(fixture('clean.svg'))).not.toThrow()
  })

  it('rejects text that is not an SVG', () => {
    for (const text of ['hello', '<html><body><svg/></body></html>', '<?xml version="1.0"?><note/>', '']) {
      expect(() => sanitiseSvg(text)).toThrow('The file is not an SVG')
    }
  })

  it('keeps a clean SVG as well-formed XML, with its links and styles', () => {
    const out = sanitiseSvg(fixture('clean.svg'))

    const doc = new JSDOM(out, { contentType: 'image/svg+xml' }).window.document
    expect(doc.documentElement.localName).toBe('svg')
    expect(doc.documentElement.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(out).toContain('<use href="#dot"')
    expect(out).toContain('xlink:href="#dot"')
    expect(out).toContain('fill="url(#glow)"')
    expect(out).toContain('stroke: url(#glow)')
    expect(out).toContain('Boo &amp; co')
  })

  it('drops editor metadata from an Inkscape file without complaint', () => {
    const out = sanitiseSvg(fixture('inkscape.svg'))

    expect(out).not.toMatch(/inkscape|sodipodi|rdf|metadata|namedview|image\/svg\+xml|<!--/i)
    expect(out).toContain('<path id="star"')
    const doc = new JSDOM(out, { contentType: 'image/svg+xml' }).window.document
    expect(doc.querySelector('path')?.getAttribute('d')).toMatch(/^M 60,10/)
  })

  it('accepts a byte order mark, an XML declaration, comments and a doctype before the root', () => {
    const doctype = '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">'
    const source = `\uFEFF  <?xml version="1.0"?>\n<!-- hi -->${doctype}\n${svg('<rect width="5" height="5"/>')}`

    const out = sanitiseSvg(Buffer.from(source, 'utf8'))

    expect(out).toContain('<rect')
    expect(out).not.toContain('DOCTYPE')
  })

  it('gives the root the SVG namespace when the file left it out', () => {
    expect(sanitiseSvg('<svg width="10" height="10"><rect width="5" height="5"/></svg>')).toContain('xmlns="http://www.w3.org/2000/svg"')
  })
})

describe('processArt: size', () => {
  it('refuses a tile over 2 MB with a 413, before looking at what it is', async () => {
    const error = await artError(() => processArt('tile', Buffer.alloc(ART_LIMITS.tile + 1)))

    expect(error.statusCode).toBe(413)
    expect(error.message).toBe('Tile art must be at most 2 MB')
  })

  it('has limits of 2, 20 and 20 MB', () => {
    expect(ART_LIMITS).toEqual({ tile: 2 * 1024 * 1024, full: 20 * 1024 * 1024, extra: 20 * 1024 * 1024 })
  })

  it('refuses over-size full and extra art too', async () => {
    expect((await artError(() => processArt('full', Buffer.alloc(ART_LIMITS.full + 1)))).statusCode).toBe(413)
    expect((await artError(() => processArt('extra', Buffer.alloc(ART_LIMITS.extra + 1)))).statusCode).toBe(413)
  })
})

describe('processArt: tile', () => {
  it('fits a large PNG inside 512×512 as WebP, keeping its shape and transparency', async () => {
    const input = await raster(1600, 800, { r: 10, g: 120, b: 200, alpha: 0.5 }).png().toBuffer()

    const { data, ext } = await processArt('tile', input)

    expect(ext).toBe('webp')
    const info = await meta(data)
    expect(info.format).toBe('webp')
    expect([info.width, info.height]).toEqual([512, 256])
    expect(info.hasAlpha).toBe(true)
    expect(await isTransparent(data)).toBe(true)
  })

  it('fits a tall image by its height', async () => {
    const input = await raster(300, 1200).png().toBuffer()

    const info = await meta((await processArt('tile', input)).data)

    expect([info.width, info.height]).toEqual([128, 512])
  })

  it('does not enlarge a small image', async () => {
    const input = await raster(64, 48).png().toBuffer()

    const info = await meta((await processArt('tile', input)).data)

    expect([info.width, info.height]).toEqual([64, 48])
  })

  it('takes a WebP', async () => {
    const input = await raster(900, 900).webp().toBuffer()

    const { data, ext } = await processArt('tile', input)

    expect(ext).toBe('webp')
    expect((await meta(data)).width).toBe(512)
  })

  it('keeps a clean SVG as SVG, sanitised', async () => {
    const { data, ext } = await processArt('tile', fixture('inkscape.svg'))

    expect(ext).toBe('svg')
    const text = data.toString('utf8')
    expect(text).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/)
    expect(text).not.toContain('inkscape')
    expect((await meta(data)).format).toBe('svg')
  })

  it('takes an SVG whatever the file calls it, and the client says it is', async () => {
    // Nothing but the bytes are given to processArt, which is the point.
    const { ext } = await processArt('tile', Buffer.from(svg('<rect width="5" height="5"/>')))
    expect(ext).toBe('svg')
  })

  it('refuses a JPEG with a 415', async () => {
    const input = await raster(200, 200).jpeg().toBuffer()

    const error = await artError(() => processArt('tile', input))

    expect(error.statusCode).toBe(415)
    expect(error.message).toBe('Tile art must be PNG, WebP or SVG')
  })

  it('refuses text and garbage with a 415, whatever it might be called', async () => {
    expect((await artError(() => processArt('tile', Buffer.from('hello there')))).statusCode).toBe(415)
    expect((await artError(() => processArt('tile', Buffer.alloc(0)))).statusCode).toBe(415)
    expect((await artError(() => processArt('tile', Buffer.from('<html><body><svg/></body></html>')))).statusCode).toBe(415)
  })

  it('refuses a hostile SVG with a 400', async () => {
    const error = await artError(() => processArt('tile', fixture('hostile.svg')))

    expect(error.statusCode).toBe(400)
  })

  it('takes an SVG with no width or height, sized by its drawing', async () => {
    const { data, ext } = await processArt('tile', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>'))

    expect(ext).toBe('svg')
    expect((await meta(data)).width).toBe(5)
  })

  it('refuses a PNG that is cut short with a 400', async () => {
    const whole = await raster(400, 400).png().toBuffer()

    const error = await artError(() => processArt('tile', whole.subarray(0, Math.floor(whole.length / 2))))

    expect(error.statusCode).toBe(400)
  })
})

describe('processArt: full', () => {
  it('crops a 4000×3000 JPEG to 2560×1440 WebP', async () => {
    const input = await raster(4000, 3000).jpeg().toBuffer()

    const { data, ext } = await processArt('full', input)

    expect(ext).toBe('webp')
    const info = await meta(data)
    expect(info.format).toBe('webp')
    expect([info.width, info.height]).toEqual([2560, 1440])
  })

  it('enlarges a small image to fill the screen', async () => {
    const input = await raster(320, 180).png().toBuffer()

    const info = await meta((await processArt('full', input)).data)

    expect([info.width, info.height]).toEqual([2560, 1440])
  })

  it('crops from the centre', async () => {
    // Red left, green middle, blue right: a 16:9 cut of a square keeps the middle band.
    const left = await raster(100, 300, { r: 255, g: 0, b: 0, alpha: 1 }).png().toBuffer()
    const middle = await raster(100, 300, { r: 0, g: 255, b: 0, alpha: 1 }).png().toBuffer()
    const right = await raster(100, 300, { r: 0, g: 0, b: 255, alpha: 1 }).png().toBuffer()
    const input = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#000' } })
      .composite([{ input: left, left: 0, top: 0 }, { input: middle, left: 100, top: 0 }, { input: right, left: 200, top: 0 }])
      .png().toBuffer()

    const { data } = await processArt('full', input)

    const { data: pixels, info } = await sharp(data).raw().toBuffer({ resolveWithObject: true })
    const at = (x: number, y: number) => [0, 1, 2].map(c => pixels[(y * info.width + x) * info.channels + c]!)
    // A 300×300 cut to 16:9 loses its top and bottom, so the columns stay in order.
    expect(at(40, 700)[0]).toBeGreaterThan(200)
    expect(at(1280, 700)[1]).toBeGreaterThan(200)
    expect(at(2520, 700)[2]).toBeGreaterThan(200)
  })

  it('turns a photo upright by its EXIF orientation', async () => {
    // Stored 400 wide and 200 tall with orientation 6 (rotate 90°), so it is a portrait; a cover crop of it is still 2560×1440,
    // and the red top half of the stored image ends up on the right.
    const top = await raster(400, 100, { r: 255, g: 0, b: 0, alpha: 1 }).png().toBuffer()
    const input = await sharp({ create: { width: 400, height: 200, channels: 3, background: { r: 0, g: 0, b: 255 } } })
      .composite([{ input: top, left: 0, top: 0 }])
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 100 }).toBuffer()

    const { data } = await processArt('full', input)

    const { data: pixels, info } = await sharp(data).raw().toBuffer({ resolveWithObject: true })
    const at = (x: number, y: number) => [0, 1, 2].map(c => pixels[(y * info.width + x) * info.channels + c]!)
    // Orientation 6 puts the stored top on the right: right edge red, left edge blue.
    expect(at(2500, 700)[0]).toBeGreaterThan(200)
    expect(at(60, 700)[2]).toBeGreaterThan(200)
  })

  it('draws a clean SVG at full size', async () => {
    const { data, ext } = await processArt('full', fixture('clean.svg'))

    expect(ext).toBe('webp')
    const info = await meta(data)
    expect([info.width, info.height]).toEqual([2560, 1440])
  })

  it('draws a tiny SVG sharply, not as a blown up thumbnail', async () => {
    const tiny = svg('<rect width="10" height="10" fill="#ff0000"/>').replace('width="100" height="100" viewBox="0 0 100 100"', 'width="10" height="10" viewBox="0 0 10 10"')

    const { data } = await processArt('full', Buffer.from(tiny))

    const { data: pixels, info } = await sharp(data).raw().toBuffer({ resolveWithObject: true })
    expect([info.width, info.height]).toEqual([2560, 1440])
    // Past the 2400 dpi cap a pixel of the source is no more than 33 output pixels wide; the red fills the middle and its edge is crisp.
    const mid = (720 * info.width + 1280) * info.channels
    expect(pixels[mid]).toBeGreaterThan(240)
    expect(pixels[mid + 1]).toBeLessThan(15)
  })

  it('takes the other common formats', async () => {
    for (const make of [
      () => raster(800, 600).png().toBuffer(),
      () => raster(800, 600).webp().toBuffer(),
      () => raster(800, 600).gif().toBuffer(),
      () => raster(800, 600).tiff().toBuffer(),
      () => raster(800, 600).avif().toBuffer(),
    ]) {
      const info = await meta((await processArt('full', await make())).data)
      expect([info.width, info.height]).toEqual([2560, 1440])
    }
  })

  it('uses the first frame of an animated image', async () => {
    const frames = await Promise.all([200, 100].map(g => raster(100, 100, { r: g, g, b: g, alpha: 1 }).raw().toBuffer()))
    const animated = await sharp(Buffer.concat(frames), { raw: { width: 100, height: 100, channels: 4, pageHeight: 100 } })
      .gif({ delay: [100, 100], loop: 0 }).toBuffer()

    const info = await meta((await processArt('full', animated)).data)

    expect(info.pages ?? 1).toBe(1)
    expect([info.width, info.height]).toEqual([2560, 1440])
  })

  it('refuses garbage with a 415', async () => {
    const error = await artError(() => processArt('full', Buffer.from('this is not an image at all')))

    expect(error.statusCode).toBe(415)
    expect(error.message).toBe('Full-screen art must be an image, such as JPEG, PNG, WebP or SVG')
  })

  it('refuses a damaged image with a 400', async () => {
    const whole = await raster(2000, 2000).png().toBuffer()

    const error = await artError(() => processArt('full', whole.subarray(0, Math.floor(whole.length / 2))))

    expect(error.statusCode).toBe(400)
  })

  it('refuses a hostile SVG, and one sharp alone would take as an SVG', async () => {
    expect((await artError(() => processArt('full', fixture('hostile.svg')))).statusCode).toBe(400)
    // Not an SVG by its start, so it never reached the sanitiser.
    expect((await artError(() => processArt('full', Buffer.from('<html><svg xmlns="http://www.w3.org/2000/svg" width="5" height="5"><script>alert(1)</script></svg></html>')))).statusCode).toBe(415)
  })
})

/** Whether any pixel of a WebP is not solid. */
async function isTransparent(image: Buffer): Promise<boolean> {
  const { channels } = await sharp(image).stats()
  return channels.length === 4 && channels[3]!.min < 255
}

describe('processArt: extra', () => {
  /** A square, half of it clear: left half solid, right half transparent. */
  async function halfClear(size: number, format: 'png' | 'webp'): Promise<Buffer> {
    const solid = await raster(size / 2, size, { r: 30, g: 90, b: 200, alpha: 1 }).png().toBuffer()
    const canvas = sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: solid, left: 0, top: 0 }])
    return format === 'png' ? canvas.png().toBuffer() : canvas.webp({ lossless: true }).toBuffer()
  }

  it('crops a transparent PNG to 2560×1440 WebP and keeps the transparency', async () => {
    const { data, ext } = await processArt('extra', await halfClear(1000, 'png'))

    expect(ext).toBe('webp')
    const info = await meta(data)
    expect(info.format).toBe('webp')
    expect([info.width, info.height]).toEqual([2560, 1440])
    expect(info.hasAlpha).toBe(true)
    expect(await isTransparent(data)).toBe(true)
    // The clear right half stayed clear and the left stayed solid.
    const { data: pixels, info: raw } = await sharp(data).raw().toBuffer({ resolveWithObject: true })
    const alphaAt = (x: number, y: number) => pixels[(y * raw.width + x) * raw.channels + 3]!
    expect(alphaAt(200, 700)).toBe(255)
    expect(alphaAt(2300, 700)).toBe(0)
  })

  it('lines up with full art of the same shape', async () => {
    const extra = await meta((await processArt('extra', await halfClear(800, 'webp'))).data)
    const full = await meta((await processArt('full', await raster(800, 800).png().toBuffer())).data)

    expect([extra.width, extra.height]).toEqual([full.width, full.height])
  })

  it('takes a transparent SVG', async () => {
    const { data, ext } = await processArt('extra', Buffer.from(svg('<circle cx="50" cy="50" r="20" fill="#fff"/>')))

    expect(ext).toBe('webp')
    expect([(await meta(data)).width, (await meta(data)).height]).toEqual([2560, 1440])
    expect(await isTransparent(data)).toBe(true)
  })

  it('refuses an opaque PNG with a 400', async () => {
    const error = await artError(async () => processArt('extra', await raster(800, 800).removeAlpha().png().toBuffer()))

    expect(error.statusCode).toBe(400)
    expect(error.message).toBe('Extra art must have a transparent background, this image has none')
  })

  it('refuses a PNG that has an alpha channel but is solid all over', async () => {
    const error = await artError(async () => processArt('extra', await raster(800, 800).png().toBuffer()))

    expect(error.statusCode).toBe(400)
  })

  it('refuses an opaque SVG (a background covering the lot)', async () => {
    const error = await artError(() => processArt('extra', Buffer.from(svg('<rect width="100" height="100" fill="#123456"/>'))))

    expect(error.statusCode).toBe(400)
  })

  it('refuses a JPEG with a 415', async () => {
    const input = await raster(800, 800).jpeg().toBuffer()

    const error = await artError(() => processArt('extra', input))

    expect(error.statusCode).toBe(415)
    expect(error.message).toContain('PNG, WebP or SVG')
  })

  it('refuses a hostile SVG with a 400', async () => {
    expect((await artError(() => processArt('extra', fixture('hostile.svg')))).statusCode).toBe(400)
  })
})
