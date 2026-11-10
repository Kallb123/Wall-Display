import { expect, test } from '@playwright/test'
import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { photoResponseSchema } from '../../shared/photos'
import type { PhotoInfo } from '../../shared/photos'
import { burnInOffset } from '../../app/utils/burnIn'
import { nightPosition } from '../../app/utils/night'
import type { CalendarEvent } from '../../shared/types/events'
import { fontsReady, playServer, settle, settleWithArt } from './helpers'
import { specialDaysOn } from './fixtures/special-days'
import busy from './fixtures/agenda-busy.json' with { type: 'json' }
import { fixtureEvents } from '../helpers/fixtureEvents'
import weather from './fixtures/weather.json' with { type: 'json' }

// The portrait stage (PR 5.10, architecture §4.2): a 1440×2560 window, as a
// panel hung on its side shows it. The night view, the agenda, the photo frame
// the month, the week and the week by part of day have portrait layouts, which is every view. The window is the
// shape of the panel, so `auto` finds portrait by itself, and `?orientation=` is
// checked as well. The landscape pictures are in the other specs, which must
// not change.

const events = fixtureEvents({ configFile: 'test/visual/config.visual.yaml' })
/** The events up to the end of `through` (`YYYY-MM-DD`), so the greeting has a short list under it. */
const quiet = (through: string) => events.filter(event => event.start.slice(0, 10) <= through)

test.use({ viewport: { width: 1440, height: 2560 } })

const LATE = new Date('2026-10-28T22:30:00Z')

const swimming: CalendarEvent = {
  id: 1,
  calendar_id: 'family',
  title: 'Swimming',
  display_title: 'Swimming',
  icon: null,
  location: null,
  start: '2026-10-29T08:30:00.000Z',
  end: '2026-10-29T09:30:00.000Z',
  all_day: false,
  start_date: null,
  end_date: null,
  people: [{ id: 'theo', name: 'Theo', initial: 'T', colour: '#5F94C4' }],
}

/** Opens `path` showing the night view and waits for the fonts. */
async function openNight(page: Page, path: string, overlay?: { text: string, icon: null, until: null }) {
  await playServer(page, { view: 'night', overlay: overlay ?? null }, [swimming], null, { now: LATE })
  await page.goto(path)
  await expect(page.getByTestId('night-view')).toBeVisible()
  await fontsReady(page)
}

const stageBox = async (page: Page) => (await page.getByTestId('stage').boundingBox())!

test('the porch\'s night view is the portrait stage, with the clock drifted along its long side', async ({ page }) => {
  await openNight(page, '/display?id=porch')

  await expect(page.getByTestId('stage')).toHaveAttribute('data-orientation', 'portrait')
  await expect(page.getByTestId('stage')).toHaveCSS('width', '1440px')
  await expect(page.getByTestId('stage')).toHaveCSS('height', '2560px')
  expect(await stageBox(page)).toEqual({ x: 0, y: 0, width: 1440, height: 2560 })
  await expect(page.getByTestId('night-text')).toHaveText('Tomorrow 08:30 · Swimming')
  const spot = nightPosition(LATE, 'portrait')
  expect(spot).not.toEqual({ x: 0, y: 0 })
  const transform = await page.getByTestId('night-clock').evaluate(element => getComputedStyle(element.parentElement!).transform)
  expect(transform).toBe(`matrix(1, 0, 0, 1, ${spot.x}, ${spot.y})`)
  // The block is inside the stage, whichever spot it is at.
  const block = (await page.getByTestId('night-clock').locator('..').boundingBox())!
  expect(block.x).toBeGreaterThanOrEqual(0)
  expect(block.x + block.width).toBeLessThanOrEqual(1440)
  await expect(page).toHaveScreenshot('portrait-night-porch.png')
})

test('a display with burn-in off has the clock in the middle of the portrait stage', async ({ page }) => {
  await openNight(page, '/display?id=hallway')

  await expect(page.getByTestId('night-clock').locator('..')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
  const stage = await stageBox(page)
  const clock = (await page.getByTestId('night-clock').boundingBox())!
  expect(Math.abs(clock.x + clock.width / 2 - (stage.x + stage.width / 2))).toBeLessThan(2)
  expect(Math.abs(clock.y + clock.height / 2 - (stage.y + stage.height / 2))).toBeLessThan(2)
  await expect(page).toHaveScreenshot('portrait-night-centred.png')
})

test('the clock fits the stage at the widest spot, and a long line under it is cut inside the margins', async ({ page }) => {
  const long: CalendarEvent = { ...swimming, display_title: 'Theo\'s swimming gala and the long drive to the other side of the county' }
  await playServer(page, { view: 'night' }, [long], null, { now: LATE })
  await page.goto('/display?id=porch')
  await expect(page.getByTestId('night-text')).toBeVisible()
  await fontsReady(page)

  // The widest the clock gets is its own width at the furthest it drifts across (160 px either way).
  const clock = (await page.getByTestId('night-clock').boundingBox())!
  expect(clock.width + 2 * 160).toBeLessThanOrEqual(1440 - 128)
  const text = (await page.getByTestId('night-text').boundingBox())!
  expect(text.x).toBeGreaterThanOrEqual(64)
  expect(text.x + text.width).toBeLessThanOrEqual(1440 - 64)
})

test('the overlay banner keeps its margins on the portrait stage', async ({ page }) => {
  await openNight(page, '/display?id=hallway', { text: 'Bins out tonight, and please put the recycling box out by the gate', icon: null, until: null })

  const banner = (await page.getByTestId('overlay-banner').boundingBox())!
  expect(banner.x).toBeGreaterThanOrEqual(64)
  expect(banner.x + banner.width).toBeLessThanOrEqual(1440 - 64)
  await expect(page).toHaveScreenshot('portrait-night-overlay.png')
})

test('?orientation=portrait gives the night view the portrait stage in a landscape window', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await openNight(page, '/display?id=hallway&orientation=portrait')

  await expect(page.getByTestId('stage')).toHaveAttribute('data-orientation', 'portrait')
  const stage = await stageBox(page)
  expect(stage.height).toBeCloseTo(1440, 0)
  expect(stage.width).toBeCloseTo(1440 * 1440 / 2560, 0)
})

test('?orientation=landscape keeps the landscape stage in a portrait window', async ({ page }) => {
  await openNight(page, '/display?id=hallway&orientation=landscape')

  await expect(page.getByTestId('stage')).toHaveAttribute('data-orientation', 'landscape')
  const stage = await stageBox(page)
  expect(stage.width).toBeCloseTo(1440, 0)
  expect(stage.height).toBeCloseTo(810, 0)
})

test('the porch\'s content is nudged on the portrait stage too, and the dimmer covers the whole of it', async ({ page }) => {
  await openNight(page, '/display?id=porch')

  const expected = burnInOffset(LATE)
  expect(expected).not.toEqual({ x: 0, y: 0 })
  const transform = await page.getByTestId('shift').evaluate(element => getComputedStyle(element).transform)
  const [, , , , x, y] = transform.match(/^matrix\((.+)\)$/)![1]!.split(',').map(Number)
  expect({ x, y }).toEqual(expected)
  expect(await page.getByTestId('dimmer').boundingBox()).toEqual(await stageBox(page))
})

// The agenda (PR 5.11, mocks 4e and 4f): two cards stacked, today's the taller.
// At 09:41 the busy fixture has twelve events today, three of them over, and
// two tomorrow.
test.describe('the agenda', () => {
  /** `count` half-hour events from 08:00 tomorrow, so none has passed on the clock. */
  const tomorrowsEvents = (count: number): CalendarEvent[] => Array.from({ length: count }, (_, index) => ({
    ...swimming,
    id: 500 + index,
    title: `Appointment ${index + 1}`,
    display_title: `Appointment ${index + 1}`,
    start: `2026-10-29T${String(8 + index).padStart(2, '0')}:00:00.000Z`,
    end: `2026-10-29T${String(8 + index).padStart(2, '0')}:30:00.000Z`,
  }))

  /** Nothing is cut off: every row is inside its card, with its whole height. */
  async function expectRowsInside(page: Page, days = ['day-today', 'day-tomorrow']) {
    for (const day of days) {
      const card = (await page.getByTestId(day).boundingBox())!
      const rows = await page.getByTestId(day).locator('[data-testid="event"], [data-testid="more"], [data-testid="now-marker"]').evaluateAll(elements => elements.map((element) => {
        const { top, bottom } = element.getBoundingClientRect()
        return { top, bottom, clipped: element.parentElement!.scrollHeight > element.parentElement!.clientHeight }
      }))
      expect(rows.length, day).toBeGreaterThan(0)
      for (const row of rows) {
        expect(row.top, day).toBeGreaterThanOrEqual(card.y)
        // The card has 56 px of padding under its rows.
        expect(row.bottom, day).toBeLessThanOrEqual(card.y + card.height - 56)
        expect(row.clipped, day).toBe(false)
      }
    }
  }

  test('a busy day, light theme, as the mock', async ({ page }) => {
    await playServer(page, { view: 'agenda' }, busy, weather)
    await page.goto('/display?id=hallway')
    await settle(page)

    await expect(page.getByTestId('stage')).toHaveAttribute('data-orientation', 'portrait')
    await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'light')
    await expect(page.getByTestId('clock-time')).toHaveText('09:41')
    await expect(page.getByTestId('now-marker')).toBeVisible()
    // Stacked: today above tomorrow, both the width of the stage less its margins, and today the taller.
    const today = (await page.getByTestId('day-today').boundingBox())!
    const tomorrow = (await page.getByTestId('day-tomorrow').boundingBox())!
    expect(today).toMatchObject({ x: 64, y: 72, width: 1312 })
    expect(tomorrow).toMatchObject({ x: 64, width: 1312 })
    expect(tomorrow.y).toBeCloseTo(today.y + today.height + 48, 0)
    expect(tomorrow.y + tomorrow.height).toBeCloseTo(2560 - 72, 0)
    expect(today.height / tomorrow.height).toBeCloseTo(7 / 5, 1)
    await expectRowsInside(page)
    await expect(page).toHaveScreenshot('portrait-agenda-busy-light.png')
  })

  test('a busy day, dark theme', async ({ page }) => {
    await playServer(page, { view: 'agenda' }, busy, weather)
    await page.goto('/display?id=kitchen')
    await settle(page)

    await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'dark')
    await expectRowsInside(page)
    await expect(page).toHaveScreenshot('portrait-agenda-busy-dark.png')
  })

  test('a long day shows "+N more" in both cards and cuts no row', async ({ page }) => {
    await playServer(page, { view: 'agenda' }, [...busy.filter(event => event.start < '2026-10-29'), ...tomorrowsEvents(9)], weather)
    await page.goto('/display?id=hallway')
    await settle(page)

    await expect(page.getByTestId('more')).toHaveCount(2)
    await expect(page.getByTestId('day-today').getByTestId('more')).toBeVisible()
    await expect(page.getByTestId('day-tomorrow').getByTestId('more')).toHaveText('+5 more')
    await expect(page.getByTestId('day-tomorrow').getByTestId('event')).toHaveCount(4)
    await expectRowsInside(page)
    await expect(page).toHaveScreenshot('portrait-agenda-long.png')
  })

  test('the cards are as full as they can be: one more row would not fit', async ({ page }) => {
    // A day with exactly its limit of rows has no "+N more" and still fits.
    const today = busy.filter(event => event.start < '2026-10-28T12:00')
    await playServer(page, { view: 'agenda' }, [...today, ...tomorrowsEvents(5)], weather)
    await page.goto('/display?id=hallway')
    await settle(page)

    await expect(page.getByTestId('more')).toHaveCount(0)
    await expect(page.getByTestId('day-tomorrow').getByTestId('event')).toHaveCount(5)
    await expectRowsInside(page)
  })

  test('a special day\'s greeting sits above today\'s list, in the night palette, with no art behind it when the day has no portrait art', async ({ page }) => {
    const HALLOWEEN = new Date('2026-10-31T09:41:00Z')
    await playServer(page, { view: 'agenda' }, quiet('2026-10-31'), null, { now: HALLOWEEN, specialDays: specialDaysOn('2026-10-31') })
    await page.goto('/display?id=hallway')
    await settle(page)

    await expect(page.getByTestId('stage')).toHaveAttribute('data-palette', 'night')
    // Halloween has the 2560×1440 art only, which the portrait stage does not draw.
    await expect(page.getByTestId('takeover-full')).toHaveCount(0)
    await expect(page.getByTestId('day-today').getByTestId('greeting')).toHaveText('Happy Halloween!')
    await expect(page.getByTestId('day-tomorrow').getByTestId('greeting')).toHaveCount(0)
    // Tomorrow has nothing planned in this fixture.
    await expect(page.getByTestId('day-tomorrow').getByTestId('empty-day')).toBeVisible()
    await expectRowsInside(page, ['day-today'])
    await expect(page).toHaveScreenshot('portrait-agenda-takeover.png')
  })

  test('a takeover with portrait art draws it behind the agenda, with its extra layer over it', async ({ page }) => {
    const THURSDAY_29 = new Date('2026-10-29T09:41:00Z')
    await playServer(page, { view: 'agenda' }, quiet('2026-10-29'), null, { now: THURSDAY_29, specialDays: specialDaysOn('2026-10-29') })
    await page.goto('/display?id=hallway')
    await settleWithArt(page)

    await expect(page.getByTestId('stage')).toHaveAttribute('data-orientation', 'portrait')
    await expect(page.getByTestId('stage')).toHaveAttribute('data-palette', 'sage')
    // The portrait cuts, not the landscape ones.
    await expect(page.getByTestId('takeover-full')).toHaveAttribute('src', '/special-days/birthday-light-tall.svg')
    await expect(page.getByTestId('takeover-extra')).toHaveAttribute('src', '/special-days/balloon-7-tall.svg')
    await expect(page.getByTestId('day-today').getByTestId('greeting')).toHaveText('Happy 7th birthday, Isla!')
    await expect(page).toHaveScreenshot('portrait-agenda-takeover-art.png')
  })
})

// The month (PR 5.12, mocks 4a, 4b and 4j): the title, a band for today, the
// five weeks at six lanes a tile, and a strip of the next three days. The
// fixture's busiest day shows four events, so two crowded days are added: one
// that fills six lanes exactly and one that overflows them into "+N more".
test.describe('the month', () => {
  const crowded = (date: string, count: number, from = 7): CalendarEvent[] => Array.from({ length: count }, (_, index) => ({
    ...swimming,
    id: 700 + index + Number(date.slice(8)) * 20,
    title: `Crowd ${index + 1}`,
    display_title: `Crowd ${index + 1}`,
    start: `${date}T${String(from + index).padStart(2, '0')}:00:00.000Z`,
    end: `${date}T${String(from + index).padStart(2, '0')}:30:00.000Z`,
  }))
  /** Sun 11 Oct holds six rows exactly, and Mon 12 Oct (with Swimming already) has more than it can show. */
  const withCrowds = [...events, ...crowded('2026-10-11', 6), ...crowded('2026-10-12', 8)]

  const box = async (locator: Locator) => (await locator.boundingBox())!

  /**
   * Nothing in the grid is cut off: every event, bar and "+N more" lies inside
   * the row of tiles it is in, with its whole height, and clips nothing of its
   * own. A bar runs across tiles, so it is the tile under its left end.
   */
  async function expectGridInside(page: Page) {
    const tiles = await page.getByTestId('day-tile').evaluateAll(elements => elements.map((element) => {
      const { left, right, top, bottom } = element.getBoundingClientRect()
      return { left, right, top, bottom }
    }))
    const items = await page.locator('[data-testid="event"]:not([data-kind="panel"]), [data-testid="more"]').evaluateAll(elements => elements.map((element) => {
      const { left, top, bottom } = element.getBoundingClientRect()
      return { left, top, bottom, clipped: element.scrollHeight > element.clientHeight, text: element.textContent }
    }))
    expect(items.length).toBeGreaterThan(0)
    // The last row of tiles ends above the strip, not under it.
    expect(Math.max(...tiles.map(tile => tile.bottom))).toBeLessThanOrEqual((await box(page.getByTestId('next-days'))).y)
    for (const item of items) {
      const tile = tiles.find(candidate => item.left >= candidate.left - 0.5 && item.left < candidate.right && (item.top + item.bottom) / 2 >= candidate.top && (item.top + item.bottom) / 2 <= candidate.bottom)
      expect(tile, item.text!).toBeDefined()
      expect(item.top, item.text!).toBeGreaterThanOrEqual(tile!.top)
      expect(item.bottom, item.text!).toBeLessThanOrEqual(tile!.bottom)
      expect(item.clipped, item.text!).toBe(false)
    }
  }

  /** Nothing in the band or the strip is cut off: every row is inside, above the padding, and clips nothing. */
  async function expectPanelsInside(page: Page) {
    for (const [id, padding] of [['today-band', 44], ['panel-day', 30]] as const) {
      const holders = page.getByTestId(id)
      for (let index = 0; index < await holders.count(); index++) {
        const holder = holders.nth(index)
        const outer = await box(holder)
        const rows = await holder.locator('[data-testid="event"], [data-testid="panel-more"], [data-testid="greeting"], .nothing').evaluateAll(elements => elements.map((element) => {
          const { top, bottom } = element.getBoundingClientRect()
          // A greeting's line box is taller than its glyphs and nothing clips it, so only its position is checked.
          return { top, bottom, clipped: element.getAttribute('data-testid') !== 'greeting' && element.scrollHeight > element.clientHeight }
        }))
        for (const row of rows) {
          expect(row.top, id).toBeGreaterThanOrEqual(outer.y)
          expect(row.bottom, id).toBeLessThanOrEqual(outer.y + outer.height - padding + 0.5)
          expect(row.clipped, id).toBe(false)
        }
        // The holder itself clips nothing either.
        expect(await holder.evaluate(element => element.scrollHeight <= element.clientHeight), id).toBe(true)
      }
    }
  }

  /** The events and "+N more" label in the tile of `date`. */
  async function itemsIn(page: Page, date: string) {
    const tile = await box(page.locator(`[data-testid="day-tile"][data-date="${date}"]`))
    return page.locator('[data-testid="event"]:not([data-kind="panel"]), [data-testid="more"]').evaluateAll((elements, area) => elements.filter((element) => {
      const { left, top } = element.getBoundingClientRect()
      return left >= area.x - 0.5 && left < area.x + area.width && top >= area.y && top < area.y + area.height
    }).map(element => ({ more: element.getAttribute('data-testid') === 'more', text: (element.querySelector('.name') ?? element).textContent!.trim() })), tile)
  }

  test('October, light theme, as the mock', async ({ page }) => {
    await playServer(page, { view: 'month' }, events, weather)
    await page.goto('/display?id=hallway')
    await settle(page)

    await expect(page.getByTestId('stage')).toHaveAttribute('data-orientation', 'portrait')
    await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'light')
    await expect(page.getByTestId('month-title')).toHaveText('October 2026')
    await expect(page.getByTestId('today-high-low')).toHaveText('High 14° · Low 8°')
    await expect(page.getByTestId('next-days').getByTestId('panel-day')).toHaveCount(3)
    // Full width less its 48 px margins, the weeks under the band and the strip under them.
    const band = await box(page.getByTestId('today-band'))
    const strip = await box(page.getByTestId('next-days'))
    expect(band).toMatchObject({ x: 48, width: 1344 })
    expect(strip).toMatchObject({ x: 48, width: 1344 })
    expect(strip.y + strip.height).toBeCloseTo(2560 - 48, 0)
    await expectGridInside(page)
    await expectPanelsInside(page)
    await expect(page).toHaveScreenshot('portrait-month-light.png')
  })

  test('October, dark theme', async ({ page }) => {
    await playServer(page, { view: 'month' }, events, weather)
    await page.goto('/display?id=kitchen')
    await settle(page)

    await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'dark')
    await expectGridInside(page)
    await expectPanelsInside(page)
    await expect(page).toHaveScreenshot('portrait-month-dark.png')
  })

  test('a day with six events shows all six, and a fuller one ends in "+N more" in the sixth lane', async ({ page }) => {
    await playServer(page, { view: 'month' }, withCrowds, weather)
    await page.goto('/display?id=hallway')
    await settle(page)

    const six = await itemsIn(page, '2026-10-11')
    expect(six.map(item => item.text)).toEqual(['Crowd 1', 'Crowd 2', 'Crowd 3', 'Crowd 4', 'Crowd 5', 'Crowd 6'])
    // More than six: five rows, then the count of the rest.
    const full = await itemsIn(page, '2026-10-12')
    expect(full).toHaveLength(6)
    expect(full[5]).toMatchObject({ more: true, text: expect.stringMatching(/^\+\d+ more$/) })
    await expectGridInside(page)
    await expect(page).toHaveScreenshot('portrait-month-crowded.png')
  })

  test('the strip and the band hold as many rows as they are meant to, and cut none', async ({ page }) => {
    // Tomorrow has eight events and today has nine: more than either can show.
    await playServer(page, { view: 'month' }, [...events, ...crowded('2026-10-28', 9, 10), ...crowded('2026-10-29', 8)], weather)
    await page.goto('/display?id=hallway')
    await settle(page)

    await expect(page.getByTestId('today-band').getByTestId('panel-more')).toBeVisible()
    const tomorrow = page.locator('[data-testid="next-days"] [data-testid="panel-day"]').first()
    await expect(tomorrow.getByTestId('panel-more')).toBeVisible()
    await expect(tomorrow.getByTestId('event')).toHaveCount(3)
    await expect(page.getByTestId('today-band').getByTestId('event')).toHaveCount(6)
    await expectPanelsInside(page)
    await expectGridInside(page)
    await expect(page).toHaveScreenshot('portrait-month-full-panels.png')
  })

  test('a takeover\'s greeting sits in the band, in the night palette, and six lanes still fit the shorter tiles', async ({ page }) => {
    const HALLOWEEN = new Date('2026-10-31T09:41:00Z')
    await playServer(page, { view: 'month' }, withCrowds, weather, { now: HALLOWEEN, specialDays: specialDaysOn('2026-10-31') })
    await page.goto('/display?id=hallway')
    await settle(page)

    await expect(page.getByTestId('stage')).toHaveAttribute('data-palette', 'night')
    await expect(page.getByTestId('takeover-full')).toHaveCount(0)
    await expect(page.getByTestId('today-band').getByTestId('greeting')).toHaveText('Happy Halloween!')
    expect((await itemsIn(page, '2026-10-11')).map(item => item.text)).toEqual(['Crowd 1', 'Crowd 2', 'Crowd 3', 'Crowd 4', 'Crowd 5', 'Crowd 6'])
    expect((await itemsIn(page, '2026-10-12'))[5]).toMatchObject({ more: true })
    await expectGridInside(page)
    await expectPanelsInside(page)
    await expect(page).toHaveScreenshot('portrait-month-takeover.png')
  })

  test('a takeover with portrait art draws it behind the month', async ({ page }) => {
    const THURSDAY_29 = new Date('2026-10-29T09:41:00Z')
    await playServer(page, { view: 'month' }, quiet('2026-11-02'), weather, { now: THURSDAY_29, specialDays: specialDaysOn('2026-10-29') })
    await page.goto('/display?id=hallway')
    await settleWithArt(page)

    await expect(page.getByTestId('stage')).toHaveAttribute('data-palette', 'sage')
    await expect(page.getByTestId('takeover-full')).toHaveAttribute('src', '/special-days/birthday-light-tall.svg')
    await expect(page.getByTestId('today-band').getByTestId('greeting')).toHaveText('Happy 7th birthday, Isla!')
    await expectGridInside(page)
    await expectPanelsInside(page)
    await expect(page).toHaveScreenshot('portrait-month-takeover-art.png')
  })

  test('a pinned month changes the title and the grid, and the band stays on today', async ({ page }) => {
    await playServer(page, { view: 'month', month: '2026-12' }, events, weather)
    await page.goto('/display?id=hallway')
    await settle(page)

    await expect(page.getByTestId('month-title')).toHaveText('December 2026')
    await expect(page.getByTestId('day-tile')).toHaveCount(35)
    await expect(page.locator('[data-testid="day-tile"][data-today="true"]')).toHaveCount(0)
    await expect(page.getByTestId('panel-date')).toHaveText('28')
    await expect(page.getByTestId('today-band')).toContainText('Wednesday')
    await expect(page.getByTestId('next-days').getByTestId('panel-day').first()).toHaveAttribute('data-date', '2026-10-29')
    await expectGridInside(page)
  })
})

// The week (PR 5.13, mocks 4c and 4d): seven narrow tiles with the hours down
// the left, two blocks side by side at most, and a "+N" chip for the rest. The
// fixtures have Wednesday's playdate and ballet side by side; the crowded week
// adds three events at once on Tuesday, two more at one time on Thursday, and
// five all-day events on Monday, which fill the strip and end in "+N more".
test.describe('the week', () => {
  const crowd = (id: number, title: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
    ...swimming, id, title, display_title: title, start, end, ...extra,
  })
  const crowded: CalendarEvent[] = [
    ...events,
    crowd(801, 'Maths club', '2026-10-27T10:00:00.000Z', '2026-10-27T12:00:00.000Z'),
    crowd(802, 'Chess club', '2026-10-27T10:00:00.000Z', '2026-10-27T12:00:00.000Z'),
    crowd(803, 'Choir', '2026-10-27T10:30:00.000Z', '2026-10-27T11:30:00.000Z'),
    crowd(804, 'Drama', '2026-10-27T10:30:00.000Z', '2026-10-27T11:00:00.000Z'),
    crowd(805, 'Lab', '2026-10-27T14:00:00.000Z', '2026-10-27T14:20:00.000Z'),
    crowd(806, 'Quick one', '2026-10-27T14:00:00.000Z', '2026-10-27T14:20:00.000Z'),
    crowd(807, 'Spanish', '2026-10-27T14:00:00.000Z', '2026-10-27T14:20:00.000Z'),
    ...[1, 2, 3, 4, 5].map(index => crowd(810 + index, `Day trip ${index}`, '2026-10-26', '2026-10-27', { all_day: true, start_date: '2026-10-26', end_date: '2026-10-27' })),
  ]

  const box = async (locator: Locator) => (await locator.boundingBox())!

  /**
   * Nothing is cut off: the title, the strip and every block and chip lie inside
   * the stage's margins and the tile they belong to, and the tiles end above the
   * stage's bottom margin. A title may be clamped (it ends in an ellipsis), but
   * the block holds it.
   */
  async function expectWeekInside(page: Page) {
    const tiles = await page.getByTestId('day-tile').evaluateAll(elements => elements.map((element) => {
      const { left, right, top, bottom } = element.getBoundingClientRect()
      return { left, right, top, bottom }
    }))
    expect(tiles).toHaveLength(7)
    expect(Math.min(...tiles.map(tile => tile.top))).toBeGreaterThan(0)
    expect(Math.max(...tiles.map(tile => tile.bottom))).toBeLessThanOrEqual(2560 - 48 + 0.5)
    expect(Math.max(...tiles.map(tile => tile.right))).toBeLessThanOrEqual(1440 - 40 + 0.5)
    const title = await box(page.getByTestId('week-title'))
    expect(title.x).toBeGreaterThanOrEqual(40)
    expect(title.x + title.width).toBeLessThanOrEqual(1440 - 40)
    expect(title.y + title.height).toBeLessThanOrEqual(Math.min(...tiles.map(tile => tile.top)))
    const greeting = page.getByTestId('greeting')
    if (await greeting.count()) {
      const line = await box(greeting)
      expect(line.x + line.width).toBeLessThanOrEqual(1440 - 40)
      expect(line.y).toBeGreaterThanOrEqual(title.y + title.height)
      expect(line.y + line.height).toBeLessThanOrEqual(Math.min(...tiles.map(tile => tile.top)))
    }

    const items = await page.locator('[data-testid="event"], [data-testid="more"], [data-testid="overflow"], [data-testid="band-item"]').evaluateAll(elements => elements.map((element) => {
      const { left, right, top, bottom } = element.getBoundingClientRect()
      return { kind: element.getAttribute('data-testid') === 'event' ? element.getAttribute('data-kind')! : element.getAttribute('data-testid')!, left, right, top, bottom, text: element.textContent!.replace(/\s+/g, ' ').trim() }
    }))
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      const middle = (item.left + item.right) / 2
      const tile = tiles.find(candidate => middle >= candidate.left && middle <= candidate.right)
      expect(tile, item.text).toBeDefined()
      expect(item.top, item.text).toBeGreaterThanOrEqual(tile!.top - 0.5)
      expect(item.bottom, item.text).toBeLessThanOrEqual(tile!.bottom + 0.5)
      // A bar may run on into the next tile; everything else stays in its own.
      if (item.kind !== 'bar') {
        expect(item.left, item.text).toBeGreaterThanOrEqual(tile!.left - 0.5)
        expect(item.right, item.text).toBeLessThanOrEqual(tile!.right + 0.5)
      }
    }
    // The labels that must be whole are not clipped.
    const clipped = await page.locator('[data-testid="more"], [data-testid="overflow"]').evaluateAll(elements => elements.filter(element => element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight).map(element => element.textContent))
    expect(clipped).toEqual([])
  }

  test('26 October to 1 November, light theme, as the mock', async ({ page }) => {
    await playServer(page, { view: 'week' }, events, weather)
    await page.goto('/display?id=hallway')
    await settle(page)

    await expect(page.getByTestId('stage')).toHaveAttribute('data-orientation', 'portrait')
    await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'light')
    await expect(page.getByTestId('week-title')).toHaveText('26 October – 1 November 2026')
    await expect(page.getByTestId('now-time')).toHaveText('09:41')
    // The hour gutter is 64 px and the stage has 40 px at its sides, so the first tile starts at 40 + 64 + 10.
    const first = await box(page.getByTestId('day-tile').first())
    const last = await box(page.getByTestId('day-tile').last())
    expect(first.x).toBeCloseTo(114, 0)
    expect(last.x + last.width).toBeCloseTo(1400, 0)
    expect(last.y + last.height).toBeCloseTo(2560 - 48, 0)
    // The playdate and the ballet share Wednesday's column, two tracks wide.
    await expect(page.locator('[data-kind="block"][data-tracks="2"]')).not.toHaveCount(0)
    await expectWeekInside(page)
    await expect(page).toHaveScreenshot('portrait-week-light.png')
  })

  test('26 October to 1 November, dark theme', async ({ page }) => {
    await playServer(page, { view: 'week' }, events, weather)
    await page.goto('/display?id=kitchen')
    await settle(page)

    await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'dark')
    await expectWeekInside(page)
    await expect(page).toHaveScreenshot('portrait-week-dark.png')
  })

  test('a crowded week draws two blocks at most side by side, counts the rest in chips, and ends a full strip in "+N more"', async ({ page }) => {
    await playServer(page, { view: 'week' }, crowded, weather)
    await page.goto('/display?id=hallway')
    await settle(page)

    const tuesday = page.locator('[data-testid="overflow"]')
    // Tuesday: two of the four 10:00 to 12:00 events are hidden (Choir at 10:30 and Drama at 10:30: one chip, +2), and the three short ones at 14:00 leave one chip, +1.
    await expect(tuesday).toHaveText(['+2', '+1'])
    expect(await page.locator('[data-kind="block"]').evaluateAll(blocks => Math.max(...blocks.map(block => Number(block.getAttribute('data-tracks')))))).toBe(2)
    // Half term and five day trips on Monday: three lanes, the last of them "+N more".
    await expect(page.locator('[data-kind="bar"]').filter({ hasText: 'Day trip' })).toHaveCount(1)
    await expect(page.getByTestId('more').first()).toHaveText('+4 more')
    // It sits in the third lane, 34 px tall.
    const strip = await box(page.getByTestId('more').first())
    expect(strip.height).toBe(34)
    await expectWeekInside(page)
    await expect(page).toHaveScreenshot('portrait-week-crowded.png')
  })

  test('a long block has its time and a title that wraps; a short one is a single line with no time', async ({ page }) => {
    await playServer(page, { view: 'week' }, crowded, weather)
    await page.goto('/display?id=hallway')
    await settle(page)

    const long = page.locator('[data-kind="block"]').filter({ hasText: 'Hair appointment' }).first()
    await expect(long.locator('.time')).toBeVisible()
    const short = page.locator('[data-kind="block"].one-line').first()
    await expect(short.locator('.time')).toBeHidden()
    expect((await box(short)).height).toBeLessThan(50 / 60 * 90)
  })

  test('a takeover\'s greeting has a line under the title, in the night palette, with the tiles tinted', async ({ page }) => {
    const HALLOWEEN = new Date('2026-10-31T09:41:00Z')
    await playServer(page, { view: 'week' }, crowded, weather, { now: HALLOWEEN, specialDays: specialDaysOn('2026-10-31') })
    await page.goto('/display?id=hallway')
    await settle(page)

    await expect(page.getByTestId('stage')).toHaveAttribute('data-palette', 'night')
    await expect(page.getByTestId('takeover-full')).toHaveCount(0)
    await expect(page.getByTestId('greeting')).toHaveText('Happy Halloween!')
    const title = await box(page.getByTestId('week-title'))
    const greeting = await box(page.getByTestId('greeting'))
    expect(greeting.y).toBeGreaterThanOrEqual(title.y + title.height)
    await expect(page.locator('[data-testid="day-tile"][data-special="halloween"]')).toHaveAttribute('data-date', '2026-10-31')
    await expectWeekInside(page)
    await expect(page).toHaveScreenshot('portrait-week-takeover.png')
  })
})

// The week by part of day (PR 5.16): the same structure as in landscape, with
// rows of about 340 px instead of 190, so a cell holds eight lines and not
// four. The crowded week puts nine events in Tuesday's morning, which ends in
// "+N more" at eight lines, and three all-day ones in Monday's head.
test.describe('the week by part of day', () => {
  const HALLOWEEN = new Date('2026-10-31T09:41:00Z')
  const crowd = (id: number, title: string, start: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
    ...swimming, id, title, display_title: title, start, end: start, ...extra,
  })
  const crowded: CalendarEvent[] = [
    ...events,
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(index => crowd(900 + index, `Lesson ${index}`, `2026-10-27T0${index}:00:00.000Z`, { end: `2026-10-27T0${index}:30:00.000Z` })),
    ...[1, 2, 3].map(index => crowd(920 + index, `Day trip ${index}`, '2026-10-26', { end: '2026-10-27', all_day: true, start_date: '2026-10-26', end_date: '2026-10-27' })),
  ]

  const box = async (locator: Locator) => (await locator.boundingBox())!

  /** Nothing is cut off: the rows fill the stage's margins, and every line and label lies inside its row and is whole. */
  async function expectPartsInside(page: Page) {
    const rows = await page.getByTestId('day-row').evaluateAll(elements => elements.map((element) => {
      const { left, right, top, bottom } = element.getBoundingClientRect()
      return { left, right, top, bottom }
    }))
    expect(rows).toHaveLength(7)
    expect(Math.max(...rows.map(row => row.bottom))).toBeLessThanOrEqual(2560 - 48 + 0.5)
    expect(Math.max(...rows.map(row => row.right))).toBeLessThanOrEqual(1440 - 40 + 0.5)
    const title = await box(page.getByTestId('week-title'))
    expect(title.x).toBeGreaterThanOrEqual(40)
    expect(title.y + title.height).toBeLessThanOrEqual(Math.min(...rows.map(row => row.top)))
    const greeting = page.getByTestId('greeting')
    if (await greeting.count()) {
      const line = await box(greeting)
      expect(line.x + line.width).toBeLessThanOrEqual(1440 - 40)
      expect(line.y).toBeGreaterThanOrEqual(title.y + title.height)
      expect(line.y + line.height).toBeLessThanOrEqual(Math.min(...rows.map(row => row.top)))
    }
    for (const row of rows) expect(row.bottom - row.top).toBeGreaterThan(300)

    // Every cell shows all its lines: none is pushed out of the bottom of its row.
    const cut = await page.getByTestId('part-cell').evaluateAll(elements => elements.filter(element => element.scrollHeight > element.clientHeight + 1).map(element => element.textContent))
    expect(cut).toEqual([])
    const items = await page.locator('[data-testid="event"], [data-testid="more"], [data-testid="head-more"]').evaluateAll(elements => elements.map((element) => {
      const { left, right, top, bottom } = element.getBoundingClientRect()
      return { left, right, top, bottom, text: element.textContent!.replace(/\s+/g, ' ').trim() }
    }))
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      const middle = (item.top + item.bottom) / 2
      const row = rows.find(candidate => middle >= candidate.top && middle <= candidate.bottom)
      expect(row, item.text).toBeDefined()
      expect(item.bottom, item.text).toBeLessThanOrEqual(row!.bottom + 0.5)
      expect(item.right, item.text).toBeLessThanOrEqual(row!.right + 0.5)
    }
  }

  test('26 October to 1 November, light theme', async ({ page }) => {
    await playServer(page, { view: 'week_parts' }, events, weather)
    await page.goto('/display?id=hallway')
    await settle(page)

    await expect(page.getByTestId('stage')).toHaveAttribute('data-orientation', 'portrait')
    await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'light')
    await expect(page.getByTestId('week-title')).toHaveText('26 October – 1 November 2026')
    await expect(page.getByTestId('now-part')).toHaveCount(1)
    const last = await box(page.getByTestId('day-row').last())
    expect(last.x + last.width).toBeCloseTo(1400, 0)
    expect(last.y + last.height).toBeCloseTo(2560 - 48, 0)
    await expectPartsInside(page)
    await expect(page).toHaveScreenshot('portrait-week-parts-light.png')
  })

  test('26 October to 1 November, dark theme', async ({ page }) => {
    await playServer(page, { view: 'week_parts' }, events, weather)
    await page.goto('/display?id=kitchen')
    await settle(page)

    await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'dark')
    await expectPartsInside(page)
    await expect(page).toHaveScreenshot('portrait-week-parts-dark.png')
  })

  test('a crowded week fills a cell with eight lines, and ends it in "+N more"', async ({ page }) => {
    await playServer(page, { view: 'week_parts' }, crowded, weather)
    await page.goto('/display?id=hallway')
    await settle(page)

    const tuesday = page.locator('[data-testid="day-row"][data-date="2026-10-27"] [data-part="morning"]')
    await expect(tuesday.getByTestId('event')).toHaveCount(7)
    await expect(tuesday.getByTestId('more')).toContainText('+2 more')
    await expect(page.locator('[data-testid="day-row"][data-date="2026-10-26"]').getByTestId('head-more')).toContainText('+2')
    await expectPartsInside(page)
    await expect(page).toHaveScreenshot('portrait-week-parts-crowded.png')
  })

  test('Halloween puts its greeting under the title, in the night palette', async ({ page }) => {
    await playServer(page, { view: 'week_parts' }, events, weather, { now: HALLOWEEN, specialDays: specialDaysOn('2026-10-31') })
    await page.goto('/display?id=hallway')
    await settleWithArt(page)

    await expect(page.getByTestId('stage')).toHaveAttribute('data-palette', 'night')
    await expect(page.getByTestId('greeting')).toHaveText('Happy Halloween!')
    await expectPartsInside(page)
    await expect(page).toHaveScreenshot('portrait-week-parts-takeover.png')
  })
})

// The photo frame (PR 5.11). The server's portrait renders are tested with the
// real photos elsewhere; here the answer is made up, to check what the page
// asks for and that the pill fits the narrow stage in every corner.
test.describe('the photo frame', () => {
  /** Answers /api/photos/next with a picture of the stage's own shape, and records the orientation asked for. */
  async function answerPhotos(page: Page) {
    const asked: (string | null)[] = []
    await page.route('**/api/photos/next**', async (route) => {
      asked.push(new URL(route.request().url()).searchParams.get('orientation'))
      await route.fulfill({ json: { photo: { id: 'local:made-up.jpg', url: '/made-up-photo.svg', width: 1440, height: 2560, orientation: 'portrait', taken_at: null, provider: 'local' } } })
    })
    await page.route('**/made-up-photo.svg', route => route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="2560"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9b872"/><stop offset="1" stop-color="#3d5a80"/></linearGradient></defs><rect width="1440" height="2560" fill="url(#g)"/></svg>',
    }))
    return asked
  }

  async function photoShown(page: Page) {
    await fontsReady(page)
    const top = page.locator('[data-testid^="photo-layer-"].top')
    await expect(top).toHaveCount(1)
    await expect.poll(() => top.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true)
    await expect.poll(() => top.evaluate(image => getComputedStyle(image).opacity)).toBe('1')
  }

  test('asks for a portrait photo, and the layers fill the stage', async ({ page }) => {
    const asked = await answerPhotos(page)
    await playServer(page, { view: 'photo' }, busy, weather)
    await page.goto('/display?id=hallway')
    await photoShown(page)

    await expect(page.getByTestId('stage')).toHaveAttribute('data-orientation', 'portrait')
    expect(asked).toEqual(['portrait'])
    const layer = (await page.locator('[data-testid^="photo-layer-"].top').boundingBox())!
    expect(layer).toEqual({ x: 0, y: 0, width: 1440, height: 2560 })
  })

  test('asks for a landscape photo when the display is turned to landscape in a portrait window', async ({ page }) => {
    const asked = await answerPhotos(page)
    await playServer(page, { view: 'photo' }, busy, weather)
    await page.goto('/display?id=hallway&orientation=landscape')
    await photoShown(page)

    expect(asked).toEqual(['landscape'])
  })

  test('the pill fits inside the stage at every corner, even with a long title', async ({ context }) => {
    const long = [{ ...swimming, start: '2026-10-28T15:30:00.000Z', end: '2026-10-28T16:30:00.000Z', display_title: 'Theo\'s swimming gala and the long drive to the other side of the county' }]
    const corners = new Set<string>()
    // The porch walks its pill round the corners a quarter of an hour at a time.
    for (const minute of ['09:05', '09:20', '09:35', '09:50']) {
      const next = await context.newPage()
      await answerPhotos(next)
      await playServer(next, { view: 'photo' }, long, weather, { now: new Date(`2026-10-28T${minute}:00Z`) })
      await next.goto('/display?id=porch')
      await photoShown(next)

      const pill = (await next.getByTestId('photo-pill').boundingBox())!
      corners.add((await next.getByTestId('photo-pill').getAttribute('data-corner'))!)
      // The porch's burn-in shift moves everything up to 8 px.
      expect(pill.x, minute).toBeGreaterThanOrEqual(64 - 8)
      expect(pill.x + pill.width, minute).toBeLessThanOrEqual(1440 - 64 + 8)
      expect(pill.y, minute).toBeGreaterThanOrEqual(64 - 8)
      expect(pill.y + pill.height, minute).toBeLessThanOrEqual(2560 - 64 + 8)
      await next.close()
    }
    expect([...corners].sort()).toEqual(['bottom-left', 'bottom-right', 'top-left', 'top-right'])
  })

  /** The server's portrait render of `id`, asked for on the display no spec shows, so the playlist of the one under test is not touched. */
  async function portraitPhotoNamed(request: APIRequestContext, id: string): Promise<PhotoInfo> {
    const seen: string[] = []
    // The pool is listed in the background at start-up, so the first answers may be empty.
    for (let attempt = 0; attempt < 40; attempt++) {
      const response = await request.get('/api/photos/next?display=kitchen&orientation=portrait')
      const { photo } = photoResponseSchema.parse(await response.json())
      if (photo?.id === id) return photo
      if (photo) seen.push(photo.id)
      else await new Promise(resolve => setTimeout(resolve, 250))
    }
    throw new Error(`The server never offered ${id}, only ${seen.join(', ')}`)
  }

  /** Makes the page's requests for a photo get `photo`. Returns the `orientation` each asked for. */
  async function serve(page: Page, photo: PhotoInfo) {
    const asked: (string | null)[] = []
    await page.route('**/api/photos/next**', async (route) => {
      asked.push(new URL(route.request().url()).searchParams.get('orientation'))
      await route.fulfill({ json: { photo } })
    })
    return asked
  }

  test('a portrait photo fills the stage (mock 4g)', async ({ page, request }) => {
    const photo = await portraitPhotoNamed(request, 'local:tall-portrait.jpg')
    const asked = await serve(page, photo)
    await playServer(page, { view: 'photo' }, busy, weather)
    await page.goto('/display?id=hallway')
    await photoShown(page)

    expect(asked).toEqual(['portrait'])
    const size = await page.locator('[data-testid^="photo-layer-"].top').evaluate(image => [(image as HTMLImageElement).naturalWidth, (image as HTMLImageElement).naturalHeight])
    expect(size).toEqual([1440, 2560])
    await expect(page.getByTestId('photo-clock')).toHaveText('09:41')
    await expect(page).toHaveScreenshot('portrait-photo-portrait.png')
  })

  test('a landscape photo is fitted over its blurred copy (mock 4h), with the pill in a corner', async ({ page, request }) => {
    const photo = await portraitPhotoNamed(request, 'local:sunset-landscape.jpg')
    const asked = await serve(page, photo)
    await playServer(page, { view: 'photo' }, busy, weather)
    await page.goto('/display?id=porch')
    await photoShown(page)

    expect(asked).toEqual(['portrait'])
    await expect(page.getByTestId('photo-pill')).toHaveAttribute('data-corner', 'bottom-right')
    await expect(page).toHaveScreenshot('portrait-photo-landscape.png')
  })
})

// The week and photo (PR 5.14, mocks 4k and 4l): the photo across the top, 1000
// px tall and so wider than it is tall, which asks for the landscape render, and
// the week in the 1560 px below it.
test.describe('the week and photo', () => {
  const box = async (locator: Locator) => (await locator.boundingBox())!

  /** The server's landscape render of `id`, asked for on a display no spec shows, so the playlist of the one under test is not touched. */
  async function landscapePhotoNamed(request: APIRequestContext, id: string): Promise<PhotoInfo> {
    const seen: string[] = []
    for (let attempt = 0; attempt < 40; attempt++) {
      const response = await request.get('/api/photos/next?display=kitchen&orientation=landscape')
      const { photo } = photoResponseSchema.parse(await response.json())
      if (photo?.id === id) return photo
      if (photo) seen.push(photo.id)
      else await new Promise(resolve => setTimeout(resolve, 250))
    }
    throw new Error(`The server never offered ${id}, only ${seen.join(', ')}`)
  }

  async function shown(page: Page, photo: PhotoInfo) {
    const asked: (string | null)[] = []
    await page.route('**/api/photos/next**', async (route) => {
      asked.push(new URL(route.request().url()).searchParams.get('orientation'))
      await route.fulfill({ json: { photo } })
    })
    await playServer(page, { view: 'week_photo' }, events, weather)
    return asked
  }

  async function ready(page: Page) {
    await settle(page)
    const top = page.locator('[data-testid^="photo-layer-"].top')
    await expect(top).toHaveCount(1)
    await expect.poll(() => top.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true)
    await expect.poll(() => top.evaluate(image => getComputedStyle(image).opacity)).toBe('1')
  }

  test('the photo over the week, light theme (mock 4k)', async ({ page, request }) => {
    const asked = await shown(page, await landscapePhotoNamed(request, 'local:sunset-landscape.jpg'))
    await page.goto('/display?id=hallway')
    await ready(page)

    expect(asked).toEqual(['landscape'])
    await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'light')
    expect(await box(page.getByTestId('week-photo-photo-pane'))).toMatchObject({ x: 0, y: 0, width: 1440, height: 1000 })
    expect(await box(page.getByTestId('week-photo-week-pane'))).toMatchObject({ x: 0, y: 1000, width: 1440, height: 1560 })
    await expect(page.getByTestId('photo-next-event')).toHaveCount(0)
    await expect(page.getByTestId('week-title')).toHaveText('26 Oct – 1 Nov This week')
    await expect(page).toHaveScreenshot('portrait-week-photo-light.png')
  })

  test('the photo over the week, dark theme (mock 4l)', async ({ page, request }) => {
    const asked = await shown(page, await landscapePhotoNamed(request, 'local:sunset-landscape.jpg'))
    await page.goto('/display?id=kitchen')
    await ready(page)

    expect(asked).toEqual(['landscape'])
    await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'dark')
    await expect(page).toHaveScreenshot('portrait-week-photo-dark.png')
  })
})
