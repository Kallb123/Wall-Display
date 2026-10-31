import type { SpecialDay } from '../../../../../shared/special-days'
import { setSpecialDayArt } from '../../../../special-days/store'

// Clears one art slot of a special day, so it goes back to its scene's art, and
// answers 200 with the day. 404 for an unknown day or slot. The file goes if
// nothing else refers to it.
export default defineEventHandler((event): SpecialDay => {
  const id = getRouterParam(event, 'id') ?? ''
  const slot = getRouterParam(event, 'slot') ?? ''
  if (!isArtSlot(slot)) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown art slot "${slot}"` })

  const day = clearArt(() => {
    const set = setSpecialDayArt(useDb(), id, slot, null, new Date())
    return set && { row: set.day, previous: set.previous }
  })
  if (!day) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown special day "${id}"` })
  useSpecialDays()?.refresh()
  return day
})
