import type { HaTriggerSocket } from './socket'

// Holds the running Home Assistant trigger socket between the triggers plugin and useTriggers(). Not auto-imported.
let current: HaTriggerSocket | undefined

export function setTriggerSocket(socket: HaTriggerSocket | undefined): void {
  current = socket
}

export function getTriggerSocket(): HaTriggerSocket | undefined {
  return current
}
