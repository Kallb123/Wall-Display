import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { photoRenditionSize } from '../../../shared/photos'
import { PhotoRenderError, fillsScreen, renderPhoto, uprightSize } from '../../../server/photos/render'

/** A picture split into coloured bands: `bands` are CSS colours, left to right (or top to bottom if `vertical`). */
async function banded(width: number, height: number, bands: string[], { vertical = false, orientation }: { vertical?: boolean, orientation?: number } = {}) {
  const size = vertical ? height / bands.length : width / bands.length
  const rects = bands.map((colour, i) => vertical
    ? `<rect x="0" y="${i * size}" width="${width}" height="${size}" fill="${colour}"/>`
    : `<rect x="${i * size}" y="0" width="${size}" height="${height}" fill="${colour}"/>`).join('')
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${rects}</svg>`)
  return sharp(svg).jpeg({ quality: 95 }).withMetadata(orientation ? { orientation } : {}).toBuffer()
}

/** The rendered image's colour at a point. */
async function pixel(webp: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(webp).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const at = (y * info.width + x) * info.channels
  return [data[at]!, data[at + 1]!, data[at + 2]!]
}

const brightness = ([r, g, b]: number[]) => (r! + g! + b!) / 3

describe('renderPhoto', () => {
  it('crops a 16:9 photo to fill 2560×1440 and saves it as WebP', async () => {
    const rendered = await renderPhoto(await banded(1600, 900, ['#c03030']))

    const meta = await sharp(rendered.data).metadata()
    expect(meta).toMatchObject({ format: 'webp', ...photoRenditionSize('landscape') })
    expect(rendered).toMatchObject({ width: 1600, height: 900, orientation: 'landscape' })
    // Filled to the corners, with no bars.
    const [r, g, b] = await pixel(rendered.data, 2, 2)
    expect(r).toBeGreaterThan(150)
    expect(g).toBeLessThan(80)
    expect(b).toBeLessThan(80)
  })

  it('still crops a photo that is within 10% of 16:9, and fits one that is further off', async () => {
    expect(fillsScreen(1700, 1000)).toBe(true) // 1.7, 4.4% off
    expect(fillsScreen(1900, 1000)).toBe(true) // 1.9, 6.9% off
    expect(fillsScreen(1500, 1000)).toBe(false) // 3:2, 15.6% off
    expect(fillsScreen(2000, 1000)).toBe(false) // 2:1, 12.5% off
    expect(fillsScreen(1000, 1000)).toBe(false)

    const rendered = await renderPhoto(await banded(1700, 1000, ['#3060c0']))
    expect(await sharp(rendered.data).metadata()).toMatchObject({ width: 2560, height: 1440 })
  })

  it('fits a portrait photo whole over a blurred, darkened copy of itself', async () => {
    // Left half red, right half blue, then the same again top to bottom: the sides of the backdrop differ from top to bottom.
    const portrait = await banded(600, 900, ['#ff0000', '#0000ff'], { vertical: true })
    const rendered = await renderPhoto(portrait)

    expect(await sharp(rendered.data).metadata()).toMatchObject({ format: 'webp', width: 2560, height: 1440 })
    expect(rendered).toMatchObject({ width: 600, height: 900, orientation: 'portrait' })

    // The photo sits in the middle, 960 wide, at its own colours.
    const topOfPhoto = await pixel(rendered.data, 1280, 300)
    const bottomOfPhoto = await pixel(rendered.data, 1280, 1140)
    expect(topOfPhoto[0]).toBeGreaterThan(200)
    expect(topOfPhoto[2]).toBeLessThan(60)
    expect(bottomOfPhoto[2]).toBeGreaterThan(200)
    expect(bottomOfPhoto[0]).toBeLessThan(60)

    // The edges are not bars: they carry the photo's colours, and they differ from top to bottom.
    const edgeTop = await pixel(rendered.data, 100, 200)
    const edgeBottom = await pixel(rendered.data, 100, 1240)
    expect(edgeTop[0]).toBeGreaterThan(edgeTop[2]! + 40)
    expect(edgeBottom[2]).toBeGreaterThan(edgeBottom[0]! + 40)

    // And darker than the photo itself.
    expect(brightness(edgeTop)).toBeLessThan(brightness(topOfPhoto) - 20)
  })

  it('blurs the backdrop: hard edges in the photo are soft ramps behind it', async () => {
    // Eight bands, white and black in turn. The backdrop is this stretched to 2560 wide, so its edges are 320 px apart.
    const stripes = await banded(640, 900, Array.from({ length: 8 }, (_, i) => i % 2 === 0 ? '#ffffff' : '#000000'))
    const rendered = await renderPhoto(stripes)

    // Along the left side, outside the photo, which starts at 768.
    const values: number[] = []
    const { data, info } = await sharp(rendered.data).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    for (let x = 0; x < 760; x += 10) {
      const at = (720 * info.width + x) * info.channels
      values.push(brightness([data[at]!, data[at + 1]!, data[at + 2]!]))
    }
    const top = Math.max(...values)
    const middling = values.filter(value => value > top * 0.25 && value < top * 0.75)

    expect(top).toBeGreaterThan(100)
    expect(Math.min(...values)).toBeLessThan(40)
    // A hard edge has none of these; a 60-pixel blur has a dozen.
    expect(middling.length).toBeGreaterThanOrEqual(5)
    // Darkened: white at 60%.
    expect(top).toBeLessThan(180)
  })

  it('turns a photo upright by its EXIF orientation before judging its shape', async () => {
    // Stored 400×200 with orientation 6 (turn a quarter clockwise): upright it is 200×400, with the left band on top.
    const stored = await banded(400, 200, ['#ff0000', '#0000ff'], { orientation: 6 })
    const rendered = await renderPhoto(stored)

    expect(rendered).toMatchObject({ width: 200, height: 400, orientation: 'portrait' })
    const top = await pixel(rendered.data, 1280, 300)
    const bottom = await pixel(rendered.data, 1280, 1140)
    expect(top[0]).toBeGreaterThan(top[2]! + 100)
    expect(bottom[2]).toBeGreaterThan(bottom[0]! + 100)
  })

  it('draws a transparent PNG on black rather than leaving a hole', async () => {
    const png = await sharp({ create: { width: 1600, height: 900, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).png().toBuffer()
    const rendered = await renderPhoto(png)

    expect(brightness(await pixel(rendered.data, 100, 100))).toBeLessThan(10)
  })

  it('reads the formats a photo folder holds', async () => {
    const base = sharp({ create: { width: 320, height: 180, channels: 3, background: '#40a060' } })
    for (const encoded of [await base.clone().png().toBuffer(), await base.clone().webp().toBuffer(), await base.clone().tiff().toBuffer(), await base.clone().gif().toBuffer()]) {
      expect(await sharp((await renderPhoto(encoded)).data).metadata()).toMatchObject({ width: 2560, height: 1440 })
    }
  })

  it('refuses bytes that are not a picture, with a message that names nothing', async () => {
    await expect(renderPhoto(Buffer.from('not an image'))).rejects.toThrow(PhotoRenderError)
    await expect(renderPhoto(Buffer.alloc(0))).rejects.toThrow(/can't be read/)
  })
})

describe('renderPhoto in the portrait rendition', () => {
  it('crops a 9:16 photo to fill 1440×2560', async () => {
    const rendered = await renderPhoto(await banded(900, 1600, ['#c03030']), 'portrait')

    expect(await sharp(rendered.data).metadata()).toMatchObject({ format: 'webp', width: 1440, height: 2560 })
    expect(rendered).toMatchObject({ width: 900, height: 1600, orientation: 'portrait' })
    const [r, g, b] = await pixel(rendered.data, 2, 2)
    expect(r).toBeGreaterThan(150)
    expect(g).toBeLessThan(80)
    expect(b).toBeLessThan(80)
  })

  it('judges the fit against the shape asked for', () => {
    expect(fillsScreen(900, 1600, 'portrait')).toBe(true)
    expect(fillsScreen(1600, 900, 'portrait')).toBe(false)
    expect(fillsScreen(1000, 1700, 'portrait')).toBe(true) // 9:15.3, 4.4% off
    expect(fillsScreen(1000, 1500, 'portrait')).toBe(false) // 2:3, 15.6% off
    expect(fillsScreen(900, 1600)).toBe(false)
    expect(fillsScreen(1000, 1000, 'portrait')).toBe(false)
  })

  it('fits a landscape photo whole over a blurred copy, with the backdrop above and below', async () => {
    // Red above blue. The backdrop is cropped to the stage's shape, so only the height of the photo survives in it.
    const landscape = await banded(1500, 1000, ['#ff0000', '#0000ff'], { vertical: true })
    const rendered = await renderPhoto(landscape, 'portrait')

    expect(await sharp(rendered.data).metadata()).toMatchObject({ format: 'webp', width: 1440, height: 2560 })
    expect(rendered).toMatchObject({ width: 1500, height: 1000, orientation: 'landscape' })

    // The photo is 1440 × 960 in the middle (y 800 to 1760), at its own colours.
    const photoTop = await pixel(rendered.data, 720, 1000)
    const photoBottom = await pixel(rendered.data, 720, 1560)
    expect(photoTop[0]).toBeGreaterThan(200)
    expect(photoTop[2]).toBeLessThan(60)
    expect(photoBottom[2]).toBeGreaterThan(200)
    // Above and below it is the backdrop, which carries the same colours, but darker.
    const above = await pixel(rendered.data, 720, 200)
    const below = await pixel(rendered.data, 720, 2360)
    expect(above[0]).toBeGreaterThan(above[2]! + 40)
    expect(below[2]).toBeGreaterThan(below[0]! + 40)
    expect(brightness(above)).toBeLessThan(brightness(photoTop) - 20)
  })

  it('renders to the landscape size when no rendition is named', async () => {
    const rendered = await renderPhoto(await banded(900, 1600, ['#c03030']))
    expect(await sharp(rendered.data).metadata()).toMatchObject({ width: 2560, height: 1440 })
  })
})

describe('renderPhoto in the cover rendition', () => {
  it('is the whole photo scaled to just cover the stage of its own orientation: no backdrop, no crop', async () => {
    // 4:3 landscape, left half red and right half blue, larger than the stage.
    const rendered = await renderPhoto(await banded(3200, 2400, ['#c03030', '#3030c0']), 'cover')

    expect(await sharp(rendered.data).metadata()).toMatchObject({ format: 'webp', width: 2560, height: 1920 })
    expect(rendered).toMatchObject({ width: 3200, height: 2400, orientation: 'landscape' })
    // Every corner is the photo itself: nothing blurred or darkened at an edge.
    const left = await pixel(rendered.data, 2, 2)
    const right = await pixel(rendered.data, 2557, 1917)
    expect(left[0]).toBeGreaterThan(160)
    expect(left[2]).toBeLessThan(80)
    expect(right[2]).toBeGreaterThan(160)
    expect(right[0]).toBeLessThan(80)
  })

  it('covers the portrait stage for a portrait photo, and an upright one that was stored sideways', async () => {
    const portrait = await renderPhoto(await banded(2160, 2880, ['#c03030'], { vertical: true }), 'cover')
    expect(await sharp(portrait.data).metadata()).toMatchObject({ width: 1920, height: 2560 })
    expect(portrait.orientation).toBe('portrait')

    const turned = await renderPhoto(await banded(3200, 2400, ['#c03030'], { orientation: 6 }), 'cover')
    expect(await sharp(turned.data).metadata()).toMatchObject({ width: 1920, height: 2560 })
    expect(turned).toMatchObject({ width: 2400, height: 3200, orientation: 'portrait' })
  })

  it('does not enlarge a small photo', async () => {
    const rendered = await renderPhoto(await banded(640, 480, ['#c03030']), 'cover')
    expect(await sharp(rendered.data).metadata()).toMatchObject({ width: 640, height: 480 })
  })
})

describe('uprightSize', () => {
  it('swaps the sides for the quarter turns only', () => {
    expect(uprightSize(400, 200, undefined)).toEqual({ width: 400, height: 200 })
    for (const orientation of [1, 2, 3, 4]) expect(uprightSize(400, 200, orientation)).toEqual({ width: 400, height: 200 })
    for (const orientation of [5, 6, 7, 8]) expect(uprightSize(400, 200, orientation)).toEqual({ width: 200, height: 400 })
  })
})
