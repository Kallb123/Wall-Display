import type { PhotoPoolInput } from '../../shared/photoPools'
import { poolRefusal } from '../photoPools/checks'

/**
 * Refuses a pool body the config can't support: 409 with no photos block, 400
 * naming `sources.N` for a source that needs a block or feed that isn't set up.
 * Read from the settings, so a block added while the app runs counts at once.
 */
export function checkPhotoPool(input: PhotoPoolInput): void {
  const refusal = poolRefusal(input, useSettings().config().photos)
  if (refusal) throw createError({ statusCode: refusal.statusCode, statusMessage: refusal.statusCode === 409 ? 'Conflict' : 'Bad Request', message: refusal.message })
}
