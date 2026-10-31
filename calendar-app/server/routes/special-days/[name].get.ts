import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ART_FILE_NAME } from '../../special-days/files'

// Serves a stored art file at /special-days/<hash>.<webp|svg>. It is outside
// /api, so the PIN doesn't ask for it: the displays load it as a plain image.
// Only a name of the right shape is ever looked up, so no path gets in. The
// name is a hash of the contents, so the file never changes and can be cached
// for good. An SVG is also locked down, in case it is opened on its own.
export default defineEventHandler((event) => {
  const name = getRouterParam(event, 'name') ?? ''
  if (!ART_FILE_NAME.test(name)) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'No such art' })

  let data: Buffer
  try {
    data = readFileSync(join(useSpecialDayArtDir(), name))
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'No such art' })
  }

  const svg = name.endsWith('.svg')
  setResponseHeaders(event, {
    'Content-Type': svg ? 'image/svg+xml' : 'image/webp',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    ...(svg ? { 'Content-Security-Policy': 'default-src \'none\'; style-src \'unsafe-inline\'' } : {}),
  })
  return data
})
