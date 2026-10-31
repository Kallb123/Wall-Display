import { effectiveLook, unfillablePlaceholders } from '../../shared/special-days'
import type { GreetingPlaceholder, SpecialDayInput, SpecialDayScene, SpecialDaySceneInput } from '../../shared/special-days'
import type { Db } from '../db/client'
import { SpecialDayError, joinList } from './errors'
import { getScene } from './scenes'
import { listSpecialDays } from './store'

// What a save has to satisfy that a body's shape can't say, because it depends
// on what is stored: the scene must exist, and every day must be able to fill
// the placeholders in the greeting it ends up with (architecture §6.1). Each
// check throws a 400 SpecialDayError naming the days that fail.

/** What a placeholder needs the day to have. */
const NEEDS: Record<GreetingPlaceholder, string> = { who: 'who', years: 'since_year', nth: 'since_year' }

function needs(missing: readonly GreetingPlaceholder[]): string {
  return joinList(missing.map(name => `{${name}} needs ${NEEDS[name]}`))
}

/**
 * Checks a create or an edit of a day: its `scene_id` is a scene, and the
 * greeting it will have (its own, or the scene's) can be filled from its `who`
 * and `since_year`. `id` is the day being edited, which an error then names.
 */
export function checkDayInput(db: Db, input: SpecialDayInput, id?: string): void {
  let scene: SpecialDayScene | undefined
  if (input.scene_id !== null) {
    scene = getScene(db, input.scene_id)
    if (!scene) throw new SpecialDayError(400, `scene_id is not a scene: "${input.scene_id}"`)
  }

  const greeting = input.greeting ?? scene?.greeting ?? null
  const missing = unfillablePlaceholders(input, { greeting })
  // A new day has no id yet, so there is nobody to name in the data.
  if (missing.length > 0) throw new SpecialDayError(400, `greeting can't be filled for ${input.name}: ${needs(missing)}`, id === undefined ? [] : [{ id, name: input.name }])
}

/**
 * Checks an edit of a scene against the days on it: a day that takes its
 * greeting from the scene must be able to fill the new one. Every failing day
 * is named in the one error.
 */
export function checkSceneInput(db: Db, id: string, input: SpecialDaySceneInput): void {
  // As the scene will be: the art is not in the input and doesn't matter here.
  const proposed = { ...input, tile_art: null, full_art: null }
  const failures = listSpecialDays(db).filter(day => day.scene_id === id).flatMap((day) => {
    const missing = unfillablePlaceholders(day, effectiveLook(day, proposed))
    return missing.length > 0 ? [{ day, missing }] : []
  })
  if (failures.length === 0) return

  const detail = failures.map(({ day, missing }) => `${day.name} (${needs(missing)})`)
  throw new SpecialDayError(400, `greeting can't be filled for ${joinList(detail)}`, failures.map(({ day }) => ({ id: day.id, name: day.name })))
}
