import { deleteScene } from '../../special-days/scenes'

// Deletes a scene and answers 204, or 404 if there is no such scene. A scene
// that days still use is a 409 naming them, unless `?detach=true`, which first
// copies the scene's look into those days so the wall doesn't change.
export default defineEventHandler((event): null => {
  const id = getRouterParam(event, 'id') ?? ''
  const detach = getQuery(event).detach === 'true'
  if (answeringSpecialDayErrors(() => deleteScene(useDb(), id, { detach })) === null) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown scene "${id}"` })
  useSpecialDays()?.refresh()
  setResponseStatus(event, 204)
  return null
})
