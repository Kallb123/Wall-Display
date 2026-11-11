import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { photoResponseSchema } from '../../shared/photos'
import type { PhotoInfo } from '../../shared/photos'
import type { CustomLayout, LayoutArrangement, LayoutComponent, LayoutOptions } from '../../shared/layouts'
import type { StarChart } from '../../shared/stars'
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

const layout = (id: string, landscape: LayoutArrangement, portrait: LayoutArrangement, options: LayoutOptions = {}): CustomLayout => ({
  id,
  name: id,
  landscape,
  portrait,
  options,
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

// The pane options (architecture §4.8): a month with no title or sidebar beside an
// agenda that has today's date, a week with no hour labels over the week by part
// of day, and a day grid, with whole events coloured and titles wrapped where
// there is room.
const withOptions = layout(
  'options',
  { rows: [row(1, ['month', 3], ['agenda', 2]), row(1, ['week', 1], ['days', 1])] },
  { rows: [row(2, ['month', 1]), row(1, ['agenda', 1]), row(1, ['week', 1], ['days', 1])] },
  {
    month: { show_title: false, show_sidebar: false, fill_events: true, wrap_titles: true },
    agenda: { fill_events: true, wrap_titles: true },
    week: { show_title: false, show_hours: false },
    days: { fill_events: true, wrap_titles: true },
  },
)
withOptions.landscape.rows[1]!.panes[1]!.grid = { rows: 2, columns: 3, start: 'today' }
withOptions.portrait.rows[2]!.panes[1]!.grid = { rows: 2, columns: 1, start: 'today' }

const partsWithOptions = layout(
  'parts-options',
  { rows: [row(1, ['week_parts', 1])] },
  { rows: [row(1, ['week_parts', 1])] },
  { week_parts: { show_title: false, fill_events: true, wrap_titles: true } },
)

// The photo frame's overlays (PR 5.21): beside the agenda, the time and the
// weather in the walking corner (the top left, as burn-in shifting is off) and
// the date on its own at the bottom left; alone on the stage, the time and the
// date sharing a pill at the bottom right, with the weather left off.
const photoOverlays = layout(
  'photo-overlays',
  { rows: [row(1, ['photo', 2], ['agenda', 1])] },
  { rows: [row(2, ['photo', 1]), row(1, ['agenda', 1])] },
  { photo: { show_date: true, date_corner: 'bottom-left' } },
)

const photoAlone = layout(
  'photo-alone',
  { rows: [row(1, ['photo', 1])] },
  { rows: [row(1, ['photo', 1])] },
  { photo: { show_date: true, show_weather: false, time_corner: 'bottom-right', date_corner: 'bottom-right' } },
)

// The star chart (architecture §4.8b). The frozen clock is Wednesday 28 October,
// so the week is Monday 26 October to Sunday 1 November. Isla counts the week
// against a goal of 6 and has beaten it, Theo counts days against a goal of 3
// and has two stars so far today, Poppy has no goal, and Dad's goal of 25 for the
// week is more than ten, so his progress is a bar.
const starChart: StarChart = {
  people: [
    { id: 'isla', name: 'Isla', initial: 'I', colour: '#D27FA0', period: 'week', goal: 6 },
    { id: 'theo', name: 'Theo', initial: 'T', colour: '#5F94C4', period: 'day', goal: 3 },
    { id: 'poppy', name: 'Poppy', initial: 'P', colour: '#9A7BC4', period: 'week', goal: null },
    { id: 'dad', name: 'Dad', initial: 'D', colour: '#7A8A5E', period: 'week', goal: 25 },
  ],
  counts: {
    isla: { '2026-10-26': 2, '2026-10-27': 3, '2026-10-28': 2 },
    theo: { '2026-10-26': 3, '2026-10-27': 4, '2026-10-28': 2 },
    poppy: { '2026-10-26': 1, '2026-10-27': 2, '2026-10-28': 1 },
    dad: { '2026-10-26': 5, '2026-10-27': 6, '2026-10-28': 4 },
  },
}

/** A layout with a star chart pane in the arrangement `at` (`[row, pane]`), a grid of `rows` by `columns` in each. */
const withStars = (id: string, landscape: LayoutArrangement, portrait: LayoutArrangement, grids: { landscape: [number, number, number, number], portrait: [number, number, number, number] }, options: LayoutOptions = {}): CustomLayout => {
  const shown = layout(id, landscape, portrait, options)
  for (const [arrangement, [rowIndex, paneIndex, rows, columns]] of [[shown.landscape, grids.landscape], [shown.portrait, grids.portrait]] as const) {
    arrangement.rows[rowIndex]!.panes[paneIndex]!.star_grid = { rows, columns }
  }
  return shown
}

// A strip of three cards under the week, and a column of three in portrait under
// the week. (Both arrangements hold the same components.)
const starsStrip = withStars(
  'stars-strip',
  { rows: [row(2, ['week', 1]), row(1, ['stars', 1])] },
  { rows: [row(2, ['week', 1]), row(1, ['stars', 1])] },
  { landscape: [1, 0, 1, 3], portrait: [1, 0, 3, 1] },
)

// A two by two block beside the agenda, with all four people, and in portrait a
// block under the agenda with its title hidden.
const starsBlock = withStars(
  'stars-block',
  { rows: [row(1, ['agenda', 1], ['stars', 2])] },
  { rows: [row(1, ['agenda', 1]), row(1, ['stars', 1])] },
  { landscape: [0, 1, 2, 2], portrait: [1, 0, 2, 2] },
  { stars: { show_title: false } },
)

const starsAlone = withStars(
  'stars-alone',
  { rows: [row(1, ['stars', 1])] },
  { rows: [row(1, ['stars', 1])] },
  { landscape: [0, 0, 2, 2], portrait: [0, 0, 2, 2] },
)

// A month pane beside an agenda: the forecast beside the dates in the month's
// small tiles (the icon alone), and with the pane's option off.
const monthAgenda = (id: string, options: LayoutOptions = {}) => layout(
  id,
  { rows: [row(1, ['month', 3], ['agenda', 1])] },
  { rows: [row(2, ['month', 1]), row(1, ['agenda', 1])] },
  options,
)

/** The server's own render of the fixture photo `id`, asked for on a display no spec here shows a photo on. */
async function photoNamed(request: APIRequestContext, id: string): Promise<PhotoInfo> {
  const seen: string[] = []
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await request.get('/api/photos/next?display=porch')
    const { photo } = photoResponseSchema.parse(await response.json())
    if (photo?.id === id) return photo
    if (photo) seen.push(photo.id)
    else await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`The server never offered ${id}, only ${seen.join(', ')}`)
}

/** Opens `display` showing `shown` with `photo` in its photo pane, and waits for the photo to be drawn at full strength. */
async function openWithPhoto(page: Page, display: string, shown: CustomLayout, photo: PhotoInfo) {
  await playServer(page, { view: 'custom', layout: shown.id }, events, weather, { layouts: [shown] })
  // Routes added last are tried first, so this answers before the one `playServer` may have set.
  await page.route('**/api/photos/next**', route => route.fulfill({ json: { photo } }))
  await page.goto(`/display?id=${display}`)
  await expect(page.getByTestId('custom-layout-view')).toBeVisible()
  await fontsReady(page)
  const top = page.locator('[data-testid^="photo-layer-"].top')
  await expect(top).toHaveCount(1)
  await expect.poll(() => top.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true)
  await expect.poll(() => top.evaluate(image => getComputedStyle(image).opacity)).toBe('1')
}

/** Opens `display` showing `shown`, and waits for every pane to be drawn. */
async function open(page: Page, display: string, shown: CustomLayout, stars?: StarChart) {
  await page.route('**/api/photos/next**', route => route.fulfill({ json: { photo: null } }))
  await playServer(page, { view: 'custom', layout: shown.id }, events, weather, { layouts: [shown], stars })
  await page.goto(`/display?id=${display}`)
  await expect(page.getByTestId('custom-layout-view')).toBeVisible()
  await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', display === 'kitchen' ? 'dark' : 'light')
  // A layout of the star chart alone has no events to wait for.
  if (shown.landscape.rows.every(({ panes }) => panes.every(pane => pane.component === 'stars'))) await fontsReady(page)
  else await settle(page)
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

test.describe('landscape star chart', () => {
  test('a strip of three cards under the week, light theme', async ({ page }) => {
    await open(page, 'hallway', starsStrip, { ...starChart, people: starChart.people.slice(0, 3) })

    await expect(page.getByTestId('star-card')).toHaveCount(3)
    await expect(page).toHaveScreenshot('custom-stars-strip-light.png')
  })

  test('a strip of three cards, dark theme', async ({ page }) => {
    await open(page, 'kitchen', starsStrip, { ...starChart, people: starChart.people.slice(0, 3) })

    await expect(page).toHaveScreenshot('custom-stars-strip-dark.png')
  })

  test('a two by two block of cards beside the agenda, with a bar for a big goal', async ({ page }) => {
    await open(page, 'hallway', starsBlock, starChart)

    await expect(page.getByTestId('star-card')).toHaveCount(4)
    await expect(page).toHaveScreenshot('custom-stars-block-light.png')
  })

  test('no star charts yet', async ({ page }) => {
    await open(page, 'hallway', starsAlone, { people: [], counts: {} })

    await expect(page.getByTestId('star-empty')).toBeVisible()
    await expect(page).toHaveScreenshot('custom-stars-empty-light.png')
  })
})

test.describe('pane options', () => {
  test('hidden titles, sidebar and hours, filled and wrapped events', async ({ page }) => {
    await open(page, 'hallway', withOptions)

    await expect(page.getByTestId('layout-pane-month').getByTestId('panel')).toHaveCount(0)
    await expect(page.getByTestId('layout-pane-month').getByTestId('month-title')).toHaveCount(0)
    await expect(page.getByTestId('layout-pane-week').getByTestId('gutter')).toHaveCount(0)
    await expect(page).toHaveScreenshot('custom-options-light.png')
  })

  test('the same in the dark theme', async ({ page }) => {
    await open(page, 'kitchen', withOptions)

    await expect(page).toHaveScreenshot('custom-options-dark.png')
  })

  test('the week by part of day with filled, wrapped lines', async ({ page }) => {
    await open(page, 'hallway', partsWithOptions)

    await expect(page.getByTestId('week-title')).toHaveCount(0)
    await expect(page).toHaveScreenshot('custom-parts-options-light.png')
  })
})

test.describe('the photo frame\'s overlays', () => {
  test('the time and the weather top left, and the date bottom left, beside the agenda', async ({ page, request }) => {
    await openWithPhoto(page, 'hallway', photoOverlays, await photoNamed(request, 'local:sunset-landscape.jpg'))
    await settle(page)

    const pills = page.getByTestId('layout-pane-photo').getByTestId('photo-pill')
    await expect(pills).toHaveCount(2)
    await expect(pills.nth(0)).toHaveAttribute('data-corner', 'top-left')
    await expect(pills.nth(0).getByTestId('photo-clock')).toHaveText('09:41')
    await expect(pills.nth(0).getByTestId('photo-weather')).toHaveText('12°')
    await expect(pills.nth(1)).toHaveAttribute('data-corner', 'bottom-left')
    await expect(pills.nth(1).getByTestId('photo-date')).toHaveText('Wednesday 28 October')
    await expect(page).toHaveScreenshot('custom-photo-overlays-light.png')
  })

  test('the time and the date in one pill at the bottom right, without the weather, full screen', async ({ page, request }) => {
    await openWithPhoto(page, 'kitchen', photoAlone, await photoNamed(request, 'local:sunset-landscape.jpg'))

    const pills = page.getByTestId('photo-pill')
    await expect(pills).toHaveCount(1)
    await expect(pills).toHaveAttribute('data-corner', 'bottom-right')
    await expect(pills.getByTestId('photo-weather')).toHaveCount(0)
    await expect(pills.getByTestId('photo-date')).toHaveText('Wednesday 28 October')
    await expect(page).toHaveScreenshot('custom-photo-alone-dark.png')
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

  test('pane options', async ({ page }) => {
    await open(page, 'hallway', withOptions)

    await expect(page.getByTestId('layout-pane-month').getByTestId('today-band')).toHaveCount(0)
    await expect(page.getByTestId('layout-pane-month').getByTestId('next-days')).toHaveCount(0)
    await expect(page).toHaveScreenshot('custom-options-portrait-light.png')
  })

  test('a column of three cards under the week', async ({ page }) => {
    await open(page, 'hallway', starsStrip, { ...starChart, people: starChart.people.slice(0, 3) })

    await expect(page.getByTestId('star-card')).toHaveCount(3)
    await expect(page).toHaveScreenshot('custom-stars-strip-portrait-light.png')
  })

  test('a two by two block under the agenda, without its title, dark theme', async ({ page }) => {
    await open(page, 'kitchen', starsBlock, starChart)

    await expect(page.getByTestId('star-card')).toHaveCount(4)
    await expect(page).toHaveScreenshot('custom-stars-block-portrait-dark.png')
  })

  test('a 4 by 2 day grid below a photo', async ({ page }) => {
    await open(page, 'hallway', photoAboveDays)

    await expect(page.getByTestId('day-tile')).toHaveCount(8)
    await expect(page).toHaveScreenshot('custom-photo-days-portrait-light.png')
  })
})

test.describe('weather on dates', () => {
  test('a month pane beside an agenda shows the forecast beside the dates', async ({ page }) => {
    await open(page, 'hallway', monthAgenda('month-agenda'))

    await expect(page.getByTestId('cell-weather').first()).toBeVisible()
    await expect(page).toHaveScreenshot('custom-month-weather-dates-light.png')
  })

  test('the pane option leaves it out of the month and the agenda', async ({ page }) => {
    await open(page, 'hallway', monthAgenda('month-agenda-off', { month: { weather_on_dates: false }, agenda: { weather_on_dates: false } }))

    await expect(page.getByTestId('cell-weather')).toHaveCount(0)
    await expect(page.getByTestId('agenda-weather')).toHaveCount(0)
    await expect(page).toHaveScreenshot('custom-month-weather-dates-off-light.png')
  })
})
