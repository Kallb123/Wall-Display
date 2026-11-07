import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { CustomLayout, LayoutArrangement, LayoutComponent } from '../../shared/layouts'
import { fixtureEvents } from '../helpers/fixtureEvents'
import { fontsReady, playServer, settle } from './helpers'
import weather from './fixtures/weather.json' with { type: 'json' }

// Custom layouts at the frozen clock (PR 5.17, architecture §4.8): the existing
// views arranged in panes, each drawn at its own size or, where its pane is
// smaller than it was designed for, scaled down to fit. Photo | week | agenda
// on both stages in both themes, and a two by two grid. The photo pane has no
// photos to show (the server is pretended, so it answers none) and says so.

const events = fixtureEvents({ configFile: 'test/visual/config.visual.yaml' })

const row = (size: number, ...panes: [LayoutComponent, number][]): LayoutArrangement['rows'][number] => ({
  size,
  panes: panes.map(([component, paneSize]) => ({ component, size: paneSize })),
})

const layout = (id: string, landscape: LayoutArrangement, portrait: LayoutArrangement): CustomLayout => ({
  id,
  name: id,
  landscape,
  portrait,
  created_at: '2026-10-01T09:00:00.000Z',
  updated_at: '2026-10-01T09:00:00.000Z',
})

const photoWeekAgenda = layout(
  'photo-week-agenda',
  { rows: [row(1, ['photo', 1], ['week', 2], ['agenda', 1])] },
  { rows: [row(1, ['photo', 1]), row(2, ['week', 1]), row(1, ['agenda', 1])] },
)

const grid = layout(
  'grid',
  { rows: [row(1, ['month', 1], ['week', 1]), row(1, ['agenda', 1], ['week_parts', 1])] },
  { rows: [row(1, ['month', 1], ['week', 1]), row(1, ['agenda', 1], ['week_parts', 1])] },
)

const dayGrid = (id: string, rows: number, columns: number, start: 'today' | 'week'): CustomLayout => {
  const arrangement: LayoutArrangement = { rows: [{ size: 1, panes: [{ component: 'days', size: 1, grid: { rows, columns, start } }] }] }
  return layout(id, arrangement, arrangement)
}

const daysAlone = dayGrid('days-alone', 2, 4, 'today')

// A 3 by 7 grid from the start of the week beside the agenda; the agenda keeps its
// column and the grid is scaled down to fit the rest.
const daysAndAgenda = layout(
  'days-agenda',
  { rows: [row(1, ['days', 2], ['agenda', 1])] },
  { rows: [row(1, ['days', 1]), row(1, ['agenda', 1])] },
)
daysAndAgenda.landscape.rows[0]!.panes[0]!.grid = { rows: 3, columns: 7, start: 'week' }
daysAndAgenda.portrait.rows[0]!.panes[0]!.grid = { rows: 3, columns: 2, start: 'week' }

const photoAboveDays = layout(
  'photo-days',
  { rows: [row(1, ['photo', 1], ['days', 2])] },
  { rows: [row(1, ['photo', 1]), row(2, ['days', 1])] },
)
photoAboveDays.landscape.rows[0]!.panes[1]!.grid = { rows: 2, columns: 3, start: 'today' }
photoAboveDays.portrait.rows[1]!.panes[0]!.grid = { rows: 4, columns: 2, start: 'today' }

/** Opens `display` showing `shown`, and waits for every pane to be drawn. */
async function open(page: Page, display: string, shown: CustomLayout) {
  await page.route('**/api/photos/next**', route => route.fulfill({ json: { photo: null } }))
  await playServer(page, { view: 'custom', layout: shown.id }, events, weather, { layouts: [shown] })
  await page.goto(`/display?id=${display}`)
  await expect(page.getByTestId('custom-layout-view')).toBeVisible()
  await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', display === 'kitchen' ? 'dark' : 'light')
  await settle(page)
  await fontsReady(page)
}

test.describe('landscape', () => {
  test('photo, week and agenda, light theme', async ({ page }) => {
    await open(page, 'hallway', photoWeekAgenda)

    await expect(page.getByTestId('layout-pane-photo')).toHaveCSS('width', '640px')
    await expect(page.getByTestId('layout-pane-week')).toHaveCSS('width', '1280px')
    await expect(page.getByTestId('layout-pane-agenda')).toHaveCSS('width', '640px')
    await expect(page).toHaveScreenshot('custom-photo-week-agenda-light.png')
  })

  test('photo, week and agenda, dark theme', async ({ page }) => {
    await open(page, 'kitchen', photoWeekAgenda)

    await expect(page).toHaveScreenshot('custom-photo-week-agenda-dark.png')
  })

  test('a two by two grid of month, week, agenda and the week by part of day, scaled to fit', async ({ page }) => {
    await open(page, 'hallway', grid)

    // Every pane is smaller than its view's minimum, so every view is drawn shrunk.
    for (const pane of ['month', 'week', 'agenda', 'week_parts']) {
      expect(Number(await page.getByTestId(`layout-pane-${pane}`).locator('.virtual-stage').getAttribute('data-scale'))).toBeLessThan(1)
    }
    await expect(page).toHaveScreenshot('custom-grid-light.png')
  })

  test('the grid in the dark theme', async ({ page }) => {
    await open(page, 'kitchen', grid)

    await expect(page).toHaveScreenshot('custom-grid-dark.png')
  })
})

test.describe('landscape day grid', () => {
  test('a 2 by 4 day grid alone, light theme', async ({ page }) => {
    await open(page, 'hallway', daysAlone)

    await expect(page.getByTestId('day-tile')).toHaveCount(8)
    await expect(page).toHaveScreenshot('custom-days-light.png')
  })

  test('a 2 by 4 day grid alone, dark theme', async ({ page }) => {
    await open(page, 'kitchen', daysAlone)

    await expect(page).toHaveScreenshot('custom-days-dark.png')
  })

  test('a 3 by 7 day grid from the start of the week beside the agenda', async ({ page }) => {
    await open(page, 'hallway', daysAndAgenda)

    await expect(page.getByTestId('day-tile')).toHaveCount(21)
    await expect(page).toHaveScreenshot('custom-days-week-agenda-light.png')
  })
})

test.describe('portrait', () => {
  test.use({ viewport: { width: 1440, height: 2560 } })

  test('photo above week above agenda, light theme', async ({ page }) => {
    await open(page, 'hallway', photoWeekAgenda)

    await expect(page.getByTestId('stage')).toHaveAttribute('data-orientation', 'portrait')
    await expect(page.getByTestId('layout-pane-photo')).toHaveCSS('height', '640px')
    await expect(page).toHaveScreenshot('custom-photo-week-agenda-portrait-light.png')
  })

  test('photo above week above agenda, dark theme', async ({ page }) => {
    await open(page, 'kitchen', photoWeekAgenda)

    await expect(page).toHaveScreenshot('custom-photo-week-agenda-portrait-dark.png')
  })

  test('the grid', async ({ page }) => {
    await open(page, 'hallway', grid)

    await expect(page).toHaveScreenshot('custom-grid-portrait-light.png')
  })

  test('a 3 by 2 day grid above the agenda, from the start of the week', async ({ page }) => {
    await open(page, 'hallway', daysAndAgenda)

    await expect(page.getByTestId('day-tile')).toHaveCount(6)
    await expect(page).toHaveScreenshot('custom-days-week-agenda-portrait-light.png')
  })

  test('a 4 by 2 day grid below a photo', async ({ page }) => {
    await open(page, 'hallway', photoAboveDays)

    await expect(page.getByTestId('day-tile')).toHaveCount(8)
    await expect(page).toHaveScreenshot('custom-photo-days-portrait-light.png')
  })
})
