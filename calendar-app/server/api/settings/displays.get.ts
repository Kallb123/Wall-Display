import type { DisplayStatus } from '../../../shared/settings'
import { getMqttBridge } from '../../mqtt/state'
import { displayStatuses } from '../../settings/status'
import { getSocketHub } from '../../ws/hub'

// Each display's live state, open sockets and MQTT connection, for the settings
// page's Displays tab. Reading is open, like /api/displays/:id/state.
export default defineEventHandler((): DisplayStatus[] => {
  const control = useDisplayControl()
  const hub = getSocketHub()
  return displayStatuses({
    displays: useConfig().displays,
    getState: id => control.getState(id),
    counts: id => hub.counts(id),
    mqtt: getMqttBridge()?.status(),
  })
})
