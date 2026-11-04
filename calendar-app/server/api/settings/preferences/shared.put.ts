import type { PreferencesStatus } from '../../../../shared/settings'

// The same as the display one, for the preferences every display shares: the
// photo interval and the auto presence and brightness policies.
export default defineEventHandler(async (event): Promise<PreferencesStatus> => {
  const body = await readBody<unknown>(event)
  return answeringPreferenceErrors(() => useSettings().updateShared(body))
})
