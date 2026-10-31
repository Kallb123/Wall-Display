import type { SpecialDay } from '../../../../../shared/special-days'
import { getSpecialDay, setSpecialDayArt } from '../../../../special-days/store'

// Sets one art slot of a special day (`tile`, `full` or `extra`) from a
// multipart upload with the picture in a `file` field, and answers 200 with
// the day. 404 for an unknown day or slot (checked before the body is read),
// 411 with no Content-Length, 413 when it is too big, 415 for the wrong kind of
// file and 400 for a missing or unusable one. The old file goes once nothing
// else refers to it.
export default defineEventHandler(async (event): Promise<SpecialDay> => {
  const id = getRouterParam(event, 'id') ?? ''
  const slot = getRouterParam(event, 'slot') ?? ''
  if (!isArtSlot(slot)) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown art slot "${slot}"` })
  const db = useDb()
  if (!getSpecialDay(db, id)) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown special day "${id}"` })

  const day = await storeUploadedArt(event, slot, (name) => {
    const set = setSpecialDayArt(db, id, slot, name, new Date())
    return set && { row: set.day, previous: set.previous }
  })
  if (!day) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown special day "${id}"` })
  useSpecialDays()?.refresh()
  return day
})
