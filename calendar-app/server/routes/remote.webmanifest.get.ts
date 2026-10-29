// The web app manifest that makes "Add to Home Screen" work for `/remote`.
// It is per display (`?id=hallway`, the first display if left out), so each
// shortcut is named after its display and opens the remote for it. Public: the
// name is the only config it reads, and no PIN or other secret.
export default defineEventHandler((event) => {
  const displays = useConfig().displays
  const { id } = getQuery(event)
  const display = typeof id === 'string' ? displays.find(candidate => candidate.id === id) : displays[0]
  if (!display) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown display "${String(id)}"` })

  // The Organic cream, `--color-bg` in app/assets/tokens.css.
  const cream = '#f5ead8'
  const manifest = {
    name: `${display.name} remote`,
    short_name: display.name,
    id: `/remote?id=${encodeURIComponent(display.id)}`,
    start_url: `/remote?id=${encodeURIComponent(display.id)}`,
    scope: '/remote',
    display: 'standalone',
    background_color: cream,
    theme_color: cream,
    icons: [
      { src: '/icons/remote-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/remote-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/remote-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }

  setResponseHeader(event, 'content-type', 'application/manifest+json')
  return JSON.stringify(manifest)
})
