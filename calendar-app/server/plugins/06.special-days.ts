import { createSpecialDaysService } from '../special-days/service'
import { getSpecialDays, setSpecialDays } from '../special-days/state'
import { listScenes } from '../special-days/scenes'
import { listSpecialDays } from '../special-days/store'
import { getSocketHub } from '../ws/hub'

// Runs after the weather plugin (the 06 prefix). It resolves the special days
// for today and keeps them resolved: at local midnight, and after every edit
// (the routes call `refresh()`), whether it is a day or a scene that was edited. Each change goes to the displays over the
// WebSocket hub and, through the bus, to MQTT for Home Assistant's sensor.
export default defineNitroPlugin((nitroApp) => {
  // A hot reload runs this again in the same process, so stop the old service first.
  getSpecialDays()?.stop()
  setSpecialDays(undefined)

  const config = useConfig()
  const bus = useEventBus()
  const service = createSpecialDaysService({
    load: () => {
      const db = useDb()
      return { days: listSpecialDays(db), scenes: listScenes(db) }
    },
    timeZone: config.timezone,
    onChange: specialDays => bus.emit('special_days.updated', { specialDays }),
  })
  setSpecialDays(service)

  const unsubscribe = bus.on('special_days.updated', ({ specialDays }) => {
    getSocketHub().sendToAll({ type: 'special_days.updated', special_days: specialDays })
  })
  service.start()

  nitroApp.hooks.hook('close', () => {
    unsubscribe()
    service.stop()
    if (getSpecialDays() === service) setSpecialDays(undefined)
  })
})
