import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { fixtureEvents } from '../helpers/fixtureEvents'
import { NOW, playServer, settle, settleWithArt } from './helpers'
import { specialDaysOn } from './fixtures/special-days'

// Special days on the wall (architecture §6): Halloween, Isla's seventh
// birthday and Bonfire Night from fixtures/special-days.ts, resolved by the real
// `resolveSpecialDays`, with SVG art (fixtures/art) in place of uploads. The
// clock is the mock's Wed 28 Oct 2026 unless a test needs the day itself. The
// clocks went back on the 25th, so London is GMT and 09:41 there is 09:41Z.

const events = fixtureEvents({ configFile: 'test/visual/config.visual.yaml' })

const THURSDAY_29 = new Date('2026-10-29T09:41:00Z')
const HALLOWEEN = new Date('2026-10-31T09:41:00Z')

/**
 * The events up to the end of `through` (`YYYY-MM-DD`) and none after, so the
 * days the panel lists after today are empty. That keeps the panel short, as it
 * is when nothing is on, and the art shows below it. Over the family's real
 * week the panel fills the column and only the margins are left.
 */
const quiet = (through: string) => events.filter(event => event.start.slice(0, 10) <= through)

/** The date as the server would resolve it, for a clock at `now`. */
const resolved = (now: Date) => specialDaysOn(now.toISOString().slice(0, 10))

const stage = (page: Page) => page.getByTestId('stage')

test.describe('a week ahead (mock 2b)', () => {
  test('the pumpkin and the cake show on their tiles before their days, light theme', async ({ page }) => {
    await playServer(page, { view: 'month' }, events, null, { specialDays: resolved(NOW) })
    await page.goto('/display?id=hallway')
    await settleWithArt(page)

    await expect(stage(page)).toHaveAttribute('data-theme', 'light')
    await expect(page.locator('[data-testid="day-tile"][data-special="halloween"]')).toHaveAttribute('data-date', '2026-10-31')
    await expect(page.locator('[data-testid="day-tile"][data-special="isla-birthday"]')).toHaveAttribute('data-date', '2026-10-29')
    await expect(page.getByTestId('tile-art')).toHaveCount(2)
    await expect(page.getByTestId('tile-art').first()).toHaveAttribute('src', '/special-days/cake.svg')
    // Only the tiles are decorated: today is an ordinary day, so the wall is as it always was.
    await expect(stage(page)).not.toHaveAttribute('data-palette')
    await expect(page.getByTestId('takeover-full')).toHaveCount(0)
    await expect(page.getByTestId('greeting')).toHaveCount(0)
    await expect(page).toHaveScreenshot('tiles-light.png')
  })
})

test.describe('the day itself (mock 2a)', () => {
  test('Halloween takes over the month: night palette, greeting and the scene behind', async ({ page }) => {
    await playServer(page, { view: 'month' }, quiet('2026-10-31'), null, { now: HALLOWEEN, specialDays: resolved(HALLOWEEN) })
    await page.goto('/display?id=hallway')
    await settleWithArt(page)

    // The display is light, and the palette replaces that for the day.
    await expect(stage(page)).toHaveAttribute('data-theme', 'light')
    await expect(stage(page)).toHaveAttribute('data-palette', 'night')
    await expect(page.getByTestId('takeover-full')).toHaveAttribute('src', '/special-days/halloween-night.svg')
    await expect(page.getByTestId('takeover-extra')).toHaveCount(0)
    await expect(page.getByTestId('greeting')).toHaveText('Happy Halloween!')
    await expect(page.getByTestId('panel')).toHaveClass(/takeover/)
    await expect(page.locator('[data-testid="day-tile"][data-today="true"]')).toHaveAttribute('data-special', 'halloween')
    await expect(page.getByTestId('preview-badge')).toHaveCount(0)
    await expect(page).toHaveScreenshot('takeover-halloween-month.png')
  })

  test('Halloween takes over the agenda too', async ({ page }) => {
    await playServer(page, { view: 'agenda' }, quiet('2026-10-31'), null, { now: HALLOWEEN, specialDays: resolved(HALLOWEEN) })
    await page.goto('/display?id=hallway')
    await settleWithArt(page)

    await expect(stage(page)).toHaveAttribute('data-palette', 'night')
    await expect(page.getByTestId('takeover-full')).toBeVisible()
    await expect(page.getByTestId('day-today').getByTestId('greeting')).toHaveText('Happy Halloween!')
    await expect(page.getByTestId('day-tomorrow').getByTestId('greeting')).toHaveCount(0)
    await expect(page).toHaveScreenshot('takeover-halloween-agenda.png')
  })

  test('Isla\'s birthday has a layer over the scene and a greeting filled in for her seventh', async ({ page }) => {
    await playServer(page, { view: 'month' }, quiet('2026-10-29'), null, { now: THURSDAY_29, specialDays: resolved(THURSDAY_29) })
    await page.goto('/display?id=hallway')
    await settleWithArt(page)

    await expect(stage(page)).toHaveAttribute('data-palette', 'sage')
    await expect(page.getByTestId('takeover-full')).toHaveAttribute('src', '/special-days/birthday-light.svg')
    await expect(page.getByTestId('takeover-extra')).toHaveAttribute('src', '/special-days/balloon-7.svg')
    await expect(page.getByTestId('greeting')).toHaveText('Happy 7th birthday, Isla!')
    // The layer is over the scene, and both are behind the view.
    const order = await page.evaluate(() => {
      const [full, extra, view] = ['takeover-full', 'takeover-extra', 'month-view'].map(id => document.querySelector(`[data-testid="${id}"]`)!)
      return [full!.compareDocumentPosition(extra!), extra!.compareDocumentPosition(view!)].map(position => Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING))
    })
    expect(order).toEqual([true, true])
    await expect(page).toHaveScreenshot('takeover-birthday.png')
  })
})

test.describe('a preview', () => {
  test('shows another day as if it were today, and the wall goes back when the server ends it', async ({ page }) => {
    const server = await playServer(page, { view: 'month' }, quiet('2026-10-28'), null, { specialDays: resolved(NOW) })
    const asked: URL[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname === '/api/special-days/preview') asked.push(url)
    })
    await page.goto('/display?id=hallway')
    await settleWithArt(page)
    await expect(page.getByTestId('month-title')).toHaveText('October 2026')
    await expect(page.getByTestId('preview-badge')).toHaveCount(0)
    expect(asked).toHaveLength(0)

    server.send({ preview: { special_day: 'bonfire-night', until: '2026-10-28T09:42:00.000Z' } })

    await expect(page.getByTestId('preview-badge')).toHaveText('Preview')
    await expect(stage(page)).toHaveAttribute('data-preview', 'true')
    await expect(stage(page)).toHaveAttribute('data-palette', 'night')
    // The month is the previewed date's, which is the server's answer, not the wall's today.
    await expect(page.getByTestId('month-title')).toHaveText('November 2026')
    await expect(page.getByTestId('greeting')).toHaveText('Happy Bonfire Night!')
    await expect(page.getByTestId('takeover-full')).toBeVisible()
    expect(asked.map(url => url.search)).toEqual(['?special_day=bonfire-night'])
    await settleWithArt(page)
    await expect(page).toHaveScreenshot('preview.png')

    server.send({ preview: null })

    await expect(page.getByTestId('preview-badge')).toHaveCount(0)
    await expect(stage(page)).not.toHaveAttribute('data-preview')
    await expect(stage(page)).not.toHaveAttribute('data-palette')
    await expect(page.getByTestId('takeover-full')).toHaveCount(0)
    await expect(page.getByTestId('greeting')).toHaveCount(0)
    await expect(page.getByTestId('month-title')).toHaveText('October 2026')
    await expect(page.getByTestId('tile-art')).toHaveCount(2)
  })
})

test.describe('what a takeover leaves alone', () => {
  test('the photo frame and the night view are not changed by it', async ({ page }) => {
    const server = await playServer(page, { view: 'photo' }, events, null, { now: HALLOWEEN, specialDays: resolved(HALLOWEEN) })
    await page.goto('/display?id=hallway')

    await expect(page.getByTestId('photo-view')).toBeVisible()
    await expect(stage(page)).toHaveAttribute('data-theme', 'light')
    await expect(stage(page)).not.toHaveAttribute('data-palette')
    await expect(page.getByTestId('takeover-full')).toHaveCount(0)

    server.send({ view: 'night' })

    await expect(page.locator('h1')).toHaveText('Night')
    await expect(stage(page)).not.toHaveAttribute('data-palette')
    await expect(page.getByTestId('takeover-full')).toHaveCount(0)

    // The special days were there all along: the calendar views take them.
    server.send({ view: 'month' })

    await expect(stage(page)).toHaveAttribute('data-palette', 'night')
    await expect(page.getByTestId('takeover-full')).toBeVisible()
  })

  test('the overlay banner stays above the takeover', async ({ page }) => {
    const bins = { text: 'Bins out tonight', icon: 'trash', until: '2026-10-31T18:00:00.000Z' }
    await playServer(page, { view: 'month', overlay: bins }, events, null, { now: HALLOWEEN, specialDays: resolved(HALLOWEEN) })
    await page.goto('/display?id=hallway')
    await settleWithArt(page)

    await expect(page.getByTestId('takeover-full')).toBeVisible()
    await expect(page.getByTestId('overlay-banner')).toHaveText('Bins out tonight')
    // The banner never takes a click, which also hides it from hit testing, so it is allowed to for this check of what is on top.
    await page.addStyleTag({ content: '[data-testid="overlay-banner"] { pointer-events: auto !important }' })
    const onTop = await page.evaluate(() => {
      const banner = document.querySelector('[data-testid="overlay-banner"]')!
      const { left, top, width, height } = banner.getBoundingClientRect()
      const topmost = document.elementFromPoint(left + width / 2, top + height / 2)
      return topmost !== null && banner.contains(topmost)
    })
    expect(onTop).toBe(true)
  })
})

// The page compares dates itself, so a takeover never outlives its midnight. These run time forward on a clock the
// test controls (the usual one is frozen), starting a minute before midnight and pausing 30 seconds before it.
test.describe('midnight', () => {
  /** Opens the wall with a clock that starts at `start` and is paused at `pause`, whose special days are `specialDays`. */
  async function openAt(page: Page, start: string, pause: string, specialDays: ReturnType<typeof specialDaysOn>) {
    const server = await playServer(page, { view: 'month' }, events, null, { ownClock: true, now: new Date(start), specialDays })
    await page.clock.install({ time: new Date(start) })
    await page.goto('/display?id=hallway')
    await settle(page)
    await page.clock.pauseAt(new Date(pause))
    // Set before midnight: it is gone if the page reloads.
    await page.evaluate(() => Object.assign(window, { notReloaded: true }))
    return server
  }

  test('the takeover comes when the server sends the new day, with no reload', async ({ page }) => {
    const server = await openAt(page, '2026-10-30T23:59:00Z', '2026-10-30T23:59:30Z', specialDaysOn('2026-10-30'))
    await expect(page.getByTestId('day-tile').first()).toBeVisible()
    await expect(stage(page)).not.toHaveAttribute('data-palette')
    await expect(page.getByTestId('takeover-full')).toHaveCount(0)

    // It is 00:00:01 on Halloween, and the server has just sent the day.
    await page.clock.runFor(31_000)
    await expect(page.locator('[data-testid="day-tile"][data-today="true"]')).toHaveAttribute('data-date', '2026-10-31')
    server.sendSpecialDays(specialDaysOn('2026-10-31'))

    await expect(stage(page)).toHaveAttribute('data-palette', 'night')
    await expect(page.getByTestId('takeover-full')).toBeVisible()
    await expect(page.getByTestId('greeting')).toHaveText('Happy Halloween!')
    expect(await page.evaluate(() => 'notReloaded' in window)).toBe(true)
  })

  test('the takeover goes at midnight, before the server says anything', async ({ page }) => {
    const server = await openAt(page, '2026-10-31T23:59:00Z', '2026-10-31T23:59:30Z', specialDaysOn('2026-10-31'))
    await expect(stage(page)).toHaveAttribute('data-palette', 'night')
    await expect(page.getByTestId('takeover-full')).toBeVisible()
    await expect(page.getByTestId('greeting')).toHaveText('Happy Halloween!')

    // Still Halloween at 23:59:50.
    await page.clock.runFor(20_000)
    await expect(stage(page)).toHaveAttribute('data-palette', 'night')

    // Midnight passes, and the wall has only yesterday's word.
    await page.clock.fastForward(11_000)
    await expect(page.getByTestId('month-title')).toHaveText('November 2026')
    await expect(stage(page)).not.toHaveAttribute('data-palette')
    await expect(page.getByTestId('takeover-full')).toHaveCount(0)
    await expect(page.getByTestId('greeting')).toHaveCount(0)

    // Its own day arriving changes nothing: there is no takeover on 1 November.
    server.sendSpecialDays(specialDaysOn('2026-11-01'))
    await expect(page.getByTestId('day-tile').first()).toBeVisible()
    await expect(stage(page)).not.toHaveAttribute('data-palette')
    await expect(page.getByTestId('takeover-full')).toHaveCount(0)
    expect(await page.evaluate(() => 'notReloaded' in window)).toBe(true)
  })
})
