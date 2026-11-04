import type { PreferencesStatus } from '../../../../../shared/settings'

// Saves (`set`) or goes back to the config's value for (`reset`) some of one
// display's preferences, and answers with all of them. The change is live: the
// display's sockets are sent its new settings and the services read them again.
// 404 for a display that is not in the config, and a refused value is a 400 with
// a message per key as `data.fields`, with nothing saved. The PIN middleware
// already guards every PUT under /api.
export default defineEventHandler(async (event): Promise<PreferencesStatus> => {
  const id = getRouterParam(event, 'id') ?? ''
  const body = await readBody<unknown>(event)
  return answeringPreferenceErrors(() => useSettings().updateDisplay(id, body))
})
