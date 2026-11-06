import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { DAYS, SCENES } from './fixtures/special-days'
import { NOW, fontsReady } from './helpers'

// The special days admin page (architecture §7.6) at a laptop's size: the
// editor's drops for the landscape and the portrait art, and the list's mark on
// the days that take over with no portrait art. The days and scenes are the
// fixtures of the display specs, played by the test (the real server's are
// whatever is in its data folder), with their art served from fixtures/art.
// /api/displays is the real one, as in settings.spec.ts.

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })

async function open(page: Page, address: string) {
  await page.clock.setFixedTime(NOW)
  await page.route('**/api/special-days', route => route.fulfill({ json: DAYS }))
  await page.route('**/api/special-day-scenes', route => route.fulfill({ json: SCENES }))
  await page.route('**/api/remote', route => route.fulfill({ json: { pin_required: false } }))
  await page.route(url => url.pathname.startsWith('/special-days/'), async (route) => {
    const name = new URL(route.request().url()).pathname.slice('/special-days/'.length)
    if (!/^[\w-]+\.svg$/.test(name)) return route.fulfill({ status: 404 })
    await route.fulfill({ path: join(import.meta.dirname, 'fixtures/art', name), contentType: 'image/svg+xml' })
  })
  await page.goto(address)
  await expect(page.getByTestId('day-row').or(page.getByTestId('scene-row')).first()).toBeVisible()
  await page.evaluate(() => Promise.all([...document.images].map(image => image.decode().catch(() => {}))))
  await fontsReady(page)
}

test('a day on a scene with portrait art has no mark, and its drops sit side by side', async ({ page }) => {
  await open(page, '/settings/special-days?day=isla-birthday')

  await expect(page.getByTestId('art-full-portrait-image')).toHaveAttribute('src', '/special-days/birthday-light-tall.svg')
  await expect(page.getByTestId('art-extra-portrait-image')).toHaveAttribute('src', '/special-days/balloon-7-tall.svg')
  // Isla's birthday has its scene's portrait art; only Halloween and Bonfire Night lack theirs.
  await expect(page.getByTestId('no-portrait')).toHaveCount(2)
  await expect(page.getByTestId('day-row').first().getByTestId('no-portrait')).toHaveCount(0)
  await expect(page).toHaveScreenshot('special-days-day.png', { fullPage: true })
})

test('marks the days that take over with no portrait art, and shows the empty portrait drops', async ({ page }) => {
  await open(page, '/settings/special-days?day=halloween')

  await expect(page.getByTestId('no-portrait').first()).toHaveText('No portrait art')
  await expect(page.getByTestId('art-full-portrait-image')).toHaveCount(0)
  await expect(page).toHaveScreenshot('special-days-day-no-portrait.png', { fullPage: true })
})

test('a scene has a portrait drop beside its full-screen art', async ({ page }) => {
  await open(page, '/settings/special-days?scene=birthday')

  await expect(page.getByTestId('art-full-portrait-image')).toHaveAttribute('src', '/special-days/birthday-light-tall.svg')
  await expect(page.getByTestId('art-extra-portrait')).toHaveCount(0)
  await expect(page).toHaveScreenshot('special-days-scene.png', { fullPage: true })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the portrait drop wraps under the landscape one', async ({ page }) => {
    await open(page, '/settings/special-days?day=isla-birthday')

    await expect(page.getByTestId('art-full-portrait')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expect(page).toHaveScreenshot('special-days-day-phone.png', { fullPage: true })
  })
})
