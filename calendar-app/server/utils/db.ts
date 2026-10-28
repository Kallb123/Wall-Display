import { getDb } from '../db/state'
import type { Db } from '../db/client'

/**
 * The Drizzle database, opened and migrated at boot by `server/plugins/01.db.ts`.
 * Server code only. Call it inside a handler or a later plugin, not at import time.
 */
export function useDb(): Db {
  const handle = getDb()
  if (!handle) {
    throw new Error('useDb() was called before the database was opened. The 01.db plugin opens it at boot; call useDb() inside a handler or a later plugin, not at import time.')
  }
  return handle.db
}
