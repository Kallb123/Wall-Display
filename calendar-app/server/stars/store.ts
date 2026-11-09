import { and, between, eq, sql } from 'drizzle-orm'
import { clampStars, DEFAULT_STAR_SETTINGS, starHistory } from '../../shared/stars'
import type { StarChart, StarSettings, StarSettingsEntry } from '../../shared/stars'
import type { Db } from '../db/client'
import { starChartPeople, starCounts } from '../db/schema'
import type { StarChartPersonRow } from '../db/schema'

// Reads and writes the star chart's two tables (PR 5.20): each person's
// settings, and the stars they have on each day. Like the other stores it only
// stores. Who the people are comes from the config, so every function that
// needs them is handed the list, and a row for someone no longer in the config
// is kept but never read back.

/** The parts of a config person the chart needs. */
export interface StarPerson {
  id: string
  name: string
  initial: string
  colour: string
}

function toSettings(row: StarChartPersonRow | undefined): StarSettings {
  if (!row) return { ...DEFAULT_STAR_SETTINGS }
  return { enabled: row.enabled, period: row.period, goal: row.goal }
}

/** Every stored person's settings, by person id. A person with no row is not in it. */
export function readStarSettings(db: Db): Map<string, StarSettings> {
  return new Map(db.select().from(starChartPeople).all().map(row => [row.personId, toSettings(row)]))
}

/** One person's settings, or `DEFAULT_STAR_SETTINGS` (a copy) if they have none stored. */
export function getStarSettings(db: Db, personId: string): StarSettings {
  return toSettings(db.select().from(starChartPeople).where(eq(starChartPeople.personId, personId)).get())
}

/** Stores a person's whole settings, replacing any before, and returns them. */
export function saveStarSettings(db: Db, personId: string, settings: StarSettings, now: Date): StarSettings {
  const values = { enabled: settings.enabled, period: settings.period, goal: settings.goal, updatedAt: now }
  const row = db.insert(starChartPeople).values({ personId, ...values })
    .onConflictDoUpdate({ target: starChartPeople.personId, set: values })
    .returning().get()
  return toSettings(row)
}

/** Every person in `people`, in that order, with their settings (the defaults for one never saved). For the settings page. */
export function starSettingsEntries(db: Db, people: readonly StarPerson[]): StarSettingsEntry[] {
  const stored = readStarSettings(db)
  return people.map(person => ({
    id: person.id,
    name: person.name,
    initial: person.initial,
    colour: person.colour,
    ...(stored.get(person.id) ?? DEFAULT_STAR_SETTINGS),
  }))
}

/** The counts from `first` to `last` inclusive, by person id then date. A day with no row is left out. */
export function listStarCounts(db: Db, first: string, last: string): Record<string, Record<string, number>> {
  const counts: Record<string, Record<string, number>> = {}
  const rows = db.select().from(starCounts).where(between(starCounts.date, first, last)).orderBy(starCounts.personId, starCounts.date).all()
  for (const row of rows) {
    if (row.count <= 0) continue
    ;(counts[row.personId] ??= {})[row.date] = row.count
  }
  return counts
}

/**
 * Adds `delta` (negative to take away) to a person's stars on `date`, in one
 * transaction so two taps at once both count, keeps the result between 0 and
 * `MAX_STARS_PER_DAY`, and returns it. A day that falls to 0 has its row
 * deleted, so the table holds only days with stars.
 */
export function adjustStars(db: Db, personId: string, date: string, delta: number, now: Date): number {
  return db.transaction((tx) => {
    const current = tx.select({ count: starCounts.count }).from(starCounts)
      .where(and(eq(starCounts.personId, personId), eq(starCounts.date, date))).get()?.count ?? 0
    const next = clampStars(current + delta)
    if (next === 0) {
      tx.delete(starCounts).where(and(eq(starCounts.personId, personId), eq(starCounts.date, date))).run()
    } else {
      tx.insert(starCounts).values({ personId, date, count: next, updatedAt: now })
        .onConflictDoUpdate({ target: [starCounts.personId, starCounts.date], set: { count: next, updatedAt: now } }).run()
    }
    return next
  })
}

/**
 * The chart the wall and the remote are sent: the people in `people` whose
 * chart is switched on, in that order, and the counts for the last
 * `STAR_HISTORY_DAYS` days up to `today`. Counts of people without a chart are
 * left out.
 */
export function buildStarChart(db: Db, people: readonly StarPerson[], today: string): StarChart {
  const settings = readStarSettings(db)
  const on = people.flatMap((person) => {
    const own = settings.get(person.id)
    return own?.enabled ? [{ id: person.id, name: person.name, initial: person.initial, colour: person.colour, period: own.period, goal: own.goal }] : []
  })
  const { first, last } = starHistory(today)
  const all = listStarCounts(db, first, last)
  const counts: Record<string, Record<string, number>> = {}
  for (const person of on) {
    if (all[person.id]) counts[person.id] = all[person.id]!
  }
  return { people: on, counts }
}

/** For tests: how many count rows there are. */
export function countStarRows(db: Db): number {
  return db.select({ n: sql<number>`count(*)` }).from(starCounts).get()!.n
}
