import type { CustomLayout } from '../../../shared/layouts'
import { parseLayoutBody } from '../../layouts/body'
import { createLayout } from '../../layouts/store'

// Adds a layout and answers 201 with it, id included. A bad body is a 400 that
// names the field, and a name another layout has is a 409. With `remote.pin`
// set the PIN middleware has already checked the `x-wallcal-pin` header.
export default defineEventHandler(async (event): Promise<CustomLayout> => {
  const input = await readValidatedBody(event, parseLayoutBody)
  const created = answeringLayoutErrors(() => createLayout(useDb(), input, new Date()))
  useLayouts().changed()
  setResponseStatus(event, 201)
  return created
})
