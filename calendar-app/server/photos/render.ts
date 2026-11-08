import { photoRenditionSize } from '../../shared/photos'
import type { PhotoRendition, StageRendition } from '../../shared/photos'
import type { PhotoOrientation } from '../db/schema'
import { loadSharp } from './sharp'

// Turns a photo into the one image a display draws (architecture §5.1), so the
// Pi never has to scale or blur anything. There are two kinds of rendition:
//
// - `landscape` and `portrait` are composites for the shape of a stage:
//   2560×1440 or 1440×2560. A photo within 10% of that shape is cropped to fill
//   it, any other shape is fitted whole, centred over a blurred, enlarged,
//   slightly darkened copy of itself.
// - `cover` is for a photo whose shape is close to that of the box it is drawn
//   in (`coversBox`, decided by the caller, which knows the box): the plain
//   upright photo, scaled to just cover the stage of its own orientation, with
//   no backdrop and no crop. The page draws it with `object-fit: cover`, so it
//   is cropped centrally to whatever box it is in (the photo pane of a week
//   layout is not the shape of the stage), with no strip of backdrop at any edge.
//
// Either way the result is a WebP. Free of h3, so it can be tested alone.

/** How far from 16:9 a photo may be and still be cropped to fill a composite (10%). Older pages, which don't say the shape of their box, get only this. */
const COVER_TOLERANCE = 0.1

/** The blurred background is drawn this small along its long side and enlarged, which is both faster and smoother than blurring at full size. */
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

/** Whether a photo of this size is cropped to fill a composite of that shape rather than fitted over a backdrop. */
export function fillsScreen(width: number, height: number, rendition: StageRendition = 'landscape'): boolean {
  const target = photoRenditionSize(rendition)
  return Math.abs(width / height / (target.width / target.height) - 1) <= COVER_TOLERANCE
}

/**
 * Renders the bytes of a photo. Throws a `PhotoRenderError` if they aren't an
 * image sharp can read. Only the first frame of an animated image is used, and
 * a transparent image is drawn on black (cropped) or over its backdrop (fitted).
 */
export async function renderPhoto(input: Buffer, rendition: PhotoRendition = 'landscape'): Promise<RenderedPhoto> {
  const sharp = await loadSharp()
  try {
    // `failOn: 'error'` keeps a photo that is cut off near the end, which is still a photo.
    const open = () => sharp(input, { failOn: 'error' }).rotate()
    const meta = await sharp(input, { failOn: 'error' }).metadata()
    if (!meta.width || !meta.height) throw new Error('no size')
    const { width, height } = uprightSize(meta.width, meta.height, meta.orientation)
    const orientation: PhotoOrientation = height > width ? 'portrait' : 'landscape'

    let data: Buffer
    if (rendition === 'cover') {
      // Just covers the stage of its own orientation (a 4:3 landscape photo becomes 2560×1920) and
      // is never enlarged: the page scales it, and a bigger file would only be slower to send.
      const { width: W, height: H } = photoRenditionSize(orientation)
      data = await open()
        .resize(W, H, { fit: 'outside', withoutEnlargement: true })
        .flatten({ background: '#000000' })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer()
      return { data, width, height, orientation }
    }
    const { width: W, height: H } = photoRenditionSize(rendition)
    const scale = BACKDROP_WIDTH / Math.max(W, H)
    if (fillsScreen(width, height, rendition)) {
      data = await open()
        .resize(W, H, { fit: 'cover', position: 'centre' })
        .flatten({ background: '#000000' })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer()
    } else {
      const backdrop = await open()
        .resize(Math.round(W * scale), Math.round(H * scale), { fit: 'cover', position: 'centre' })
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
