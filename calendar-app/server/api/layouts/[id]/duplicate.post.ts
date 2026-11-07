import type { CustomLayout } from '../../../../shared/layouts'
import { duplicateLayout } from '../../../layouts/store'

// Copies a layout as "Copy of …" and answers 201 with the copy. 404 if there is
// no such layout.
export default defineEventHandler((event): CustomLayout => {
  const id = getRouterParam(event, 'id') ?? ''
  const copy = duplicateLayout(useDb(), id, new Date())
  if (!copy) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown layout "${id}"` })
  useLayouts().changed()
  setResponseStatus(event, 201)
  return copy
})
