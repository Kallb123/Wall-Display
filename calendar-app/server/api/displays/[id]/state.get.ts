import type { DisplayState } from '../../../../shared/display'

// A display's current state: the same document the WebSocket sends on connect.
export default defineEventHandler((event): DisplayState => {
  const id = getRouterParam(event, 'id') ?? ''
  const control = useDisplayControl()
  if (!control.hasDisplay(id)) throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `Unknown display "${id}"` })

  return control.getState(id)
})
