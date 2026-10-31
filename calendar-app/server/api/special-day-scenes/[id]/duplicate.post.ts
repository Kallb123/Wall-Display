import type { SpecialDayScene } from '../../../../shared/special-days'
import { duplicateScene } from '../../../special-days/scenes'

// Copies a scene as "Copy of …" and answers 201 with the copy. The copy shares
// the art files and is used by no day. 404 if there is no such scene.
export default defineEventHandler((event): SpecialDayScene => {
  const id = getRouterParam(event, 'id') ?? ''
  const copy = duplicateScene(useDb(), id, new Date())
  if (!copy) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown scene "${id}"` })
  useSpecialDays()?.refresh()
  setResponseStatus(event, 201)
  return copy
})
