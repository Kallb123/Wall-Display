import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PHOTO_FILE_NAME } from '../../photos/cache'

// Serves a rendered photo at /photos/<sha256>.webp, the `url` that
// /api/photos/next gives. It is outside /api, so the PIN doesn't ask for it: the
// displays load it as a plain image. Only a name of the right shape is ever
// looked up, so no path gets in. The name is a hash of the contents, so the file
// never changes and can be cached for good.
export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name') ?? ''
  if (!PHOTO_FILE_NAME.test(name)) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'No such photo' })

  let data: Buffer
  try {
    data = await readFile(join(usePhotoDir(), name))
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'No such photo' })
  }

  setResponseHeaders(event, {
    'Content-Type': 'image/webp',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  })
  return data
})
