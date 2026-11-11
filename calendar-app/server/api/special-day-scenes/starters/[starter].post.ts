import type { SpecialDayScene } from '../../../../shared/special-days'
import { findStarterScene } from '../../../../shared/starter-scenes'

// Adds a starter scene (shared/starter-scenes.ts) to the scene library and
// answers 201 with the new scene: its look, and its tile, full-screen and
// portrait art copied into the art folder. Adding one twice makes a second
// copy. 404 for an unknown starter. Like every write under /api it is behind
// the PIN when `remote.pin` is set.
export default defineEventHandler(async (event): Promise<SpecialDayScene> => {
  const id = getRouterParam(event, 'starter') ?? ''
  const starter = findStarterScene(id)
  if (!starter) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown starter scene "${id}"` })

  // Loaded here, not at the top, so jsdom and sharp are only read once a starter is added.
  const { addStarterScene } = await import('../../../special-days/starters')
  const scene = await addStarterScene(useDb(), useSpecialDayArtDir(), starter, async (path) => {
    const data = await readServerAsset(path)
    if (!data) throw createError({ statusCode: 500, statusMessage: 'Internal Server Error', message: `The art for the starter scene "${id}" is missing (${path})` })
    return data
  }, new Date())
  useSpecialDays()?.refresh()
  setResponseStatus(event, 201)
  return scene
})
