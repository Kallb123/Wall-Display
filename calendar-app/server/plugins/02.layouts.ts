import { createLayoutsService } from '../layouts/service'
import { setLayouts } from '../layouts/state'
import { listLayouts } from '../layouts/store'
import { getSocketHub } from '../ws/hub'

// Runs right after the database opens (the 02 prefix), so the control service
// and MQTT, which start after it, can read the layouts as they start. After
// every write the routes call `changed()`, and each change goes to the
// displays and remotes over the WebSocket hub and, through the bus, to the
// control service and MQTT.
export default defineNitroPlugin((nitroApp) => {
  setLayouts(undefined)

  const bus = useEventBus()
  const service = createLayoutsService({
    load: () => listLayouts(useDb()),
    onChange: layouts => bus.emit('layouts.updated', { layouts }),
  })
  setLayouts(service)

  const unsubscribe = bus.on('layouts.updated', ({ layouts }) => {
    getSocketHub().sendToAll({ type: 'layouts.updated', layouts })
  })
  service.start()
  console.info(`[layouts] ${service.get().length} custom ${service.get().length === 1 ? 'layout' : 'layouts'}`)

  nitroApp.hooks.hook('close', () => {
    unsubscribe()
    setLayouts(undefined)
  })
})
