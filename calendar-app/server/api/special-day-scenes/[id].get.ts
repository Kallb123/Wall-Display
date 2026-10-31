import type { SpecialDayScene } from '../../../shared/special-days'
import { getScene } from '../../special-days/scenes'

// One scene, or 404.
export default defineEventHandler((event): SpecialDayScene => {
  const id = getRouterParam(event, 'id') ?? ''
  const scene = getScene(useDb(), id)
  if (!scene) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown scene "${id}"` })
  return scene
})
