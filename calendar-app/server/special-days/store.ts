import { asc, eq } from 'drizzle-orm'
import type { SpecialDay, SpecialDayInput } from '../../shared/special-days'
import type { Db } from '../db/client'
import { specialDays } from '../db/schema'
import type { SpecialDayRow } from '../db/schema'

// Reads and writes the special days. Nothing here decides which dates they
// fall on; shared/special-days.ts does that. The wire format is snake_case and
// the rows are camelCase, so this is where one becomes the other.

/** Ids that would shadow a route, so no special day gets one: `/api/special-days/resolved` is not a day. */
const RESERVED_IDS = ['resolved']

const MAX_SLUG_LENGTH = 40

function toSpecialDay(row: SpecialDayRow): SpecialDay {
  return {
    id: row.id,
    name: row.name,
    month: row.month,
    day: row.day,
    year: row.year,
    repeat: row.repeat,
    lead: row.lead,
    lead_days: row.leadDays,
    tile_art: row.tileArt,
    takeover: row.takeover,
    full_art: row.fullArt,
    greeting: row.greeting,
    palette: row.palette,
    updated_at: row.updatedAt.toISOString(),
  }
}

/** The columns an edit sets. The art files are not here: they are set by the upload routes. */
function editableColumns(input: SpecialDayInput) {
  return {
    name: input.name,
    month: input.month,
    day: input.day,
    // The table insists on a year exactly when the day happens once.
    year: input.repeat === 'once' ? input.year : null,
    repeat: input.repeat,
    lead: input.lead,
    // And a lead in days exactly when the lead is `days`.
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
 * Replaces everything the editor sets, keeping the id and the art, and returns
 * the special day. Null if there is none with that id.
 */
export function updateSpecialDay(db: Db, id: string, input: SpecialDayInput, now: Date): SpecialDay | null {
  const row = db.update(specialDays).set({ ...editableColumns(input), updatedAt: now }).where(eq(specialDays.id, id)).returning().get()
  return row ? toSpecialDay(row) : null
}

/** True if there was a special day to delete. */
export function deleteSpecialDay(db: Db, id: string): boolean {
  return db.delete(specialDays).where(eq(specialDays.id, id)).returning({ id: specialDays.id }).all().length > 0
}

/**
 * A lowercase ASCII id for a name: accents are stripped and anything that is
 * not a letter or digit becomes a dash, so "Mum's birthday" is `mum-s-birthday`.
 * It is cut at 40 characters, falls back to `day` when nothing is left, and
 * gets `-2`, `-3` and so on until it is not in `taken`.
 */
export function slugFor(name: string, taken: ReadonlySet<string>): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '') || 'day'

  const free = (id: string) => !taken.has(id) && !RESERVED_IDS.includes(id)
  if (free(base)) return base
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`
    if (free(id)) return id
  }
}
