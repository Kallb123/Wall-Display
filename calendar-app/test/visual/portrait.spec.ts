import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { burnInOffset } from '../../app/utils/burnIn'
import { nightPosition } from '../../app/utils/night'
import type { CalendarEvent } from '../../shared/types/events'
import { fontsReady, playServer, settle } from './helpers'

// The portrait stage (PR 5.10, architecture §4.2): a 1440×2560 window, as a
// panel hung on its side shows it. Only the night view has a portrait layout so
// far; every other view is the landscape stage letterboxed in the window, as
// the month is here. The window is the shape of the panel, so `auto` finds
// portrait by itself, and `?orientation=` is checked as well. The landscape
// pictures are in the other specs, which must not change.

test.use({ viewport: { width: 1440, height: 2560 } })

const LATE = new Date('2026-10-28T22:30:00Z')

const swimming: CalendarEvent = {
  id: 1,
  calendar_id: 'family',
  title: 'Swimming',
  display_title: 'Swimming',
  location: null,
  start: '2026-10-29T08:30:00.000Z',
  end: '2026-10-29T09:30:00.000Z',
  all_day: false,
  start_date: null,
  end_date: null,
  people: [{ id: 'theo', name: 'Theo', initial: 'T', colour: '#5F94C4' }],
}

/** Opens `path` showing the night view and waits for the fonts. */
async function openNight(page: Page, path: string, overlay?: { text: string, icon: null, until: null }) {
  await playServer(page, { view: 'night', overlay: overlay ?? null }, [swimming], null, { now: LATE })
  await page.goto(path)
  await expect(page.getByTestId('night-view')).toBeVisible()
  await fontsReady(page)
}

const stageBox = async (page: Page) => (await page.getByTestId('stage').boundingBox())!

test('the porch\'s night view is the portrait stage, with the clock drifted along its long side', async ({ page }) => {
  await openNight(page, '/display?id=porch')

  await expect(page.getByTestId('stage')).toHaveAttribute('data-orientation', 'portrait')
  await expect(page.getByTestId('stage')).toHaveCSS('width', '1440px')
  await expect(page.getByTestId('stage')).toHaveCSS('height', '2560px')
  expect(await stageBox(page)).toEqual({ x: 0, y: 0, width: 1440, height: 2560 })
  await expect(page.getByTestId('night-text')).toHaveText('Tomorrow 08:30 · Swimming')
  const spot = nightPosition(LATE, 'portrait')
  expect(spot).not.toEqual({ x: 0, y: 0 })
  const transform = await page.getByTestId('night-clock').evaluate(element => getComputedStyle(element.parentElement!).transform)
  expect(transform).toBe(`matrix(1, 0, 0, 1, ${spot.x}, ${spot.y})`)
  // The block is inside the stage, whichever spot it is at.
  const block = (await page.getByTestId('night-clock').locator('..').boundingBox())!
  expect(block.x).toBeGreaterThanOrEqual(0)
  expect(block.x + block.width).toBeLessThanOrEqual(1440)
  await expect(page).toHaveScreenshot('portrait-night-porch.png')
})

test('a display with burn-in off has the clock in the middle of the portrait stage', async ({ page }) => {
  await openNight(page, '/display?id=hallway')

  await expect(page.getByTestId('night-clock').locator('..')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
  const stage = await stageBox(page)
  const clock = (await page.getByTestId('night-clock').boundingBox())!
  expect(Math.abs(clock.x + clock.width / 2 - (stage.x + stage.width / 2))).toBeLessThan(2)
  expect(Math.abs(clock.y + clock.height / 2 - (stage.y + stage.height / 2))).toBeLessThan(2)
  await expect(page).toHaveScreenshot('portrait-night-centred.png')
})

test('the clock fits the stage at the widest spot, and a long line under it is cut inside the margins', async ({ page }) => {
  const long: CalendarEvent = { ...swimming, display_title: 'Theo\'s swimming gala and the long drive to the other side of the county' }
  await playServer(page, { view: 'night' }, [long], null, { now: LATE })
  await page.goto('/display?id=porch')
  await expect(page.getByTestId('night-text')).toBeVisible()
  await fontsReady(page)

  // The widest the clock gets is its own width at the furthest it drifts across (160 px either way).
  const clock = (await page.getByTestId('night-clock').boundingBox())!
  expect(clock.width + 2 * 160).toBeLessThanOrEqual(1440 - 128)
  const text = (await page.getByTestId('night-text').boundingBox())!
  expect(text.x).toBeGreaterThanOrEqual(64)
  expect(text.x + text.width).toBeLessThanOrEqual(1440 - 64)
})

test('the overlay banner keeps its margins on the portrait stage', async ({ page }) => {
  await openNight(page, '/display?id=hallway', { text: 'Bins out tonight, and please put the recycling box out by the gate', icon: null, until: null })

  const banner = (await page.getByTestId('overlay-banner').boundingBox())!
  expect(banner.x).toBeGreaterThanOrEqual(64)
  expect(banner.x + banner.width).toBeLessThanOrEqual(1440 - 64)
  await expect(page).toHaveScreenshot('portrait-night-overlay.png')
})

test('the month is the landscape stage letterboxed in a portrait window', async ({ page }) => {
  await playServer(page, { view: 'month' })
  await page.goto('/display?id=hallway')
  await settle(page)

  await expect(page.getByTestId('stage')).toHaveAttribute('data-orientation', 'landscape')
  const stage = await stageBox(page)
  expect(stage.width).toBeCloseTo(1440, 0)
  expect(stage.height).toBeCloseTo(810, 0)
  // Centred, with black above and below.
  expect(stage.y).toBeCloseTo((2560 - 810) / 2, 0)
  await expect(page).toHaveScreenshot('portrait-month-letterboxed.png')
})

test('?orientation=portrait gives the night view the portrait stage in a landscape window', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await openNight(page, '/display?id=hallway&orientation=portrait')

  await expect(page.getByTestId('stage')).toHaveAttribute('data-orientation', 'portrait')
  const stage = await stageBox(page)
  expect(stage.height).toBeCloseTo(1440, 0)
  expect(stage.width).toBeCloseTo(1440 * 1440 / 2560, 0)
})

test('?orientation=landscape keeps the landscape stage in a portrait window', async ({ page }) => {
  await openNight(page, '/display?id=hallway&orientation=landscape')

  await expect(page.getByTestId('stage')).toHaveAttribute('data-orientation', 'landscape')
  const stage = await stageBox(page)
  expect(stage.width).toBeCloseTo(1440, 0)
  expect(stage.height).toBeCloseTo(810, 0)
})

test('the porch\'s content is nudged on the portrait stage too, and the dimmer covers the whole of it', async ({ page }) => {
  await openNight(page, '/display?id=porch')

  const expected = burnInOffset(LATE)
  expect(expected).not.toEqual({ x: 0, y: 0 })
  const transform = await page.getByTestId('shift').evaluate(element => getComputedStyle(element).transform)
  const [, , , , x, y] = transform.match(/^matrix\((.+)\)$/)![1]!.split(',').map(Number)
  expect({ x, y }).toEqual(expected)
  expect(await page.getByTestId('dimmer').boundingBox()).toEqual(await stageBox(page))
})
