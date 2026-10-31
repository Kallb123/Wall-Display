import { z } from 'zod'
import { PHOTO_SOURCES } from './display'

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
})
export type PhotoInfo = z.infer<typeof photoInfoSchema>

/** What `GET /api/photos/next` answers: null when there is nothing to show. */
export const photoResponseSchema = z.strictObject({ photo: photoInfoSchema.nullable() })
export type PhotoResponse = z.infer<typeof photoResponseSchema>

/** Where a rendered photo (a `<sha256>.webp` name) is served from. */
export function photoUrl(name: string): string {
  return `/photos/${name}`
}
