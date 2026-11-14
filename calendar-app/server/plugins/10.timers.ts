import type { ServerMessage } from '../../shared/display'
import { fetchHaTimerState } from '../timers/fetch'
import { createTimersService } from '../timers/service'
import { getTimers, getTimersSocket, setTimers, setTimersSocket } from '../timers/state'
import { createHaTriggerSocket } from '../triggers/socket'
import { getSocketHub } from '../ws/hub'

// Runs after the triggers plugin (the 10 prefix). With a `timers` block in the
// config it reads those Home Assistant entities in the background, so a slow or
// broken Home Assistant never delays the boot, and sends each display its
// timers whenever they change. Two things feed it: a poll of every entity, and a
// WebSocket to Home Assistant (its own connection, apart from the triggers')
// that subscribes to the entities' state changes, attributes included, which is
// where the timers are, so a timer shows up as soon as Home Assistant has it.
// Home Assistant only allows that subscription to an administrator's token; with
// another one the polling still works, just slower. Without the block it does
// nothing.
export default defineNitroPlugin((nitroApp) => {
  // A hot reload runs this again in the same process, so stop the old ones first.
  getTimers()?.stop()
  setTimers(undefined)
  getTimersSocket()?.stop()
  setTimersSocket(undefined)

  const { timers, homeassistant, displays } = useConfig()
  // The config check makes sure there is a homeassistant block whenever there is a timers one.
  if (!timers || !homeassistant) {
    console.info('[timers] off: no timers block in the config')
    return
  }

  const service = createTimersService({
    entities: timers.entities,
    displayIds: displays.map(display => display.id),
    load: entityId => fetchHaTimerState(homeassistant, entityId),
    intervalMs: timers.poll_seconds * 1000,
    doneMs: timers.done_seconds * 1000,
    onChange: (displayId, list) => {
      const message: ServerMessage = { type: 'timers.updated', display_id: displayId, timers: list }
      getSocketHub().sendToDisplay(displayId, message)
    },
  })
  setTimers(service)

  const socket = createHaTriggerSocket({
    homeassistant,
    // One subscription for every entity. A state trigger with only `entity_id` fires on attribute changes too.
    subscriptions: [{ id: 'timers', trigger: { platform: 'state', entity_id: timers.entities.map(entity => entity.entity_id) } }],
    onTrigger: (_id, variables) => {
      const trigger = (variables as { trigger?: { entity_id?: unknown, to_state?: unknown } } | null | undefined)?.trigger
      if (typeof trigger?.entity_id !== 'string') return
      service.push(trigger.entity_id, trigger.to_state ?? null)
    },
    logPrefix: '[timers]',
    refusedNote: 'timers are still read every poll_seconds, only not at once (the WebSocket needs an administrator\'s token)',
  })
  setTimersSocket(socket)

  service.start()
  socket.start()

  nitroApp.hooks.hook('close', () => {
    socket.stop()
    service.stop()
    if (getTimersSocket() === socket) setTimersSocket(undefined)
    if (getTimers() === service) setTimers(undefined)
  })
})
