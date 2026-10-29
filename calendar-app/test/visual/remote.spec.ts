import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { displayStateSchema } from '../../shared/display'
import type { DisplayState } from '../../shared/display'
import { fontsReady, playServer } from './helpers'

// The phone remote (architecture §7.5) at a phone's size, in both of the
// phone's colour schemes. The server's /api/displays is the real one; the
// socket, the PIN question and the commands are played by the test. The Soft
// month view's look is in month.spec.ts, and the shell's in display.spec.ts.

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })

/** Answers `GET /api/remote`: whether the server wants a PIN. */
async function pinRequired(page: Page, required: boolean) {
  await page.route('**/api/remote', route => route.fulfill({ json: { pin_required: required } }))
}

/** Opens the remote for the hallway once the name and the fonts are in. */
async function openRemote(page: Page, initial: Partial<DisplayState> = {}, required = false) {
  const server = await playServer(page, initial)
  await pinRequired(page, required)
  await page.goto('/remote?id=hallway')
  await expect(page.getByTestId('display-name')).toHaveText('Hallway')
  await expect(page.getByTestId('connection-pill')).toHaveText('Connected')
  await fontsReady(page)
  return server
}

test.describe('light', () => {
  test('looks right', async ({ page }) => {
    await openRemote(page, { view: 'agenda', brightness: 80 })

    await expect(page.getByTestId('tile-agenda')).toHaveAttribute('aria-pressed', 'true')
    await expect(page).toHaveScreenshot('light.png', { fullPage: true })
  })

  test('paints the page with the theme background to the edges', async ({ page }) => {
    await openRemote(page)

    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(245, 234, 216)')
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(245, 234, 216)')
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'light')
  })
})

test.describe('dark', () => {
  test.use({ colorScheme: 'dark' })

  test('looks right', async ({ page }) => {
    await openRemote(page, { view: 'agenda', brightness: 80 })

    await expect(page).toHaveScreenshot('dark.png', { fullPage: true })
  })

  test('paints the page with the theme background to the edges', async ({ page }) => {
    await openRemote(page)

    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(46, 43, 37)')
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(46, 43, 37)')
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
  })
})

test('follows the phone when it switches between light and dark', async ({ page }) => {
  await openRemote(page)
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(245, 234, 216)')

  await page.emulateMedia({ colorScheme: 'dark' })

  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(46, 43, 37)')
})

test('fades what is under the screen card when the screen is off, and it still works', async ({ page }) => {
  await openRemote(page, { view: 'week', screen: 'off', brightness: 100 })

  await expect(page.getByTestId('screen-toggle')).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByTestId('controls')).toHaveCSS('opacity', '0.5')
  await expect(page).toHaveScreenshot('screen-off.png', { fullPage: true })

  const commands = await recordCommands(page)
  await page.getByTestId('tile-night').click()
  await expect.poll(() => commands).toEqual([{ type: 'set_view', view: 'night' }])
})

test('shows the month picker, and the way back, for a pinned month', async ({ page }) => {
  await openRemote(page, { view: 'month', month: '2027-03', month_set_at: '2026-10-28T09:41:00.000Z' })

  await expect(page.getByTestId('month-select')).toHaveValue('2027-03')
  await expect(page.getByTestId('month-current')).toHaveText('Back to this month')
  await expect(page).toHaveScreenshot('month-pinned.png', { fullPage: true })
})

test('shows this month in the picker, with no way back, when none is pinned', async ({ page }) => {
  await openRemote(page, { view: 'month' })

  await expect(page.getByTestId('month-select')).toHaveValue('2026-10')
  await expect(page.getByTestId('month-current')).toHaveCount(0)
})

test.describe('the message', () => {
  const bins = { text: 'Bins out tonight', icon: 'trash', until: '2026-10-28T14:30:00.000Z' }

  test('shows what is on the wall and when it ends', async ({ page }) => {
    await openRemote(page, { view: 'agenda', brightness: 80, overlay: bins })

    await expect(page.getByTestId('overlay-current-text')).toHaveText('Bins out tonight')
    await expect(page.getByTestId('overlay-current-until')).toHaveText('Until 14:30')
    await expect(page).toHaveScreenshot('message.png', { fullPage: true })
  })

  test.describe('dark', () => {
    test.use({ colorScheme: 'dark' })

    test('shows what is on the wall and when it ends', async ({ page }) => {
      await openRemote(page, { view: 'agenda', brightness: 80, overlay: bins })

      await expect(page.getByTestId('overlay-current')).toBeVisible()
      await expect(page).toHaveScreenshot('message-dark.png', { fullPage: true })
    })
  })

  test('only has the form when nothing is on the wall', async ({ page }) => {
    await openRemote(page, { view: 'agenda' })

    await expect(page.getByTestId('overlay-current')).toHaveCount(0)
    await expect(page.getByTestId('overlay-submit')).toBeDisabled()
  })

  test('sends exactly what was filled in, then clears the text', async ({ page }) => {
    await openRemote(page, { view: 'agenda' })
    const commands = await recordCommands(page)

    await page.getByTestId('overlay-input').fill('  Bins out tonight  ')
    await expect(page.getByTestId('overlay-submit')).toBeEnabled()
    await page.getByTestId('overlay-icon-trash').click()
    await page.getByTestId('overlay-duration').selectOption({ label: '3 hours' })
    await page.getByTestId('overlay-submit').click()

    await expect.poll(() => commands).toEqual([{ type: 'set_overlay', overlay: { text: 'Bins out tonight', icon: 'trash', ttl: 10800 } }])
    await expect(page.getByTestId('overlay-input')).toHaveValue('')
    await expect(page.getByTestId('overlay-submit')).toBeDisabled()
    // The answer is shown at once.
    await expect(page.getByTestId('overlay-current-text')).toHaveText('Bins out tonight')
  })

  test('sends the plain form with the defaults, and Enter in the box sends it', async ({ page }) => {
    await openRemote(page, { view: 'agenda' })
    const commands = await recordCommands(page)

    await page.getByTestId('overlay-input').fill('Hello')
    await page.getByTestId('overlay-input').press('Enter')

    await expect.poll(() => commands).toEqual([{ type: 'set_overlay', overlay: { text: 'Hello', ttl: 3600 } }])
  })

  test('Clear sends null', async ({ page }) => {
    await openRemote(page, { view: 'agenda', overlay: { text: 'Hello', icon: null, until: null } })
    await expect(page.getByTestId('overlay-current-until')).toHaveText('Until cleared')
    const commands = await recordCommands(page)

    await page.getByTestId('overlay-clear').click()

    await expect.poll(() => commands).toEqual([{ type: 'set_overlay', overlay: null }])
    await expect(page.getByTestId('overlay-current')).toHaveCount(0)
  })

  test('has tap targets of at least 44 pixels', async ({ page }) => {
    await openRemote(page, { view: 'agenda', overlay: bins })

    for (const testid of ['overlay-clear', 'overlay-input', 'overlay-duration', 'overlay-submit', 'overlay-icon-none', 'overlay-icon-gift']) {
      const box = (await page.getByTestId(testid).boundingBox())!
      expect(box.height, testid).toBeGreaterThanOrEqual(44)
      expect(box.width, testid).toBeGreaterThanOrEqual(44)
    }
  })
})

test('asks for the PIN, and says when it is wrong', async ({ page }) => {
  await openRemote(page, { view: 'agenda' }, true)

  await expect(page.getByTestId('pin-sheet')).toBeVisible()
  await expect(page.getByTestId('pin-input')).toBeFocused()
  await page.getByTestId('pin-input').fill('1234')
  await page.route('**/api/remote/pin', route => route.fulfill({ status: 401, json: { statusCode: 401, message: 'Wrong PIN' } }))
  await page.getByTestId('pin-submit').click()

  await expect(page.getByTestId('pin-message')).toHaveText('Wrong PIN')
  await expect(page).toHaveScreenshot('pin-sheet.png', { fullPage: true })
})

test('names the page for the home screen', async ({ page }) => {
  await openRemote(page)

  await expect(page).toHaveTitle('Hallway remote')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/remote.webmanifest?id=hallway')
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/apple-touch-icon.png')
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Hallway')
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes')
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute('content', 'yes')
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2)
})

test('a tap sends one command and does not reload the page', async ({ page }) => {
  await openRemote(page, { view: 'month' })
  await page.evaluate(() => {
    (window as unknown as { marker: number }).marker = 1
  })
  const commands = await recordCommands(page)

  await page.getByTestId('tile-agenda').click()

  await expect.poll(() => commands).toEqual([{ type: 'set_view', view: 'agenda' }])
  // The answer to the command is shown at once.
  await expect(page.getByTestId('tile-agenda')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('month-picker')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(1)
})

test('says the wall could not be reached when a command gets no answer', async ({ page }) => {
  await openRemote(page)
  await page.route('**/api/displays/hallway/commands', route => route.abort())

  await page.getByTestId('tile-week').click()

  await expect(page.getByTestId('error')).toContainText('Couldn\'t reach the wall')
  await page.getByRole('button', { name: 'Dismiss' }).click()
  await expect(page.getByTestId('error')).toHaveCount(0)
})

/**
 * Answers every command with the state it would give (just the view, screen
 * and overlay for these tests) and lists what was sent, in order.
 */
async function recordCommands(page: Page) {
  const sent: unknown[] = []
  let state = displayStateSchema.parse({})
  await page.route('**/api/displays/hallway/commands', async (route) => {
    const command = route.request().postDataJSON() as { type: string, view?: DisplayState['view'], screen?: DisplayState['screen'], overlay?: { text: string, icon?: string, ttl?: number } | null }
    sent.push(command)
    if (command.type === 'set_view') state = displayStateSchema.parse({ ...state, view: command.view })
    if (command.type === 'set_screen') state = displayStateSchema.parse({ ...state, screen: command.screen })
    if (command.type === 'set_overlay') state = displayStateSchema.parse({ ...state, overlay: command.overlay && { text: command.overlay.text, icon: command.overlay.icon ?? null, until: null } })
    await route.fulfill({ json: state })
  })
  return sent
}
