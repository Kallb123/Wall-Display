import type { BrightnessPolicy } from '../control/brightness'
import type { PresencePolicy } from '../control/presence'
import type { MqttBridge } from './client'

// Holds the running MQTT bridge between the mqtt plugin and whatever asks about it later. Not auto-imported.
let current: MqttBridge | undefined

export function setMqttBridge(bridge: MqttBridge | undefined): void {
  current = bridge
}

export function getMqttBridge(): MqttBridge | undefined {
  return current
}

// The auto presence policy that goes with it: its sensor readings arrive over MQTT, and it listens to the event bus, which outlives a hot reload, so the next run has to stop it too.
let currentPresence: PresencePolicy | undefined

export function setPresencePolicy(policy: PresencePolicy | undefined): void {
  currentPresence = policy
}

export function getPresencePolicy(): PresencePolicy | undefined {
  return currentPresence
}

// The auto brightness policy, for the same reason: its light readings arrive over MQTT, and it listens to the event bus.
let currentBrightness: BrightnessPolicy | undefined

export function setBrightnessPolicy(policy: BrightnessPolicy | undefined): void {
  currentBrightness = policy
}

export function getBrightnessPolicy(): BrightnessPolicy | undefined {
  return currentBrightness
}
