import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { displayStateSchema } from '../../shared/display'
import type { DisplayState } from '../../shared/display'
import events from './fixtures/events.json' with { type: 'json' }

// Wed 28 Oct 2026, 09:41 in London (the clocks went back on the 25th, so that is 09:41Z).
const NOW = new Date('2026-10-28T09:41:00Z')

/** A whole state, with defaults filled in. */
const stateWith = (changes: Partial<DisplayState> = {}): DisplayState => displayStateSchema.parse(changes)

/**
 * Plays the server for a page: it answers /api/events from the fixture and
 * the WebSocket with a state, and `send` pushes a new state to every open
 * socket. /api/displays is the real server's, so the config is exercised too.
 * The clock is frozen before the page loads.
 */
async function playServer(page: Page, initial: Partial<DisplayState> = {}) {
  const sockets: { displayId: string, send: (message: string) => void }[] = []
  const message = (displayId: string, state: DisplayState) => JSON.stringify({ type: 'state.updated', display_id: displayId, state })
  let current = stateWith(initial)

  await page.clock.setFixedTime(NOW)
  await page.route('**/api/events**', async (route) => {
    const url = new URL(route.request().url())
    await route.fulfill({ json: { from: url.searchParams.get('from'), to: url.searchParams.get('to'), events } })
  })
  await page.routeWebSocket(/\/_ws/, (socket) => {
    const displayId = new URL(socket.url()).searchParams.get('display') ?? ''
    sockets.push({ displayId, send: text => socket.send(text) })
    socket.send(message(displayId, current))
  })

  return {
    /** Sends a new state (the changes on top of the one before) to the display. */
    send(changes: Partial<DisplayState>) {
      current = stateWith({ ...current, ...changes })
      for (const socket of sockets) socket.send(message(socket.displayId, current))
    },
  }
}

/** Waits for the fonts and the events, so a screenshot is of the finished page. */
async function settle(page: Page) {
  await expect(page.getByTestId('event').first()).toBeVisible()
  await page.evaluate(async () => {
    await Promise.all([document.fonts.load('400 40px Caprasimo'), document.fonts.load('700 40px Figtree')])
    await document.fonts.ready
  })
}

test('light theme, month view', async ({ page }) => {
  await playServer(page, { view: 'month' })
  await page.goto('/display?id=hallway')
  await settle(page)

  await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('h1')).toHaveText('Month')
  await expect(page.getByTestId('clock-time')).toHaveText('09:41')
  await expect(page).toHaveScreenshot('light.png')
})

test('dark theme', async ({ page }) => {
  await playServer(page, { view: 'month' })
  await page.goto('/display?id=kitchen')
  await settle(page)

  await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'dark')
  await expect(page).toHaveScreenshot('dark.png')
})

test('the view follows the server', async ({ page }) => {
  const server = await playServer(page, { view: 'month' })
  await page.goto('/display?id=hallway')
  await expect(page.locator('h1')).toHaveText('Month')

  server.send({ view: 'agenda' })

  await expect(page.locator('h1')).toHaveText('Agenda')
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
  await expect(offline.locator('h1')).toHaveText('Month')
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
  expect(await page.evaluate(() => localStorage.getItem('wallcal:display:last'))).toBe('hallway')
})

test('says so for a display that is not in the config', async ({ page }) => {
  await playServer(page)
  await page.goto('/display?id=garage')

  await expect(page.getByTestId('stage')).toContainText('Unknown display')
})
