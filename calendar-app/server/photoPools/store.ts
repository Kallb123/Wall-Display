import { asc, eq, sql } from 'drizzle-orm'
import { photoPoolSchema } from '../../shared/photoPools'
import type { PhotoPool, PhotoPoolInput } from '../../shared/photoPools'
import type { Db } from '../db/client'
import { photoPools } from '../db/schema'
import type { PhotoPoolRow } from '../db/schema'
import { slugFor } from '../special-days/rows'
import { PhotoPoolError } from './errors'

// Reads and writes the photo pools made on the Photos tab. Like the layout
// store, it only stores: the editor sends whole pools, and what the config
// allows (see checks.ts) is checked by the routes before they get here.

/** A row as the wire format, or null if what it holds no longer parses. */
function toPool(row: PhotoPoolRow): PhotoPool | null {
  try {
    const parsed = photoPoolSchema.safeParse({
      id: row.id,
      name: row.name,
      sources: JSON.parse(row.sources),
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    })
    if (parsed.success) return parsed.data
    console.warn(`[photo pools] skipping "${row.id}": ${parsed.error.issues[0]!.path.join('.')} ${parsed.error.issues[0]!.message}`)
  } catch (error) {
    console.warn(`[photo pools] skipping "${row.id}": ${error instanceof Error ? error.message : String(error)}`)
  }
  return null
}

const present = (pool: PhotoPool | null): pool is PhotoPool => pool !== null

/** Every pool, by name. A stored row that no longer parses is left out with a warning. */
export function listPhotoPools(db: Db): PhotoPool[] {
  return db.select().from(photoPools).orderBy(sql`lower(${photoPools.name})`, asc(photoPools.id)).all().map(toPool).filter(present)
}

export function getPhotoPool(db: Db, id: string): PhotoPool | undefined {
  const row = db.select().from(photoPools).where(eq(photoPools.id, id)).get()
  return (row && toPool(row)) ?? undefined
}

/** Refuses a name that another pool already has, ignoring case. */
function checkNameFree(db: Pick<Db, 'select'>, name: string, exceptId: string | null): void {
  const clash = db.select({ id: photoPools.id }).from(photoPools).where(sql`lower(${photoPools.name}) = ${name.toLowerCase()}`).all()
  if (clash.some(row => row.id !== exceptId)) throw new PhotoPoolError(`There is already a pool called "${name}"`)
}

/**
 * Stores a new pool under a slug of its name, and returns it. `reserved` are ids
 * the slug must avoid because they already name a photo feed (the source names
 * and the config's `photos.feeds` ids), so a pool never shadows one. Throws
 * `PhotoPoolError` (409) if the name is taken.
 */
export function createPhotoPool(db: Db, input: PhotoPoolInput, now: Date, reserved: readonly string[] = []): PhotoPool {
  return db.transaction((tx) => {
    checkNameFree(tx, input.name, null)
    const taken = new Set([...tx.select({ id: photoPools.id }).from(photoPools).all().map(row => row.id), ...reserved])
    const row = tx.insert(photoPools).values({
      id: slugFor(input.name, taken, 'pool'),
      name: input.name,
      sources: JSON.stringify(input.sources),
      createdAt: now,
      updatedAt: now,
    }).returning().get()
    return toPool(row)!
  })
}

/** Replaces the name and sources, keeping the id. Null if there is no such pool. Throws `PhotoPoolError` (409) if the name is taken. */
export function updatePhotoPool(db: Db, id: string, input: PhotoPoolInput, now: Date): PhotoPool | null {
  return db.transaction((tx) => {
    if (!tx.select({ id: photoPools.id }).from(photoPools).where(eq(photoPools.id, id)).get()) return null
    checkNameFree(tx, input.name, id)
    const row = tx.update(photoPools).set({
      name: input.name,
      sources: JSON.stringify(input.sources),
      updatedAt: now,
    }).where(eq(photoPools.id, id)).returning().get()
    return row ? toPool(row) : null
  })
}

/** Deletes a pool. False if there was none. Whether a layout still shows it is the caller's check. */
export function deletePhotoPool(db: Db, id: string): boolean {
  return db.delete(photoPools).where(eq(photoPools.id, id)).returning({ id: photoPools.id }).all().length > 0
}
