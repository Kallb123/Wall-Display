import { expect, test } from '@playwright/test'
import { playServer, settle } from './helpers'
import busy from './fixtures/agenda-busy.json' with { type: 'json' }
import empty from './fixtures/agenda-empty.json' with { type: 'json' }
import long from './fixtures/agenda-long.json' with { type: 'json' }
import weather from './fixtures/weather.json' with { type: 'json' }

// The agenda view at the frozen clock (Wed 28 Oct 2026, 09:41 in London).
// Today's busy fixture has more events than fit even once the three that are
// over are dropped, with one on now and the rest to come, so the "now" marker
// and "+N more" both show.

test('a busy day, light theme', async ({ page }) => {
  await playServer(page, { view: 'agenda' }, busy)
  await page.goto('/display?id=hallway')
  await settle(page)

  await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByTestId('clock-time')).toHaveText('09:41')
  await expect(page.getByTestId('now-marker')).toBeVisible()
  await expect(page.getByTestId('more')).toBeVisible()
  await expect(page.getByTestId('more')).toHaveText('+2 more')
  await expect(page).toHaveScreenshot('busy-light.png')
})

test('a busy day, dark theme', async ({ page }) => {
  await playServer(page, { view: 'agenda' }, busy)
  await page.goto('/display?id=kitchen')
  await settle(page)

  await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByTestId('now-marker')).toBeVisible()
  await expect(page.getByTestId('more')).toBeVisible()
  await expect(page).toHaveScreenshot('busy-dark.png')
})

test('a busy day with the weather, light theme', async ({ page }) => {
  await playServer(page, { view: 'agenda' }, busy, weather)
  await page.goto('/display?id=hallway')
  await settle(page)

  const lines = page.getByTestId('agenda-weather')
  await expect(lines).toHaveText(['12° · Rain14° / 8°', 'Partly cloudy13° / 6°'])
  await expect(page.getByTestId('now-marker')).toBeVisible()
  await expect(page.getByTestId('more')).toHaveText('+2 more')
  await expect(page).toHaveScreenshot('busy-weather-light.png')
})

test('an empty day shows a calm state', async ({ page }) => {
  await playServer(page, { view: 'agenda' }, empty)
  await page.goto('/display?id=hallway')
  await settle(page)

  await expect(page.getByTestId('empty-day')).toBeVisible()
  await expect(page.getByTestId('empty-day')).toContainText('Nothing planned')
  await expect(page.getByTestId('now-marker')).toHaveCount(0)
  await expect(page).toHaveScreenshot('empty.png')
})

test('long titles are cut short and the layout holds', async ({ page }) => {
  await playServer(page, { view: 'agenda' }, long)
  await page.goto('/display?id=hallway')
  await settle(page)

  const titles = page.getByTestId('event-title')
  const cut = await titles.evaluateAll(elements => elements.map(element => [element.textContent, element.scrollWidth > element.clientWidth]))
  const byTitle = new Map(cut as [string, boolean][])
  expect(byTitle.get('Dinner')).toBe(false)
  for (const [title, truncated] of byTitle) {
    if (title.length > 60) expect(truncated, title).toBe(true)
  }

  // Nothing is pushed out of its card, and every timed row still has its time.
  for (const day of ['day-today', 'day-tomorrow']) {
    const card = (await page.getByTestId(day).boundingBox())!
    const rows = await page.getByTestId(day).getByTestId('event').evaluateAll(elements => elements.map((element) => {
      const { left, right } = element.getBoundingClientRect()
      return { left, right }
    }))
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.left).toBeGreaterThanOrEqual(card.x)
      expect(row.right).toBeLessThanOrEqual(card.x + card.width)
    }
  }
  const times = page.getByTestId('event-time')
  await expect(times).toHaveText(['10:30', '13:00', '18:30', '22:00', 'Until 10:00', '08:15'])
  for (const time of await times.all()) await expect(time).toBeVisible()
  await expect(page).toHaveScreenshot('long-titles.png')
})
