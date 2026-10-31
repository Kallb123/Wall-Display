import type { SpecialDay } from '../../../shared/special-days'
import { parseSpecialDayBody } from '../../special-days/body'
import { checkDayInput } from '../../special-days/checks'
import { getSpecialDay, updateSpecialDay } from '../../special-days/store'

// Replaces everything the editor sets on a special day, and answers with it.
// The id and the art stay as they were. 404 if there is no such day, and a bad
// body is a 400 that names the field. So is an unknown `scene_id`, or a greeting
// the day can't fill.
export default defineEventHandler(async (event): Promise<SpecialDay> => {
  const id = getRouterParam(event, 'id') ?? ''
  const db = useDb()
  if (!getSpecialDay(db, id)) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown special day "${id}"` })

  const input = await readValidatedBody(event, parseSpecialDayBody)
  const updated = answeringSpecialDayErrors(() => {
    checkDayInput(db, input, id)
    return updateSpecialDay(db, id, input, new Date())
  })
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown special day "${id}"` })
  useSpecialDays()?.refresh()
  return updated
})
