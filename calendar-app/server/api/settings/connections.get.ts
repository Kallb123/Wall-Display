import type { ConnectionsStatus } from '../../../shared/settings'
import { getMqttBridge } from '../../mqtt/state'
import { connectionsStatus } from '../../settings/status'

// How the app's links to MQTT and Home Assistant are doing. The broker is named
// by scheme, host and port only. Home Assistant is asked at most once a minute,
// however often the page polls, and is never named: no URL, no token.
export default defineEventHandler(async (): Promise<ConnectionsStatus> => {
  const config = useConfig()
  return connectionsStatus({
    mqtt: config.mqtt,
    bridge: getMqttBridge()?.status(),
    displayCount: config.displays.length,
    homeassistant: await useHaStatus()?.get(),
  })
})
