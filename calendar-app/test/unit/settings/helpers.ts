import { createConfigSchema } from '../../../server/config/schema'
import type { AppConfig } from '../../../server/config/schema'

/** A parsed config (defaults filled in) for the preferences tests: two displays, with `extra` merged on top at the top level. */
export function parsedConfig(extra: Record<string, unknown> = {}, display: Record<string, unknown> = {}): AppConfig {
  return createConfigSchema('/etc/wallcal').parse({
    people: [{ id: 'mum', name: 'Mum', colour: '#C67139' }],
    displays: [{ id: 'hallway', name: 'Hallway', ...display }, { id: 'kitchen', name: 'Kitchen', theme: 'dark' }],
    ...extra,
  })
}

export const ALARM = { alarm: { entity_id: 'sensor.phone_next_alarm' }, homeassistant: { url: 'http://ha.local:8123', token: 'secret-token' } }
export const PHOTOS = { photos: { interval_seconds: 30 } }
