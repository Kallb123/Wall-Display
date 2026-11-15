import type { SetupStatus } from '../../../shared/settings'
import { setupStatus } from '../../settings/setup'

// The rest of config.yaml for the settings page's Setup tab: schedules, the
// button, cameras, triggers, kitchen timers and the other blocks that can only
// be changed in the YAML. Reading is open, like the other settings reads, and
// the shaping copies out named fields only, so no token, password or PIN appears.
export default defineEventHandler((): SetupStatus => setupStatus(useConfig()))
