import type { PhotoResponse } from '../../../shared/photos'

// Moves a display on to its next photo and answers it (architecture §5.1):
// `{ photo: { id, url, width, height, orientation, taken_at, provider } }`, or
// `{ photo: null }` when there is nothing to show (no photos block, an empty
// pool, or a provider that is down with nothing cached). The image is loaded
// from `url`. A GET that changes something, like the playlist's position,
// because the display calls it on its own; the PIN guards the commands that
// make it happen from outside.
export default defineEventHandler(async (event): Promise<PhotoResponse> => {
  const { display } = getQuery(event)
  if (typeof display !== 'string' || display === '') {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'display is required' })
  }
  const control = useDisplayControl()
  if (!control.hasDisplay(display)) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown display "${display}"` })

  // Never cached: every request is a new photo.
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const photos = usePhotos()
  if (!photos) return { photo: null }
  return { photo: await photos.next(display, control.getState(display).photo_source) }
})
