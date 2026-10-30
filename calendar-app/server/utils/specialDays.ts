import { getSpecialDays } from '../special-days/state'
import type { SpecialDaysService } from '../special-days/service'

/**
 * The special days service: today's resolution, and `refresh()` after an edit.
 * Started at boot by `server/plugins/06.special-days.ts`, so it is undefined
 * before then. Server code only. Call it inside a handler, not at import time.
 */
export function useSpecialDays(): SpecialDaysService | undefined {
  return getSpecialDays()
}
