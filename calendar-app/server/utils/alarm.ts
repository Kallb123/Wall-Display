import { getAlarm } from '../alarm/state'
import type { AlarmService } from '../alarm/service'

/**
 * The next alarm service, or undefined when the config has no `alarm` block.
 * Started at boot by `server/plugins/08.alarm.ts`. Server code only. Call it
 * inside a handler, not at import time.
 */
export function useAlarm(): AlarmService | undefined {
  return getAlarm()
}
