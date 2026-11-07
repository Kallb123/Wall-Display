import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { CustomLayout, LayoutArrangement } from '../../shared/layouts'
import { NOW, fontsReady, playServer } from './helpers'

// The custom layouts' editing UI (PR 5.17): the settings Layouts tab on a laptop
// and on a phone, and the remote with its layout tiles and its edit sheet. The
// layouts are played by the test (the real server's are whatever is in its data
// folder); /api/displays is the real one, as in settings.spec.ts and
// remote.spec.ts.

const arrangement = (...rows: [number, ...[string, number][]][]): LayoutArrangement => ({
  rows: rows.map(([size, ...panes]) => ({ size, panes: panes.map(([component, paneSize]) => ({ component: component as 'week', size: paneSize })) })),
})

const STAMP = '2026-10-01T10:00:00.000Z'
const LAYOUTS: CustomLayout[] = [
  { id: 'kitchen', name: 'Kitchen', landscape: arrangement([1, ['photo', 2], ['week', 3], ['agenda', 2]]), portrait: arrangement([2, ['photo', 1]], [3, ['week', 1]], [2, ['agenda', 1]]), created_at: STAMP, updated_at: STAMP },
  { id: 'planner', name: 'Planner', landscape: arrangement([1, ['month', 3], ['agenda', 1]]), portrait: arrangement([3, ['month', 1]], [1, ['agenda', 1]]), created_at: STAMP, updated_at: STAMP },
  { id: 'grid', name: 'Everything at once', landscape: arrangement([2, ['month', 1], ['week', 1]], [1, ['agenda', 1], ['photo', 1]]), portrait: arrangement([1, ['month', 1], ['agenda', 1]], [1, ['week', 1], ['photo', 1]]), created_at: STAMP, updated_at: STAMP },
]

async function playLayouts(page: Page) {
  await page.route('**/api/layouts', route => route.fulfill({ json: LAYOUTS }))
  await page.route('**/api/remote', route => route.fulfill({ json: { pin_required: false } }))
}

test.describe('the settings tab', () => {
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })

  test('lists the layouts and edits the first, landscape', async ({ page }) => {
    await page.clock.setFixedTime(NOW)
    await playLayouts(page)
    await page.goto('/settings/layouts')
    await expect(page.getByTestId('layout-editor')).toBeVisible()
    await fontsReady(page)

    await expect(page.getByTestId('layout-row')).toHaveCount(3)
    await expect(page).toHaveScreenshot('layouts-settings.png', { fullPage: true })
  })

  test('shows the portrait arrangement', async ({ page }) => {
    await page.clock.setFixedTime(NOW)
    await playLayouts(page)
    await page.goto('/settings/layouts')
    await page.getByTestId('switch-portrait').click()
    await expect(page.getByTestId('reset-portrait')).toBeVisible()
    await fontsReady(page)

    await expect(page).toHaveScreenshot('layouts-settings-portrait.png', { fullPage: true })
  })

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('looks right', async ({ page }) => {
      await page.clock.setFixedTime(NOW)
      await playLayouts(page)
      await page.goto('/settings/layouts')
      await expect(page.getByTestId('layout-editor')).toBeVisible()
      await fontsReady(page)

      await expect(page).toHaveScreenshot('layouts-settings-phone.png', { fullPage: true })
    })
  })
})

test.describe('the remote', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })

  async function openRemote(page: Page) {
    await playServer(page, { view: 'custom', layout: 'kitchen' })
    await playLayouts(page)
    await page.goto('/remote?id=hallway')
    await expect(page.getByTestId('connection-pill')).toHaveText('Connected')
    await fontsReady(page)
  }

  test('has a tile for each layout, the one on the wall marked', async ({ page }) => {
    await openRemote(page)

    await expect(page.getByTestId('layout-tile-kitchen')).toHaveAttribute('aria-pressed', 'true')
    await expect(page).toHaveScreenshot('layouts-remote.png', { fullPage: true })
  })

  test('opens the editing sheet on the list, and then on a layout', async ({ page }) => {
    await openRemote(page)

    await page.getByTestId('layouts-edit').click()
    await expect(page.getByTestId('layout-row')).toHaveCount(3)
    await expect(page).toHaveScreenshot('layouts-remote-sheet.png')

    await page.getByTestId('layout-row').first().click()
    await expect(page.getByTestId('layout-editor')).toBeVisible()
    await expect(page).toHaveScreenshot('layouts-remote-sheet-editor.png')
  })
})
