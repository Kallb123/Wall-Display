import { createAlarmService } from '../alarm/service'
import { getAlarm, setAlarm } from '../alarm/state'
import { fetchHaAlarm } from '../alarm/fetch'
import { getSocketHub } from '../ws/hub'

// Runs after the photos plugin (the 08 prefix). With an `alarm` block in
// the config it polls that Home Assistant entity in the background, so a slow
// or broken Home Assistant never delays the boot, and sends every change to the
// displays over the WebSocket hub. Without the block it does nothing, and a
// night view that asks for the next alarm shows none.
export default defineNitroPlugin((nitroApp) => {
  // A hot reload runs this again in the same process, so stop the old service first.
  getAlarm()?.stop()
  setAlarm(undefined)

  const { alarm, homeassistant } = useConfig()
  // The config check makes sure there is a homeassistant block whenever there is an alarm one.
  if (!alarm || !homeassistant) {
    console.info('[alarm] off: no alarm block in the config')
    return
  }

  const bus = useEventBus()
  const service = createAlarmService({
    load: () => fetchHaAlarm(homeassistant, alarm.entity_id),
    intervalMs: alarm.poll_seconds * 1000,
    onChange: next => bus.emit('alarm.updated', { alarm: next }),
  })
  setAlarm(service)

  const unsubscribe = bus.on('alarm.updated', ({ alarm: next }) => {
    getSocketHub().sendToAll({ type: 'alarm.updated', alarm: next })
  })
  service.start()

  nitroApp.hooks.hook('close', () => {
    unsubscribe()
    service.stop()
    if (getAlarm() === service) setAlarm(undefined)
  })
})
