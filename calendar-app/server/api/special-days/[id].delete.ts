import { removeUnreferencedArt } from '../../special-days/files'
import { deleteSpecialDay } from '../../special-days/store'

// Deletes a special day and answers 204, or 404 if there is no such day. Its art
// files go too, unless a scene or another day (a copy shares them) still uses them.
export default defineEventHandler((event): null => {
  const id = getRouterParam(event, 'id') ?? ''
  const db = useDb()
  const art = deleteSpecialDay(db, id)
  if (art === null) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown special day "${id}"` })
  removeUnreferencedArt(db, useSpecialDayArtDir(), art)
  useSpecialDays()?.refresh()
  setResponseStatus(event, 204)
  return null
})
