import { expect, test } from '@playwright/test'
import { NOW, playServer, settle } from './helpers'

// The shell around the views: themes, the socket, dimming, offline, scaling. The
// month view's own look is in month.spec.ts, and the agenda's in agenda.spec.ts.
// The week view is still the placeholder, which is what these use when they
// need a view that isn't any of those.

test.describe('the theme follows the display', () => {
  for (const [id, theme] of [['hallway', 'light'], ['kitchen', 'dark']]) {
    test(`${id} is ${theme}`, async ({ page }) => {
      await playServer(page, { view: 'month' })
      await page.goto(`/display?id=${id}`)
      await settle(page)

      await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', theme!)
      await expect(page.getByTestId('month-view')).toBeVisible()
    })
  }
})

test('the view follows the server', async ({ page }) => {
  const server = await playServer(page, { view: 'month' })
  await page.goto('/display?id=hallway')
  await expect(page.getByTestId('month-title')).toHaveText('October 2026')

  server.send({ view: 'agenda' })

  await expect(page.getByTestId('agenda-view')).toBeVisible()
  await expect(page.getByTestId('month-view')).toHaveCount(0)

  server.send({ view: 'week' })

  await expect(page.locator('h1')).toHaveText('Week')
  await expect(page.getByTestId('agenda-view')).toHaveCount(0)
})

test('dims with brightness, and goes black when the screen is off', async ({ page }) => {
  const server = await playServer(page)
  await page.goto('/display?id=hallway')
  await settle(page)
  await expect(page.getByTestId('dimmer')).toHaveCSS('opacity', '0')

  server.send({ brightness: 40 })
  await expect(page.getByTestId('dimmer')).toHaveCSS('opacity', '0.6')
  await expect(page).toHaveScreenshot('dimmed.png')

  server.send({ screen: 'off' })
  await expect(page.getByTestId('dimmer')).toHaveCSS('opacity', '1')
})

test('shows the last-known wall and an offline badge when the server cannot be reached', async ({ page, context }) => {
  await playServer(page, { view: 'month' })
  await page.goto('/display?id=hallway')
  await settle(page)
  await expect(page.getByTestId('offline-badge')).toHaveCount(0)
  // The cache is written once the events have arrived.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('wallcal:display:hallway')?.includes('Grandma visiting'))).toBe(true)

  // A new load in the same browser, with the server gone: nothing answers and the socket drops at once.
  const offline = await context.newPage()
  await offline.clock.setFixedTime(NOW)
  await offline.route('**/api/displays', route => route.abort())
  await offline.route('**/api/events**', route => route.abort())
  await offline.routeWebSocket(/\/_ws/, socket => socket.close())
  await offline.goto('/display?id=hallway')

  await settle(offline)
  await expect(offline.getByTestId('offline-badge')).toBeVisible()
  await expect(offline.getByTestId('offline-badge')).toHaveText('Offline')
  await expect(offline.getByTestId('month-title')).toHaveText('October 2026')
  await expect(offline).toHaveScreenshot('offline.png')
})

test('scales the stage to fit the window and centres it', async ({ page }) => {
  await playServer(page)
  await page.goto('/display?id=hallway')
  await settle(page)
  const box = async () => (await page.getByTestId('stage').boundingBox())!

  await page.setViewportSize({ width: 1280, height: 720 })
  await expect.poll(async () => (await box()).width).toBeCloseTo(1280, 1)
  expect(await box()).toMatchObject({ x: 0, y: 0, height: 720 })

  await page.setViewportSize({ width: 1000, height: 1000 })
  await expect.poll(async () => (await box()).width).toBeCloseTo(1000, 1)
  const square = await box()
  expect(square.height).toBeCloseTo(562.5, 1)
  expect(square.x).toBeCloseTo(0, 1)
  expect(square.y).toBeCloseTo(218.75, 1)
})

test('with no id it shows the first display', async ({ page }) => {
  await playServer(page)
  await page.goto('/display')
  await settle(page)

  // hallway is first in the config, and light.
  await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'light')
  expect(await page.evaluate(() => localStorage.getItem('wallcal:last-display'))).toBe('hallway')
})

test('says so for a display that is not in the config', async ({ page }) => {
  await playServer(page)
  await page.goto('/display?id=garage')

  await expect(page.getByTestId('stage')).toContainText('Unknown display')
})

test.describe('the overlay banner', () => {
  const bins = { text: 'Bins out tonight', icon: 'trash', until: '2026-10-28T18:00:00.000Z' }

  test('sits over the month view in the light theme', async ({ page }) => {
    await playServer(page, { view: 'month', overlay: bins })
    await page.goto('/display?id=hallway')
    await settle(page)

    await expect(page.getByTestId('overlay-banner')).toHaveText('Bins out tonight')
    await expect(page.getByTestId('overlay-banner')).toHaveAttribute('role', 'status')
    await expect(page).toHaveScreenshot('overlay-month.png')
  })

  test('sits over the agenda in the dark theme, and a long message stops at two lines', async ({ page }) => {
    const text = 'Dinner is at six, so please wash your hands, put your shoes away and come and lay the table before the pasta goes cold, and tell Grandma we are nearly ready to eat'
    await playServer(page, { view: 'agenda', overlay: { text, icon: 'utensils', until: null } })
    await page.goto('/display?id=kitchen')
    await settle(page)

    await expect(page.getByTestId('overlay-banner')).toContainText('Dinner is at six')
    await expect(page).toHaveScreenshot('overlay-agenda-dark.png')
  })

  test('is shown on the photo frame, and stays put when the view changes', async ({ page }) => {
    const server = await playServer(page, { view: 'photo', overlay: bins })
    await page.goto('/display?id=hallway')

    await expect(page.getByTestId('photo-view')).toBeVisible()
    await expect(page.getByTestId('overlay-banner')).toBeVisible()

    server.send({ view: 'agenda' })
    await expect(page.getByTestId('agenda-view')).toBeVisible()
    await expect(page.getByTestId('overlay-banner')).toBeVisible()
  })

  test('goes when the server clears it, and comes when the server sets one', async ({ page }) => {
    const server = await playServer(page, { view: 'month', overlay: bins })
    await page.goto('/display?id=hallway')
    await settle(page)
    await expect(page.getByTestId('overlay-banner')).toBeVisible()

    server.send({ overlay: null })
    await expect(page.getByTestId('overlay-banner')).toHaveCount(0)

    server.send({ overlay: { text: 'Parcel at the door', icon: 'package', until: null } })
    await expect(page.getByTestId('overlay-banner')).toHaveText('Parcel at the door')
  })

  test('goes by itself when its time passes, with no word from the server', async ({ page }) => {
    await playServer(page, { view: 'month', overlay: { text: 'Bins out tonight', icon: 'trash', until: '2026-10-28T10:00:00.000Z' } })
    await page.goto('/display?id=hallway')
    await settle(page)
    await expect(page.getByTestId('overlay-banner')).toBeVisible()

    await page.clock.setFixedTime(new Date('2026-10-28T10:00:00Z'))

    await expect(page.getByTestId('overlay-banner')).toHaveCount(0)
  })

  test('is blacked out with the rest when the screen is off', async ({ page }) => {
    const server = await playServer(page, { view: 'month', overlay: bins })
    await page.goto('/display?id=hallway')
    await settle(page)

    server.send({ screen: 'off' })

    await expect(page.getByTestId('dimmer')).toHaveCSS('opacity', '1')
    // It is still in the page, but the dimmer is after it and covers it.
    const order = await page.evaluate(() => {
      const banner = document.querySelector('[data-testid="overlay-banner"]')!
      const dimmer = document.querySelector('[data-testid="dimmer"]')!
      return banner.compareDocumentPosition(dimmer) & Node.DOCUMENT_POSITION_FOLLOWING
    })
    expect(order).toBeTruthy()
  })

  test('is not shown for a display that is not in the config, even from an old cache', async ({ page }) => {
    await playServer(page)
    const cached = {
      settings: { id: 'garage', name: 'Garage', theme: 'light', month_style: 'soft', week_start: 'monday', timezone: 'Europe/London' },
      state: { view: 'month', month: null, month_set_at: null, screen: 'on', photo_source: 'immich', last_calendar_view: 'month', brightness: 100, auto_presence: true, auto_brightness: true, overlay: bins },
      events: [],
      saved_at: '2026-10-28T09:00:00.000Z',
    }
    await page.addInitScript(value => localStorage.setItem('wallcal:display:garage', JSON.stringify(value)), cached)
    await page.goto('/display?id=garage')

    await expect(page.getByTestId('stage')).toContainText('Unknown display')
    await expect(page.getByTestId('overlay-banner')).toHaveCount(0)
  })
})
