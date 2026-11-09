import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { displayStateSchema } from '../../shared/display'
import type { CalendarStatus, ConnectionsStatus, DisplayPreferences, DisplayStatus, PhotosSettingsStatus, PreferencesStatus, SharedPreferences } from '../../shared/settings'
import type { StarChart, StarSettingsEntry } from '../../shared/stars'
import { NOW, fontsReady } from './helpers'

// The settings pages (architecture §7.6) at a laptop's size, in both of the
// device's colour schemes. The server's /api/displays is the real one (the
// pages read the wall's time zone from it); everything under /api/settings and
// /api/remote is played by the test, with the clock frozen at the same moment
// as the other specs so "2 minutes ago", "Today" and "Tomorrow" stay put.

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })

const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString()

const household = { id: 'home', name: 'Household', initial: 'H', colour: '#D9A93F' }
const dad = { id: 'dad', name: 'Dad', initial: 'D', colour: '#7A8A5E' }

const calendars: CalendarStatus[] = [
  {
    id: 'family',
    name: 'Family',
    person: household,
    detect_people: true,
    detect_in: ['title', 'description'],
    source_type: 'ics',
    poll_seconds: 900,
    syncing: true,
    last_attempt_at: minutesAgo(2),
    last_success_at: minutesAgo(2),
    last_error: null,
    event_count: 124,
    fallbacks: [
      { title: 'Parents\' evening', start: '2026-10-28T17:30:00Z', all_day: false, start_date: null, occurrences: 1 },
      { title: 'Dentist', start: '2026-10-29T00:00:00Z', all_day: true, start_date: '2026-10-29', occurrences: 1 },
      { title: 'Violin practice', start: '2026-10-31T10:00:00Z', all_day: false, start_date: null, occurrences: 4 },
      { title: 'Grandma visiting', start: '2026-11-07T00:00:00Z', all_day: true, start_date: '2026-11-07', occurrences: 1 },
    ],
  },
  {
    id: 'bins',
    name: 'Bin collection',
    person: household,
    detect_people: 'anywhere',
    detect_in: ['title'],
    source_type: 'homeassistant',
    poll_seconds: 3600,
    syncing: true,
    last_attempt_at: minutesAgo(1),
    last_success_at: minutesAgo(185),
    last_error: 'Home Assistant refused the token (401)',
    event_count: 18,
    fallbacks: [],
  },
  {
    id: 'dad-work',
    name: 'Dad\'s work',
    person: dad,
    detect_people: false,
    detect_in: ['title', 'description'],
    source_type: 'ics',
    poll_seconds: 300,
    syncing: true,
    last_attempt_at: minutesAgo(4),
    last_success_at: minutesAgo(4),
    last_error: null,
    event_count: 57,
    fallbacks: [],
  },
]

const displays: DisplayStatus[] = [
  {
    id: 'hallway',
    name: 'Hallway',
    theme: 'light',
    month_style: 'soft',
    state: displayStateSchema.parse({
      view: 'agenda',
      brightness: 80,
      overlay: { text: 'Bins out tonight', icon: 'trash', until: '2026-10-28T14:30:00.000Z' },
    }),
    sockets: { display: 1, remote: 2 },
    mqtt: 'connected',
    mqtt_error: null,
  },
  {
    id: 'kitchen',
    name: 'Kitchen',
    theme: 'dark',
    month_style: 'classic',
    state: displayStateSchema.parse({ view: 'month', month: '2026-11', screen: 'off', brightness: 40, photo_source: 'google' }),
    sockets: { display: 0, remote: 0 },
    mqtt: 'disconnected',
    mqtt_error: 'Connection refused',
  },
]

const connections: ConnectionsStatus = {
  mqtt: { configured: true, broker: 'mqtt://mosquitto:1883', discovery: true, connected: 1, total: 2 },
  homeassistant: { configured: true, state: 'error', error: 'Home Assistant refused the token (401)', checked_at: minutesAgo(1) },
}

const MB = 1024 * 1024

const photos: PhotosSettingsStatus = {
  configured: true,
  interval_seconds: 60,
  match_orientation: true,
  cache_bytes: 1536 * MB,
  cache_max_bytes: 2048 * MB,
  google_ignored: false,
  providers: [
    { id: 'immich', mode: 'albums', where: 'immich.local:2283', photos: 1240, cached: 312, last_success_at: minutesAgo(7), last_error: null },
    { id: 'local', mode: null, where: '/photos', photos: 0, cached: 36, last_success_at: minutesAgo(190), last_error: 'The photo folder is not there' },
  ],
}

const hallwayPreferences: DisplayPreferences = {
  theme: 'light',
  month_style: 'soft',
  week_start: 'monday',
  month_return_minutes: 5,
  week_hours: { from: 7, to: 21 },
  burn_in: true,
  night_text: 'none',
  orientation: 'auto',
}

const sharedPreferences: SharedPreferences = {
  photo_interval_seconds: 60,
  off_after_minutes: 10,
  quiet_hours: null,
  night_action: 'none',
  night_below_lux: null,
  night_above_lux: null,
  min_step: 5,
  smoothing_seconds: 30,
}

// The kitchen has a few saved changes, so the Changed marks and Reset are in the shot.
const preferences: PreferencesStatus = {
  displays: [
    { id: 'hallway', name: 'Hallway', values: hallwayPreferences, config: hallwayPreferences, changed: [] },
    {
      id: 'kitchen',
      name: 'Kitchen',
      values: { ...hallwayPreferences, theme: 'dark', month_style: 'classic', week_start: 'sunday', night_text: 'first_event', orientation: 'portrait' },
      config: { ...hallwayPreferences, month_style: 'classic' },
      changed: ['theme', 'week_start', 'night_text', 'orientation'],
    },
  ],
  shared: {
    values: { ...sharedPreferences, night_action: 'night_view', night_below_lux: 5, quiet_hours: { from: '22:00', to: '07:00' } },
    config: sharedPreferences,
    changed: ['quiet_hours', 'night_action', 'night_below_lux'],
  },
  photos_configured: true,
  alarm_configured: true,
  mqtt_configured: true,
}

/** Plays the settings API, with the clock frozen before the page loads. */
async function playSettings(page: Page, status: ConnectionsStatus = connections, pinRequired = false, photosStatus: PhotosSettingsStatus = photos) {
  await page.clock.setFixedTime(NOW)
  await page.route('**/api/settings/calendars', route => route.fulfill({ json: calendars }))
  await page.route('**/api/settings/displays', route => route.fulfill({ json: displays }))
  await page.route('**/api/settings/connections', route => route.fulfill({ json: status }))
  await page.route('**/api/settings/photos', route => route.fulfill({ json: photosStatus }))
  await page.route('**/api/settings/preferences', route => route.fulfill({ json: preferences }))
  await page.route('**/api/remote', route => route.fulfill({ json: { pin_required: pinRequired } }))
}

const starPeople: StarSettingsEntry[] = [
  { id: 'isla', name: 'Isla', initial: 'I', colour: '#D27FA0', enabled: true, period: 'week', goal: 6 },
  { id: 'theo', name: 'Theo', initial: 'T', colour: '#5F94C4', enabled: true, period: 'day', goal: 3 },
  { id: 'poppy', name: 'Poppy', initial: 'P', colour: '#9A7BC4', enabled: false, period: 'week', goal: null },
]

const starChart: StarChart = {
  people: starPeople.filter(person => person.enabled).map(({ id, name, initial, colour, period, goal }) => ({ id, name, initial, colour, period, goal })),
  counts: {
    isla: { '2026-10-26': 2, '2026-10-27': 3, '2026-10-28': 2 },
    theo: { '2026-10-26': 3, '2026-10-27': 4, '2026-10-28': 2 },
  },
}

async function openStars(page: Page) {
  await playSettings(page)
  await page.route('**/api/settings/stars', route => route.fulfill({ json: starPeople }))
  await page.route('**/api/stars', route => route.fulfill({ json: starChart }))
  await page.goto('/settings/stars')
  await expect(page.getByTestId('tab-stars')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('star-people')).toBeVisible()
  await expect(page.getByTestId('chip-mqtt')).toContainText('1 of 2 connected')
  await fontsReady(page)
}

async function openCalendars(page: Page) {
  await playSettings(page)
  await page.goto('/settings/calendars')
  await expect(page.getByTestId('calendar-card')).toHaveCount(3)
  await expect(page.getByTestId('chip-mqtt')).toContainText('1 of 2 connected')
  // The time zone arrives from /api/displays; the dates are right either side of it, but wait so the shot is the settled page.
  await expect(page.getByTestId('fallback').first()).toContainText('Today')
  await fontsReady(page)
}

async function openDisplays(page: Page) {
  await playSettings(page, { ...connections, homeassistant: { configured: true, state: 'ok', error: null, checked_at: minutesAgo(1) } })
  await page.goto('/settings/displays')
  await expect(page.getByTestId('display-card')).toHaveCount(2)
  await expect(page.getByTestId('shared-card')).toBeVisible()
  await expect(page.getByTestId('chip-homeassistant')).toContainText('Connected')
  await fontsReady(page)
}

async function openPhotos(page: Page, photosStatus: PhotosSettingsStatus = photos) {
  await playSettings(page, connections, false, photosStatus)
  await page.goto('/settings/photos')
  await expect(page.getByTestId('tab-photos')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('cache-card').or(page.getByTestId('photos-off'))).toBeVisible()
  await expect(page.getByTestId('chip-mqtt')).toContainText('1 of 2 connected')
  await fontsReady(page)
}

test.describe('light', () => {
  test('Calendars looks right', async ({ page }) => {
    await openCalendars(page)

    await expect(page).toHaveScreenshot('calendars-light.png', { fullPage: true })
  })

  test('Displays looks right', async ({ page }) => {
    await openDisplays(page)

    await expect(page).toHaveScreenshot('displays-light.png', { fullPage: true })
  })

  test('Photos looks right', async ({ page }) => {
    await openPhotos(page)

    await expect(page.getByTestId('provider-card')).toHaveCount(2)
    await expect(page).toHaveScreenshot('photos-light.png', { fullPage: true })
  })

  test('Photos looks right with no photos block', async ({ page }) => {
    await openPhotos(page, { configured: false })

    await expect(page).toHaveScreenshot('photos-off-light.png', { fullPage: true })
  })

  test('paints the page with the theme background to the edges', async ({ page }) => {
    await openCalendars(page)

    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(245, 234, 216)')
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(245, 234, 216)')
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'light')
  })
})

test.describe('dark', () => {
  test.use({ colorScheme: 'dark' })

  test('Calendars looks right', async ({ page }) => {
    await openCalendars(page)

    await expect(page).toHaveScreenshot('calendars-dark.png', { fullPage: true })
  })

  test('Displays looks right', async ({ page }) => {
    await openDisplays(page)

    await expect(page).toHaveScreenshot('displays-dark.png', { fullPage: true })
  })

  test('Photos looks right', async ({ page }) => {
    await openPhotos(page)

    await expect(page.getByTestId('provider-card')).toHaveCount(2)
    await expect(page).toHaveScreenshot('photos-dark.png', { fullPage: true })
  })

  test('paints the page with the theme background to the edges', async ({ page }) => {
    await openCalendars(page)

    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(46, 43, 37)')
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(46, 43, 37)')
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
  })
})

test.describe('Stars', () => {
  test('looks right on a laptop', async ({ page }) => {
    await openStars(page)

    await expect(page).toHaveScreenshot('stars-light.png', { fullPage: true })
  })

  test.describe('on a phone, dark', () => {
    test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })

    test('looks right', async ({ page }) => {
      await openStars(page)

      await expect(page).toHaveScreenshot('stars-phone-dark.png', { fullPage: true })
    })
  })
})

test.describe('on a tablet held upright', () => {
  test.use({ viewport: { width: 768, height: 1024 } })

  test('Calendars looks right', async ({ page }) => {
    await openCalendars(page)

    await expect(page).toHaveScreenshot('calendars-tablet.png', { fullPage: true })
  })

  test('Displays looks right', async ({ page }) => {
    await openDisplays(page)

    await expect(page).toHaveScreenshot('displays-tablet.png', { fullPage: true })
  })
})

test('Photos refresh asks for the PIN, then refreshes with it', async ({ page }) => {
  await playSettings(page, connections, true)
  const refreshes: (string | undefined)[] = []
  await page.route('**/api/settings/photos/refresh', async (route) => {
    const pin = route.request().headers()['x-wallcal-pin']
    refreshes.push(pin)
    if (pin === '4821') await route.fulfill({ json: photos })
    else await route.fulfill({ status: 401, json: { statusCode: 401, message: 'PIN required' } })
  })
  await page.route('**/api/remote/pin', route => route.fulfill(route.request().headers()['x-wallcal-pin'] === '4821'
    ? { status: 200, body: '' }
    : { status: 401, json: { statusCode: 401, message: 'Wrong PIN' } }))
  await page.goto('/settings/photos')
  await expect(page.getByTestId('provider-card')).toHaveCount(2)
  await fontsReady(page)

  await page.getByTestId('refresh').click()
  await expect(page.getByTestId('pin-dialog')).toBeVisible()
  await page.getByTestId('pin-input').fill('4821')
  await page.getByTestId('pin-submit').click()

  await expect(page.getByTestId('pin-dialog')).toHaveCount(0)
  await expect.poll(() => refreshes).toEqual([undefined, '4821'])
})

test('opens /settings on the Calendars tab, and the tabs move between pages', async ({ page }) => {
  await playSettings(page)
  await page.goto('/settings')

  await expect(page).toHaveURL(/\/settings\/calendars$/)
  await expect(page.getByTestId('tab-calendars')).toHaveAttribute('aria-current', 'page')

  await page.getByTestId('tab-displays').click()

  await expect(page).toHaveURL(/\/settings\/displays$/)
  await expect(page.getByTestId('tab-displays')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('tab-calendars')).not.toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('display-card')).toHaveCount(2)

  await page.getByTestId('tab-photos').click()
  await expect(page.getByTestId('cache-card')).toBeVisible()
  await page.getByTestId('tab-special-days').click()
  // The real server answers the special days (none in the visual config's data folder, or some: either way the page and its list are there).
  await expect(page.getByTestId('special-days-page')).toBeVisible()
  await expect(page.getByTestId('special-days-list')).toBeVisible()
})

test('links back to the remote', async ({ page }) => {
  await playSettings(page)
  await page.goto('/settings/calendars')

  const link = page.getByTestId('remote-link')
  await expect(link).toHaveAttribute('href', '/remote')
  await link.click()

  await expect(page).toHaveURL(/\/remote$/)
  await expect(page.getByTestId('remote')).toBeVisible()
})

test('Refresh now asks for the PIN, then refreshes with it', async ({ page }) => {
  await playSettings(page, connections, true)
  const refreshes: (string | undefined)[] = []
  await page.route('**/api/refresh', async (route) => {
    const pin = route.request().headers()['x-wallcal-pin']
    refreshes.push(pin)
    if (pin === '4821') await route.fulfill({ json: { calendars: [] } })
    else await route.fulfill({ status: 401, json: { statusCode: 401, message: 'PIN required' } })
  })
  await page.route('**/api/remote/pin', route => route.fulfill(route.request().headers()['x-wallcal-pin'] === '4821'
    ? { status: 200, body: '' }
    : { status: 401, json: { statusCode: 401, message: 'Wrong PIN' } }))
  await page.goto('/settings/calendars')
  await expect(page.getByTestId('calendar-card')).toHaveCount(3)
  await fontsReady(page)

  await page.getByTestId('refresh').click()
  await expect(page.getByTestId('pin-dialog')).toBeVisible()
  await expect(page.getByTestId('pin-input')).toBeFocused()
  await page.getByTestId('pin-input').fill('1111')
  await page.getByTestId('pin-submit').click()
  await expect(page.getByTestId('pin-message')).toHaveText('Wrong PIN')
  // The window, not the whole page: the dialog's scrim covers the window.
  await expect(page).toHaveScreenshot('pin-dialog.png')

  await page.getByTestId('pin-input').fill('4821')
  await page.getByTestId('pin-submit').click()

  await expect(page.getByTestId('pin-dialog')).toHaveCount(0)
  await expect.poll(() => refreshes).toEqual([undefined, '4821'])
  // The PIN is kept under the remote's key, so the remote on this browser won't ask again.
  expect(await page.evaluate(() => localStorage.getItem('wallcal.remote.pin'))).toBe('4821')
})
