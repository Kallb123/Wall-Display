import type { ServerMessage } from '../../shared/display'
import { parseSocketQuery } from '../ws/query'
import { getSocketHub } from '../ws/hub'

// The WebSocket at `/_ws?display=<id>&role=display|remote`. A new connection
// gets the display's whole state, the weather, the special days and the next
// alarm (each null when there is none yet), then every `state.updated`,
// `events.updated`, `weather.updated`, `special_days.updated` and
// `alarm.updated` (the control, weather, special days and alarm plugins
// connect the event bus to the hub).
// The display shows the state and the remote shows what the display is
// showing, so both only listen.
export default defineWebSocketHandler({
  // A bad query is refused here, before the connection is upgraded.
  upgrade(request) {
    const query = parseSocketQuery(request.url, displayId => useDisplayControl().hasDisplay(displayId))
    if (!query.ok) return new Response(query.message, { status: query.status })
  },

  open(peer) {
    const query = parseSocketQuery(peer.request.url, displayId => useDisplayControl().hasDisplay(displayId))
    if (!query.ok) {
      peer.close(1008, query.message)
      return
    }

    getSocketHub().add(peer, query)
    const message: ServerMessage = { type: 'state.updated', display_id: query.displayId, state: useDisplayControl().getState(query.displayId) }
    peer.send(JSON.stringify(message))
    const weather: ServerMessage = { type: 'weather.updated', weather: useWeather()?.get() ?? null }
    peer.send(JSON.stringify(weather))
    const specialDays: ServerMessage = { type: 'special_days.updated', special_days: useSpecialDays()?.get() ?? null }
    peer.send(JSON.stringify(specialDays))
    const alarm: ServerMessage = { type: 'alarm.updated', alarm: useAlarm()?.get() ?? null }
    peer.send(JSON.stringify(alarm))
  },

  // Commands go through POST /api/displays/:id/commands, not the socket, so anything the client sends is ignored.
  message() {},

  close(peer) {
    getSocketHub().remove(peer)
  },

  error(peer) {
    getSocketHub().remove(peer)
  },
})
