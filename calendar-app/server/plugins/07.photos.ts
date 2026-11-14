import { getDisplayControl } from '../control/state'
import { createImmichProvider } from '../photos/immich'
import { photoFeedsOf } from '../photos/feeds'
import { createLocalProvider } from '../photos/local'
import { startPhotoRotation } from '../photos/rotation'
import { createPhotoService } from '../photos/service'
import { getPhotoRotation, getPhotos, setPhotoRotation, setPhotos } from '../photos/state'
import { createUnsplashProvider } from '../photos/unsplash'
import type { PhotoProvider } from '../photos/types'

// Runs after the special days plugin (the 07 prefix). With a `photos` block in
// the config it lists each provider's photos in the background, so a slow or
// missing source never delays the boot, and keeps the cache of rendered photos
// that `GET /api/photos/next` hands out, and runs the rotation: while a display
// is on the photo view, a timer tells it to move on every `interval_seconds`.
// The interval follows the settings page: a saved change restarts the running
// timers with the new one. Without the block it does nothing and the photo frame has nothing to show.
/** What an Unsplash feed asks for, for the log: never the key. */
const unsplashSummary = (settings: { query?: string | undefined, collections?: string[] | undefined, topics?: string[] | undefined }): string =>
  settings.collections ? `collections ${settings.collections.join(', ')}` : settings.topics ? `topics ${settings.topics.join(', ')}` : `search "${settings.query}"`

export default defineNitroPlugin((nitroApp) => {
  // A hot reload runs this again in the same process, so stop the old service first.
  getPhotos()?.stop()
  setPhotos(undefined)
  getPhotoRotation()?.stop()
  setPhotoRotation(undefined)

  const settings = useSettings()
  const { photos } = settings.config()
  if (!photos) {
    console.info('[photos] off: no photos block in the config')
    return
  }

  // One provider for each feed: the sources set up at the top level, and then
  // each of `photos.feeds`, which share their source's key or address.
  const providers: PhotoProvider[] = []
  for (const feed of photoFeedsOf(photos)) {
    if (feed.source === 'immich') {
      providers.push(createImmichProvider(feed.settings, { id: feed.id, name: feed.name }))
      console.info(`[photos] ${feed.id}: immich, mode ${feed.settings.mode}`)
    } else if (feed.source === 'unsplash') {
      providers.push(createUnsplashProvider(feed.settings, { id: feed.id, name: feed.name }))
      console.info(`[photos] ${feed.id}: unsplash, ${unsplashSummary(feed.settings)}, ${feed.settings.count} photos, ${feed.settings.pick} pick, listed every ${feed.settings.refresh_minutes} min`)
    } else {
      providers.push(createLocalProvider({ id: feed.id, name: feed.name, path: feed.settings.path }))
    }
  }
  // Not built yet: PR 4.4 was skipped.
  if (photos.google) console.warn('[photos] google is set up in the config, but is not supported yet and is ignored')
  if (providers.length === 0) console.warn('[photos] no photo source is available, so the photo frame has nothing to show')

  const service = createPhotoService({
    db: useDb(),
    dir: usePhotoDir(),
    providers,
    maxBytes: photos.cache_max_mb * 1024 * 1024,
    // `landscape_only` is the older name of the same switch.
    matchOrientation: photos.match_orientation || photos.landscape_only,
    // Loaded when the first photo is rendered, so sharp isn't read at boot.
    render: async (input, rendition) => (await import('../photos/render')).renderPhoto(input, rendition),
  })
  setPhotos(service)
  service.start()

  // The control plugin (03) has started by now. The timers read each display's view from it.
  const control = getDisplayControl()
  const rotation = control
    ? startPhotoRotation({
        bus: useEventBus(),
        displayIds: settings.config().displays.map(display => display.id),
        getState: displayId => control.getState(displayId),
        // The layouts plugin (02) starts before this one.
        layouts: () => useLayouts().summaries(),
        intervalSeconds: photos.interval_seconds,
      })
    : undefined
  setPhotoRotation(rotation)
  // `photos` is not editable as a block, so it is still there; only the interval can change.
  const unsubscribe = useEventBus().on('settings.updated', ({ shared }) => {
    const interval = settings.config().photos?.interval_seconds
    if (shared && interval !== undefined) rotation?.setIntervalSeconds(interval)
  })

  nitroApp.hooks.hook('close', () => {
    unsubscribe()
    service.stop()
    if (getPhotos() === service) setPhotos(undefined)
    rotation?.stop()
    if (getPhotoRotation() === rotation) setPhotoRotation(undefined)
  })
})
