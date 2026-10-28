import { eq } from 'drizzle-orm'
import { displayStateSchema } from '../../shared/display'
import type { DisplayState } from '../../shared/display'
import type { Db } from '../db/client'
import { displayState } from '../db/schema'

// Reads and writes a display's state document. Nothing here decides what the
// state should be; commands.ts does that.

/**
 * The stored state, with defaults filled in for any field added since it was
 * written. Undefined if the display has none yet, or if the stored document
 * can't be read (that is logged, and the caller starts again from the defaults).
 */
export function loadDisplayState(db: Db, displayId: string, log: Pick<Console, 'warn'> = console): DisplayState | undefined {
  const row = db.select().from(displayState).where(eq(displayState.displayId, displayId)).get()
  if (!row) return undefined

  const parsed = displayStateSchema.safeParse(row.state)
  if (!parsed.success) {
    log.warn(`[control] ${displayId}: the stored state could not be read, so it starts from the defaults (${parsed.error.issues[0]?.path.join('.') || 'document'} is invalid)`)
    return undefined
  }
  return parsed.data
}

/** Stores `state` as the display's one state document, replacing any earlier one. */
export function saveDisplayState(db: Db, displayId: string, state: DisplayState): void {
  const updatedAt = new Date()
  db.insert(displayState).values({ displayId, state, updatedAt }).onConflictDoUpdate({
    target: displayState.displayId,
    set: { state, updatedAt },
  }).run()
}
