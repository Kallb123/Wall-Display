import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import type { CustomLayout, LayoutArrangement, LayoutOptions } from '../../shared/layouts'
import type { CalendarEvent } from '../../shared/types/events'
import { playServer, settle } from './helpers'
import { CROWDED, PACKED, ROOMY, withoutLocations } from './fixtures/locations'

// Event locations (issue 74) at the frozen clock (Wed 28 Oct 2026, 09:41 in
// London): a second, quieter line under an event's title, the first part of its
// address, where there is room for it. The fit gives a location only the room
// left once every title has its own, so these specs measure real layout: with
// room the line is on and has a box under its title; without, it is off and
// nothing is clipped; and the same crowded fixture with and without locations
// draws the same events and the same "+N more". ROOMY has events with
// room to spare and CROWDED has more than any view can show (see
// fixtures/locations.ts).

/** What one event of a view looks like: whether the fit gave it a location line, the line's text and whether it has a box, and where it sits. */
interface Row {
  title: string
  /** `data-location="on"` is on the event or on the element inside it the fit works on. */
  on: boolean
  /** The text of the location line, or null if the event has none in the markup. */
  location: string | null
  /** The line has a box: it is drawn. */
  drawn: boolean
  /** The line starts at or under the title's bottom edge. */
  underTitle: boolean
  top: number
  bottom: number
}

/** The rows of the events in `scope`, in document order. */
async function rowsOf(scope: Locator): Promise<Row[]> {
  return scope.getByTestId('event').evaluateAll(elements => elements.map((element) => {
    const line = element.querySelector('[data-testid="event-location"]')
    const title = element.querySelector('.title, .name')!
    const lineBox = line?.getBoundingClientRect()
    const titleBox = title.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    return {
      title: title.textContent!.trim(),
      on: element.matches('[data-location="on"]') || element.querySelector('[data-location="on"]') !== null,
      location: line ? line.textContent!.trim() : null,
      drawn: !!lineBox && lineBox.width > 0 && lineBox.height > 0,
      underTitle: !!lineBox && lineBox.top >= titleBox.bottom - 1,
      top: box.top,
      bottom: box.bottom,
    }
  }))
}

/** The rows that show a location line (on and drawn). */
const shown = (rows: Row[]) => rows.filter(row => row.on && row.drawn)

/**
 * Nothing is clipped in any box the fit works on: every event in it ends inside
 * it and, for a box with no "+N more" line, `scrollHeight` is no more than
 * `clientHeight`. (A cell of the week by part of day with four lines or a "+N
 * more" is 5px taller inside than out, as it is with no locations at all, so
 * its spec leaves the scroll height out and keeps the check on the events.)
 */
async function expectNothingClipped(page: Page, options: { scroll?: boolean } = {}) {
  const boxes = await page.locator('[data-wrap-box]').evaluateAll(elements => elements.map((element) => {
    const box = element.getBoundingClientRect()
    const items = [...element.querySelectorAll('[data-wrap-item]')].flatMap((item) => {
      // A wrapper with no box of its own (display: contents) is its children.
      const parts = getComputedStyle(item).display === 'contents' ? [...item.children] : [item]
      return parts.map(part => part.getBoundingClientRect()).filter(rect => rect.height > 0)
    })
    return {
      hasMore: element.querySelector('[data-testid="more"], [data-testid="panel-more"]') !== null,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      box: { top: box.top, bottom: box.bottom },
      items: items.map(rect => ({ top: rect.top, bottom: rect.bottom })),
    }
  }))
  expect(boxes.length).toBeGreaterThan(0)
  for (const { hasMore, scrollHeight, clientHeight, box, items } of boxes) {
    if (!hasMore && options.scroll !== false) expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1)
    for (const item of items) expect(item.bottom).toBeLessThanOrEqual(box.bottom + 1)
  }
}

/** Some events have a location line in the markup that the fit left off, and it has no box: it is not drawn. */
function expectSomeWithoutRoom(rows: Row[]) {
  const without = rows.filter(row => row.location !== null && !row.on)
  expect(without.length).toBeGreaterThan(0)
  for (const row of without) expect(row.drawn, row.title).toBe(false)
}

/** The events in the month's day tiles (every event that is not a row of the panel or the strip) are drawn, and none has a location line. */
async function expectNoLocationInTiles(page: Page) {
  const tiles = page.locator('[data-testid="event"]:not([data-kind="panel"])')
  await expect(tiles.first()).toBeVisible()
  await expect(tiles.locator('[data-testid="event-location"]')).toHaveCount(0)
  await expect(page.getByTestId('day-tile').getByTestId('event-location')).toHaveCount(0)
}

/** The "+N more" texts of a page, whatever the view calls them. */
const moreOf = (page: Page) => page.locator('[data-testid="more"], [data-testid="panel-more"], [data-testid="head-more"], [data-testid="overflow"]').allTextContents().then(texts => texts.map(text => text.replace(/\s+/g, ' ').trim()))

/** How many events a page draws, and its "+N more" texts. */
async function drawn(page: Page) {
  return { events: await page.getByTestId('event').count(), more: await moreOf(page) }
}

/** A second page of the same browser, shown with `open` and closed after `use`. */
async function onAnotherPage<T>(page: Page, open: (page: Page) => Promise<void>, use: (page: Page) => Promise<T>): Promise<T> {
  const other = await page.context().newPage()
  try {
    await open(other)
    return await use(other)
  } finally {
    await other.close()
  }
}

/** Gives the page the display list with every display's `show_locations` turned off, as the settings page does. */
async function locationsOff(page: Page) {
  await page.route('**/api/displays', async (route) => {
    const response = await route.fetch()
    const displays = (await response.json()) as { show_locations: boolean }[]
    await route.fulfill({ response, json: displays.map(display => ({ ...display, show_locations: false })) })
  })
}

/** Opens a full-screen `view` of `served` on `display`, with the display's `show_locations` as given. */
const openView = (view: 'agenda' | 'week' | 'week_parts' | 'month', served: CalendarEvent[], display = 'hallway', options: { off?: boolean } = {}) => async (page: Page) => {
  if (options.off) await locationsOff(page)
  await playServer(page, { view }, served)
  await page.goto(`/display?id=${display}`)
  await settle(page)
  // The fit runs after the fonts have loaded, in the next frame.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

// A custom layout with a day grid alone, 2 by 4 from today (the pane as in custom-layout.spec.ts).
const days = (id: string, options: LayoutOptions = {}, grid = { rows: 2, columns: 4, start: 'today' as const }): CustomLayout => {
  const arrangement: LayoutArrangement = { rows: [{ size: 1, panes: [{ component: 'days', size: 1, grid }] }] }
  return { id, name: id, landscape: arrangement, portrait: arrangement, options, created_at: '2026-10-01T09:00:00.000Z', updated_at: '2026-10-01T09:00:00.000Z' }
}

const openDays = (shown: CustomLayout, served: CalendarEvent[], display = 'hallway') => async (page: Page) => {
  await page.route('**/api/photos/next**', route => route.fulfill({ json: { photo: null } }))
  await playServer(page, { view: 'custom', layout: shown.id }, served, null, { layouts: [shown] })
  await page.goto(`/display?id=${display}`)
  await expect(page.getByTestId('custom-layout-view')).toBeVisible()
  await settle(page)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

test.describe('the agenda', () => {
  test('a location under the title where there is room, cut to its first part', async ({ page }) => {
    await openView('agenda', ROOMY)(page)

    const rows = await rowsOf(page.getByTestId('day-today'))
    const byTitle = new Map(rows.map(row => [row.title, row]))
    expect(shown(rows).map(row => row.location)).toEqual(['Nana\'s house', 'Parkside Dental Practice', 'The Old Mill Café', 'Aqua Leisure Centre'])
    for (const row of shown(rows)) expect(row.underTitle, row.title).toBe(true)
    // A link says nothing about where, and no location says nothing.
    expect(byTitle.get('Call with the school')!.location).toBeNull()
    expect(byTitle.get('Bonfire at the park')!.location).toBeNull()
    const tomorrow = await rowsOf(page.getByTestId('day-tomorrow'))
    expect(shown(tomorrow).map(row => row.location)).toEqual(['Science Museum'])
    await expectNothingClipped(page)
    await expect(page).toHaveScreenshot('agenda-light.png')
  })

  test('the same in the dark theme', async ({ page }) => {
    await openView('agenda', ROOMY, 'kitchen')(page)

    await expect(page.getByTestId('stage')).toHaveAttribute('data-theme', 'dark')
    expect(shown(await rowsOf(page.getByTestId('day-today')))).toHaveLength(4)
    await expect(page).toHaveScreenshot('agenda-dark.png')
  })

  test('a full list gives no location the room it has not got, and nothing is clipped', async ({ page }) => {
    await openView('agenda', CROWDED)(page)

    const rows = await rowsOf(page.getByTestId('day-today'))
    expectSomeWithoutRoom(rows)
    // The list is full: the last event that has a location is one without room.
    expect(rows.findLast(row => row.location !== null)!.on).toBe(false)
    await expectNothingClipped(page)
  })

  test('the locations never cost an event or add a "+N more"', async ({ page }) => {
    await openView('agenda', CROWDED)(page)
    const withLocations = await drawn(page)
    const without = await onAnotherPage(page, openView('agenda', withoutLocations(CROWDED)), drawn)

    expect(withLocations.more.length).toBeGreaterThan(0)
    expect(withLocations).toEqual(without)
  })

  test('with locations off in the display\'s settings, no line is drawn', async ({ page }) => {
    await openView('agenda', ROOMY, 'hallway', { off: true })(page)

    await expect(page.getByTestId('event-location')).toHaveCount(0)
    await expect(page.locator('[data-location="on"]')).toHaveCount(0)
  })
})

test.describe('the week', () => {
  test('a long block has its location under the title', async ({ page }) => {
    await openView('week', ROOMY)(page)

    const rows = await rowsOf(page)
    expect(shown(rows).map(row => row.location)).toEqual(['Parkside Dental Practice', 'The Old Mill Café', 'Aqua Leisure Centre', 'Science Museum'])
    for (const row of shown(rows)) expect(row.underTitle, row.title).toBe(true)
    // The link and no location say nothing; the all-day bar has no line.
    for (const title of ['Call with the school', 'Bonfire at the park', 'Half term at Nana\'s']) expect(rows.find(row => row.title === title)!.location, title).toBeNull()
    await expectNothingClipped(page)
  })

  test('a block only as tall as its title gets none, and nothing is clipped', async ({ page }) => {
    await openView('week', CROWDED)(page)

    const rows = await rowsOf(page)
    // Half an hour is a one-line block, which has no line in it at all; an hour among neighbours has the line, and no room for it.
    expect(rows.find(row => row.title === 'Piano lesson')!.location).toBeNull()
    expectSomeWithoutRoom(rows)
    for (const title of ['Swimming', 'Ballet', 'Football']) expect(rows.find(row => row.title === title)!.on, title).toBe(false)
    await expect(page.getByTestId('event').filter({ has: page.locator('[data-location="on"]') }).first()).toBeVisible()
    await expectNothingClipped(page)
    await expect(page).toHaveScreenshot('week-light.png')
  })

  test('the locations never cost an event or add a "+N" ', async ({ page }) => {
    await openView('week', CROWDED)(page)
    const withLocations = await drawn(page)
    const without = await onAnotherPage(page, openView('week', withoutLocations(CROWDED)), drawn)

    expect(withLocations).toEqual(without)
  })

  test('with locations off in the display\'s settings, no line is drawn', async ({ page }) => {
    await openView('week', ROOMY, 'hallway', { off: true })(page)

    await expect(page.getByTestId('event-location')).toHaveCount(0)
  })
})

test.describe('the week by part of day', () => {
  test('a cell with free lines shows the location under the title', async ({ page }) => {
    await openView('week_parts', ROOMY)(page)

    const rows = await rowsOf(page)
    expect(shown(rows).map(row => row.location)).toEqual(['Parkside Dental Practice', 'The Old Mill Café', 'Aqua Leisure Centre', 'Science Museum'])
    for (const row of shown(rows)) expect(row.underTitle, row.title).toBe(true)
    // The head's items (all-day events) have none.
    expect(rows.find(row => row.title === 'Half term at Nana\'s')!.location).toBeNull()
    await expectNothingClipped(page, { scroll: false })
  })

  test('a full cell shows none, and nothing is clipped', async ({ page }) => {
    await openView('week_parts', CROWDED)(page)

    const rows = await rowsOf(page)
    expectSomeWithoutRoom(rows)
    expect(shown(rows).length).toBeGreaterThan(0)
    await expect(page.getByTestId('part-cell').filter({ has: page.getByTestId('more') }).first()).toBeVisible()
    await expectNothingClipped(page, { scroll: false })
    await expect(page).toHaveScreenshot('week-parts-light.png')
  })

  test('the locations never cost an event or add a "+N more"', async ({ page }) => {
    await openView('week_parts', CROWDED)(page)
    const withLocations = await drawn(page)
    const without = await onAnotherPage(page, openView('week_parts', withoutLocations(CROWDED)), drawn)

    expect(withLocations.more.length).toBeGreaterThan(0)
    expect(withLocations).toEqual(without)
  })

  test('with locations off in the display\'s settings, no line is drawn', async ({ page }) => {
    await openView('week_parts', ROOMY, 'hallway', { off: true })(page)

    await expect(page.getByTestId('event-location')).toHaveCount(0)
  })
})

test.describe('the month', () => {
  test('the panel\'s rows show the location under the title, and the day tiles never do', async ({ page }) => {
    await openView('month', ROOMY)(page)

    const rows = await rowsOf(page.getByTestId('panel'))
    expect(shown(rows).map(row => row.location)).toEqual(['Nana\'s house', 'Parkside Dental Practice', 'The Old Mill Café', 'Science Museum'])
    for (const row of shown(rows)) expect(row.underTitle, row.title).toBe(true)
    await expectNoLocationInTiles(page)
    await expectNothingClipped(page)
  })

  test('a panel with room for some gives the location to the first rows, and nothing is clipped', async ({ page }) => {
    await openView('month', CROWDED)(page)

    const rows = await rowsOf(page.getByTestId('panel'))
    expect(shown(rows).length).toBeGreaterThan(0)
    await expectNoLocationInTiles(page)
    await expectNothingClipped(page)
    await expect(page).toHaveScreenshot('month-light.png')
  })

  test('a full panel gives none, and nothing is clipped', async ({ page }) => {
    await openView('month', PACKED)(page)

    const rows = await rowsOf(page.getByTestId('panel'))
    expectSomeWithoutRoom(rows)
    await expectNoLocationInTiles(page)
    await expectNothingClipped(page)
  })

  test('the locations never cost an event or add a "+N more"', async ({ page }) => {
    await openView('month', CROWDED)(page)
    const withLocations = await drawn(page)
    const without = await onAnotherPage(page, openView('month', withoutLocations(CROWDED)), drawn)

    expect(withLocations.more.length).toBeGreaterThan(0)
    expect(withLocations).toEqual(without)
  })

  test('with locations off in the display\'s settings, no line is drawn', async ({ page }) => {
    await openView('month', ROOMY, 'hallway', { off: true })(page)

    await expect(page.getByTestId('event-location')).toHaveCount(0)
  })
})

test.describe('the day grid', () => {
  test('a card with room shows the location under its time', async ({ page }) => {
    await openDays(days('days-roomy'), ROOMY)(page)

    const tomorrow = await rowsOf(page.locator('[data-testid="day-tile"][data-date="2026-10-29"]'))
    expect(shown(tomorrow).map(row => row.location)).toEqual(['Science Museum'])
    for (const row of shown(tomorrow)) expect(row.underTitle, row.title).toBe(true)
    await expectNothingClipped(page)
  })

  test('a full tile shows none for the cards without room, and nothing is clipped', async ({ page }) => {
    await openDays(days('days-crowded'), CROWDED)(page)

    const today = await rowsOf(page.locator('[data-testid="day-tile"][data-date="2026-10-28"]'))
    expectSomeWithoutRoom(today)
    await expectNothingClipped(page)
    await expect(page).toHaveScreenshot('days-light.png')
  })

  test('the locations never cost a card or add a "+N more"', async ({ page }) => {
    await openDays(days('days-crowded'), CROWDED)(page)
    const withLocations = await drawn(page)
    // The pane's own option, for a pane of a custom layout.
    const without = await onAnotherPage(page, openDays(days('days-off', { days: { show_locations: false } }), CROWDED), drawn)

    expect(withLocations.more.length).toBeGreaterThan(0)
    expect(withLocations).toEqual(without)
  })

  test('the pane option turns the line off', async ({ page }) => {
    await openDays(days('days-off', { days: { show_locations: false } }), ROOMY)(page)

    await expect(page.getByTestId('event')).not.toHaveCount(0)
    await expect(page.getByTestId('event-location')).toHaveCount(0)
  })
})

test.describe('portrait', () => {
  test.use({ viewport: { width: 1440, height: 2560 } })

  test('the month\'s strip cards show the location and the band does not', async ({ page }) => {
    await openView('month', CROWDED)(page)

    await expect(page.getByTestId('stage')).toHaveAttribute('data-orientation', 'portrait')
    await expect(page.getByTestId('today-band').getByTestId('event')).not.toHaveCount(0)
    await expect(page.getByTestId('today-band').getByTestId('event-location')).toHaveCount(0)
    await expectNoLocationInTiles(page)
    const strip = await rowsOf(page.getByTestId('next-days'))
    expect(shown(strip).length).toBeGreaterThan(0)
    for (const row of shown(strip)) expect(row.underTitle, row.title).toBe(true)
    await expectNothingClipped(page)
    await expect(page).toHaveScreenshot('portrait-month-light.png')
  })
})
