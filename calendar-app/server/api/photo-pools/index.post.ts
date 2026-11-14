import type { PhotoPool } from '../../../shared/photoPools'
import { PHOTO_SOURCE_NAMES } from '../../../shared/photos'
import { parsePhotoPoolBody } from '../../photoPools/body'
import { createPhotoPool } from '../../photoPools/store'

// Adds a pool and answers 201 with it, id included. A bad body is a 400 that
// names the field, as is a source the config can't run (`sources.N …`); with no
// photos block it is a 409, as is a name another pool has. The id is a slug of
// the name that avoids the ids of the feeds the config sets up. With
// `remote.pin` set the PIN middleware has already checked the header.
export default defineEventHandler(async (event): Promise<PhotoPool> => {
  const input = await readValidatedBody(event, parsePhotoPoolBody)
  checkPhotoPool(input)
  const photos = useSettings().config().photos
  const reserved = [...Object.keys(PHOTO_SOURCE_NAMES), ...(photos?.feeds.map(feed => feed.id) ?? [])]
  const created = answeringPhotoPoolErrors(() => createPhotoPool(useDb(), input, new Date(), reserved))
  usePhotoPools().changed()
  setResponseStatus(event, 201)
  return created
})
