import type { AlarmService } from './service'

// Holds the running alarm service between the alarm plugin and useAlarm(). Not auto-imported.
let current: AlarmService | undefined

export function setAlarm(service: AlarmService | undefined): void {
  current = service
}

export function getAlarm(): AlarmService | undefined {
  return current
}
