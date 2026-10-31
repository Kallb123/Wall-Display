import { asc, eq } from 'drizzle-orm'
import { effectiveLook } from '../../shared/special-days'
import type { SpecialDay, SpecialDayInput, SpecialDayScene } from '../../shared/special-days'
import type { Db } from '../db/client'
import { specialDays, specialDayScenes } from '../db/schema'
import { copyName, slugFor, toSpecialDay, toSpecialDayScene } from './rows'

// Reads and writes the special days. Nothing here decides which dates they
// fall on; shared/special-days.ts does that. The wire format is snake_case and
// the rows are camelCase, so rows.ts is where one becomes the other.

export { slugFor }

/** The columns an edit sets. The art files are not here: they are set by the upload routes. */
function editableColumns(input: SpecialDayInput) {
  return {
    name: input.name,
    month: input.month,
    day: input.day,
    // The table insists on a year exactly when the day happens once.
    year: input.repeat === 'once' ? input.year : null,
    repeat: input.repeat,
    sceneId: input.scene_id,
    who: input.who,
    // And a since_year only when it repeats.
    sinceYear: input.repeat === 'yearly' ? input.since_year : null,
    // Null here means "use the scene's".
    lead: input.lead,
    // The table insists on a lead in days exactly when the lead is `days`.
    leadDays: input.lead === 'days' ? input.lead_days : null,
    takeover: input.takeover,
    greeting: input.greeting,
    palette: input.palette,
  }
}

/** Every special day, in calendar order: by month, then day, then name. */
export function listSpecialDays(db: Db): SpecialDay[] {
  return db.select().from(specialDays).orderBy(asc(specialDays.month), asc(specialDays.day), asc(specialDays.name), asc(specialDays.id)).all().map(toSpecialDay)
}

export function getSpecialDay(db: Db, id: string): SpecialDay | undefined {
  const row = db.select().from(specialDays).where(eq(specialDays.id, id)).get()
  return row && toSpecialDay(row)
}

/** Stores a new special day under a slug of its name, and returns it. */
export function createSpecialDay(db: Db, input: SpecialDayInput, now: Date): SpecialDay {
  const taken = new Set(db.select({ id: specialDays.id }).from(specialDays).all().map(row => row.id))
  const id = slugFor(input.name, taken)
  const row = db.insert(specialDays).values({ id, ...editableColumns(input), createdAt: now, updatedAt: now }).returning().get()
  return toSpecialDay(row)
}

/**
 * Replaces everything the editor sets, keeping the id and all the art
 * (including the extra art), and returns the special day. Null if there is
 * none with that id.
 */
export function updateSpecialDay(db: Db, id: string, input: SpecialDayInput, now: Date): SpecialDay | null {
  const row = db.update(specialDays).set({ ...editableColumns(input), updatedAt: now }).where(eq(specialDays.id, id)).returning().get()
  return row ? toSpecialDay(row) : null
}

/**
 * Deletes a special day and returns the art files it held (tile, full and
 * extra, without duplicates), so the caller can remove those nothing else
 * refers to. Null if there was no such day.
 */
export function deleteSpecialDay(db: Db, id: string): string[] | null {
  const row = db.delete(specialDays).where(eq(specialDays.id, id)).returning().get()
  if (!row) return null
  return [...new Set([row.tileArt, row.fullArt, row.extraArt].filter((name): name is string => name !== null))]
}

/**
 * Points one art slot of a special day at a stored file, or at nothing (null,
 * so the day falls back to its scene's art). Bumps `updated_at`, because this
 * is an edit of the day. Returns the day and the file the slot held before, so
 * the caller can remove it if nothing else refers to it. Null if there is no
 * such day.
 */
export function setSpecialDayArt(db: Db, id: string, slot: 'tile' | 'full' | 'extra', name: string | null, now: Date): { day: SpecialDay, previous: string | null } | null {
  const column = { tile: 'tileArt', full: 'fullArt', extra: 'extraArt' } as const
  return db.transaction((tx) => {
    const before = tx.select().from(specialDays).where(eq(specialDays.id, id)).get()
    if (!before) return null
    const row = tx.update(specialDays).set({ [column[slot]]: name, updatedAt: now }).where(eq(specialDays.id, id)).returning().get()
    return { day: toSpecialDay(row), previous: before[column[slot]] }
  })
}

/**
 * Copies a day under the name "Copy of …": the scene, `who`, `since_year`, its
 * own look and all its art, as it is. The copy shares the art files rather
 * than storing them twice. Null if there is no such day.
 */
export function duplicateSpecialDay(db: Db, id: string, now: Date): SpecialDay | null {
  return db.transaction((tx) => {
    const row = tx.select().from(specialDays).where(eq(specialDays.id, id)).get()
    if (!row) return null
    const taken = new Set(tx.select({ id: specialDays.id }).from(specialDays).all().map(other => other.id))
    const name = copyName(row.name)
    const copy = tx.insert(specialDays).values({ ...row, id: slugFor(name, taken), name, createdAt: now, updatedAt: now }).returning().get()
    return toSpecialDay(copy)
  })
}

/**
 * Makes a new scene from the look the day really has (its own values over its
 * scene's), and moves the day onto it with its own look cleared. `who`,
 * `since_year` and the extra art stay on the day. The scene is named `name`, or
 * after the day. The day's `updated_at` is left alone: the wall looks exactly
 * as it did, so which day wins a shared date must not move. Null if there is
 * no such day.
 */
export function saveDayAsScene(db: Db, id: string, name: string | undefined, now: Date): { scene: SpecialDayScene, day: SpecialDay } | null {
  return db.transaction((tx) => {
    const row = tx.select().from(specialDays).where(eq(specialDays.id, id)).get()
    if (!row) return null
    const current = row.sceneId === null ? undefined : tx.select().from(specialDayScenes).where(eq(specialDayScenes.id, row.sceneId)).get()
    const look = effectiveLook(toSpecialDay(row), current && toSpecialDayScene(current))

    const taken = new Set(tx.select({ id: specialDayScenes.id }).from(specialDayScenes).all().map(other => other.id))
    const sceneName = name ?? row.name
    const scene = tx.insert(specialDayScenes).values({
      id: slugFor(sceneName, taken, 'scene'),
      name: sceneName,
      lead: look.lead,
      leadDays: look.lead_days,
      tileArt: look.tile_art,
      takeover: look.takeover,
      fullArt: look.full_art,
      greeting: look.greeting,
      palette: look.palette,
      createdAt: now,
      updatedAt: now,
    }).returning().get()

    // updatedAt is set to itself: left out, the column's on-update default would stamp it.
    const day = tx.update(specialDays)
      .set({ sceneId: scene.id, lead: null, leadDays: null, tileArt: null, takeover: null, fullArt: null, greeting: null, palette: null, updatedAt: row.updatedAt })
      .where(eq(specialDays.id, id))
      .returning()
      .get()
    return { scene: toSpecialDayScene(scene), day: toSpecialDay(day) }
  })
}
