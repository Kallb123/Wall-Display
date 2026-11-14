import type { PhotoPool } from '../../../shared/photoPools'
import { parsePhotoPoolBody } from '../../photoPools/body'
import { getPhotoPool, updatePhotoPool } from '../../photoPools/store'

// Replaces a pool's name and sources, and answers with it. The id stays as it
// was, so layouts that show it keep doing so. 404 if there is no such pool;
// otherwise the same refusals as adding one (400, or 409 for a taken name).
export default defineEventHandler(async (event): Promise<PhotoPool> => {
  const id = getRouterParam(event, 'id') ?? ''
  const db = useDb()
  const unknown = () => createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown photo pool "${id}"` })
  if (!getPhotoPool(db, id)) throw unknown()

  const input = await readValidatedBody(event, parsePhotoPoolBody)
  checkPhotoPool(input)
  const updated = answeringPhotoPoolErrors(() => updatePhotoPool(db, id, input, new Date()))
  if (!updated) throw unknown()
  usePhotoPools().changed()
  return updated
})
