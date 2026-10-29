import type { MqttBridge } from './client'

// Holds the running MQTT bridge between the mqtt plugin and whatever asks about it later. Not auto-imported.
let current: MqttBridge | undefined

export function setMqttBridge(bridge: MqttBridge | undefined): void {
  current = bridge
}

export function getMqttBridge(): MqttBridge | undefined {
  return current
}
