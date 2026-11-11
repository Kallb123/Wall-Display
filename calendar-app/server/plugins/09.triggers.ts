import { createTriggerRunner, subscriptionsFor } from '../triggers/service'
import { createHaTriggerSocket } from '../triggers/socket'
import { getTriggerSocket, setTriggerSocket } from '../triggers/state'

// Runs after the alarm plugin (the 09 prefix), once the display control is up.
// With `triggers` in the config it keeps a WebSocket open to Home Assistant and
// subscribes to each one, and when one fires (a doorbell ringing, say) it
// applies that trigger's actions, such as showing a camera, to its displays.
// It never waits for Home Assistant, so one that is down doesn't delay the boot,
// and without triggers it does nothing.
export default defineNitroPlugin((nitroApp) => {
  // A hot reload runs this again in the same process, so close the old connection first.
  getTriggerSocket()?.stop()
  setTriggerSocket(undefined)

  const { triggers, homeassistant, displays } = useConfig()
  // The config check makes sure there is a homeassistant block whenever there are triggers.
  if (triggers.length === 0 || !homeassistant) {
    console.info('[triggers] off: no triggers in the config')
    return
  }

  const runner = createTriggerRunner({ triggers, displays: displays.map(display => display.id), control: useDisplayControl() })
  const socket = createHaTriggerSocket({
    homeassistant,
    subscriptions: subscriptionsFor(triggers),
    onTrigger: id => runner.fire(id),
  })
  setTriggerSocket(socket)
  socket.start()

  nitroApp.hooks.hook('close', () => {
    socket.stop()
    if (getTriggerSocket() === socket) setTriggerSocket(undefined)
  })
})
