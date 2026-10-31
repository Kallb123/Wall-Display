import { join } from 'node:path'
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { todayIn } from '../../shared/dates'
import { displayStateSchema } from '../../shared/display'
import type { DisplayState } from '../../shared/display'
import { resolvePreview } from '../../shared/special-days'
import type { SpecialDaysResolution } from '../../shared/special-days'
import type { CalendarEvent } from '../../shared/types/events'
import type { WeatherSnapshot } from '../../shared/weather'
import events from './fixtures/events.json' with { type: 'json' }
import { DAYS, SCENES } from './fixtures/special-days'

// What the visual specs share: the frozen clock, a stand-in for the server, and
// a wait for the page to finish drawing.

// Wed 28 Oct 2026, 09:41 in London (the clocks went back on the 25th, so that is 09:41Z).
export const NOW = new Date('2026-10-28T09:41:00Z')

/** A whole state, with defaults filled in. */
const stateWith = (changes: Partial<DisplayState> = {}): DisplayState => displayStateSchema.parse(changes)

export interface PlayOptions {
  /** The moment the clock is frozen at, and so what the preview route calls today. `NOW` unless given. */
  now?: Date
  /** Leave the clock alone, for a spec that installs its own to run time forward. The page then needs `now` to be the time that clock starts at. */
  ownClock?: boolean
  /**
   * The special days the server sends after the weather on every connect: a
   * resolution (`specialDaysOn` in fixtures/special-days.ts), or null for none.
   * Left out, nothing is sent, as with a server that has not got to them.
   */
  specialDays?: SpecialDaysResolution | null
}

/**
 * Plays the server for a page: it answers /api/events from `served` (the
 * default fixture unless given others) and the WebSocket with a state and then
 * the weather (null unless given, which is what the real server sends when it
 * has none) and the special days if given, and `send` pushes a new state to
 * every open socket (`sendSpecialDays` the special days). /api/displays is the real
 * server's, so the config is exercised too. The clock is frozen before the
 * page loads.
 *
 * It also serves the special day art (the SVGs in fixtures/art) and answers
 * /api/special-days/preview from the fixture days and scenes with the real
 * `resolvePreview`, for the date the clock is at.
 */
export async function playServer(page: Page, initial: Partial<DisplayState> = {}, served: CalendarEvent[] = events, weather: WeatherSnapshot | null = null, options: PlayOptions = {}) {
  const sockets: { displayId: string, send: (message: string) => void }[] = []
  const message = (displayId: string, state: DisplayState) => JSON.stringify({ type: 'state.updated', display_id: displayId, state })
  const specialDaysMessage = (specialDays: SpecialDaysResolution | null) => JSON.stringify({ type: 'special_days.updated', special_days: specialDays })
  let current = stateWith(initial)
  let specialDays = options.specialDays

  if (!options.ownClock) await page.clock.setFixedTime(options.now ?? NOW)
  await page.route(url => url.pathname.startsWith('/special-days/'), async (route) => {
    const name = new URL(route.request().url()).pathname.slice('/special-days/'.length)
    // Only a plain file name, so a request can't reach outside the folder.
    if (!/^[\w-]+\.svg$/.test(name)) return route.fulfill({ status: 404 })
    await route.fulfill({ path: join(import.meta.dirname, 'fixtures/art', name), contentType: 'image/svg+xml' })
  })
  await page.route('**/api/special-days/preview**', async (route) => {
    const query = new URL(route.request().url()).searchParams
    const target = query.has('scene') ? { scene: query.get('scene')! } : { special_day: query.get('special_day')! }
    const resolution = resolvePreview(DAYS, SCENES, target, todayIn(options.now ?? NOW, 'Europe/London'))
    if (!resolution) return route.fulfill({ status: 404, json: { message: 'Unknown' } })
    await route.fulfill({ json: { special_days: resolution } })
  })
  await page.route('**/api/events**', async (route) => {
    const url = new URL(route.request().url())
    await route.fulfill({ json: { from: url.searchParams.get('from'), to: url.searchParams.get('to'), events: served } })
  })
  await page.routeWebSocket(/\/_ws/, (socket) => {
    const displayId = new URL(socket.url()).searchParams.get('display') ?? ''
    sockets.push({ displayId, send: text => socket.send(text) })
    socket.send(message(displayId, current))
    socket.send(JSON.stringify({ type: 'weather.updated', weather }))
    if (specialDays !== undefined) socket.send(specialDaysMessage(specialDays))
  })

  return {
    /** Sends new special days (or null for none) to the display, and to any that connect later. */
    sendSpecialDays(next: SpecialDaysResolution | null) {
      specialDays = next
      for (const socket of sockets) socket.send(specialDaysMessage(next))
    },
    /** Sends a new state (the changes on top of the one before) to the display. */
    send(changes: Partial<DisplayState>) {
      current = stateWith({ ...current, ...changes })
      for (const socket of sockets) socket.send(message(socket.displayId, current))
    },
  }
}

/**
 * Waits for the fonts and the events, so a screenshot is of the finished page.
 * A view with nothing to show says so (`empty-day`) instead of listing events.
 */
export async function settle(page: Page) {
  await expect(page.getByTestId('event').or(page.getByTestId('empty-day')).first()).toBeVisible()
  await fontsReady(page)
}

/** Waits for the two bundled fonts, for a page that has no events to wait for. */
export async function fontsReady(page: Page) {
  await page.evaluate(async () => {
    await Promise.all([document.fonts.load('400 40px Caprasimo'), document.fonts.load('700 40px Figtree')])
    await document.fonts.ready
  })
}

/**
 * Waits for what `settle` waits for, and for every image on the page to be
 * loaded and decoded, so a screenshot of special day art is of the finished
 * picture and not of a half-drawn one.
 */
export async function settleWithArt(page: Page) {
  await settle(page)
  await page.evaluate(() => Promise.all([...document.images].map(image => image.decode().catch(() => {}))))
  await expect.poll(() => page.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth > 0))).toBe(true)
}
