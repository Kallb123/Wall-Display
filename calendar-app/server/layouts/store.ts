import { asc, eq, sql } from 'drizzle-orm'
import { customLayoutSchema, layoutPhotoFeed, MAX_LAYOUT_NAME } from '../../shared/layouts'
import type { CustomLayout, CustomLayoutInput } from '../../shared/layouts'
import type { Db } from '../db/client'
import { customLayouts } from '../db/schema'
import type { CustomLayoutRow } from '../db/schema'
import { slugFor } from '../special-days/rows'
import { LayoutError } from './errors'

// Reads and writes the shared library of custom layouts (PR 5.17). Like the
// special day stores, it only stores: the editors send whole layouts, and what
// the wall does with one is worked out in shared/layouts.ts and the display.

/** A row as the wire format, or null if what it holds no longer parses. */
function toLayout(row: CustomLayoutRow): CustomLayout | null {
  try {
    const parsed = customLayoutSchema.safeParse({
      id: row.id,
      name: row.name,
      landscape: JSON.parse(row.landscape),
      portrait: JSON.parse(row.portrait),
      options: JSON.parse(row.options),
      photo_feed: row.photoFeed,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    })
    if (parsed.success) return parsed.data
    console.warn(`[layouts] skipping "${row.id}": ${parsed.error.issues[0]!.path.join('.')} ${parsed.error.issues[0]!.message}`)
  } catch (error) {
    console.warn(`[layouts] skipping "${row.id}": ${error instanceof Error ? error.message : String(error)}`)
  }
  return null
}

const present = (layout: CustomLayout | null): layout is CustomLayout => layout !== null

/** Every layout, by name. A stored row that no longer parses is left out with a warning. */
export function listLayouts(db: Db): CustomLayout[] {
  return db.select().from(customLayouts).orderBy(sql`lower(${customLayouts.name})`, asc(customLayouts.id)).all().map(toLayout).filter(present)
}

export function getLayout(db: Db, id: string): CustomLayout | undefined {
  const row = db.select().from(customLayouts).where(eq(customLayouts.id, id)).get()
  return (row && toLayout(row)) ?? undefined
}

/** Refuses a name that another layout already has, ignoring case, because Home Assistant's select uses the names as its options. */
function checkNameFree(db: Pick<Db, 'select'>, name: string, exceptId: string | null): void {
  const clash = db.select({ id: customLayouts.id }).from(customLayouts).where(sql`lower(${customLayouts.name}) = ${name.toLowerCase()}`).all()
  if (clash.some(row => row.id !== exceptId)) throw new LayoutError(`There is already a layout called "${name}"`)
}

/** Stores a new layout under a slug of its name, and returns it. Throws `LayoutError` (409) if the name is taken. */
export function createLayout(db: Db, input: CustomLayoutInput, now: Date): CustomLayout {
  return db.transaction((tx) => {
    checkNameFree(tx, input.name, null)
    const taken = new Set(tx.select({ id: customLayouts.id }).from(customLayouts).all().map(row => row.id))
    const row = tx.insert(customLayouts).values({
      id: slugFor(input.name, taken, 'layout'),
      name: input.name,
      landscape: JSON.stringify(input.landscape),
      portrait: JSON.stringify(input.portrait),
      options: JSON.stringify(input.options),
      photoFeed: layoutPhotoFeed(input),
      createdAt: now,
      updatedAt: now,
    }).returning().get()
    return toLayout(row)!
  })
}

/** Replaces everything the editor sets, keeping the id. Null if there is no such layout. Throws `LayoutError` (409) if the name is taken. */
export function updateLayout(db: Db, id: string, input: CustomLayoutInput, now: Date): CustomLayout | null {
  return db.transaction((tx) => {
    if (!tx.select({ id: customLayouts.id }).from(customLayouts).where(eq(customLayouts.id, id)).get()) return null
    checkNameFree(tx, input.name, id)
    const row = tx.update(customLayouts).set({
      name: input.name,
      landscape: JSON.stringify(input.landscape),
      portrait: JSON.stringify(input.portrait),
      options: JSON.stringify(input.options),
      photoFeed: layoutPhotoFeed(input),
      updatedAt: now,
    }).where(eq(customLayouts.id, id)).returning().get()
    return row ? toLayout(row) : null
  })
}

/** "Copy of <name>", then "Copy of <name> 2" and so on until no layout has it, cut to the longest name allowed. */
function copyName(name: string, taken: ReadonlySet<string>): string {
  const fit = (text: string) => text.slice(0, MAX_LAYOUT_NAME).trim()
  for (let n = 1; ; n++) {
    const candidate = fit(n === 1 ? `Copy of ${name}` : `${fit(`Copy of ${name}`).slice(0, MAX_LAYOUT_NAME - ` ${n}`.length).trim()} ${n}`)
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

/** An independent copy under the name "Copy of …". Null if there is no such layout. */
export function duplicateLayout(db: Db, id: string, now: Date): CustomLayout | null {
  return db.transaction((tx) => {
    const row = tx.select().from(customLayouts).where(eq(customLayouts.id, id)).get()
    if (!row) return null
    const all = tx.select({ id: customLayouts.id, name: customLayouts.name }).from(customLayouts).all()
    const name = copyName(row.name, new Set(all.map(other => other.name.toLowerCase())))
    const copy = tx.insert(customLayouts).values({ ...row, id: slugFor(name, new Set(all.map(other => other.id)), 'layout'), name, createdAt: now, updatedAt: now }).returning().get()
    return toLayout(copy)
  })
}

/** Deletes a layout. False if there was none. Whether a schedule still names it is the caller's check, because that lives in the config. */
export function deleteLayout(db: Db, id: string): boolean {
  return db.delete(customLayouts).where(eq(customLayouts.id, id)).returning({ id: customLayouts.id }).all().length > 0
}
