import type { SpecialDayScene } from '../../shared/special-days'
import type { StarterScene } from '../../shared/starter-scenes'
import type { Db } from '../db/client'
import { processArt } from './art'
import type { SceneArtSlot } from './art-errors'
import { removeUnreferencedArt, writeArtFile } from './files'
import { createScene } from './scenes'
import type { SceneArt } from './scenes'

// Adds a starter scene (shared/starter-scenes.ts) to the scene library. Its
// art ships with the app, in server/assets/starter-scenes/, and goes through
// the same checks and conversion as an upload (`processArt`) before it is
// stored in the art folder, so the scene that comes out is like one made by
// hand: it can be edited, copied or deleted without touching the bundled
// original. Imports art.ts, and so jsdom and sharp: the route loads this lazily.

/** The art a starter has, one file per scene slot. */
export const STARTER_ART_SLOTS = ['tile', 'full', 'full-portrait'] as const satisfies readonly SceneArtSlot[]

/** Where a starter's art is in the server assets (`assets:server`): `starter-scenes/<id>/<slot>.svg`. */
export function starterArtPath(id: string, slot: SceneArtSlot): string {
  return `starter-scenes/${id}/${slot}.svg`
}

/** Reads the bundled bytes of one of a starter's art files. */
export type StarterArtReader = (path: string) => Promise<Buffer>

/**
 * Makes a new scene from a starter, with its art, and returns it. Adding the
 * same starter again makes another copy, under the next free id
 * (`christmas-2`), sharing the art files, which are named by their contents.
 * The art is processed first; after that everything is synchronous, as for an
 * upload, so the files can't be cleaned up by another request between being
 * written and being referenced. If the scene can't be stored, the files it
 * would have used are removed again unless something else uses them.
 */
export async function addStarterScene(db: Db, dir: string, starter: StarterScene, read: StarterArtReader, now: Date): Promise<SpecialDayScene> {
  const processed = await Promise.all(STARTER_ART_SLOTS.map(async slot => [slot, await processArt(slot, await read(starterArtPath(starter.id, slot)))] as const))

  const art: SceneArt = {}
  for (const [slot, { data, ext }] of processed) art[slot] = writeArtFile(dir, data, ext)
  try {
    return createScene(db, starter.scene, now, art)
  } catch (error) {
    removeUnreferencedArt(db, dir, Object.values(art))
    throw error
  }
}
