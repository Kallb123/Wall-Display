import { z } from 'zod'
import { PHOTO_HISTORY_DEFAULT_LIMIT, PHOTO_HISTORY_MAX_LIMIT } from '../../../../shared/photoHistory'
import type { PhotoHistoryResponse } from '../../../../shared/photoHistory'

// The photos a display has shown lately, newest first, with when each was on
// show and what is known about it (architecture §5.1). A read, like the state,
// so it needs no PIN. Without a photo service there is nothing to list.
const query = z.object({
  limit: z.coerce.number().int().min(1).max(PHOTO_HISTORY_MAX_LIMIT).default(PHOTO_HISTORY_DEFAULT_LIMIT),
})

export default defineEventHandler((event): PhotoHistoryResponse => {
  const id = getRouterParam(event, 'id') ?? ''
  if (!useDisplayControl().hasDisplay(id)) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown display "${id}"` })

  const parsed = query.safeParse(getQuery(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `limit must be a whole number from 1 to ${PHOTO_HISTORY_MAX_LIMIT}` })

  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { entries: usePhotos()?.history(id, parsed.data.limit) ?? [] }
})
