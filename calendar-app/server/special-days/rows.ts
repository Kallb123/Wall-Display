import { MAX_SPECIAL_DAY_NAME } from '../../shared/special-days'
import type { SpecialDay, SpecialDayScene } from '../../shared/special-days'
import type { SpecialDayRow, SpecialDaySceneRow } from '../db/schema'

// What the day store and the scene store share: turning rows into the wire
// format (camelCase to snake_case) and making ids. The two stores need each
// other's mappers, so they live here rather than in either.

/** Ids that would shadow a route, so no special day or scene gets one: `/api/special-days/resolved` is not a day. */
const RESERVED_IDS = ['resolved']

const MAX_SLUG_LENGTH = 40

export function toSpecialDay(row: SpecialDayRow): SpecialDay {
  return {
    id: row.id,
    name: row.name,
    month: row.month,
    day: row.day,
    year: row.year,
    repeat: row.repeat,
    scene_id: row.sceneId,
    who: row.who,
    since_year: row.sinceYear,
    lead: row.lead,
    lead_days: row.leadDays,
    tile_art: row.tileArt,
    takeover: row.takeover,
    full_art: row.fullArt,
    greeting: row.greeting,
    palette: row.palette,
    extra_art: row.extraArt,
    updated_at: row.updatedAt.toISOString(),
  }
}

export function toSpecialDayScene(row: SpecialDaySceneRow): SpecialDayScene {
  return {
    id: row.id,
    name: row.name,
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

/** "Copy of <name>", cut to the longest name allowed. */
export function copyName(name: string): string {
  return `Copy of ${name}`.slice(0, MAX_SPECIAL_DAY_NAME).trim()
}

/**
 * A lowercase ASCII id for a name: accents are stripped and anything that is
 * not a letter or digit becomes a dash, so "Mum's birthday" is `mum-s-birthday`.
 * It is cut at 40 characters, falls back to `fallback` (`day` for a day,
 * `scene` for a scene) when nothing is left, and gets `-2`, `-3` and so on
 * until it is not in `taken`.
 */
export function slugFor(name: string, taken: ReadonlySet<string>, fallback = 'day'): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '') || fallback

  const free = (id: string) => !taken.has(id) && !RESERVED_IDS.includes(id)
  if (free(base)) return base
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`
    if (free(id)) return id
  }
}
