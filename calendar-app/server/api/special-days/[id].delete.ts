import { deleteSpecialDay } from '../../special-days/store'

// Deletes a special day and answers 204, or 404 if there is no such day.
export default defineEventHandler((event): null => {
  const id = getRouterParam(event, 'id') ?? ''
  if (deleteSpecialDay(useDb(), id) === null) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown special day "${id}"` })
  useSpecialDays()?.refresh()
  setResponseStatus(event, 204)
  return null
})
