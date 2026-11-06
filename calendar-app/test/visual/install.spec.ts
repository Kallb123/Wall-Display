import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { playServer, settle } from './helpers'

// The display as an installable app (PR 5.8): what its head says, the "Tap for
// fullscreen" hint a plain browser tab gets and a kiosk doesn't, and the service
// worker that lets an installed display open with the server out of reach. The
// other display specs run as the Pi's kiosk does (see `emulateKiosk`), so they
// never see the hint.

const hint = (page: Page) => page.getByTestId('fullscreen-hint')

test('the head names the display for installing, with the iOS metas', async ({ page }) => {
  await playServer(page)
  await page.goto('/display?id=kitchen')
  await settle(page)

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/display.webmanifest?id=kitchen')
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/display-apple-touch-icon.png')
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes')
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute('content', 'yes')
  await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute('content', 'black-translucent')
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Kitchen')
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover')
  // The favicon is on every page.
  await expect(page.locator('link[rel="icon"][href="/favicon.svg"]')).toHaveCount(1)
  await expect(page.locator('link[rel="icon"][href="/favicon.ico"]')).toHaveCount(1)
})

test.describe('the fullscreen hint', () => {
  test.use({ viewport: { width: 820, height: 1180 } })

  test('shows in a plain tab, and tapping it enters fullscreen and hides it', async ({ page }) => {
    await playServer(page, {}, undefined, null, { kiosk: false })
    await page.goto('/display?id=hallway')
    await settle(page)

    await expect(hint(page)).toBeVisible()
    await expect(hint(page)).toHaveText('Tap for fullscreen')
    await expect(page).toHaveScreenshot('hint-tablet.png')

    await hint(page).click()
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true)
    await expect(hint(page)).toHaveCount(0)

    await page.evaluate(() => document.exitFullscreen())
    await expect(hint(page)).toBeVisible()
  })

  test('is not there when the page reports it is fullscreen, as under the kiosk', async ({ page }) => {
    await playServer(page)
    await page.goto('/display?id=hallway')
    await settle(page)

    expect(await page.evaluate(() => matchMedia('(display-mode: fullscreen)').matches)).toBe(true)
    await expect(hint(page)).toHaveCount(0)
  })
})

test.describe('offline', () => {
  // The only tests that run the service worker; everywhere else it is blocked so `page.route` answers every request.
  test.use({ serviceWorkers: 'allow' })

  test('an installed display still opens when the server cannot be reached', async ({ page, context }) => {
    await playServer(page)
    await page.goto('/display?id=hallway')
    await settle(page)

    // Registered, and in charge of the page once it has claimed it.
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

    // The worker keeps what it sees while it controls the page, so load once more while online.
    await page.reload()
    await settle(page)
    await expect.poll(() => page.evaluate(async () => {
      const [name] = await caches.keys()
      return name ? (await (await caches.open(name)).keys()).length : 0
    })).toBeGreaterThan(3)

    await context.setOffline(true)
    await page.reload()
    await settle(page)
    await expect(page.getByTestId('month-title')).toHaveText('October 2026')
    await context.setOffline(false)
  })
})
