import type { SpecialDay } from '../../../shared/special-days'
import { getSpecialDay } from '../../special-days/store'

// One special day, or 404.
export default defineEventHandler((event): SpecialDay => {
  const id = getRouterParam(event, 'id') ?? ''
  const day = getSpecialDay(useDb(), id)
  if (!day) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown special day "${id}"` })
  return day
})
