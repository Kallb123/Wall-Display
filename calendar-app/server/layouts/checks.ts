import type { AppConfig } from '../config/schema'

/** A schedule rule that names a layout, for the message that refuses a delete. */
export interface ScheduleUse {
  display: string
  schedule: string
}

/**
 * The schedules in the config with a rule that shows layout `id` (PR 5.17),
 * each once. The layout lives in SQLite and the schedule in config.yaml, so
 * this is the only place the two meet.
 */
export function schedulesUsingLayout(displays: AppConfig['displays'], id: string): ScheduleUse[] {
  const uses: ScheduleUse[] = []
  for (const display of displays) {
    for (const schedule of display.schedules) {
      if (schedule.rules.some(rule => rule.layout === id)) uses.push({ display: display.id, schedule: schedule.id })
    }
  }
  return uses
}
