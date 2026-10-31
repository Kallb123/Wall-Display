import type { SpecialDayScene } from '../../../../../shared/special-days'
import { getScene, setSceneArt } from '../../../../special-days/scenes'

// Sets the `tile` or `full` art of a scene from a multipart upload with the
// picture in a `file` field, and answers 200 with the scene. Scenes have no
// `extra` art, so that is a 404 like any unknown slot, and so is an unknown
// scene (checked before the body is read). The other errors are as for a day.
export default defineEventHandler(async (event): Promise<SpecialDayScene> => {
  const id = getRouterParam(event, 'id') ?? ''
  const slot = getRouterParam(event, 'slot') ?? ''
  if (slot !== 'tile' && slot !== 'full') throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown art slot "${slot}"` })
  const db = useDb()
  if (!getScene(db, id)) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown scene "${id}"` })

  const scene = await storeUploadedArt(event, slot, (name) => {
    const set = setSceneArt(db, id, slot, name, new Date())
    return set && { row: set.scene, previous: set.previous }
  })
  if (!scene) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown scene "${id}"` })
  useSpecialDays()?.refresh()
  return scene
})
