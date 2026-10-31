import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { nightPosition } from '../../app/utils/night'
import type { CalendarEvent } from '../../shared/types/events'
import { fontsReady, playServer } from './helpers'

// The night view: a very dim clock on pure black, with the first event of the
// next 24 hours under it when the display asks (the porch does, the hallway and
// kitchen do not). The clock is frozen at Wed 28 Oct 2026, 22:30 in London, so
// "tomorrow morning" is the next day.

const LATE = new Date('2026-10-28T22:30:00Z')

const swimming: CalendarEvent = {
  id: 1,
  calendar_id: 'family',
  title: 'Swimming',
  display_title: 'Swimming',
  location: null,
  start: '2026-10-29T08:30:00.000Z',
  end: '2026-10-29T09:30:00.000Z',
  all_day: false,
  start_date: null,
  end_date: null,
  people: [{ id: 'theo', name: 'Theo', initial: 'T', colour: '#5F94C4' }],
}

// Something all day, which the night view leaves out even though it starts first.
const birthday: CalendarEvent = {
  ...swimming,
  id: 2,
  title: 'Isla\'s birthday',
  display_title: 'Isla\'s birthday',
  start: '2026-10-29T00:00:00.000Z',
  end: '2026-10-30T00:00:00.000Z',
  all_day: true,
  start_date: '2026-10-29',
  end_date: '2026-10-30',
}

/** Opens the night view of `display` and waits for the fonts. */
async function openNight(page: Page, display: string, served: CalendarEvent[]) {
  await playServer(page, { view: 'night' }, served, null, { now: LATE })
  await page.goto(`/display?id=${display}`)
  await expect(page.getByTestId('night-view')).toBeVisible()
  await fontsReady(page)
}

test('the porch shows the clock and tomorrow morning\'s first event, drifted to its spot', async ({ page }) => {
  await openNight(page, 'porch', [birthday, swimming])

  await expect(page.getByTestId('night-clock')).toHaveText('22:30')
  await expect(page.getByTestId('night-text')).toHaveText('Tomorrow 08:30 · Swimming')
  // The clock block is at the spot for this moment, the burn-in being on.
  const spot = nightPosition(LATE)
  const transform = await page.getByTestId('night-clock').evaluate(element => getComputedStyle(element.parentElement!).transform)
  expect(transform).toBe(`matrix(1, 0, 0, 1, ${spot.x}, ${spot.y})`)
  await expect(page).toHaveScreenshot('night-first-event.png')
})

test('with nothing coming up it is just the clock', async ({ page }) => {
  await openNight(page, 'porch', [birthday])

  await expect(page.getByTestId('night-clock')).toHaveText('22:30')
  await expect(page.getByTestId('night-text')).toHaveCount(0)
  await expect(page).toHaveScreenshot('night-clock-only.png')
})

test('on a light display it is still pure black, and a display that does not ask has no line', async ({ page }) => {
  await openNight(page, 'hallway', [swimming])

  await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByTestId('night-view')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
  await expect(page.getByTestId('night-text')).toHaveCount(0)
  // Burn-in is off for the hallway, so the clock is in the middle.
  await expect(page.getByTestId('night-clock').locator('..')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
  const stage = (await page.getByTestId('stage').boundingBox())!
  const clock = (await page.getByTestId('night-clock').boundingBox())!
  expect(Math.abs(clock.x + clock.width / 2 - (stage.x + stage.width / 2))).toBeLessThan(2)
  await expect(page).toHaveScreenshot('night-light-display.png')
})

test('the dimmer still covers it', async ({ page }) => {
  await playServer(page, { view: 'night', brightness: 0 }, [swimming], null, { now: LATE })
  await page.goto('/display?id=kitchen')
  await expect(page.getByTestId('night-view')).toBeVisible()

  await expect(page.getByTestId('dimmer')).toHaveCSS('opacity', '1')
})
