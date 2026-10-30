import type { SpecialDay } from '../../../shared/special-days'
import { parseSpecialDayBody } from '../../special-days/body'
import { createSpecialDay } from '../../special-days/store'

// Adds a special day and answers 201 with it, id included. A bad body is a 400
// that names the field, such as "day must be …". With `remote.pin` set the PIN
// middleware has already checked the `x-wallcal-pin` header.
export default defineEventHandler(async (event): Promise<SpecialDay> => {
  const input = await readValidatedBody(event, parseSpecialDayBody)
  const created = createSpecialDay(useDb(), input, new Date())
  useSpecialDays()?.refresh()
  setResponseStatus(event, 201)
  return created
})
