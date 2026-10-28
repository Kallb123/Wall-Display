import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { displayStateSchema } from '../../shared/display'
import type { DisplayState } from '../../shared/display'
import type { CalendarEvent } from '../../shared/types/events'
import events from './fixtures/events.json' with { type: 'json' }

// What the visual specs share: the frozen clock, a stand-in for the server, and
// a wait for the page to finish drawing.

// Wed 28 Oct 2026, 09:41 in London (the clocks went back on the 25th, so that is 09:41Z).
export const NOW = new Date('2026-10-28T09:41:00Z')

/** A whole state, with defaults filled in. */
const stateWith = (changes: Partial<DisplayState> = {}): DisplayState => displayStateSchema.parse(changes)

/**
 * Plays the server for a page: it answers /api/events from `served` (the
 * default fixture unless given others) and the WebSocket with a state, and
 * `send` pushes a new state to every open socket. /api/displays is the real
 * server's, so the config is exercised too. The clock is frozen before the
 * page loads.
 */
export async function playServer(page: Page, initial: Partial<DisplayState> = {}, served: CalendarEvent[] = events) {
  const sockets: { displayId: string, send: (message: string) => void }[] = []
  const message = (displayId: string, state: DisplayState) => JSON.stringify({ type: 'state.updated', display_id: displayId, state })
  let current = stateWith(initial)

  await page.clock.setFixedTime(NOW)
  await page.route('**/api/events**', async (route) => {
    const url = new URL(route.request().url())
    await route.fulfill({ json: { from: url.searchParams.get('from'), to: url.searchParams.get('to'), events: served } })
  })
  await page.routeWebSocket(/\/_ws/, (socket) => {
    const displayId = new URL(socket.url()).searchParams.get('display') ?? ''
    sockets.push({ displayId, send: text => socket.send(text) })
    socket.send(message(displayId, current))
  })

  return {
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
  await page.evaluate(async () => {
    await Promise.all([document.fonts.load('400 40px Caprasimo'), document.fonts.load('700 40px Figtree')])
    await document.fonts.ready
  })
}
