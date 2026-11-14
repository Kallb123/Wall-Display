import type { HaTriggerSocket } from '../triggers/socket'
import type { TimersService } from './service'

// Holds the running timers service, and the WebSocket that feeds it, between
// the timers plugin and useTimers(). Not auto-imported.
let current: TimersService | undefined
let currentSocket: HaTriggerSocket | undefined

export function setTimers(service: TimersService | undefined): void {
  current = service
}

export function getTimers(): TimersService | undefined {
  return current
}

export function setTimersSocket(socket: HaTriggerSocket | undefined): void {
  currentSocket = socket
}

export function getTimersSocket(): HaTriggerSocket | undefined {
  return currentSocket
}
