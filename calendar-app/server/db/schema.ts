import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { PHOTO_RENDITIONS } from '../../shared/photos'
import { STAR_PERIODS } from '../../shared/stars'

// The database schema. After changing this file, run `pnpm db:generate` and
// commit the new migration in `server/db/migrations/`. CI fails if they differ.
//
// Conventions: snake_case column names. Timestamps are epoch milliseconds
// (read and written as `Date`). Booleans are 0/1. JSON columns hold text.

export const SOURCE_TYPES = ['ics', 'homeassistant'] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

export const PHOTO_ORIENTATIONS = ['landscape', 'portrait'] as const
export type PhotoOrientation = (typeof PHOTO_ORIENTATIONS)[number]

export const SPECIAL_DAY_REPEATS = ['yearly', 'once'] as const
export type SpecialDayRepeat = (typeof SPECIAL_DAY_REPEATS)[number]

export const SPECIAL_DAY_LEADS = ['day', 'week', 'month', 'days'] as const
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

/**
 * One state document per display, in the shape of `DisplayState` in
 * shared/display.ts. It is parsed on the way out, with defaults for fields
 * added later, so it needs no migration when the state grows.
 */
export const displayState = sqliteTable('display_state', {
  displayId: text('display_id').primaryKey(),
  state: text('state', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
})

/** Photos known to the photo frame, and whether they are in the local cache. */
export const photoAssets = sqliteTable('photo_assets', {
  /** `<feed>:<provider_asset_id>`. */
  id: text('id').primaryKey(),
  /** The photo feed it is in: a source's own (`immich`, `local`, `unsplash`) or one of `photos.feeds`. */
  provider: text('provider').notNull(),
  providerAssetId: text('provider_asset_id').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  orientation: text('orientation', { enum: PHOTO_ORIENTATIONS }).notNull(),
  takenAt: timestamp('taken_at'),
  /** Who to credit for it on the frame ("Photo by … on Unsplash"), when its source asks for that. */
  credit: text('credit'),
  /** When this photo was last on any display, in any rendition. */
  lastShownAt: timestamp('last_shown_at'),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
}, table => [
  index('photo_assets_provider_idx').on(table.provider),
  index('photo_assets_last_shown_at_idx').on(table.lastShownAt),
])

/**
 * The rendered files of a photo in the cache (architecture §5.1): one per shape
 * of stage it has been drawn for, so a wall and a portrait phone showing the same
 * photo each get an image of their own size. Gone with the photo.
 */
export const photoRenditions = sqliteTable('photo_renditions', {
  assetId: text('asset_id').notNull().references(() => photoAssets.id, { onDelete: 'cascade' }),
  rendition: text('rendition', { enum: PHOTO_RENDITIONS }).notNull(),
  /** File name in the photo cache. */
  cacheFile: text('cache_file').notNull(),
  cacheBytes: integer('cache_bytes').notNull(),
  fetchedAt: timestamp('fetched_at').notNull(),
  /** For least-recently-used eviction. */
  lastShownAt: timestamp('last_shown_at'),
}, table => [
  primaryKey({ columns: [table.assetId, table.rendition] }),
  index('photo_renditions_cache_file_idx').on(table.cacheFile),
])

/**
 * Where each display is in its shuffled photo playlist (architecture §5.1),
 * per provider, so a restart carries on instead of starting a new round. The
 * order is every asset id in the pool, and the first `position` of them have
 * been shown this round.
 */
export const photoPlaylists = sqliteTable('photo_playlists', {
  displayId: text('display_id').notNull(),
  /** The photo feed, as in `photo_assets.provider`. */
  provider: text('provider').notNull(),
  /** Asset ids (`photo_assets.id`), as a JSON array. */
  order: text('order', { mode: 'json' }).$type<string[]>().notNull().default([]),
  position: integer('position').notNull().default(0),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
}, table => [
  primaryKey({ columns: [table.displayId, table.provider] }),
])

/**
 * Looks that several special days share (architecture §6.1). A day's own look
 * fields override its scene's, field by field, so on a scene they are all set.
 * Defined before `specialDays`, which points at it.
 */
export const specialDayScenes = sqliteTable('special_day_scenes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  lead: text('lead', { enum: SPECIAL_DAY_LEADS }).notNull(),
  /** Days before the day the tile art starts to show. Set only when `lead` is `days`. */
  leadDays: integer('lead_days'),
  /** File names in `/data/special-days/`. */
  tileArt: text('tile_art'),
  takeover: integer('takeover', { mode: 'boolean' }).notNull().default(false),
  fullArt: text('full_art'),
  /** The full art for a portrait stage (1440×2560). Null shows none there. */
  fullArtPortrait: text('full_art_portrait'),
  /** A layer always behind the view, under the full art (a sky), and its portrait cut. Null for none. */
  backdropArt: text('backdrop_art'),
  backdropArtPortrait: text('backdrop_art_portrait'),
  greeting: text('greeting'),
  palette: text('palette', { enum: SPECIAL_DAY_PALETTES }).notNull().default('warm'),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
}, table => [
  // Each branch says "is not null" outright, because a CHECK passes when it
  // comes out NULL, which is what a bare comparison with a NULL gives.
  check('special_day_scenes_lead_days_check', sql`(${table.lead} = 'days' and ${table.leadDays} is not null and ${table.leadDays} between 1 and 365) or (${table.lead} <> 'days' and ${table.leadDays} is null)`),
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
  /** The scene this day takes its look from. Null fields below fall back to it. */
  sceneId: text('scene_id').references(() => specialDayScenes.id, { onDelete: 'restrict' }),
  /** Who the day is about, for `{who}` in the greeting. */
  who: text('who'),
  /** The year it first happened, for `{years}` and `{nth}`. Only for a day that repeats. */
  sinceYear: integer('since_year'),
  /** The look fields are null when the day leaves them to its scene (or the default). */
  lead: text('lead', { enum: SPECIAL_DAY_LEADS }),
  /** Days before the day the tile art starts to show. Set only when `lead` is `days`. */
  leadDays: integer('lead_days'),
  /** File names in `/data/special-days/`. */
  tileArt: text('tile_art'),
  takeover: integer('takeover', { mode: 'boolean' }),
  fullArt: text('full_art'),
  /** Goes with `fullArt`: a day with either has both of its own, so it never shows its scene's picture half way. */
  fullArtPortrait: text('full_art_portrait'),
  /** The backdrop, always behind the view, and its portrait cut. They go with `fullArt` too. */
  backdropArt: text('backdrop_art'),
  backdropArtPortrait: text('backdrop_art_portrait'),
  /** Extra art for this day alone, shown over its look. Scenes have none. */
  extraArt: text('extra_art'),
  /** The extra art for a portrait stage, cropped to line up with `fullArtPortrait`. */
  extraArtPortrait: text('extra_art_portrait'),
  greeting: text('greeting'),
  palette: text('palette', { enum: SPECIAL_DAY_PALETTES }),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
}, table => [
  check('special_days_month_check', sql`${table.month} between 1 and 12`),
  check('special_days_day_check', sql`${table.day} between 1 and 31`),
  check('special_days_year_check', sql`(${table.repeat} = 'once') = (${table.year} is not null)`),
  // A null lead means "use the scene's", and then there is no count either.
  // Each branch says "is not null" outright, because a CHECK passes when it
  // comes out NULL, which is what a bare comparison with a NULL gives.
  check('special_days_lead_days_check', sql`(${table.lead} is null and ${table.leadDays} is null) or (${table.lead} is not null and ${table.lead} = 'days' and ${table.leadDays} is not null and ${table.leadDays} between 1 and 365) or (${table.lead} is not null and ${table.lead} <> 'days' and ${table.leadDays} is null)`),
  check('special_days_since_year_check', sql`${table.sinceYear} is null or (${table.repeat} = 'yearly' and ${table.sinceYear} between 1900 and 2100)`),
  index('special_days_scene_id_idx').on(table.sceneId),
])

/**
 * Preferences saved on the settings page (PR 5.6), on top of config.yaml. One
 * row per scope: `display:<id>` for a display's own, `shared` for the ones every
 * display shares. `values` holds only the overridden keys, as JSON. A row for a
 * display no longer in the config is left alone and ignored.
 */
export const preferenceOverrides = sqliteTable('preference_overrides', {
  scope: text('scope').primaryKey(),
  values: text('values', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
})

/**
 * The shared library of custom layouts (PR 5.17): view components arranged
 * into rows and panes, one arrangement for a landscape wall and one for a
 * portrait wall, both as JSON in the shape of `LayoutArrangement` in
 * shared/layouts.ts. `options` is the pane options as JSON (`LayoutOptions`),
 * '{}' for a layout saved before they existed. The id is a slug of the name. The unique index on the
 * lower-cased name keeps Home Assistant's select, which uses names as its
 * options, unambiguous.
 */
export const customLayouts = sqliteTable('custom_layouts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  landscape: text('landscape').notNull(),
  portrait: text('portrait').notNull(),
  options: text('options').notNull().default('{}'),
  /** The photo feed the layout's photo pane shows, or null for the display's own choice. */
  photoFeed: text('photo_feed'),
  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, table => [
  uniqueIndex('custom_layouts_name_idx').on(sql`lower(${table.name})`),
])

/**
 * Who has a star chart (PR 5.20), and how. One row per person in the config
 * who has ever had their settings saved; no row means the chart is off. Rows
 * for people since removed from the config are kept and ignored, so adding
 * the person back brings their settings back.
 */
export const starChartPeople = sqliteTable('star_chart_people', {
  /** The person's id in the config. Not a foreign key: people live in the config, not here. */
  personId: text('person_id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  /** What the goal and the wall's total count over. */
  period: text('period', { enum: STAR_PERIODS }).notNull().default('week'),
  /** Stars per period that count as a good day or week. Null for no goal. */
  goal: integer('goal'),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, table => [
  check('star_chart_people_period_check', sql`${table.period} in ('day', 'week')`),
  check('star_chart_people_goal_check', sql`${table.goal} is null or ${table.goal} >= 1`),
])

/** The stars a person has on a day (PR 5.20). A day with none has no row, so a count is always at least 1 in practice, though 0 is allowed. */
export const starCounts = sqliteTable('star_counts', {
  personId: text('person_id').notNull(),
  /** The day in the config's time zone, `YYYY-MM-DD`. */
  date: text('date').notNull(),
  count: integer('count').notNull(),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
}, table => [
  primaryKey({ columns: [table.personId, table.date] }),
  check('star_counts_count_check', sql`${table.count} >= 0`),
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
export type PhotoRenditionRow = typeof photoRenditions.$inferSelect
export type NewPhotoRenditionRow = typeof photoRenditions.$inferInsert
export type PhotoPlaylistRow = typeof photoPlaylists.$inferSelect
export type NewPhotoPlaylistRow = typeof photoPlaylists.$inferInsert
export type SpecialDaySceneRow = typeof specialDayScenes.$inferSelect
export type NewSpecialDaySceneRow = typeof specialDayScenes.$inferInsert
export type SpecialDayRow = typeof specialDays.$inferSelect
export type NewSpecialDayRow = typeof specialDays.$inferInsert
export type PreferenceOverrideRow = typeof preferenceOverrides.$inferSelect
export type NewPreferenceOverrideRow = typeof preferenceOverrides.$inferInsert
export type CustomLayoutRow = typeof customLayouts.$inferSelect
export type NewCustomLayoutRow = typeof customLayouts.$inferInsert
export type StarChartPersonRow = typeof starChartPeople.$inferSelect
export type NewStarChartPersonRow = typeof starChartPeople.$inferInsert
export type StarCountRow = typeof starCounts.$inferSelect
export type NewStarCountRow = typeof starCounts.$inferInsert
