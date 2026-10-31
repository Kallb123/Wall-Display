import type { SpecialDay, SpecialDayScene } from '../../../../shared/special-days'
import { parseSaveAsSceneBody } from '../../../special-days/body'
import { getSpecialDay, saveDayAsScene } from '../../../special-days/store'

// Makes a scene from the look a special day has and moves the day onto it,
// clearing its own look. The body is optional: `{ "name": "…" }` names the
// scene, otherwise it is named after the day. Answers 201 with `{ scene, day }`.
// The day's `updated_at` stays as it was. 404 if there is no such day.
export default defineEventHandler(async (event): Promise<{ scene: SpecialDayScene, day: SpecialDay }> => {
  const id = getRouterParam(event, 'id') ?? ''
  const db = useDb()
  if (!getSpecialDay(db, id)) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown special day "${id}"` })

  const { name } = await readValidatedBody(event, parseSaveAsSceneBody)
  const saved = saveDayAsScene(db, id, name, new Date())
  if (!saved) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown special day "${id}"` })
  useSpecialDays()?.refresh()
  setResponseStatus(event, 201)
  return saved
})
