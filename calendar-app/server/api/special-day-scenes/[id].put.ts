import type { SpecialDayScene } from '../../../shared/special-days'
import { parseSpecialDaySceneBody } from '../../special-days/body'
import { checkSceneInput } from '../../special-days/checks'
import { getScene, updateScene } from '../../special-days/scenes'

// Replaces everything the editor sets on a scene, and answers with it. The id
// and the art stay as they were. 404 if there is no such scene, and a bad body
// is a 400 that names the field. So is a greeting that some day on the scene
// can't fill, which the error names. The days using it are drawn again.
export default defineEventHandler(async (event): Promise<SpecialDayScene> => {
  const id = getRouterParam(event, 'id') ?? ''
  const db = useDb()
  if (!getScene(db, id)) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown scene "${id}"` })

  const input = await readValidatedBody(event, parseSpecialDaySceneBody)
  const updated = answeringSpecialDayErrors(() => {
    checkSceneInput(db, id, input)
    return updateScene(db, id, input, new Date())
  })
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown scene "${id}"` })
  useSpecialDays()?.refresh()
  return updated
})
