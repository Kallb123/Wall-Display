import { z } from 'zod'
import { PHOTO_SOURCES } from './display'
import { PHOTO_STAGE_RENDITIONS } from './photos'

// The photo history (architecture §5.1, §7.5): which photos a display has shown
// lately, when each was on show, and what is known about it. The server writes
// an entry each time `GET /api/photos/next` hands a display a photo, and the
// remote's "Photo history" section reads them back. Pure: no I/O, and no imports
// from server/, so the page can use it too. The wire format is snake_case, like
// the state.

/**
 * What a source says about a photo beyond its size and date, as far as it
 * knows: every field is optional, and one the source doesn't know is left out
 * (or null). Kept on the photo (`photo_assets.details`) as it is listed, and
 * copied onto each history entry when the photo is shown, so the history keeps
 * it after the photo has left the pool. Plain text, never markup; no field ever
 * holds a key or an address with credentials in it.
 */
export const photoDetailsSchema = z.strictObject({
  /** A caption: Immich's description, Unsplash's description (or its alt text when it has none). */
  description: z.string().nullish(),
  /** Where it was taken, as one line ("Keswick, Cumbria, United Kingdom"). */
  location: z.string().nullish(),
  /** Who took it (Unsplash's photographer). */
  photographer: z.string().nullish(),
  /** The photographer's page (Unsplash, with the referral parameters its guidelines ask for). */
  photographer_url: z.string().nullish(),
  /** The photo's own page: on Unsplash (with the referral parameters), or in Immich's web app. */
  source_url: z.string().nullish(),
  /** The camera, as one line ("FUJIFILM X-T5"), and the lens if known. */
  camera: z.string().nullish(),
  /** The original file name (Immich), or the path inside the folder (local). */
  file_name: z.string().nullish(),
  /** The names of the people in it that Immich has recognised and named. */
  people: z.array(z.string()).optional(),
})
export type PhotoDetails = z.infer<typeof photoDetailsSchema>

/** One photo a display showed, and for how long. */
export const photoHistoryEntrySchema = z.strictObject({
  /** The entry's own id, increasing: a later entry has a larger one. */
  id: z.number().int(),
  /** The photo's id, `<feed>:<provider asset id>`, as in `PhotoInfo.id`. */
  photo_id: z.string().min(1),
  /** The feed it came from: a source's own (`immich`), a `photos.feeds` id, or a pool's id. */
  feed: z.string().min(1),
  /** The feed's name as the settings page shows it, if it is still set up. */
  feed_name: z.string().nullable(),
  provider: z.enum(PHOTO_SOURCES),
  /** The shape of stage (or pane) it was shown for. */
  rendition: z.enum(PHOTO_STAGE_RENDITIONS),
  /** When it went on show, as an ISO 8601 instant. */
  shown_at: z.string(),
  /**
   * When it came off: the next photo replaced it, the display turned its screen
   * off or moved to a view without photos, or the server restarted. Null while
   * it is still on show.
   */
  ended_at: z.string().nullable(),
  /** Where the rendered image can be loaded from while it is still in the cache, null once it isn't. */
  image_url: z.string().nullable(),
  /** The size of the original, upright; 0 when it was never known. */
  width: z.number().int().min(0),
  height: z.number().int().min(0),
  orientation: z.enum(['landscape', 'portrait']),
  /** When it was taken, as an ISO 8601 instant, if the source knows. */
  taken_at: z.string().nullable(),
  /** The credit drawn on the frame ("Photo by Jane Doe on Unsplash"), if any. */
  credit: z.string().nullable(),
  details: photoDetailsSchema,
})
export type PhotoHistoryEntry = z.infer<typeof photoHistoryEntrySchema>

/** What `GET /api/displays/:id/photo-history` answers: the newest entry first. */
export const photoHistoryResponseSchema = z.strictObject({
  entries: z.array(photoHistoryEntrySchema),
})
export type PhotoHistoryResponse = z.infer<typeof photoHistoryResponseSchema>

/** How many entries the endpoint answers when `?limit=` is left out, and the most it will. */
export const PHOTO_HISTORY_DEFAULT_LIMIT = 30
export const PHOTO_HISTORY_MAX_LIMIT = 100

/** How many entries the server keeps per display; older ones are deleted as new ones come. */
export const PHOTO_HISTORY_KEEP = 200
