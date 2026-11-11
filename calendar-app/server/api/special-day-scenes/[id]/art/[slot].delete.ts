import type { SpecialDayScene } from '../../../../../shared/special-days'
import { SCENE_ART_SLOTS } from '../../../../special-days/art-errors'
import type { SceneArtSlot } from '../../../../special-days/art-errors'
import { setSceneArt } from '../../../../special-days/scenes'

// Clears the `tile`, `full`, `full-portrait`, `backdrop` or `backdrop-portrait` art of a scene and answers 200 with the scene.
// 404 for an unknown scene or slot. The file goes if nothing else refers to it.
const isSceneArtSlot = (slot: string): slot is SceneArtSlot => (SCENE_ART_SLOTS as readonly string[]).includes(slot)

export default defineEventHandler((event): SpecialDayScene => {
  const id = getRouterParam(event, 'id') ?? ''
  const slot = getRouterParam(event, 'slot') ?? ''
  if (!isSceneArtSlot(slot)) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown art slot "${slot}"` })

  const scene = clearArt(() => {
    const set = setSceneArt(useDb(), id, slot, null, new Date())
    return set && { row: set.scene, previous: set.previous }
  })
  if (!scene) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown scene "${id}"` })
  useSpecialDays()?.refresh()
  return scene
})
