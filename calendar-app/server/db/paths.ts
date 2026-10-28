import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export type Env = Record<string, string | undefined>

export interface DataDirOptions {
  env: Env
  /** True under `nuxt dev`, where a missing env falls back to a local `.data` folder. */
  dev: boolean
  /** The calendar-app folder, where the dev data folder lives. */
  rootDir: string
}

export const DB_FILE_NAME = 'wallcal.db'

const DEFAULT_DATA_DIR = '/data'

function set(value: string | undefined): value is string {
  return value !== undefined && value !== ''
}

/**
 * Works out where the app keeps its data (the database, and later the photo
 * cache and special day art):
 *
 * 1. `WALLCAL_DATA_DIR`, if set.
 * 2. Under `nuxt dev`, `.data` in the calendar-app folder (git-ignored).
 * 3. `/data`.
 */
export function resolveDataDir({ env, dev, rootDir }: DataDirOptions): string {
  if (set(env.WALLCAL_DATA_DIR)) return resolve(env.WALLCAL_DATA_DIR)
  if (dev) return join(rootDir, '.data')
  return DEFAULT_DATA_DIR
}

export interface MigrationsDirOptions {
  env: Env
  dev: boolean
  /** The calendar-app folder. Under `nuxt dev` the migrations are read from its `server/db/migrations`. */
  rootDir: string
  /** The folder holding the server entry script, `.output/server` (production). */
  bundleDir: string
}

const MIGRATIONS_PATH = join('db', 'migrations')
const JOURNAL_PATH = join('meta', '_journal.json')

function hasMigrations(dir: string): boolean {
  return existsSync(join(dir, JOURNAL_PATH))
}

/**
 * Works out where the generated SQL migrations are:
 *
 * 1. `WALLCAL_MIGRATIONS_DIR`, if set.
 * 2. Under `nuxt dev`, `server/db/migrations` in the calendar-app folder.
 * 3. Otherwise `db/migrations`, which the build copies next to the server
 *    bundle (`.output/server/db/migrations`). It is looked for in `bundleDir`
 *    and a few folders above it.
 */
export function findMigrationsDir({ env, dev, rootDir, bundleDir }: MigrationsDirOptions): string {
  if (set(env.WALLCAL_MIGRATIONS_DIR)) return resolve(env.WALLCAL_MIGRATIONS_DIR)
  if (dev) return join(rootDir, 'server', MIGRATIONS_PATH)

  const tried: string[] = []
  for (let dir = bundleDir, i = 0; i < 6; i++) {
    const candidate = join(dir, MIGRATIONS_PATH)
    if (hasMigrations(candidate)) return candidate
    tried.push(candidate)
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`Could not find the database migrations. Looked in: ${tried.join(', ')}. Set WALLCAL_MIGRATIONS_DIR to the folder holding them.`)
}
