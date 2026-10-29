import { createPeopleResolver } from '../../../shared/people'
import type { CalendarConfig, HomeAssistantConfig, Person, SyncConfig } from '../../config/schema'
import type { Db } from '../../db/client'
import { safeErrorMessage } from '../errors'
import { ensureCalendarRow, recordSyncStatus, replaceCalendarEvents } from '../store'
import type { ReplaceResult } from '../store'
import { syncWindow } from '../time'
import { fetchHaCalendar } from './fetch'
import { mapHaEvents } from './map'

// One Home Assistant calendar, end to end: fetch the sync window, map it,
// replace the stored events, record how it went. Home Assistant has no ETag or
// Last-Modified to ask with, so every poll fetches the whole window. That is
// cheap to keep: the store only writes the rows that changed. Like the ICS
// sync, nothing here runs by itself; the scheduler calls it.

export interface SyncHomeAssistantArgs {
  db: Db
  /** A calendar whose source is `homeassistant`. */
  calendar: CalendarConfig
  /** Where Home Assistant is and the token to use. */
  homeassistant: Pick<HomeAssistantConfig, 'url' | 'token'>
  /** Everyone in the config, for person detection. */
  people: readonly Person[]
  /** The display time zone. */
  timeZone: string
  sync: SyncConfig
  /** Default: the current time. */
  now?: Date
  /** For tests. Default: the global `fetch`. */
  fetch?: typeof fetch
}

export type SyncHomeAssistantResult = { status: 'updated', warnings: string[] } & ReplaceResult

/**
 * Syncs one calendar. Throws if the fetch or the check of the response fails,
 * after recording the (token-free) reason in `sync_status` and leaving the
 * stored events as they were.
 */
export async function syncHomeAssistantCalendar({ db, calendar, homeassistant, people, timeZone, sync, now = new Date(), fetch: fetchFn }: SyncHomeAssistantArgs): Promise<SyncHomeAssistantResult> {
  if (calendar.source.type !== 'homeassistant') throw new Error(`calendar "${calendar.id}" is not a Home Assistant calendar`)
  const { entity_id: entityId } = calendar.source

  ensureCalendarRow(db, calendar, people)
  const window = syncWindow(now, timeZone, sync.months_back, sync.months_ahead)
  const attemptedAt = now

  try {
    const raw = await fetchHaCalendar(homeassistant, entityId, window, { fetch: fetchFn })
    const { events, warnings } = mapHaEvents(raw, window, { timeZone })
    const result = replaceCalendarEvents(db, calendar.id, events, createPeopleResolver(calendar, people))
    // No validators to remember: the next poll fetches the window again.
    recordSyncStatus(db, calendar.id, {
      lastAttemptAt: attemptedAt,
      lastSuccessAt: attemptedAt,
      lastError: null,
      etag: null,
      lastModified: null,
      expansionKey: null,
      eventCount: result.total,
    })
    return { status: 'updated', warnings, ...result }
  } catch (error) {
    recordSyncStatus(db, calendar.id, { lastAttemptAt: attemptedAt, lastError: safeErrorMessage(error) })
    throw error
  }
}
