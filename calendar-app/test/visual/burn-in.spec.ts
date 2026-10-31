import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { burnInOffset } from '../../app/utils/burnIn'
import { NOW, playServer, settle } from './helpers'

// Burn-in shifting (PR 5.3): everything but the dimmer sits in one layer that
// the page nudges in a slow orbit. The porch has it on; the hallway and kitchen
// have it off, which is what keeps every other picture in this folder still. The
// pill's corners are in photo.spec.ts.

/** The layer's offset as the browser has it, in pixels. */
async function shiftOf(page: Page) {
  const transform = await page.getByTestId('shift').evaluate(element => getComputedStyle(element).transform)
  if (transform === 'none') return { x: 0, y: 0 }
  const [, , , , x, y] = transform.match(/^matrix\((.+)\)$/)![1]!.split(',').map(Number)
  return { x: x!, y: y! }
}

test('the porch\'s content is nudged off where it was laid out', async ({ page }) => {
  await playServer(page, { view: 'month' })
  await page.goto('/display?id=porch')
  await settle(page)

  const expected = burnInOffset(NOW)
  expect(expected).not.toEqual({ x: 0, y: 0 })
  expect(await shiftOf(page)).toEqual(expected)
  // The view moved with it, and the dimmer did not.
  const stage = (await page.getByTestId('stage').boundingBox())!
  const view = (await page.getByTestId('month-view').boundingBox())!
  expect(view.x - stage.x).toBeCloseTo(expected.x, 0)
  expect(view.y - stage.y).toBeCloseTo(expected.y, 0)
  const dimmer = (await page.getByTestId('dimmer').boundingBox())!
  expect(dimmer).toEqual(stage)
})

test('a display with burn-in off stays where it was laid out', async ({ page }) => {
  await playServer(page, { view: 'month' })
  await page.goto('/display?id=hallway')
  await settle(page)

  expect(await shiftOf(page)).toEqual({ x: 0, y: 0 })
  const stage = (await page.getByTestId('stage').boundingBox())!
  const view = (await page.getByTestId('month-view').boundingBox())!
  expect(view.x).toBe(stage.x)
  expect(view.y).toBe(stage.y)
})

test('it steps on to the next place three minutes later', async ({ page }) => {
  const later = new Date(NOW.getTime() + 3 * 60_000)
  await playServer(page, { view: 'agenda' }, undefined, null, { now: later })
  await page.goto('/display?id=porch')
  await settle(page)

  expect(await shiftOf(page)).toEqual(burnInOffset(later))
  expect(burnInOffset(later)).not.toEqual(burnInOffset(NOW))
})
