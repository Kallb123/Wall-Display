import type { CustomLayout } from '../../../shared/layouts'
import { parseLayoutBody } from '../../layouts/body'
import { getLayout, updateLayout } from '../../layouts/store'

// Replaces everything the editor sets on a layout, and answers with it. The id
// stays as it was. 404 if there is no such layout, a bad body is a 400 that
// names the field, and a name another layout has is a 409. Every display
// showing it draws the new version.
export default defineEventHandler(async (event): Promise<CustomLayout> => {
  const id = getRouterParam(event, 'id') ?? ''
  const db = useDb()
  const unknown = () => createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown layout "${id}"` })
  if (!getLayout(db, id)) throw unknown()

  const input = await readValidatedBody(event, parseLayoutBody)
  const updated = answeringLayoutErrors(() => updateLayout(db, id, input, new Date()))
  if (!updated) throw unknown()
  useLayouts().changed()
  return updated
})
