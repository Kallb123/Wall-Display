import { createLocalProvider } from '../photos/local'
import { createPhotoService } from '../photos/service'
import { getPhotos, setPhotos } from '../photos/state'
import type { PhotoProvider } from '../photos/types'

// Runs after the special days plugin (the 07 prefix). With a `photos` block in
// the config it lists each provider's photos in the background, so a slow or
// missing source never delays the boot, and keeps the cache of rendered photos
// that `GET /api/photos/next` hands out. Without the block it does nothing and
// the photo frame has nothing to show.
export default defineNitroPlugin((nitroApp) => {
  // A hot reload runs this again in the same process, so stop the old service first.
  getPhotos()?.stop()
  setPhotos(undefined)

  const { photos } = useConfig()
  if (!photos) {
    console.info('[photos] off: no photos block in the config')
    return
  }

  const providers: PhotoProvider[] = []
  if (photos.local) providers.push(createLocalProvider({ path: photos.local.path }))
  // Not built yet: PRs 4.3 and 4.4.
  for (const id of ['immich', 'google'] as const) {
    if (photos[id]) console.warn(`[photos] ${id} is set up in the config, but is not supported yet and is ignored`)
  }
  if (providers.length === 0) console.warn('[photos] no photo source is available, so the photo frame has nothing to show')

  const service = createPhotoService({
    db: useDb(),
    dir: usePhotoDir(),
    providers,
    maxBytes: photos.cache_max_mb * 1024 * 1024,
    landscapeOnly: photos.landscape_only,
    // Loaded when the first photo is rendered, so sharp isn't read at boot.
    render: async input => (await import('../photos/render')).renderPhoto(input),
  })
  setPhotos(service)
  service.start()

  nitroApp.hooks.hook('close', () => {
    service.stop()
    if (getPhotos() === service) setPhotos(undefined)
  })
})
