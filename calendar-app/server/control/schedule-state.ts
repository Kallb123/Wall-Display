import type { SchedulePolicy } from './schedule'

// Holds the running schedule policy between the control plugin and a hot reload, so the old one is stopped first. Not auto-imported.
let current: SchedulePolicy | undefined

export function setSchedulePolicy(policy: SchedulePolicy | undefined): void {
  current = policy
}

export function getSchedulePolicy(): SchedulePolicy | undefined {
  return current
}
