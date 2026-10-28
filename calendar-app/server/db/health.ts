import { sql } from 'drizzle-orm'
import type { Db } from './client'

/** Runs a trivial query. Returns the error message on failure, or null when the database answers. */
export function checkDb(db: Db): string | null {
  try {
    db.run(sql`select 1`)
    return null
  } catch (error) {
    // Drizzle wraps the driver's error, so include the cause for the log.
    if (!(error instanceof Error)) return String(error)
    return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message
  }
}
