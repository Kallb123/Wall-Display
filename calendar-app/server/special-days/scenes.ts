import { and, asc, eq } from 'drizzle-orm'
import type { SpecialDaySceneInput, SpecialDayScene } from '../../shared/special-days'
import type { Db } from '../db/client'
import { specialDays, specialDayScenes } from '../db/schema'
import { SpecialDayError, joinList } from './errors'
import type { DayRef } from './errors'
import { copyName, slugFor, toSpecialDayScene } from './rows'

// Reads and writes the scenes (architecture §6.1): looks that special days
// share. Like the day store, it only stores. What a scene does to the wall is
// worked out in shared/special-days.ts.

/** The columns an edit sets. The art files are not here: they are set by the upload routes. */
function editableColumns(input: SpecialDaySceneInput) {
  return {
    name: input.name,
    lead: input.lead,
    // The table insists on a lead in days exactly when the lead is `days`.
    leadDays: input.lead === 'days' ? input.lead_days : null,
    takeover: input.takeover,
    greeting: input.greeting,
    palette: input.palette,
  }
}

/** Every scene, by name. */
export function listScenes(db: Db): SpecialDayScene[] {
  return db.select().from(specialDayScenes).orderBy(asc(specialDayScenes.name), asc(specialDayScenes.id)).all().map(toSpecialDayScene)
}

export function getScene(db: Db, id: string): SpecialDayScene | undefined {
  const row = db.select().from(specialDayScenes).where(eq(specialDayScenes.id, id)).get()
  return row && toSpecialDayScene(row)
}

/** Stores a new scene under a slug of its name, and returns it. */
export function createScene(db: Db, input: SpecialDaySceneInput, now: Date): SpecialDayScene {
  const taken = new Set(db.select({ id: specialDayScenes.id }).from(specialDayScenes).all().map(row => row.id))
  const id = slugFor(input.name, taken, 'scene')
  const row = db.insert(specialDayScenes).values({ id, ...editableColumns(input), createdAt: now, updatedAt: now }).returning().get()
  return toSpecialDayScene(row)
}

/**
 * Replaces everything the editor sets, keeping the id and the art, and returns
 * the scene. Null if there is none with that id. The days using it keep their
 * own `updated_at`, so which of two days on one date wins doesn't change.
 */
export function updateScene(db: Db, id: string, input: SpecialDaySceneInput, now: Date): SpecialDayScene | null {
  const row = db.update(specialDayScenes).set({ ...editableColumns(input), updatedAt: now }).where(eq(specialDayScenes.id, id)).returning().get()
  return row ? toSpecialDayScene(row) : null
}

/** An independent copy under the name "Copy of …", art files shared. Null if there is no such scene. */
export function duplicateScene(db: Db, id: string, now: Date): SpecialDayScene | null {
  return db.transaction((tx) => {
    const row = tx.select().from(specialDayScenes).where(eq(specialDayScenes.id, id)).get()
    if (!row) return null
    const taken = new Set(tx.select({ id: specialDayScenes.id }).from(specialDayScenes).all().map(other => other.id))
    const name = copyName(row.name)
    const copy = tx.insert(specialDayScenes).values({ ...row, id: slugFor(name, taken, 'scene'), name, createdAt: now, updatedAt: now }).returning().get()
    return toSpecialDayScene(copy)
  })
}

/** The days that use the scene, in calendar order. */
export function daysUsingScene(db: Pick<Db, 'select'>, id: string): DayRef[] {
  return db.select({ id: specialDays.id, name: specialDays.name }).from(specialDays)
    .where(eq(specialDays.sceneId, id))
    .orderBy(asc(specialDays.month), asc(specialDays.day), asc(specialDays.name), asc(specialDays.id))
    .all()
}

/**
 * Deletes a scene. One still in use is refused with a 409 naming its days,
 * unless `detach` is set: then each day first takes the scene's value for every
 * part of the look it left empty (`lead` with `lead_days`), and leaves the
 * scene, so the wall looks the same afterwards. A detached day's `updated_at`
 * is left alone for the same reason. All in one transaction. False if there was
 * no such scene.
 */
export function deleteScene(db: Db, id: string, { detach = false }: { detach?: boolean } = {}): boolean {
  return db.transaction((tx) => {
    const scene = tx.select().from(specialDayScenes).where(eq(specialDayScenes.id, id)).get()
    if (!scene) return false

    const users = tx.select().from(specialDays).where(eq(specialDays.sceneId, id)).all()
    if (users.length > 0 && !detach) {
      const days = daysUsingScene(tx, id)
      throw new SpecialDayError(409, `Scene "${scene.name}" is used by ${joinList(days.map(day => day.name))}`, days)
    }

    for (const day of users) {
      const ownLead = day.lead !== null
      tx.update(specialDays).set({
        sceneId: null,
        lead: ownLead ? day.lead : scene.lead,
        leadDays: ownLead ? day.leadDays : scene.leadDays,
        tileArt: day.tileArt ?? scene.tileArt,
        takeover: day.takeover ?? scene.takeover,
        fullArt: day.fullArt ?? scene.fullArt,
        greeting: day.greeting ?? scene.greeting,
        palette: day.palette ?? scene.palette,
        // Set to itself: left out, the column's on-update default would stamp it.
        updatedAt: day.updatedAt,
      }).where(and(eq(specialDays.id, day.id), eq(specialDays.sceneId, id))).run()
    }
    tx.delete(specialDayScenes).where(eq(specialDayScenes.id, id)).run()
    return true
  })
}
