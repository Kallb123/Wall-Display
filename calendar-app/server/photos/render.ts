import type { PhotoOrientation } from '../db/schema'
import { loadSharp } from './sharp'

// Turns a photo into the one image the display draws (architecture §5.1), so the
// Pi never has to scale or blur anything. A photo close to 16:9 is cropped to
// fill the screen. Any other shape is fitted whole, centred over a blurred,
// enlarged, slightly darkened copy of itself. Either way the result is a
// 2560×1440 WebP. Free of h3, so it can be tested alone.

/** The size every photo is rendered to, the same stage as the display's. */
export const PHOTO_SIZE = { width: 2560, height: 1440 } as const

const TARGET_RATIO = PHOTO_SIZE.width / PHOTO_SIZE.height

/** How far from 16:9 a photo may be and still be cropped to fill (10%): a little is lost at the edges, which beats bars. */
const COVER_TOLERANCE = 0.1

/** The blurred background is drawn this small and enlarged, which is both faster and smoother than blurring at full size. */
const BACKDROP_WIDTH = 256
const BACKDROP_BLUR = 6
const BACKDROP_BRIGHTNESS = 0.6

const WEBP_QUALITY = 82

export interface RenderedPhoto {
  /** The WebP image. */
  data: Buffer
  /** The size of the original once turned upright, which is what its shape is judged by. */
  width: number
  height: number
  orientation: PhotoOrientation
}

/** A photo the image library can't read, or can't draw. */
export class PhotoRenderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PhotoRenderError'
  }
}

/** The size once EXIF orientations 5 to 8 (which turn the picture a quarter) are applied. */
export function uprightSize(width: number, height: number, exifOrientation: number | undefined): { width: number, height: number } {
  return exifOrientation !== undefined && exifOrientation >= 5 ? { width: height, height: width } : { width, height }
}

/** Whether a photo of this size is cropped to fill the screen rather than fitted over a backdrop. */
export function fillsScreen(width: number, height: number): boolean {
  return Math.abs(width / height / TARGET_RATIO - 1) <= COVER_TOLERANCE
}

/**
 * Renders the bytes of a photo. Throws a `PhotoRenderError` if they aren't an
 * image sharp can read. Only the first frame of an animated image is used, and
 * a transparent image is drawn on black (cropped) or over its backdrop (fitted).
 */
export async function renderPhoto(input: Buffer): Promise<RenderedPhoto> {
  const sharp = await loadSharp()
  const { width: W, height: H } = PHOTO_SIZE
  try {
    // `failOn: 'error'` keeps a photo that is cut off near the end, which is still a photo.
    const open = () => sharp(input, { failOn: 'error' }).rotate()
    const meta = await sharp(input, { failOn: 'error' }).metadata()
    if (!meta.width || !meta.height) throw new Error('no size')
    const { width, height } = uprightSize(meta.width, meta.height, meta.orientation)
    const orientation: PhotoOrientation = height > width ? 'portrait' : 'landscape'

    let data: Buffer
    if (fillsScreen(width, height)) {
      data = await open()
        .resize(W, H, { fit: 'cover', position: 'centre' })
        .flatten({ background: '#000000' })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer()
    } else {
      const backdrop = await open()
        .resize(BACKDROP_WIDTH, Math.round(BACKDROP_WIDTH / TARGET_RATIO), { fit: 'cover', position: 'centre' })
        .flatten({ background: '#000000' })
        .blur(BACKDROP_BLUR)
        .png()
        .toBuffer()
      const photo = await open()
        .resize(W, H, { fit: 'inside' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      data = await sharp(backdrop)
        .resize(W, H, { fit: 'fill', kernel: 'cubic' })
        .modulate({ brightness: BACKDROP_BRIGHTNESS })
        .composite([{ input: photo.data, raw: { width: photo.info.width, height: photo.info.height, channels: 4 }, gravity: 'centre' }])
        .webp({ quality: WEBP_QUALITY })
        .toBuffer()
    }
    return { data, width, height, orientation }
  } catch (error) {
    // The library's message can hold a file name; ours is the same for every photo.
    if (error instanceof PhotoRenderError) throw error
    throw new PhotoRenderError('The photo can\'t be read, it may be damaged or not an image')
  }
}
