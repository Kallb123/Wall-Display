import type { AppConfig, CalendarConfig } from '../config/schema'
import type { Db } from '../db/client'
import { syncIcsCalendar } from './ics/sync'
import type { SyncIcsResult } from './ics/sync'
import type { SyncOutcome } from './scheduler'

// Which function syncs which kind of source. The scheduler calls this and
// knows nothing about ICS; the Home Assistant source (PR 2.3) adds its case here.

/** Whether the calendar's source type has a sync function yet. */
export function canSyncCalendar(calendar: CalendarConfig): boolean {
  return calendar.source.type === 'ics'
}

export interface SyncCalendarArgs {
  db: Db
  calendar: CalendarConfig
  /** For the people, the time zone and the sync window. */
  config: Pick<AppConfig, 'people' | 'timezone' | 'sync'>
  /** Default: the current time. */
  now?: Date
}

/**
 * Syncs one calendar from its source. Throws if the fetch or the parse fails,
 * after the source has recorded why and left the stored events as they were.
 */
export async function syncCalendar({ db, calendar, config, now }: SyncCalendarArgs): Promise<SyncOutcome> {
  switch (calendar.source.type) {
    case 'ics':
      return outcomeOfIcs(await syncIcsCalendar({ db, calendar, people: config.people, timeZone: config.timezone, sync: config.sync, now }))
    default:
      throw new Error(`calendar "${calendar.id}" has a ${calendar.source.type} source, which cannot be synced yet`)
  }
}

function outcomeOfIcs(result: SyncIcsResult): SyncOutcome {
  if (result.status === 'not-modified') return { status: 'not-modified', changed: false, summary: 'not modified' }
  return {
    status: 'updated',
    changed: result.inserted + result.updated + result.deleted > 0,
    summary: `${result.inserted} added, ${result.updated} changed, ${result.deleted} removed (${result.total} events)`,
    warnings: result.warnings,
  }
}
