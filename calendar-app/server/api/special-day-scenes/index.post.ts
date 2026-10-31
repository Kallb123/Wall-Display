import type { SpecialDayScene } from '../../../shared/special-days'
import { parseSpecialDaySceneBody } from '../../special-days/body'
import { createScene } from '../../special-days/scenes'

// Adds a scene and answers 201 with it, id included. A bad body is a 400 that
// names the field. With `remote.pin` set the PIN middleware has already
// checked the `x-wallcal-pin` header.
export default defineEventHandler(async (event): Promise<SpecialDayScene> => {
  const input = await readValidatedBody(event, parseSpecialDaySceneBody)
  const created = createScene(useDb(), input, new Date())
  useSpecialDays()?.refresh()
  setResponseStatus(event, 201)
  return created
})
