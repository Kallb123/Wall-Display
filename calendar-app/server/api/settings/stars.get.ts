import type { StarSettingsEntry } from '../../../shared/stars'
import { starSettingsEntries } from '../../stars/store'

// Every person in the config, in config order, with their star chart settings
// (the defaults for one who has never been set up), for the settings page.
export default defineEventHandler((): StarSettingsEntry[] => {
  return starSettingsEntries(useDb(), useConfig().people)
})
