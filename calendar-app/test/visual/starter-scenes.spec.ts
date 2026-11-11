import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { resolutionRange, resolveSpecialDays } from '../../shared/special-days'
import type { SpecialDay, SpecialDayScene } from '../../shared/special-days'
import { STARTER_SCENES } from '../../shared/starter-scenes'
import { fixtureEvents } from '../helpers/fixtureEvents'
import { playServer, settleWithArt } from './helpers'

// The starter scenes (shared/starter-scenes.ts) taking over the wall, with the
// art that ships in server/assets/starter-scenes, so a change to the art shows
// up here. Each is used by a day on Thu 29 Oct 2026, the clock's day, with the
// events up to then and none after, so the panel is short and the art shows
// below it, as it does on a quiet day. Birthday keeps the display's theme, so
// it is shown on the light hallway and the dark kitchen.

const events = fixtureEvents({ configFile: 'test/visual/config.visual.yaml' })
const THURSDAY_29 = new Date('2026-10-29T09:41:00Z')
const TODAY = '2026-10-29'
const quiet = events.filter(event => event.start.slice(0, 10) <= TODAY)
const ASSETS = join(import.meta.dirname, '..', '..', 'server', 'assets', 'starter-scenes')
const EDITED = '2026-10-01T09:00:00.000Z'

/** The starter as a scene, with its art served under /special-days/starter-<id>-<slot>.svg. */
function sceneOf(id: string): SpecialDayScene {
  const starter = STARTER_SCENES.find(candidate => candidate.id === id)!
  return {
    ...starter.scene,
    id,
    tile_art: `starter-${id}-tile.svg`,
    full_art: `starter-${id}-full.svg`,
    full_art_portrait: `starter-${id}-full-portrait.svg`,
    updated_at: EDITED,
  }
}

/** A day on the clock's date that uses the starter as it is. */
function dayOf(id: string): SpecialDay {
  return {
    id: `${id}-day`, name: sceneOf(id).name, month: 10, day: 29, year: null, repeat: 'yearly', scene_id: id,
    who: 'Isla', since_year: null, lead: null, lead_days: null, tile_art: null, takeover: null, full_art: null, full_art_portrait: null,
    greeting: null, palette: null, extra_art: null, extra_art_portrait: null, updated_at: EDITED,
  }
}

async function showStarter(page: Page, id: string, display: string, orientation?: 'portrait') {
  await playServer(page, { view: 'month' }, quiet, null, {
    now: THURSDAY_29,
    specialDays: resolveSpecialDays([dayOf(id)], [sceneOf(id)], { ...resolutionRange(TODAY), today: TODAY }),
  })
  // After playServer's own route for the fixture art, so this one is asked first.
  await page.route(url => url.pathname.startsWith('/special-days/starter-'), async (route) => {
    const name = new URL(route.request().url()).pathname.slice('/special-days/'.length)
    const match = name.match(/^starter-([a-z]+)-(tile|full|full-portrait)\.svg$/)
    if (!match) return route.fulfill({ status: 404 })
    await route.fulfill({ path: join(ASSETS, match[1]!, `${match[2]}.svg`), contentType: 'image/svg+xml' })
  })
  await page.goto(`/display?id=${display}${orientation ? `&orientation=${orientation}` : ''}`)
  await settleWithArt(page)
  await expect(page.getByTestId('takeover-full')).toHaveAttribute('src', `/special-days/starter-${id}-${orientation ? 'full-portrait' : 'full'}.svg`)
  await expect(page.getByTestId('tile-art')).toHaveAttribute('src', `/special-days/starter-${id}-tile.svg`)
}

const GREETINGS: Record<string, string> = { birthday: 'Happy birthday, Isla!', christmas: 'Merry Christmas!', easter: 'Happy Easter!' }

test.describe('landscape', () => {
  for (const [id, display] of [['birthday', 'hallway'], ['birthday', 'kitchen'], ['christmas', 'hallway'], ['easter', 'hallway']] as const) {
    test(`${id} takes over the month on the ${display}`, async ({ page }) => {
      await showStarter(page, id, display)
      await expect(page.getByTestId('greeting')).toHaveText(GREETINGS[id]!)
      await expect(page).toHaveScreenshot(`starter-${id}-${display}.png`)
    })
  }
})

test.describe('portrait', () => {
  test.use({ viewport: { width: 1440, height: 2560 } })

  for (const id of ['birthday', 'christmas', 'easter']) {
    test(`${id} takes over the portrait month`, async ({ page }) => {
      await showStarter(page, id, 'hallway', 'portrait')
      await expect(page.getByTestId('stage')).toHaveAttribute('data-orientation', 'portrait')
      await expect(page).toHaveScreenshot(`starter-${id}-portrait.png`)
    })
  }
})
