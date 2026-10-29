import type { DiscoveryResult } from '../../../shared/settings'
import { getMqttBridge } from '../../mqtt/state'
import { discoveryProblem } from '../../settings/status'

// Publishes Home Assistant's discovery configs again for every display that is
// connected to the broker, which is "Republish discovery" on the settings page.
// It answers 409 when MQTT is not set up or discovery is off: that is the
// configuration, not a fault. A write, so the PIN middleware guards it.
export default defineEventHandler((): DiscoveryResult => {
  const problem = discoveryProblem(useConfig().mqtt)
  if (problem !== null) throw createError({ statusCode: 409, statusMessage: 'Conflict', message: problem })

  return { republished: getMqttBridge()?.republishDiscovery() ?? [] }
})
