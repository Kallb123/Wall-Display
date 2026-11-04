import type { PreferencesStatus } from '../../../shared/settings'

// Every editable preference, as it is in force, as the config has it and which
// have a saved change, for the settings page's Displays tab. Reading is open.
export default defineEventHandler((): PreferencesStatus => useSettings().status())
