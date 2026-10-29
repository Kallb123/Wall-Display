import { expect, test } from '@playwright/test'
import { fixtureEvents } from '../helpers/fixtureEvents'
import { playServer, settle } from './helpers'

// The month view at the frozen clock (Wed 28 Oct 2026, 09:41 in London), drawn
// from the ICS fixtures. Today has Half term all day, then Nursery at 08:45
// (over), 1:1 with Priya at 14:00 and "+2 more" in the side panel.

const events = fixtureEvents({ configFile: 'test/visual/config.visual.yaml' })

test('October 2026, light theme', async ({ page }) => {
  await playServer(page, { view: 'month' }, events)
  await page.goto('/display?id=hallway')
  await settle(page)

  await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByTestId('month-title')).toHaveText('October 2026')
  await expect(page.locator('[data-testid="day-tile"][data-today="true"]')).toHaveAttribute('data-date', '2026-10-28')
  await expect(page.getByTestId('panel-day').first()).toHaveAttribute('data-date', '2026-10-28')
  await expect(page.getByTestId('veil').first()).toBeAttached()
  await expect(page).toHaveScreenshot('october-light.png')
})

test('October 2026, dark theme', async ({ page }) => {
  await playServer(page, { view: 'month' }, events)
  await page.goto('/display?id=kitchen')
  await settle(page)

  await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByTestId('month-title')).toHaveText('October 2026')
  await expect(page.locator('[data-testid="day-tile"][data-today="true"]')).toHaveAttribute('data-date', '2026-10-28')
  await expect(page.getByTestId('panel-day').first()).toHaveAttribute('data-date', '2026-10-28')
  await expect(page.getByTestId('veil').first()).toBeAttached()
  await expect(page).toHaveScreenshot('october-dark.png')
})

test('a pinned month follows the title and grid, while the panel stays on today', async ({ page }) => {
  await playServer(page, { view: 'month', month: '2026-12' }, events)
  await page.goto('/display?id=hallway')
  await settle(page)

  await expect(page.getByTestId('month-title')).toHaveText('December 2026')
  await expect(page.getByTestId('day-tile')).toHaveCount(35)
  await expect(page.locator('[data-testid="day-tile"][data-today="true"]')).toHaveCount(0)
  await expect(page.getByTestId('today-number')).toHaveCount(0)
  await expect(page.getByTestId('panel-day').first()).toHaveAttribute('data-date', '2026-10-28')
  await expect(page.getByTestId('panel-day').first()).toContainText('Today')
  await expect(page).toHaveScreenshot('pinned.png')
})

test('changing the month fetches that month\'s events', async ({ page }) => {
  const server = await playServer(page, { view: 'month' }, events)
  const requests: URL[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api/events') requests.push(url)
  })
  await page.goto('/display?id=hallway')
  await settle(page)
  await expect(page.getByTestId('month-title')).toHaveText('October 2026')

  server.send({ month: '2026-11' })

  await expect(page.getByTestId('month-title')).toHaveText('November 2026')
  // November's grid runs from the week before its first day to two weeks after its last.
  await expect.poll(() => requests.some(url => url.searchParams.get('from') === '2026-10-25' && url.searchParams.get('to') === '2026-12-15')).toBe(true)
})
