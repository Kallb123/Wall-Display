import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { openDatabase, runMigrations } from '../../../server/db/client'
import type { Db, OpenDatabase } from '../../../server/db/client'
import { calendars } from '../../../server/db/schema'

export const MIGRATIONS_DIR = join(import.meta.dirname, '../../../server/db/migrations')

const dirs: string[] = []
const open: OpenDatabase[] = []

afterEach(async () => {
  for (const handle of open.splice(0)) {
    if (handle.sqlite.open) handle.sqlite.close()
  }
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wallcal-db-'))
  dirs.push(dir)
  return dir
}

/** Opens a database that is closed after the test. */
export function track(handle: OpenDatabase): OpenDatabase {
  open.push(handle)
  return handle
}

/** A migrated in-memory database. */
export function migratedMemoryDb(): OpenDatabase {
  const handle = track(openDatabase(':memory:'))
  runMigrations(handle, MIGRATIONS_DIR)
  return handle
}

export function insertCalendar(db: Db, id = 'family'): void {
  db.insert(calendars).values({
    id,
    name: 'Family',
    personId: 'household',
    sourceType: 'ics',
    configHash: 'abc',
  }).run()
}
