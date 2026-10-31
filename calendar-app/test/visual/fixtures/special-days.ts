import { resolutionRange, resolveSpecialDays } from '../../../shared/special-days'
import type { SpecialDay, SpecialDayScene, SpecialDaysResolution } from '../../../shared/special-days'

// The special days the visual specs show: Halloween (a week of lead, the night
// palette, a full scene and a tile), Bonfire Night in the following month on the
// same scene with a greeting of its own, and Isla's seventh birthday (the
// birthday scene on the sage palette, with a "7" balloon over the scene and a
// greeting that is filled in by the real code). Their art is the SVGs in ./art,
// served at /special-days/<name> by helpers.ts.

const EDITED = '2026-10-01T09:00:00.000Z'

export const SCENES: SpecialDayScene[] = [
  {
    id: 'halloween',
    name: 'Halloween',
    lead: 'week',
    lead_days: null,
    tile_art: 'pumpkin.svg',
    takeover: true,
    full_art: 'halloween-night.svg',
    greeting: 'Happy Halloween!',
    palette: 'night',
    updated_at: EDITED,
  },
  {
    id: 'birthday',
    name: 'Birthday',
    lead: 'week',
    lead_days: null,
    tile_art: 'cake.svg',
    takeover: true,
    full_art: 'birthday-light.svg',
    greeting: 'Happy {nth} birthday, {who}!',
    palette: 'sage',
    updated_at: EDITED,
  },
]

/** A day that uses a scene as it is, with only what makes it a particular day on top. */
const day = (fields: Pick<SpecialDay, 'id' | 'name' | 'month' | 'day' | 'scene_id'> & Partial<SpecialDay>): SpecialDay => ({
  year: null,
  repeat: 'yearly',
  who: null,
  since_year: null,
  lead: null,
  lead_days: null,
  tile_art: null,
  takeover: null,
  full_art: null,
  greeting: null,
  palette: null,
  extra_art: null,
  updated_at: EDITED,
  ...fields,
})

/** In the order the store lists them: by month, day, then name. */
export const DAYS: SpecialDay[] = [
  // Thu 29 Oct 2026, the day before Halloween, so the month shows a cake and then a pumpkin.
  day({ id: 'isla-birthday', name: 'Isla\'s birthday', month: 10, day: 29, scene_id: 'birthday', who: 'Isla', since_year: 2019, extra_art: 'balloon-7.svg' }),
  day({ id: 'halloween', name: 'Halloween', month: 10, day: 31, scene_id: 'halloween' }),
  // On the next month, with a greeting of its own, so a preview of it shows another month.
  day({ id: 'bonfire-night', name: 'Bonfire Night', month: 11, day: 5, scene_id: 'halloween', lead: 'day', greeting: 'Happy Bonfire Night!' }),
]

/** What the server sends a display for `today` (`YYYY-MM-DD`): the real resolution over the range it covers. */
export function specialDaysOn(today: string): SpecialDaysResolution {
  return resolveSpecialDays(DAYS, SCENES, { ...resolutionRange(today), today })
}
