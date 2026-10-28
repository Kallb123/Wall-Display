import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// The database schema. After changing this file, run `pnpm db:generate` and
// commit the new migration in `server/db/migrations/`. CI fails if they differ.
//
// Conventions: snake_case column names. Timestamps are epoch milliseconds
// (read and written as `Date`). Booleans are 0/1. JSON columns hold text.

export const SOURCE_TYPES = ['ics', 'homeassistant'] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

export const PHOTO_PROVIDERS = ['immich', 'google', 'local'] as const
export type PhotoProvider = (typeof PHOTO_PROVIDERS)[number]

export const PHOTO_ORIENTATIONS = ['landscape', 'portrait'] as const
export type PhotoOrientation = (typeof PHOTO_ORIENTATIONS)[number]

export const SPECIAL_DAY_REPEATS = ['yearly', 'once'] as const
export type SpecialDayRepeat = (typeof SPECIAL_DAY_REPEATS)[number]

export const SPECIAL_DAY_LEADS = ['day', 'week', 'month'] as const
export type SpecialDayLead = (typeof SPECIAL_DAY_LEADS)[number]

export const SPECIAL_DAY_PALETTES = ['warm', 'night', 'frost', 'sage'] as const
export type SpecialDayPalette = (typeof SPECIAL_DAY_PALETTES)[number]

const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' })

/**
 * Mirrors the calendars in the config file (kept in line with it at boot by the
 * sync plugin), so events and sync status have something to point at.
 */
export const calendars = sqliteTable('calendars', {
  /** The calendar's id in the config. */
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** The calendar's default person. */
  personId: text('person_id').notNull(),
  sourceType: text('source_type', { enum: SOURCE_TYPES }).notNull(),
  /** Hash of the people and rules config, to spot when stored events need re-resolving. */
  configHash: text('config_hash').notNull(),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
})

/** One row per event, with recurring events already expanded into instances. */
export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  calendarId: text('calendar_id').notNull().references(() => calendars.id, { onDelete: 'cascade' }),
  /** The ICS UID (or the source's own id). */
  uid: text('uid').notNull(),
  /** Identifies one instance of a recurring event. Empty for a one-off event, so the unique index works. */
  recurrenceId: text('recurrence_id').notNull().default(''),
  /** The title as the source had it. */
  title: text('title').notNull(),
  /** The title shown on the wall (with any names stripped). */
  displayTitle: text('display_title').notNull(),
  description: text('description'),
  location: text('location'),
  /** Start and end as UTC instants. For all-day events, midnight in the display time zone. */
  startAt: timestamp('start_at').notNull(),
  endAt: timestamp('end_at').notNull(),
  allDay: integer('all_day', { mode: 'boolean' }).notNull().default(false),
  /** All-day events also keep their calendar dates (`YYYY-MM-DD`, end exclusive), so they never drift across time zones. */
  startDate: text('start_date'),
  endDate: text('end_date'),
  /** Person ids, in the order person detection found them. The first one sets the colour. */
  personIds: text('person_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
}, table => [
  uniqueIndex('events_calendar_uid_recurrence_idx').on(table.calendarId, table.uid, table.recurrenceId),
  index('events_start_at_idx').on(table.startAt),
  index('events_calendar_start_at_idx').on(table.calendarId, table.startAt),
])

/** How the last sync of each calendar went. */
export const syncStatus = sqliteTable('sync_status', {
  calendarId: text('calendar_id').primaryKey().references(() => calendars.id, { onDelete: 'cascade' }),
  lastAttemptAt: timestamp('last_attempt_at'),
  lastSuccessAt: timestamp('last_success_at'),
  /** The last failure, or null after a success. */
  lastError: text('last_error'),
  /** Validators for conditional ICS fetches. */
  etag: text('etag'),
  lastModified: text('last_modified'),
  /**
   * What the stored events were expanded for: the sync window, the time zone
   * and the default person. The validators above only apply while it still
   * matches, because a feed that hasn't changed still needs re-expanding when
   * the window moves.
   */
  expansionKey: text('expansion_key'),
  eventCount: integer('event_count').notNull().default(0),
})

/** One state document per display. The zod `DisplayState` arrives in PR 1.3. */
export const displayState = sqliteTable('display_state', {
  displayId: text('display_id').primaryKey(),
  state: text('state', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
})

/** Photos known to the photo frame, and whether they are in the local cache. */
export const photoAssets = sqliteTable('photo_assets', {
  /** `<provider>:<provider_asset_id>`. */
  id: text('id').primaryKey(),
  provider: text('provider', { enum: PHOTO_PROVIDERS }).notNull(),
  providerAssetId: text('provider_asset_id').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  orientation: text('orientation', { enum: PHOTO_ORIENTATIONS }).notNull(),
  takenAt: timestamp('taken_at'),
  /** File name in the photo cache, once downloaded. */
  cacheFile: text('cache_file'),
  cacheBytes: integer('cache_bytes'),
  fetchedAt: timestamp('fetched_at'),
  /** For least-recently-used eviction. */
  lastShownAt: timestamp('last_shown_at'),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
}, table => [
  index('photo_assets_provider_idx').on(table.provider),
  index('photo_assets_last_shown_at_idx').on(table.lastShownAt),
])

/** Dates with their own art (architecture §6.1). */
export const specialDays = sqliteTable('special_days', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  month: integer('month').notNull(),
  day: integer('day').notNull(),
  /** Set only when `repeat` is `once`. */
  year: integer('year'),
  repeat: text('repeat', { enum: SPECIAL_DAY_REPEATS }).notNull(),
  lead: text('lead', { enum: SPECIAL_DAY_LEADS }).notNull(),
  /** File names in `/data/special-days/`. */
  tileArt: text('tile_art'),
  takeover: integer('takeover', { mode: 'boolean' }).notNull().default(false),
  fullArt: text('full_art'),
  greeting: text('greeting'),
  palette: text('palette', { enum: SPECIAL_DAY_PALETTES }).notNull().default('warm'),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
}, table => [
  check('special_days_month_check', sql`${table.month} between 1 and 12`),
  check('special_days_day_check', sql`${table.day} between 1 and 31`),
  check('special_days_year_check', sql`(${table.repeat} = 'once') = (${table.year} is not null)`),
])

export type CalendarRow = typeof calendars.$inferSelect
export type NewCalendarRow = typeof calendars.$inferInsert
export type EventRow = typeof events.$inferSelect
export type NewEventRow = typeof events.$inferInsert
export type SyncStatusRow = typeof syncStatus.$inferSelect
export type NewSyncStatusRow = typeof syncStatus.$inferInsert
export type DisplayStateRow = typeof displayState.$inferSelect
export type NewDisplayStateRow = typeof displayState.$inferInsert
export type PhotoAssetRow = typeof photoAssets.$inferSelect
export type NewPhotoAssetRow = typeof photoAssets.$inferInsert
export type SpecialDayRow = typeof specialDays.$inferSelect
export type NewSpecialDayRow = typeof specialDays.$inferInsert
