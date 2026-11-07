import { expect, test } from '@playwright/test'
import { fixtureEvents } from '../helpers/fixtureEvents'
import { playServer, settle, settleWithArt } from './helpers'
import { specialDaysOn } from './fixtures/special-days'
import weather from './fixtures/weather.json' with { type: 'json' }

// The week by part of day at the frozen clock (Wed 28 Oct 2026, 09:41 in
// London), drawn from the ICS fixtures: 26 October to 1 November. Half term runs
// in the heads of its days, the recurring clubs, Ballet and Football are lines in
// their parts of the day, and today's morning has the sage outline. Monday and
// Tuesday are veiled.

const events = fixtureEvents({ configFile: 'test/visual/config.visual.yaml' })

test('26 October to 1 November 2026, light theme', async ({ page }) => {
  await playServer(page, { view: 'week_parts' }, events)
  await page.goto('/display?id=hallway')
  await settle(page)

  await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByTestId('week-title')).toHaveText('26 October – 1 November 2026')
  await expect(page.locator('[data-testid="day-row"][data-today="true"]')).toHaveAttribute('data-date', '2026-10-28')
  await expect(page.getByTestId('part-heading')).toHaveCount(3)
  await expect(page.getByTestId('now-part')).toHaveCount(1)
  await expect(page.getByTestId('veil')).toHaveCount(1)
  await expect(page).toHaveScreenshot('week-parts-light.png')
})

test('26 October to 1 November 2026, dark theme', async ({ page }) => {
  await playServer(page, { view: 'week_parts' }, events)
  await page.goto('/display?id=kitchen')
  await settle(page)

  await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('[data-testid="day-row"][data-today="true"]')).toHaveAttribute('data-date', '2026-10-28')
  await expect(page.getByTestId('now-part')).toHaveCount(1)
  await expect(page).toHaveScreenshot('week-parts-dark.png')
})

test('the week with the weather, light theme', async ({ page }) => {
  await playServer(page, { view: 'week_parts' }, events, weather)
  await page.goto('/display?id=hallway')
  await settle(page)

  await expect(page.getByTestId('day-weather').first()).toBeVisible()
  await expect(page.getByTestId('day-weather').nth(1)).toHaveText('14° / 8°')
  await expect(page).toHaveScreenshot('week-parts-weather-light.png')
})

test('the days before Halloween carry their tiles, light theme', async ({ page }) => {
  await playServer(page, { view: 'week_parts' }, events, null, { specialDays: specialDaysOn('2026-10-28') })
  await page.goto('/display?id=hallway')
  await settleWithArt(page)

  await expect(page.locator('[data-testid="day-row"][data-special="halloween"]')).toHaveAttribute('data-date', '2026-10-31')
  await expect(page.locator('[data-testid="day-row"][data-special="isla-birthday"]')).toHaveAttribute('data-date', '2026-10-29')
  await expect(page.getByTestId('tile-art')).toHaveCount(2)
  await expect(page.getByTestId('greeting')).toHaveCount(0)
  await expect(page).toHaveScreenshot('week-parts-tiles-light.png')
})

test('Halloween takes over the week by part of day: night palette, scene and greeting', async ({ page }) => {
  const halloween = new Date('2026-10-31T09:41:00Z')
  await playServer(page, { view: 'week_parts' }, events, null, { now: halloween, specialDays: specialDaysOn('2026-10-31') })
  await page.goto('/display?id=hallway')
  await settleWithArt(page)

  await expect(page.getByTestId('stage')).toHaveAttribute('data-palette', 'night')
  await expect(page.getByTestId('takeover-full')).toBeVisible()
  await expect(page.getByTestId('greeting')).toHaveText('Happy Halloween!')
  await expect(page.locator('[data-testid="day-row"][data-today="true"]')).toHaveAttribute('data-date', '2026-10-31')
  await expect(page.getByTestId('now-part')).toHaveCount(1)
  await expect(page).toHaveScreenshot('week-parts-takeover-halloween.png')
})
