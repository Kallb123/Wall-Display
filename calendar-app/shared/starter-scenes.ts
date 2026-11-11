import type { SpecialDaySceneInput } from './special-days'

// The starter scenes (architecture §6.6): ready-made looks with their art, so a
// takeover looks good before anyone has drawn anything. Adding one copies it
// into the scene library (`POST /api/special-day-scenes/starters/:id`), and
// from then on it is an ordinary scene. The art is in
// server/assets/starter-scenes/<id>/, as `tile.svg`, `full.svg` and
// `full-portrait.svg`. Pure, so the settings page can list them.

export interface StarterScene {
  /** Names the starter and its art folder. Not the id the copy gets: that is a slug of the name, as for any scene. */
  id: string
  /** One line for the picker. */
  description: string
  /** What the copy is created with. */
  scene: SpecialDaySceneInput
}

export const STARTER_SCENES: readonly StarterScene[] = [
  {
    id: 'birthday',
    description: 'Bunting, balloons and a cake with candles. Keeps the display\'s own theme, light or dark.',
    scene: { name: 'Birthday', lead: 'week', lead_days: null, takeover: true, greeting: 'Happy birthday, {who}!', palette: 'warm' },
  },
  {
    id: 'christmas',
    description: 'Fairy lights, falling snow and a tree under a winter moon, on the frost palette.',
    scene: { name: 'Christmas', lead: 'month', lead_days: null, takeover: true, greeting: 'Merry Christmas!', palette: 'frost' },
  },
  {
    id: 'easter',
    description: 'A bunny, painted eggs and spring flowers, on the sage palette.',
    scene: { name: 'Easter', lead: 'week', lead_days: null, takeover: true, greeting: 'Happy Easter!', palette: 'sage' },
  },
]

/** The starter with this id, or undefined. */
export function findStarterScene(id: string): StarterScene | undefined {
  return STARTER_SCENES.find(starter => starter.id === id)
}

/** Where the settings page loads a starter's tile art from, to show it in the picker. */
export function starterTileUrl(id: string): string {
  return `/special-days/starters/${encodeURIComponent(id)}.svg`
}
