import type { SpecialDay } from '../../../shared/special-days'
import { parseSpecialDayBody } from '../../special-days/body'
import { checkDayInput } from '../../special-days/checks'
import { createSpecialDay } from '../../special-days/store'

// Adds a special day and answers 201 with it, id included. A bad body is a 400
// that names the field, such as "day must be …". So is an unknown `scene_id`, or
// a greeting the day can't fill. With `remote.pin` set the PIN
// middleware has already checked the `x-wallcal-pin` header.
export default defineEventHandler(async (event): Promise<SpecialDay> => {
  const input = await readValidatedBody(event, parseSpecialDayBody)
  const db = useDb()
  const created = answeringSpecialDayErrors(() => {
    checkDayInput(db, input)
    return createSpecialDay(db, input, new Date())
  })
  useSpecialDays()?.refresh()
  setResponseStatus(event, 201)
  return created
})
