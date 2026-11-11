import { findStarterScene } from '../../../../shared/starter-scenes'

// Serves a starter scene's tile art at /special-days/starters/<id>.svg, for
// the picker on the settings page. It is the bundled original, which the unit
// tests hold to the upload checks; adding the starter stores its own copy.
// Locked down like a stored SVG. It can change with an update of the app, so
// it is cached for an hour rather than for good.
export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name') ?? ''
  const starter = name.endsWith('.svg') ? findStarterScene(name.slice(0, -'.svg'.length)) : undefined
  const data = starter && await readServerAsset(`starter-scenes/${starter.id}/tile.svg`)
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'No such starter scene' })

  setResponseHeaders(event, {
    'Content-Type': 'image/svg+xml',
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'default-src \'none\'; style-src \'unsafe-inline\'',
  })
  return data
})
