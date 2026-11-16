import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { displayStateSchema } from '../../shared/display'
import type { DisplayState } from '../../shared/display'
import type { PhotoHistoryEntry } from '../../shared/photoHistory'
import type { StarChart } from '../../shared/stars'
import { fontsReady, playServer } from './helpers'

// The phone remote (architecture §7.5) at a phone's size, in both of the
// phone's colour schemes. The server's /api/displays is the real one; the
// socket, the PIN question and the commands are played by the test. The Soft
// month view's look is in month.spec.ts, and the shell's in display.spec.ts.

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })

// The photo history the server would answer (architecture §7.5), on the frozen
// Wednesday 28 October, 09:41 in London: the photo on the wall now, an Immich
// photo with everything Immich knows, an Unsplash one with its photographer, a
// folder photo with little but its path, and a few older ones for "Show more".
// The pictures are the little drawings /api/visual-history/*.svg, answered below.
const at = (time: string, day = '2026-10-28') => `${day}T${time}:00Z`
const entry = (id: number, changes: Partial<PhotoHistoryEntry>, details: PhotoHistoryEntry['details'] = {}): PhotoHistoryEntry => ({
  id,
  photo_id: `immich:asset-${id}`,
  feed: 'immich',
  feed_name: null,
  provider: 'immich',
  rendition: 'landscape',
  shown_at: at('09:30'),
  ended_at: at('09:35'),
  image_url: `/api/visual-history/${id % 3}.svg`,
  width: 4000,
  height: 3000,
  orientation: 'landscape',
  taken_at: null,
  credit: null,
  ...changes,
  details,
})
const historyEntries: PhotoHistoryEntry[] = [
  entry(9, { shown_at: at('09:39'), ended_at: null, feed_name: 'Family album', taken_at: at('15:41', '2025-06-14') }, {
    description: 'Evening light on Derwentwater',
    location: 'Keswick, Cumbria, United Kingdom',
    camera: 'FUJIFILM X-T5 \u00B7 XF16-55mm',
    file_name: 'DSCF0412.jpg',
    people: ['Isla', 'Theo'],
    source_url: 'https://immich.example/photos/asset-9',
  }),
  entry(8, { provider: 'unsplash', feed: 'pool-1', feed_name: 'Mountains', shown_at: at('09:34'), ended_at: at('09:39'), credit: 'Photo by Jane Doe on Unsplash' }, {
    description: 'A lone hiker on a ridge above the clouds',
    location: 'Dolomites, Italy',
    photographer: 'Jane Doe',
    photographer_url: 'https://unsplash.com/@jane?utm_source=wall_display',
    source_url: 'https://unsplash.com/photos/abc?utm_source=wall_display',
  }),
  entry(7, { provider: 'local', feed: 'local', image_url: null, shown_at: at('09:29'), ended_at: at('09:34'), taken_at: at('11:02', '2024-12-25') }, { file_name: 'christmas/IMG_9041.jpg' }),
  entry(6, { shown_at: at('09:24'), ended_at: at('09:29') }, { location: 'Edinburgh, Scotland' }),
  entry(5, { shown_at: at('09:19'), ended_at: at('09:24') }, { description: 'Isla\'s birthday' }),
  entry(4, { shown_at: at('23:55', '2026-10-27'), ended_at: at('00:01') }, { description: 'Bonfire night rehearsal' }),
  entry(3, { shown_at: at('22:10', '2026-10-27'), ended_at: at('22:15', '2026-10-27') }, { description: 'The garden in autumn' }),
]

const DRAWINGS = ['#c98f5b', '#6f9a8d', '#8a7bb5'].map((colour, index) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${colour}"/><circle cx="${20 + index * 12}" cy="24" r="9" fill="#fff" opacity=".6"/><path d="M0 64 L24 36 L40 52 L50 42 L64 58 V64Z" fill="#000" opacity=".25"/></svg>`)

/** Answers `GET /api/displays/hallway/photo-history` with fixed entries, and their pictures. */
async function photoHistory(page: Page, entries: PhotoHistoryEntry[]) {
  await page.route('**/api/displays/hallway/photo-history**', route => route.fulfill({ json: { entries } }))
  await page.route('**/api/visual-history/*.svg', route => route.fulfill({ body: DRAWINGS[Number(/(\d)\.svg$/.exec(route.request().url())![1])]!, contentType: 'image/svg+xml' }))
}

/** Answers `GET /api/remote`: whether the server wants a PIN. */
async function pinRequired(page: Page, required: boolean) {
  await page.route('**/api/remote', route => route.fulfill({ json: { pin_required: required } }))
}

/** Opens the remote for the hallway once the name and the fonts are in. */
async function openRemote(page: Page, initial: Partial<DisplayState> = {}, required = false, stars?: StarChart, history: PhotoHistoryEntry[] = []) {
  const server = await playServer(page, initial, undefined, null, { stars })
  await pinRequired(page, required)
  await photoHistory(page, history)
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

// The Stars section (architecture §7.5), on the frozen Wednesday 28 October: Isla
// counts the week against a goal, Theo counts days, Poppy has no goal.
const starChart: StarChart = {
  people: [
    { id: 'isla', name: 'Isla', initial: 'I', colour: '#D27FA0', period: 'week', goal: 6 },
    { id: 'theo', name: 'Theo', initial: 'T', colour: '#5F94C4', period: 'day', goal: 3 },
    { id: 'poppy', name: 'Poppy', initial: 'P', colour: '#9A7BC4', period: 'week', goal: null },
  ],
  counts: {
    isla: { '2026-10-26': 2, '2026-10-27': 3, '2026-10-28': 2 },
    theo: { '2026-10-28': 2 },
  },
}

test('has a Stars section for the people with a chart', async ({ page }) => {
  await openRemote(page, { view: 'agenda', brightness: 80 }, false, starChart)

  await expect(page.getByTestId('star-row-isla')).toBeVisible()
  await expect(page.getByTestId('star-summary-isla')).toHaveText('7 of 6 this week')
  await expect(page.getByTestId('star-minus-poppy')).toBeDisabled()
  await expect(page).toHaveScreenshot('stars.png', { fullPage: true })
})

test.describe('dark stars', () => {
  test.use({ colorScheme: 'dark' })

  test('has a Stars section for the people with a chart', async ({ page }) => {
    await openRemote(page, { view: 'agenda', brightness: 80 }, false, starChart)

    await expect(page.getByTestId('star-row-theo')).toBeVisible()
    await expect(page).toHaveScreenshot('stars-dark.png', { fullPage: true })
  })
})

// The Photo history section (architecture §7.5): it follows "Photos from", so it
// shows here, where the visual config has a photo folder.
test.describe('photo history', () => {
  test('lists the photos, opens the details of one, and shows more', async ({ page }) => {
    await openRemote(page, { view: 'photo', photo_source: 'local', brightness: 80 }, false, undefined, historyEntries)
    const section = page.getByTestId('photo-history')

    await expect(section.getByTestId('photo-history-entry')).toHaveCount(5)
    await expect(section.getByTestId('photo-history-live')).toHaveText('On the wall')
    await section.getByTestId('photo-history-entry').first().getByRole('button').click()
    await expect(section.getByTestId('photo-history-details')).toContainText('Keswick, Cumbria, United Kingdom')
    await expect(section.getByTestId('photo-history-details')).toContainText('Saturday 14 June 2025, 16:41')
    await expect(section.getByTestId('photo-history-details')).toContainText('09:39 \u2013 now (2 min)')
    await expect(section).toHaveScreenshot('photo-history.png')

    await section.getByTestId('photo-history-more').click()
    await expect(section.getByTestId('photo-history-entry')).toHaveCount(7)
    await expect(section.getByTestId('photo-history-more')).toHaveCount(0)
    await expect(section.getByTestId('photo-history-entry').nth(5)).toContainText('Yesterday 23:55 \u2013 Today 00:01')
  })

  test('says what it is for when nothing has been shown', async ({ page }) => {
    await openRemote(page, { view: 'photo', photo_source: 'local' })

    await expect(page.getByTestId('photo-history')).toHaveScreenshot('photo-history-empty.png')
  })

  test.describe('dark', () => {
    test.use({ colorScheme: 'dark' })

    test('lists the photos and opens the details of one', async ({ page }) => {
      await openRemote(page, { view: 'photo', photo_source: 'local', brightness: 80 }, false, undefined, historyEntries)
      const section = page.getByTestId('photo-history')

      await section.getByTestId('photo-history-entry').nth(1).getByRole('button').click()
      await expect(section.getByTestId('photo-history-details')).toContainText('Jane Doe')
      await expect(section).toHaveScreenshot('photo-history-dark.png')
    })
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

// The visual config has a local photo folder and no Immich, so the server says
// only the folder is set up (`photo_sources: ['local']`): Immich and Google are
// shown, but disabled with a hint.
test.describe('the photo frame', () => {
  test('looks right with the photo frame on and the folder as its source', async ({ page }) => {
    await openRemote(page, { view: 'photo', photo_source: 'local', brightness: 80 })

    await expect(page.getByTestId('tile-photo')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('photo-source-local')).toHaveAttribute('aria-pressed', 'true')
    await expect(page).toHaveScreenshot('photo-frame.png', { fullPage: true })
  })

  test('looks right with another view on: the tile is plain and Next photo is off', async ({ page }) => {
    await openRemote(page, { view: 'month', brightness: 80 })

    await expect(page.getByTestId('tile-photo')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('photo-next')).toBeDisabled()
    await expect(page).toHaveScreenshot('photo-frame-off.png', { fullPage: true })
  })

  test.describe('dark', () => {
    test.use({ colorScheme: 'dark' })

    test('looks right', async ({ page }) => {
      await openRemote(page, { view: 'photo', photo_source: 'local', brightness: 80 })

      await expect(page.getByTestId('tile-photo')).toHaveAttribute('aria-pressed', 'true')
      await expect(page).toHaveScreenshot('photo-frame-dark.png', { fullPage: true })
    })
  })

  test('falls back to the source the server uses: the default Immich is not set up, so the folder is shown', async ({ page }) => {
    await openRemote(page, { view: 'photo' })

    await expect(page.getByTestId('photo-source-local')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('photo-source-immich')).toBeDisabled()
    await expect(page.getByTestId('photo-source-google')).toBeDisabled()
    await expect(page.getByTestId('photo-source-immich')).toContainText('Not set up')
  })

  test('the tile sends set_view photo, and Next photo sends photo_next and says Skipped for a moment', async ({ page }) => {
    await openRemote(page, { view: 'month' })
    const commands = await recordCommands(page)

    await page.getByTestId('tile-photo').click()
    await expect.poll(() => commands).toEqual([{ type: 'set_view', view: 'photo' }])
    await expect(page.getByTestId('tile-photo')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('photo-next')).toBeEnabled()

    await page.getByTestId('photo-next').click()
    await expect.poll(() => commands).toEqual([{ type: 'set_view', view: 'photo' }, { type: 'photo_next' }])
    await expect(page.getByTestId('photo-next')).toHaveText('Skipped')
    await expect(page.getByTestId('photo-next')).toHaveText('Next photo')
  })

  test('sends nothing for a source that is not set up', async ({ page }) => {
    await openRemote(page, { view: 'photo' })
    const commands = await recordCommands(page)

    await page.getByTestId('photo-source-google').click({ force: true })
    await page.getByTestId('photo-source-local').click()

    await expect.poll(() => commands).toEqual([{ type: 'set_photo_source', photo_source: 'local' }])
  })

  test('has tap targets of at least 44 pixels', async ({ page }) => {
    await openRemote(page, { view: 'photo' })

    for (const testid of ['tile-photo', 'photo-source-immich', 'photo-source-google', 'photo-source-local', 'photo-next']) {
      const box = (await page.getByTestId(testid).boundingBox())!
      expect(box.height, testid).toBeGreaterThanOrEqual(44)
      expect(box.width, testid).toBeGreaterThanOrEqual(44)
    }
  })
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

test('links to the settings page with a tap-sized button', async ({ page }) => {
  await openRemote(page)

  const link = page.getByTestId('settings-link')
  await expect(link).toHaveAttribute('href', '/settings')
  await expect(link).toHaveAccessibleName('Settings')
  const box = (await link.boundingBox())!
  expect(box.height).toBeGreaterThanOrEqual(44)
  expect(box.width).toBeGreaterThanOrEqual(44)

  await link.click()
  await expect(page).toHaveURL(/\/settings\/calendars$/)
  await expect(page.getByTestId('settings')).toBeVisible()
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
// The cameras: the visual config has none, so the server's display list is
// answered with two added, as a config with a doorbell and a garden camera would.
test.describe('the cameras', () => {
  const FRONT_DOOR: DisplayState['camera'] = { id: 'front-door', name: 'Front door', url: 'http://go2rtc.local:1984/stream.html?src=front_door', kind: 'page', until: '2026-10-28T10:00:00.000Z', restore_screen: false }

  async function withCameras(page: Page) {
    await page.route('**/api/displays', async (route) => {
      const displays = await (await route.fetch()).json() as object[]
      await route.fulfill({ json: displays.map(display => ({ ...display, cameras: [{ id: 'front-door', name: 'Front door' }, { id: 'garden', name: 'Garden' }] })) })
    })
  }

  test('looks right with one camera on the wall and one to show', async ({ page }) => {
    await withCameras(page)
    await openRemote(page, { view: 'agenda', camera: FRONT_DOOR })

    await expect(page.getByTestId('camera-front-door').getByTestId('camera-live')).toHaveText('On the wall now')
    await expect(page.getByTestId('cameras')).toHaveScreenshot('cameras-light.png')
  })

  test.describe('dark', () => {
    test.use({ colorScheme: 'dark' })

    test('looks right with one camera on the wall and one to show', async ({ page }) => {
      await withCameras(page)
      await openRemote(page, { view: 'agenda', camera: FRONT_DOOR })

      await expect(page.getByTestId('camera-front-door').getByTestId('camera-live')).toBeVisible()
      await expect(page.getByTestId('cameras')).toHaveScreenshot('cameras-dark.png')
    })
  })

  test('Show puts a camera on the wall, and Hide takes it down', async ({ page }) => {
    await withCameras(page)
    await openRemote(page, { view: 'agenda' })
    const commands = await recordCommands(page)

    await page.getByRole('button', { name: 'Show Garden' }).click()
    await expect.poll(() => commands).toEqual([{ type: 'set_camera', camera: 'garden' }])
    await expect(page.getByTestId('camera-garden').getByTestId('camera-hide')).toBeVisible()

    await page.getByRole('button', { name: 'Hide Garden' }).click()
    await expect.poll(() => commands).toEqual([{ type: 'set_camera', camera: 'garden' }, { type: 'set_camera', camera: null }])
    await expect(page.getByTestId('camera-garden').getByTestId('camera-show')).toBeVisible()
  })
})

async function recordCommands(page: Page) {
  const sent: unknown[] = []
  let state = displayStateSchema.parse({})
  await page.route('**/api/displays/hallway/commands', async (route) => {
    const command = route.request().postDataJSON() as { type: string, view?: DisplayState['view'], screen?: DisplayState['screen'], photo_source?: DisplayState['photo_source'], overlay?: { text: string, icon?: string, ttl?: number } | null, camera?: string | null }
    sent.push(command)
    if (command.type === 'set_view') state = displayStateSchema.parse({ ...state, view: command.view })
    if (command.type === 'set_screen') state = displayStateSchema.parse({ ...state, screen: command.screen })
    if (command.type === 'set_photo_source') state = displayStateSchema.parse({ ...state, photo_source: command.photo_source })
    if (command.type === 'set_overlay') state = displayStateSchema.parse({ ...state, overlay: command.overlay && { text: command.overlay.text, icon: command.overlay.icon ?? null, until: null } })
    if (command.type === 'set_camera') state = displayStateSchema.parse({ ...state, camera: command.camera ? { id: command.camera, name: command.camera === 'garden' ? 'Garden' : 'Front door', url: `http://go2rtc.local:1984/stream.html?src=${command.camera}`, kind: 'page', until: '2026-10-28T10:00:00.000Z' } : null })
    await route.fulfill({ json: state })
  })
  return sent
}

test('shows the week picker, and the way back, for a pinned week', async ({ page }) => {
  await openRemote(page, { view: 'week', week: '2027-03-01', week_set_at: '2026-10-28T09:41:00.000Z' })

  await expect(page.getByTestId('month-picker')).toHaveCount(0)
  await expect(page.getByTestId('week-select')).toHaveValue('2027-03-01')
  await expect(page.getByTestId('week-current')).toHaveText('Back to this week')
  await expect(page).toHaveScreenshot('week-pinned.png', { fullPage: true })
})

test('shows this week in the picker, with no way back, when none is pinned', async ({ page }) => {
  await openRemote(page, { view: 'week' })

  await expect(page.getByTestId('week-select')).toHaveValue('2026-10-26')
  await expect(page.getByTestId('week-current')).toHaveCount(0)
})
