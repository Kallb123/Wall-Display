import type { CustomLayoutInput } from '../../shared/layouts'
import { layoutPhotoFeed } from '../../shared/layouts'
import { photoFeedRefusal } from '../layouts/feeds'

/**
 * Refuses (400) a layout body whose `photo_feed` names no feed that is set up.
 * Read from the settings, so a feed added on the settings page counts at once.
 * Only a feed that would be kept is checked: one sent with no photo pane is
 * dropped by the store anyway, so it is not worth refusing.
 */
export function checkLayoutFeed(input: CustomLayoutInput): void {
  const refusal = photoFeedRefusal(layoutPhotoFeed(input), useSettings().config().photos)
  if (refusal) throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: refusal })
}
