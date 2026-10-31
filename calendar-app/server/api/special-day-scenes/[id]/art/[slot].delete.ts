import type { SpecialDayScene } from '../../../../../shared/special-days'
import { setSceneArt } from '../../../../special-days/scenes'

// Clears the `tile` or `full` art of a scene and answers 200 with the scene.
// 404 for an unknown scene or slot. The file goes if nothing else refers to it.
export default defineEventHandler((event): SpecialDayScene => {
  const id = getRouterParam(event, 'id') ?? ''
  const slot = getRouterParam(event, 'slot') ?? ''
  if (slot !== 'tile' && slot !== 'full') throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown art slot "${slot}"` })

  const scene = clearArt(() => {
    const set = setSceneArt(useDb(), id, slot, null, new Date())
    return set && { row: set.scene, previous: set.previous }
  })
  if (!scene) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown scene "${id}"` })
  useSpecialDays()?.refresh()
  return scene
})
