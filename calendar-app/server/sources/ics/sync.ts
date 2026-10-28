import { eq } from 'drizzle-orm'
import type { CalendarConfig, SyncConfig } from '../../config/schema'
import type { Db } from '../../db/client'
import { syncStatus } from '../../db/schema'
import { ensureCalendarRow, replaceCalendarEvents } from '../store'
import type { ReplaceResult } from '../store'
import { syncWindow } from '../time'
import { safeErrorMessage } from './errors'
import { expandIcs } from './expand'
import { fetchIcs } from './fetch'

// One ICS calendar, end to end: fetch (conditionally), expand over the sync
// window, replace the stored events, record how it went. Nothing here runs by
// itself. The scheduler (PR 1.2) calls it on each calendar's poll interval and
// adds backoff for the calendars that fail.

export interface SyncIcsArgs {
  db: Db
  /** A calendar whose source is `ics`. */
  calendar: CalendarConfig
  /** The display time zone. */
  timeZone: string
  sync: SyncConfig
  /** Default: the current time. */
  now?: Date
  /** For tests. Default: the global `fetch`. */
  fetch?: typeof fetch
}

export type SyncIcsResult =
  | { status: 'not-modified' }
  | ({ status: 'updated', warnings: string[] } & ReplaceResult)

/**
 * Syncs one calendar. Throws if the fetch or the parse fails, after recording
 * the (URL-free) reason in `sync_status` and leaving the stored events as they
 * were.
 */
export async function syncIcsCalendar({ db, calendar, timeZone, sync, now = new Date(), fetch: fetchFn }: SyncIcsArgs): Promise<SyncIcsResult> {
  if (calendar.source.type !== 'ics') throw new Error(`calendar "${calendar.id}" is not an ICS calendar`)
  const { url } = calendar.source

  ensureCalendarRow(db, calendar)
  const window = syncWindow(now, timeZone, sync.months_back, sync.months_ahead)
  // What the stored events were expanded for. A feed that hasn't changed still
  // has to be read again when the window moves (a new month), or the zone or
  // default person changed.
  const expansionKey = [window.start.toISOString(), window.end.toISOString(), timeZone, calendar.person].join('|')
  const stored = db.select().from(syncStatus).where(eq(syncStatus.calendarId, calendar.id)).get()
  const previous = stored?.expansionKey === expansionKey ? stored : undefined
  const attemptedAt = now

  try {
    const response = await fetchIcs(url, {
      etag: previous?.etag ?? null,
      lastModified: previous?.lastModified ?? null,
    }, { fetch: fetchFn })

    if (response.status === 'not-modified') {
      recordStatus(db, calendar.id, { lastAttemptAt: attemptedAt, lastSuccessAt: attemptedAt, lastError: null })
      return { status: 'not-modified' }
    }

    const { events, warnings } = expandIcs(response.body, window, { timeZone })
    const result = replaceCalendarEvents(db, calendar.id, calendar.person, events)
    // Only now, with the events safely stored, remember the validators.
    recordStatus(db, calendar.id, {
      lastAttemptAt: attemptedAt,
      lastSuccessAt: attemptedAt,
      lastError: null,
      etag: response.etag,
      lastModified: response.lastModified,
      expansionKey,
      eventCount: result.total,
    })
    return { status: 'updated', warnings, ...result }
  } catch (error) {
    recordStatus(db, calendar.id, { lastAttemptAt: attemptedAt, lastError: safeErrorMessage(error) })
    throw error
  }
}

type StatusFields = Partial<Omit<typeof syncStatus.$inferInsert, 'calendarId'>>

/** Writes the given fields and leaves the others as they were. */
function recordStatus(db: Db, calendarId: string, fields: StatusFields): void {
  db.insert(syncStatus).values({ calendarId, ...fields }).onConflictDoUpdate({ target: syncStatus.calendarId, set: fields }).run()
}
