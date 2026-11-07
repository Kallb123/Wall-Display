import { schedulesUsingLayout } from '../../layouts/checks'
import { deleteLayout, getLayout } from '../../layouts/store'

// Deletes a layout and answers 204, or 404 if there is no such layout. One that
// a schedule in the config names is a 409 naming the display and the schedule,
// because deleting it would leave the schedule with nothing to show. A display
// showing it falls back to the month view.
export default defineEventHandler((event): null => {
  const id = getRouterParam(event, 'id') ?? ''
  const db = useDb()
  const layout = getLayout(db, id)
  if (!layout) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown layout "${id}"` })

  const uses = schedulesUsingLayout(useConfig().displays, id)
  if (uses.length > 0) {
    const where = uses.map(use => `schedule "${use.schedule}" on display "${use.display}"`).join(', ')
    throw createError({ statusCode: 409, statusMessage: 'Conflict', message: `Layout "${layout.name}" is used by ${where}` })
  }

  deleteLayout(db, id)
  useLayouts().changed()
  setResponseStatus(event, 204)
  return null
})
