// The web app manifest that makes "Install" and "Add to Home Screen" work for
// `/display`, so a phone, tablet or laptop can show the wall as an app. Like the
// remote's (`remote.webmanifest.get.ts`) it is per display (`?id=hallway`, the
// first display if left out), named after the display and opening that display.
// Its scope is `/display`, so it never clashes with the remote's `/remote`.
// Public: it reads only the name and the theme, no PIN or other secret.
export default defineEventHandler((event) => {
  // The config in force, with the settings page's changes on top, so the colours follow the theme chosen there.
  const displays = useSettings().config().displays
  const { id } = getQuery(event)
  const display = typeof id === 'string' ? displays.find(candidate => candidate.id === id) : displays[0]
  if (!display) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown display "${String(id)}"` })

  // The theme's `bg` (app/utils/themes.ts, from app/assets/tokens.css): the cream, or the warm charcoal. The splash screen and the status bar match the wall.
  const background = display.theme === 'dark' ? '#2e2b25' : '#f5ead8'
  const address = `/display?id=${encodeURIComponent(display.id)}`
  const manifest = {
    name: `${display.name} wall`,
    short_name: `${display.name} wall`,
    id: address,
    start_url: address,
    scope: '/display',
    // iOS ignores `fullscreen` and opens standalone; everything else that supports it goes fullscreen.
    display: 'fullscreen',
    display_override: ['fullscreen', 'standalone'],
    orientation: 'any',
    background_color: background,
    theme_color: background,
    icons: [
      { src: '/icons/display-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/display-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/display-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }

  setResponseHeader(event, 'content-type', 'application/manifest+json')
  return JSON.stringify(manifest)
})
