import type { AppConfig, CalendarConfig } from '../config/schema'
import type { Db } from '../db/client'
import { syncHomeAssistantCalendar } from './homeassistant/sync'
import { syncIcsCalendar } from './ics/sync'
import type { SyncIcsResult } from './ics/sync'
import type { ReplaceResult } from './store'
import type { SyncOutcome } from './scheduler'

// Which function syncs which kind of source. The scheduler calls this and
// knows nothing about ICS or Home Assistant; a new source type adds its case here.

/** Whether the calendar's source type has a sync function. */
export function canSyncCalendar(calendar: CalendarConfig): boolean {
  return calendar.source.type === 'ics' || calendar.source.type === 'homeassistant'
}

export interface SyncCalendarArgs {
  db: Db
  calendar: CalendarConfig
  /** For the people, the time zone, the sync window and where Home Assistant is. */
  config: Pick<AppConfig, 'people' | 'timezone' | 'sync' | 'homeassistant'>
  /** Default: the current time. */
  now?: Date
}

/**
 * Syncs one calendar from its source. Throws if the fetch or the parse fails,
 * after the source has recorded why and left the stored events as they were.
 */
export async function syncCalendar({ db, calendar, config, now }: SyncCalendarArgs): Promise<SyncOutcome> {
  const { type } = calendar.source
  switch (type) {
    case 'ics':
      return outcomeOfIcs(await syncIcsCalendar({ db, calendar, people: config.people, timeZone: config.timezone, sync: config.sync, now }))
    case 'homeassistant': {
      // The config check makes sure of this, but the type does not know.
      if (!config.homeassistant) throw new Error(`calendar "${calendar.id}" has a homeassistant source, but the config has no "homeassistant" block`)
      return outcomeOfUpdate(await syncHomeAssistantCalendar({ db, calendar, homeassistant: config.homeassistant, people: config.people, timeZone: config.timezone, sync: config.sync, now }))
    }
    default: {
      const unhandled: never = type
      throw new Error(`calendar "${calendar.id}" has an unknown source type "${String(unhandled)}"`)
    }
  }
}

function outcomeOfIcs(result: SyncIcsResult): SyncOutcome {
  if (result.status === 'not-modified') return { status: 'not-modified', changed: false, summary: 'not modified' }
  return outcomeOfUpdate(result)
}

/** The outcome of a sync that read the source, in the words the log uses. */
function outcomeOfUpdate(result: ReplaceResult & { warnings: string[] }): SyncOutcome {
  return {
    status: 'updated',
    changed: result.inserted + result.updated + result.deleted > 0,
    summary: `${result.inserted} added, ${result.updated} changed, ${result.deleted} removed (${result.total} events)`,
    warnings: result.warnings,
  }
}
