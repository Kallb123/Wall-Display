import type { SpecialDay } from '../../../../shared/special-days'
import { duplicateSpecialDay } from '../../../special-days/store'

// Copies a special day as "Copy of …" and answers 201 with the copy: the same
// scene, `who`, `since_year`, look and art, to be given its own name and date.
// 404 if there is no such day.
export default defineEventHandler((event): SpecialDay => {
  const id = getRouterParam(event, 'id') ?? ''
  const copy = duplicateSpecialDay(useDb(), id, new Date())
  if (!copy) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown special day "${id}"` })
  useSpecialDays()?.refresh()
  setResponseStatus(event, 201)
  return copy
})
