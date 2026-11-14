import { deletePhotoPool, getPhotoPool } from '../../photoPools/store'

// Deletes a pool and answers 204, or 404 if there is no such pool. One that a
// layout's photo pane shows is a 409 naming the layouts, because deleting it
// would leave them with a feed that no longer exists.
export default defineEventHandler((event): null => {
  const id = getRouterParam(event, 'id') ?? ''
  const db = useDb()
  const pool = getPhotoPool(db, id)
  if (!pool) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown photo pool "${id}"` })

  const users = useLayouts().get().filter(layout => layout.photo_feed === id)
  if (users.length > 0) {
    const names = users.map(layout => `"${layout.name}"`).join(', ')
    throw createError({ statusCode: 409, statusMessage: 'Conflict', message: `Pool "${pool.name}" is used by ${users.length === 1 ? 'layout' : 'layouts'} ${names}` })
  }

  deletePhotoPool(db, id)
  usePhotoPools().changed()
  setResponseStatus(event, 204)
  return null
})
