import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { photoResponseSchema } from '../../shared/photos'
import type { PhotoInfo } from '../../shared/photos'
import { burnInOffset } from '../../app/utils/burnIn'
import { nightPosition } from '../../app/utils/night'
import type { CalendarEvent } from '../../shared/types/events'
import { fontsReady, playServer, settle } from './helpers'
import { specialDaysOn } from './fixtures/special-days'
import busy from './fixtures/agenda-busy.json' with { type: 'json' }
import { fixtureEvents } from '../helpers/fixtureEvents'
import weather from './fixtures/weather.json' with { type: 'json' }

// The portrait stage (PR 5.10, architecture §4.2): a 1440×2560 window, as a
// panel hung on its side shows it. The night view, the agenda and the photo
// frame have portrait layouts so far; the month and week are the landscape
// stage letterboxed in the window, as the month is here. The window is the shape of the panel, so `auto` finds
// portrait by itself, and `?orientation=` is checked as well. The landscape
// pictures are in the other specs, which must not change.

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

test('the month is the landscape stage letterboxed in a portrait window', async ({ page }) => {
  await playServer(page, { view: 'month' })
  await page.goto('/display?id=hallway')
  await settle(page)

  await expect(page.getByTestId('stage')).toHaveAttribute('data-orientation', 'landscape')
  const stage = await stageBox(page)
  expect(stage.width).toBeCloseTo(1440, 0)
  expect(stage.height).toBeCloseTo(810, 0)
  // Centred, with black above and below.
  expect(stage.y).toBeCloseTo((2560 - 810) / 2, 0)
  await expect(page).toHaveScreenshot('portrait-month-letterboxed.png')
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

  test('a special day\'s greeting sits above today\'s list, in the night palette, with no art behind it', async ({ page }) => {
    const HALLOWEEN = new Date('2026-10-31T09:41:00Z')
    await playServer(page, { view: 'agenda' }, quiet('2026-10-31'), null, { now: HALLOWEEN, specialDays: specialDaysOn('2026-10-31') })
    await page.goto('/display?id=hallway')
    await settle(page)

    await expect(page.getByTestId('stage')).toHaveAttribute('data-palette', 'night')
    // The art is 2560×1440, so the portrait stage does not draw it.
    await expect(page.getByTestId('takeover-full')).toHaveCount(0)
    await expect(page.getByTestId('day-today').getByTestId('greeting')).toHaveText('Happy Halloween!')
    await expect(page.getByTestId('day-tomorrow').getByTestId('greeting')).toHaveCount(0)
    // Tomorrow has nothing planned in this fixture.
    await expect(page.getByTestId('day-tomorrow').getByTestId('empty-day')).toBeVisible()
    await expectRowsInside(page, ['day-today'])
    await expect(page).toHaveScreenshot('portrait-agenda-takeover.png')
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

  test('asks for a landscape photo in the month\'s letterbox, where the photo frame has none', async ({ page }) => {
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
