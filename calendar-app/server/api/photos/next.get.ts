import { boxQuery, renditionQuery } from '../../../shared/photos'
import type { PhotoResponse } from '../../../shared/photos'

// Moves a display on to its next photo and answers it (architecture §5.1):
// `{ photo: { id, url, width, height, orientation, taken_at, provider }, interval_seconds }`, or
// `{ photo: null }` when there is nothing to show (no photos block, an empty
// pool, or a provider that is down with nothing cached; there is no interval then
// either). `interval_seconds` is the interval in force now, read from the
// settings, which follow the settings page, so the frame can pace its slow drift
// to the time the photo will be on show. The image is loaded
// from `url`, rendered for the shape of the display's stage:
// `?orientation=landscape|portrait`, landscape if it is left out (an older page
// or a cached app shell doesn't send it). `?width=&height=` say the size of the box
// the photo is drawn in, which for a pane is the pane's own and not the stage's;
// a photo close to that shape is sent as the plain photo to be cropped to the
// box, not as a composite over a backdrop (render.ts, `coversBox`). Without them
// the answer is as it always was. A GET that changes something, like the playlist's position,
// because the display calls it on its own; the PIN guards the commands that
// make it happen from outside.
export default defineEventHandler(async (event): Promise<PhotoResponse> => {
  const { display, orientation, width, height } = getQuery(event)
  if (typeof display !== 'string' || display === '') {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'display is required' })
  }
  const rendition = orientation === undefined ? 'landscape' : renditionQuery(orientation)
  if (!rendition) throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'orientation must be landscape or portrait' })
  const box = boxQuery(width, height)
  if (box === null) throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'width and height must be given together, as whole numbers of pixels' })
  const control = useDisplayControl()
  if (!control.hasDisplay(display)) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown display "${display}"` })

  // Never cached: every request is a new photo.
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const photos = usePhotos()
  if (!photos) return { photo: null }
  const photo = await photos.next(display, control.getState(display).photo_source, rendition, box)
  return { photo, interval_seconds: useSettings().config().photos?.interval_seconds }
})
