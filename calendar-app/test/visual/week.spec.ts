import { expect, test } from '@playwright/test'
import { fixtureEvents } from '../helpers/fixtureEvents'
import { playServer, settle, settleWithArt } from './helpers'
import { specialDaysOn } from './fixtures/special-days'
import weather from './fixtures/weather.json' with { type: 'json' }

// The week view at the frozen clock (Wed 28 Oct 2026, 09:41 in London), drawn
// from the ICS fixtures: 26 October to 1 November. Half term runs across the
// strip, the recurring Cycling club, Ballet and Football are blocks, and on
// Saturday the party and trick or treating overlap and sit side by side. The
// "now" line is at 09:41 in Wednesday's column, and Monday and Tuesday are veiled.

const events = fixtureEvents({ configFile: 'test/visual/config.visual.yaml' })

test('26 October to 1 November 2026, light theme', async ({ page }) => {
  await playServer(page, { view: 'week' }, events)
  await page.goto('/display?id=hallway')
  await settle(page)

  await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByTestId('week-title')).toHaveText('26 October – 1 November 2026')
  await expect(page.locator('[data-testid="day-tile"][data-today="true"]')).toHaveAttribute('data-date', '2026-10-28')
  await expect(page.getByTestId('now-line')).toBeVisible()
  await expect(page.getByTestId('now-time')).toHaveText('09:41')
  await expect(page.getByTestId('veil')).toHaveCount(2)
  await expect(page.locator('[data-kind="block"]:not([data-tracks="1"])').first()).toBeVisible()
  await expect(page).toHaveScreenshot('week-light.png')
})

test('26 October to 1 November 2026, dark theme', async ({ page }) => {
  await playServer(page, { view: 'week' }, events)
  await page.goto('/display?id=kitchen')
  await settle(page)

  await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByTestId('week-title')).toHaveText('26 October – 1 November 2026')
  await expect(page.locator('[data-testid="day-tile"][data-today="true"]')).toHaveAttribute('data-date', '2026-10-28')
  await expect(page.getByTestId('now-line')).toBeVisible()
  await expect(page.locator('[data-kind="block"]:not([data-tracks="1"])').first()).toBeVisible()
  await expect(page).toHaveScreenshot('week-dark.png')
})

test('the week with the weather, light theme', async ({ page }) => {
  await playServer(page, { view: 'week' }, events, weather)
  await page.goto('/display?id=hallway')
  await settle(page)

  await expect(page.getByTestId('day-weather').first()).toBeVisible()
  await expect(page.getByTestId('day-weather').nth(1)).toHaveText('14° / 8°')
  await expect(page).toHaveScreenshot('week-weather-light.png')
})

test('the days before Halloween carry their tiles, light theme', async ({ page }) => {
  await playServer(page, { view: 'week' }, events, null, { specialDays: specialDaysOn('2026-10-28') })
  await page.goto('/display?id=hallway')
  await settleWithArt(page)

  await expect(page.locator('[data-testid="day-tile"][data-special="halloween"]')).toHaveAttribute('data-date', '2026-10-31')
  await expect(page.locator('[data-testid="day-tile"][data-special="isla-birthday"]')).toHaveAttribute('data-date', '2026-10-29')
  await expect(page.getByTestId('tile-art')).toHaveCount(2)
  await expect(page.getByTestId('greeting')).toHaveCount(0)
  await expect(page).toHaveScreenshot('week-tiles-light.png')
})

test('Halloween takes over the week: night palette, scene and greeting', async ({ page }) => {
  const halloween = new Date('2026-10-31T09:41:00Z')
  await playServer(page, { view: 'week' }, events, null, { now: halloween, specialDays: specialDaysOn('2026-10-31') })
  await page.goto('/display?id=hallway')
  await settleWithArt(page)

  await expect(page.getByTestId('stage')).toHaveAttribute('data-palette', 'night')
  await expect(page.getByTestId('takeover-full')).toBeVisible()
  await expect(page.getByTestId('greeting')).toHaveText('Happy Halloween!')
  await expect(page.locator('[data-testid="day-tile"][data-today="true"]')).toHaveAttribute('data-date', '2026-10-31')
  await expect(page.getByTestId('now-line')).toBeVisible()
  await expect(page).toHaveScreenshot('week-takeover-halloween.png')
})
