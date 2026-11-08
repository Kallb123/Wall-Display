import { MAX_BADGE_INITIALS } from '../../shared/month-layout'
import { personFill } from './themes'

// The fill of a whole coloured event ("colour whole events", architecture §4.8)
// in the month, week by part of day, agenda and day grid views. Pure: no Nuxt or
// Vue imports, so it can be tested on its own.

/** The surface colour: an event with nobody on it (no person matched) is filled with this. */
const NOBODY = 'var(--surface)'

/**
 * The background of a filled event, and the colour it is ringed in.
 *
 * One person gives their `personFill` (the colour mixed into the page, so the
 * text keeps its contrast), and nobody gives the surface colour. With several
 * people the background is split into equal sections, left to right, one for
 * each person, as hard stops of a gradient. The sections are the people the
 * badges show (the first `MAX_BADGE_INITIALS`), not everyone detection found: a
 * colour with no circle to explain it would be a puzzle, and the circles are
 * where the wall's room for people ends. Each section goes through `personFill`
 * on its own, so every one is mixed into the page as a single fill is.
 *
 * The text colour (`--bar-text`) is a theme token, not worked out from the fill,
 * and every section is the same mix of the page, so one colour reads on all of
 * them. The ring (what overlapping badges are cut out of) is a solid colour
 * where a gradient would not do, so it is the first person's fill.
 */
export function eventFill(people: readonly { colour: string }[]): { background: string, ring: string } {
  const fills = people.slice(0, MAX_BADGE_INITIALS).map(person => personFill(person.colour))
  const [first] = fills
  if (!first) return { background: NOBODY, ring: NOBODY }
  if (fills.length === 1) return { background: first, ring: first }
  const share = 100 / fills.length
  const sections = fills.map((fill, index) => `${fill} ${round(index * share)}% ${round((index + 1) * share)}%`)
  return { background: `linear-gradient(to right, ${sections.join(', ')})`, ring: first }
}

/** A percentage to two places, so a third is 33.33% and not 33.33333333333333%. */
const round = (percent: number): number => Math.round(percent * 100) / 100
