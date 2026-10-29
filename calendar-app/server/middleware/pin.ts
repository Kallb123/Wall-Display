import { requiresPin } from '../remote/pin'

// The remote PIN guards every write under /api (architecture §7.5), so the
// commands, the refresh and the settings pages' saves are all behind it
// without each route having to ask. It runs before the route, so a caller
// without the PIN learns nothing from a 404 or a 400, such as which displays exist.
export default defineEventHandler((event) => {
  if (requiresPin(event.method, event.path)) requireRemotePin(event)
})
