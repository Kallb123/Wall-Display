import { todayIn } from '../../../shared/dates'
import { resolvePreview } from '../../../shared/special-days'
import type { SpecialDaysResponse } from '../../../shared/special-days'
import { listScenes } from '../../special-days/scenes'
import { listSpecialDays } from '../../special-days/store'

// What the wall shows while it previews a special day (`?special_day=<id>`) or
// a scene (`?scene=<id>`): the same answer as `/resolved`, worked out as if the
// date it next falls on were today (architecture §6.5). Exactly one of the two
// is needed (400 otherwise), and 404 says there is no such day or scene. A read,
// so it needs no PIN. Its own file, so Nitro matches it ahead of `[id]`.
export default defineEventHandler((event): SpecialDaysResponse => {
  const { special_day: day, scene } = getQuery(event)
  if ((day === undefined) === (scene === undefined) || [day, scene].some(value => value !== undefined && (typeof value !== 'string' || value === ''))) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'Give exactly one of special_day and scene' })
  }

  const db = useDb()
  const today = todayIn(new Date(), useConfig().timezone)
  const resolution = resolvePreview(listSpecialDays(db), listScenes(db), typeof day === 'string' ? { special_day: day } : { scene: scene as string }, today)
  if (!resolution) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: typeof day === 'string' ? `Unknown special day "${day}"` : `Unknown scene "${scene as string}"` })
  }
  return { special_days: resolution }
})
