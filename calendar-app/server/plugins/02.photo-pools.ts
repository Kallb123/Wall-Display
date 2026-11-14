import { createPhotoPoolsService } from '../photoPools/service'
import { setPhotoPools } from '../photoPools/state'
import { listPhotoPools } from '../photoPools/store'

// Runs right after the database opens (the 02 prefix), so the photo engine and
// the layout check, which start after it, can read the pools as they start.
// After every write the routes call `changed()`, and each change goes out on
// the bus as `photo_pools.updated` for the photo engine to rebuild from.
export default defineNitroPlugin((nitroApp) => {
  setPhotoPools(undefined)

  const bus = useEventBus()
  const service = createPhotoPoolsService({
    load: () => listPhotoPools(useDb()),
    onChange: pools => bus.emit('photo_pools.updated', { pools }),
  })
  setPhotoPools(service)
  service.start()
  console.info(`[photo pools] ${service.get().length} ${service.get().length === 1 ? 'pool' : 'pools'}`)

  nitroApp.hooks.hook('close', () => {
    setPhotoPools(undefined)
  })
})
