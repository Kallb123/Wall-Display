import { z } from 'zod'
import { PHOTO_SOURCES } from './display'
import type { PhotoSource } from './display'

// The photo the server hands a display (PR 4.1, architecture §5): where to load
// the image from and what shape it is. The image itself is already rendered to
// the display's size, so the display only draws it. Pure: no I/O, and no
// imports from server/. The wire format is snake_case, like the state.

export const photoInfoSchema = z.strictObject({
  /** `<provider>:<provider asset id>`. */
  id: z.string().min(1),
  /** Where the rendered image is served from, see `photoUrl()`. */
  url: z.string().min(1),
  /** The size of the original, after turning it upright, not of the rendered image. */
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  orientation: z.enum(['landscape', 'portrait']),
  /** When it was taken, as an ISO 8601 instant, if the provider knows. */
  taken_at: z.string().nullable(),
  provider: z.enum(PHOTO_SOURCES),
  /**
   * Who to credit on the frame, as it is to be shown ("Photo by Jane Doe on
   * Unsplash"), when the source asks for that; null or left out otherwise.
   */
  credit: z.string().nullable().optional(),
})
export type PhotoInfo = z.infer<typeof photoInfoSchema>

/**
 * What `GET /api/photos/next` answers: null when there is nothing to show. The
 * `interval_seconds` is how long the server leaves a photo on show, as set now
 * (the settings page can change it), so the frame can pace its slow drift to
 * it. Optional, so an answer from before it was added still parses.
 */
export const photoResponseSchema = z.strictObject({
  photo: photoInfoSchema.nullable(),
  interval_seconds: z.number().positive().optional(),
})
export type PhotoResponse = z.infer<typeof photoResponseSchema>

/** What each photo source is called on the settings page, the layout editor and in a feed's place when it has no name. */
export const PHOTO_SOURCE_NAMES: Record<PhotoSource, string> = {
  immich: 'Immich',
  google: 'Google Photos',
  local: 'Local folder',
  unsplash: 'Unsplash',
}

export { MAX_PHOTO_FEED_ID, photoFeedIdSchema } from './display'

/** Where a rendered photo (a `<sha256>.webp` name) is served from. */
export function photoUrl(name: string): string {
  return `/photos/${name}`
}

/** The two shapes of stage a photo is composed for: the landscape stage (2560×1440) and the portrait one (1440×2560). */
export const PHOTO_STAGE_RENDITIONS = ['landscape', 'portrait'] as const
export type StageRendition = (typeof PHOTO_STAGE_RENDITIONS)[number]

/**
 * What the cache keeps a file of per photo: a composite for each shape of stage
 * (the photo fitted whole over a blurred backdrop, or cropped when it is close to
 * that shape), and `cover`, the plain upright photo with nothing added, for a
 * photo whose shape is close to that of the box it is drawn in (`coversBox`).
 */
export const PHOTO_RENDITIONS = [...PHOTO_STAGE_RENDITIONS, 'cover'] as const
export type PhotoRendition = (typeof PHOTO_RENDITIONS)[number]

/** The pixel size of a stage rendition, the same as the stage it is drawn on. */
export function photoRenditionSize(rendition: StageRendition): { width: number, height: number } {
  return rendition === 'portrait' ? { width: 1440, height: 2560 } : { width: 2560, height: 1440 }
}

/**
 * `?orientation=` of `GET /api/photos/next`: a stage rendition, or null for none
 * or not one (the first value if it is repeated).
 */
export function renditionQuery(value: unknown): StageRendition | null {
  const first = Array.isArray(value) ? value[0] : value
  return PHOTO_STAGE_RENDITIONS.find(r => r === first) ?? null
}

/** A size in pixels, of a photo or of the box it is drawn in. */
export interface PhotoBox {
  width: number
  height: number
}

/**
 * How far apart in shape (the larger aspect ratio over the smaller) a photo and
 * the box it is drawn in may be for the photo to cover the box. It has to be a
 * little over 4:3 against 16:9 (16/12 = 1.333…, in either direction) because
 * phones take 4:3 photos and must fill a 16:9 view; 3:2 (1.185) and 2:1 (1.125)
 * are well inside it. 1.35 stops short of what is really a different shape: a
 * 1:1 photo in a 16:9 box (1.78), or a panorama, are fitted whole instead.
 */
export const COVER_MAX_RATIO = 1.35

/**
 * Whether a photo is close enough in shape to the box it is drawn in to cover
 * the box (cropped a little at two edges) rather than be contained (fitted whole
 * over a backdrop). It is the shape of the box itself that counts, not of the
 * stage: the photo pane can be landscape within a portrait stage. The test is
 * symmetric, so a 16:9 photo covers a 4:3 box as a 4:3 photo covers a 16:9 one,
 * and a portrait photo in a landscape box is never close. A size that is not
 * known (0) never covers.
 */
export function coversBox(photo: PhotoBox, box: PhotoBox): boolean {
  if (!(photo.width > 0 && photo.height > 0 && box.width > 0 && box.height > 0)) return false
  const a = photo.width / photo.height
  const b = box.width / box.height
  return Math.max(a, b) / Math.min(a, b) <= COVER_MAX_RATIO
}

/**
 * `?width=` and `?height=` of `GET /api/photos/next`, the size of the box the
 * photo is drawn in: undefined if neither is given (an older page), null if
 * either is missing or not a positive whole number of at most five digits,
 * otherwise the box. Only the shape of it is used.
 */
export function boxQuery(width: unknown, height: unknown): PhotoBox | null | undefined {
  if (width === undefined && height === undefined) return undefined
  const number = (value: unknown): number | null => {
    const first = Array.isArray(value) ? value[0] : value
    return typeof first === 'string' && /^[1-9]\d{0,4}$/.test(first) ? Number(first) : null
  }
  const w = number(width)
  const h = number(height)
  return w === null || h === null ? null : { width: w, height: h }
}
