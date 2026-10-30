import type { SpecialDaysResponse } from '../../../shared/special-days'

// What the wall is showing for special days: the decorated tiles, today's
// special day and the takeover, in the shape the WebSocket sends in
// `special_days.updated`. Null only before the service has started. Its own
// file, so Nitro matches it ahead of `[id]`.
export default defineEventHandler((): SpecialDaysResponse => {
  return { special_days: useSpecialDays()?.get() ?? null }
})
