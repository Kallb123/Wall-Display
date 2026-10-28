import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

export interface OpenDatabase {
  /** The raw connection, for closing it and for pragmas. */
  sqlite: BetterSqlite3.Database
  db: Db
}

export interface MigrationResult {
  /** Migrations run by this call. */
  applied: number
  /** Migrations in the database afterwards. */
  total: number
}

/**
 * Opens the SQLite file (or `:memory:`), creating its folder if needed, with
 * the settings the app relies on: WAL, so readers don't block the writer;
 * foreign keys on, so deletes cascade; and a busy timeout instead of an
 * instant "database is locked".
 */
export function openDatabase(file: string): OpenDatabase {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })

  const sqlite = new BetterSqlite3(file)
  try {
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('busy_timeout = 5000')
    sqlite.pragma('synchronous = NORMAL')
  } catch (error) {
    sqlite.close()
    throw error
  }

  return { sqlite, db: drizzle(sqlite, { schema }) }
}

function countApplied(sqlite: BetterSqlite3.Database): number {
  const table = sqlite.prepare(`select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'`).get()
  if (!table) return 0
  return (sqlite.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number }).n
}

/**
 * Applies any migrations in `folder` that the database hasn't seen. Running it
 * again is a no-op.
 */
export function runMigrations({ sqlite, db }: OpenDatabase, folder: string): MigrationResult {
  const before = countApplied(sqlite)
  // Read first so a missing or empty folder is an error here, not a silent no-op.
  const available = readMigrationFiles({ migrationsFolder: folder })
  if (available.length === 0) throw new Error(`No migrations found in ${folder}`)

  migrate(db, { migrationsFolder: folder })

  const total = countApplied(sqlite)
  return { applied: total - before, total }
}
