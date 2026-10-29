import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import App from '~/app.vue'
import CalendarsPage from '~/pages/settings/calendars.vue'
import DisplaysPage from '~/pages/settings/displays.vue'
import { displayStateSchema } from '../../shared/display'
import type { DisplayState } from '../../shared/display'
import { PIN_ERRORS, PIN_HEADER } from '../../shared/remote'
import type { CalendarStatus, ConnectionsStatus, DiscoveryResult, DisplayStatus } from '../../shared/settings'

// The settings pages against a pretend server: `$fetch` is replaced by one
// that answers as the real routes do (architecture §7.6, shared/settings.ts),
// and every request it gets is recorded. The looks are in test/visual/settings.spec.ts.

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

// Wed 28 Oct 2026, 09:41 in London.
const NOW = new Date('2026-10-28T09:41:00Z')

const mum = { id: 'mum', name: 'Mum', initial: 'M', colour: '#C67139' }
const household = { id: 'home', name: 'Household', initial: 'H', colour: '#D9A93F' }

const calendar = (changes: Partial<CalendarStatus> = {}): CalendarStatus => ({
  id: 'family',
  name: 'Family',
  person: household,
  detect_people: true,
  detect_in: ['title', 'description'],
  source_type: 'ics',
  poll_seconds: 900,
  syncing: true,
  last_attempt_at: '2026-10-28T09:39:00Z',
  last_success_at: '2026-10-28T09:39:00Z',
  last_error: null,
  event_count: 124,
  fallbacks: [],
  ...changes,
})

const display = (changes: Partial<DisplayStatus> = {}): DisplayStatus => ({
  id: 'hallway',
  name: 'Hallway',
  theme: 'light',
  month_style: 'soft',
  state: displayStateSchema.parse({ view: 'agenda', brightness: 80 }),
  sockets: { display: 1, remote: 2 },
  mqtt: 'connected',
  mqtt_error: null,
  ...changes,
})

const connections = (changes: { mqtt?: Partial<ConnectionsStatus['mqtt']>, homeassistant?: Partial<ConnectionsStatus['homeassistant']> } = {}): ConnectionsStatus => ({
  mqtt: { configured: true, broker: 'mqtt://mosquitto:1883', discovery: true, connected: 2, total: 2, ...changes.mqtt },
  homeassistant: { configured: false, state: 'off', error: null, checked_at: null, ...changes.homeassistant },
})

// What the pretend server holds, and what it was asked.
let calendars: CalendarStatus[]
let displays: DisplayStatus[]
let status: ConnectionsStatus
let pin: string | null
let lockedOut: boolean
let unreachable: boolean
let requests: { method: string, url: string, pin: string | null }[]
let discovery: () => DiscoveryResult
let refreshed: () => void
/** Holds /api/refresh's answer until it is let go, for a test that looks at the page meanwhile. */
let holdRefresh: Promise<void> | null

/** A failed request as `$fetch` throws it: the status, and the body the server's errors carry. */
function refusal(code: number, message: string) {
  return Object.assign(new Error(`${code}`), { statusCode: code, data: { statusCode: code, message } })
}

interface Options { method?: string, headers?: Record<string, string> }

async function server(url: string, options: Options = {}) {
  const method = options.method ?? 'GET'
  const sentPin = options.headers?.[PIN_HEADER] ?? null
  requests.push({ method, url, pin: sentPin })
  if (unreachable) throw new TypeError('Failed to fetch')

  // Reads are open; every write needs the PIN, if there is one.
  if (method === 'GET') {
    if (url === '/api/settings/calendars') return structuredClone(calendars)
    if (url === '/api/settings/displays') return structuredClone(displays)
    if (url === '/api/settings/connections') return structuredClone(status)
    if (url === '/api/displays') return [{ id: 'hallway', name: 'Hallway', theme: 'light', month_style: 'soft', week_start: 'monday', timezone: 'Europe/London' }]
    throw refusal(404, `Not found: ${url}`)
  }
  if (url === '/api/remote/pin') {
    if (lockedOut) throw refusal(429, PIN_ERRORS.locked)
    if (sentPin !== pin) throw refusal(401, PIN_ERRORS.wrong)
    return undefined
  }
  if (lockedOut) throw refusal(429, PIN_ERRORS.locked)
  if (pin !== null && sentPin === null) throw refusal(401, PIN_ERRORS.missing)
  if (pin !== null && sentPin !== pin) throw refusal(401, PIN_ERRORS.wrong)
  if (url === '/api/refresh') {
    await holdRefresh
    refreshed()
    return { calendars: [] }
  }
  if (url === '/api/settings/discovery') return discovery()
  throw refusal(404, `Not found: ${url}`)
}

const writes = () => requests.filter(request => request.method === 'POST' && request.url !== '/api/remote/pin')
const gets = (url: string) => requests.filter(request => request.method === 'GET' && request.url === url)

// Every page polls, so one left mounted would go on asking (and listening for the tab) through the next test.
const mounted: { unmount: () => void }[] = []

/** Mounts a tab's page on its own, or the whole app (the shell, with its tab's page in it) when given `App`. */
async function mountAt(page: Parameters<typeof mountSuspended>[0], route: string) {
  const wrapper = await mountSuspended(page, { route })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  fetchMock.mockImplementation(server)
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  calendars = [calendar()]
  displays = [display()]
  status = connections()
  pin = null
  lockedOut = false
  unreachable = false
  requests = []
  discovery = () => ({ republished: ['hallway'] })
  refreshed = () => {}
  holdRefresh = null
  localStorage.clear()
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the settings shell', () => {
  it.each([
    ['/settings/calendars', 'Calendars'],
    ['/settings/photos', 'Photos'],
    ['/settings/special-days', 'Special days'],
    ['/settings/displays', 'Displays'],
  ])('shows the four tabs, with the one for %s marked as the current page', async (route, active) => {
    const wrapper = await mountAt(App, route)

    expect(wrapper.find('h1').text()).toBe('Settings')
    const tabs = wrapper.findAll('nav a')
    expect(tabs.map(tab => tab.text())).toEqual(['Calendars', 'Photos', 'Special days', 'Displays'])
    expect(tabs.filter(tab => tab.attributes('aria-current') === 'page').map(tab => tab.text())).toEqual([active])
    expect(tabs.map(tab => tab.attributes('href'))).toEqual(['/settings/calendars', '/settings/photos', '/settings/special-days', '/settings/displays'])
  })

  it('shows the tab\'s page below the tabs', async () => {
    const photos = await mountAt(App, '/settings/photos')
    expect(photos.find('[data-testid="photos-placeholder"]').text()).toContain('Photos arrive with photo frame mode')

    const days = await mountAt(App, '/settings/special-days')
    expect(days.find('[data-testid="special-days-placeholder"]').text()).toContain('Special days arrive')

    const calendarsTab = await mountAt(App, '/settings/calendars')
    expect(calendarsTab.findAll('[data-testid="calendar-card"]')).toHaveLength(1)
  })

  it('opens /settings on the Calendars tab', async () => {
    const wrapper = await mountAt(App, '/settings')

    expect(useRouter().currentRoute.value.path).toBe('/settings/calendars')
    expect(wrapper.find('nav a[aria-current="page"]').text()).toBe('Calendars')
  })

  it('paints <html> with the theme\'s colours, following the device', async () => {
    await mountAt(App, '/settings/calendars')

    expect(document.documentElement.getAttribute('data-settings')).toBe('light')
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('var(--color-bg)')
  })

  describe('the connection chips', () => {
    // The chip's name, then its state, as it reads on the page.
    const read = (chip: ReturnType<Awaited<ReturnType<typeof mountAt>>['find']>) => `${chip.find('.name').text()} ${chip.find('.state').text()}`
    const chips = (wrapper: Awaited<ReturnType<typeof mountAt>>) => ({
      mqtt: read(wrapper.find('[data-testid="chip-mqtt"]')),
      homeAssistant: read(wrapper.find('[data-testid="chip-homeassistant"]')),
    })

    it('says everything is connected, with Home Assistant not set up', async () => {
      const wrapper = await mountAt(App, '/settings/photos')

      expect(chips(wrapper)).toEqual({ mqtt: 'MQTT Connected', homeAssistant: 'Home Assistant Not set up' })
    })

    it('counts the displays when only some are connected', async () => {
      status = connections({ mqtt: { connected: 1 } })
      const wrapper = await mountAt(App, '/settings/photos')

      expect(chips(wrapper).mqtt).toBe('MQTT 1 of 2 connected')
    })

    it('says Disconnected, and Off with no MQTT in the config', async () => {
      status = connections({ mqtt: { connected: 0 } })
      expect(chips(await mountAt(App, '/settings/photos')).mqtt).toBe('MQTT Disconnected')

      status = connections({ mqtt: { configured: false, broker: null, discovery: false, connected: 0, total: 0 } })
      expect(chips(await mountAt(App, '/settings/photos')).mqtt).toBe('MQTT Off')
    })

    it('says why Home Assistant is unreachable, under the chip and as its tooltip', async () => {
      status = connections({ homeassistant: { configured: true, state: 'error', error: 'Home Assistant refused the token', checked_at: '2026-10-28T09:40:00Z' } })
      const wrapper = await mountAt(App, '/settings/photos')
      const chip = wrapper.find('[data-testid="chip-homeassistant"]')

      expect(chip.find('.state').text()).toBe('Unreachable')
      expect(chip.find('.detail').text()).toBe('Home Assistant refused the token')
      expect(chip.attributes('title')).toBe('Home Assistant refused the token')
    })

    it('says Unknown when the server can\'t be asked', async () => {
      unreachable = true
      const wrapper = await mountAt(App, '/settings/photos')

      expect(chips(wrapper)).toEqual({ mqtt: 'MQTT Unknown', homeAssistant: 'Home Assistant Unknown' })
    })
  })
})

describe('the Calendars tab', () => {
  const card = (wrapper: Awaited<ReturnType<typeof mountAt>>, id = 'family') => wrapper.find(`[data-calendar="${id}"]`)
  const text = (wrapper: Awaited<ReturnType<typeof mountAt>>, testid: string, id = 'family') => card(wrapper, id).find(`[data-testid="${testid}"]`).text()

  it('shows a calendar\'s name, source, default person, detection, interval, last sync and events', async () => {
    const wrapper = await mountAt(CalendarsPage, '/settings/calendars')

    expect(text(wrapper, 'calendar-name')).toBe('Family')
    expect(text(wrapper, 'calendar-source')).toBe('ICS feed')
    expect(card(wrapper).find('.person-name').text()).toBe('Household')
    expect(card(wrapper).find('.person-role').text()).toBe('Default person')
    expect(text(wrapper, 'calendar-detection')).toBe('Title and description')
    expect(text(wrapper, 'calendar-poll')).toBe('Every 15 minutes')
    expect(text(wrapper, 'calendar-last-sync')).toBe('2 minutes ago')
    expect(card(wrapper).find('[data-testid="calendar-last-sync"]').attributes('title')).toBe('Wed 28 Oct 2026, 09:39')
    expect(text(wrapper, 'calendar-events')).toBe('124')
    expect(card(wrapper).find('[data-testid="calendar-error"]').exists()).toBe(false)
  })

  it('gives the default person a badge in their colour', async () => {
    const wrapper = await mountAt(CalendarsPage, '/settings/calendars')

    expect(card(wrapper).find('.badge').attributes('style')).toContain('background: #D9A93F')
    expect(card(wrapper).find('.badge').text()).toBe('H')
  })

  it('shows the last error in an alert, with when it was tried', async () => {
    calendars = [calendar({ id: 'bins', name: 'Bins', source_type: 'homeassistant', person: mum, last_error: 'Home Assistant refused the token', last_success_at: null, last_attempt_at: '2026-10-28T09:36:00Z' })]
    const wrapper = await mountAt(CalendarsPage, '/settings/calendars')

    const error = card(wrapper, 'bins').find('[data-testid="calendar-error"]')
    expect(error.attributes('role')).toBe('alert')
    expect(error.find('.error-title').text()).toBe('Last sync failed · 5 minutes ago')
    expect(error.find('.error-message').text()).toBe('Home Assistant refused the token')
    expect(text(wrapper, 'calendar-source', 'bins')).toBe('Home Assistant')
    expect(text(wrapper, 'calendar-last-sync', 'bins')).toBe('Never')
    expect(card(wrapper, 'bins').find('[data-testid="calendar-last-sync"]').attributes('title')).toBeUndefined()
  })

  it('says why a source with no sync has no sync time', async () => {
    calendars = [calendar({ syncing: false, last_attempt_at: null, last_success_at: null })]
    const wrapper = await mountAt(CalendarsPage, '/settings/calendars')

    expect(text(wrapper, 'calendar-last-sync')).toBe('Not synced: this source type has no sync yet')
    expect(text(wrapper, 'calendar-poll')).toBe('Not polled')
  })

  it('lists what fell back to the default person, with its day and how often', async () => {
    calendars = [calendar({
      fallbacks: [
        { title: 'Parents\' evening', start: '2026-10-28T17:00:00Z', all_day: false, start_date: null, occurrences: 1 },
        { title: 'Bin day', start: '2026-10-29T00:00:00Z', all_day: true, start_date: '2026-10-29', occurrences: 1 },
        { title: 'Violin', start: '2026-10-31T10:00:00Z', all_day: false, start_date: null, occurrences: 4 },
      ],
    })]
    const wrapper = await mountAt(CalendarsPage, '/settings/calendars')

    expect(card(wrapper).find('.subhead').text()).toBe('Fell back to Household')
    const rows = card(wrapper).findAll('[data-testid="fallback"]').map(row => [row.find('.row-title').text(), row.find('.row-date').text()])
    expect(rows).toEqual([
      ['Parents\' evening', 'Today'],
      ['Bin day', 'Tomorrow'],
      ['Violin', 'Sat 31 Oct · 4 times'],
    ])
    expect(card(wrapper).find('[data-testid="no-fallbacks"]').exists()).toBe(false)
  })

  it('says so when every recent event matched', async () => {
    const wrapper = await mountAt(CalendarsPage, '/settings/calendars')

    expect(text(wrapper, 'no-fallbacks')).toBe('Every recent event matched a name or a rule.')
  })

  it('says every event goes to the default person when detection is off, and lists nothing', async () => {
    calendars = [calendar({ id: 'dad', name: 'Dad\'s work', person: { id: 'dad', name: 'Dad', initial: 'D', colour: '#7A8A5E' }, detect_people: false })]
    const wrapper = await mountAt(CalendarsPage, '/settings/calendars')

    expect(text(wrapper, 'calendar-detection', 'dad')).toBe('Off')
    expect(text(wrapper, 'calendar-detection-off', 'dad')).toBe('Name detection is off, so every event goes to Dad.')
    expect(card(wrapper, 'dad').find('[data-testid="calendar-fallbacks"]').exists()).toBe(false)
  })

  it('says how a name is looked for', async () => {
    calendars = [calendar({ detect_people: 'anywhere', detect_in: ['description'] })]
    const wrapper = await mountAt(CalendarsPage, '/settings/calendars')

    expect(text(wrapper, 'calendar-detection')).toBe('Anywhere in description')
  })

  it('says so when there are no calendars', async () => {
    calendars = []
    const wrapper = await mountAt(CalendarsPage, '/settings/calendars')

    expect(wrapper.find('[data-testid="no-calendars"]').exists()).toBe(true)
  })

  describe('Refresh now', () => {
    it('posts to /api/refresh, says it is working, then reloads the list', async () => {
      const wrapper = await mountAt(CalendarsPage, '/settings/calendars')
      expect(wrapper.find('[data-testid="refresh"]').text()).toBe('Refresh now')
      expect(text(wrapper, 'calendar-events')).toBe('124')

      // The server takes its time: hold the answer until the test lets it go.
      let finish = () => {}
      holdRefresh = new Promise<void>((resolve) => {
        finish = resolve
      })
      refreshed = () => {
        calendars = [calendar({ event_count: 130, last_success_at: '2026-10-28T09:41:00Z' })]
      }
      const readsBefore = gets('/api/settings/calendars').length

      await wrapper.find('[data-testid="refresh"]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="refresh"]').text()).toBe('Refreshing…')
      expect(wrapper.find('[data-testid="refresh"]').attributes('disabled')).toBeDefined()
      expect(writes()).toEqual([{ method: 'POST', url: '/api/refresh', pin: null }])

      finish()
      await flushPromises()

      expect(wrapper.find('[data-testid="refresh"]').text()).toBe('Refresh now')
      expect(gets('/api/settings/calendars').length).toBe(readsBefore + 1)
      expect(text(wrapper, 'calendar-events')).toBe('130')
      expect(text(wrapper, 'calendar-last-sync')).toBe('Just now')
    })

    it('says so inline when it can\'t be done, and the button works again', async () => {
      const wrapper = await mountAt(CalendarsPage, '/settings/calendars')
      fetchMock.mockImplementation(async (url: string, options: Options) => {
        if (url === '/api/refresh') throw refusal(500, 'boom')
        return server(url, options)
      })

      await wrapper.find('[data-testid="refresh"]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="refresh-error"]').text()).toBe('The server couldn\'t refresh the calendars')
      expect(wrapper.find('[data-testid="refresh"]').attributes('disabled')).toBeUndefined()
      expect(wrapper.find('[data-testid="pin-dialog"]').exists()).toBe(false)
    })

    it('says the server can\'t be reached, when it can\'t', async () => {
      const wrapper = await mountAt(CalendarsPage, '/settings/calendars')
      unreachable = true

      await wrapper.find('[data-testid="refresh"]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="refresh-error"]').text()).toBe('Couldn\'t reach the server')
    })
  })
})

describe('the Displays tab', () => {
  const card = (wrapper: Awaited<ReturnType<typeof mountAt>>, id = 'hallway') => wrapper.find(`[data-display="${id}"]`)
  const text = (wrapper: Awaited<ReturnType<typeof mountAt>>, testid: string, id = 'hallway') => card(wrapper, id).find(`[data-testid="${testid}"]`).text()

  it('shows each display\'s connections and what is on the wall', async () => {
    const wrapper = await mountAt(DisplaysPage, '/settings/displays')

    expect(text(wrapper, 'display-name')).toBe('Hallway')
    expect(text(wrapper, 'display-id')).toBe('hallway')
    expect(text(wrapper, 'display-wall')).toBe('Connected')
    expect(text(wrapper, 'display-remotes')).toBe('2 connected')
    expect(text(wrapper, 'display-mqtt')).toBe('Connected')
    expect(text(wrapper, 'display-view')).toBe('Agenda')
    expect(text(wrapper, 'display-screen')).toBe('On')
    expect(text(wrapper, 'display-brightness')).toBe('80%')
    expect(text(wrapper, 'display-month')).toBe('This month')
    expect(text(wrapper, 'display-photos')).toBe('Immich')
    expect(card(wrapper).find('[data-testid="display-overlay"]').exists()).toBe(false)
  })

  it('shows a display that is not connected, with the MQTT error, and a pinned month', async () => {
    displays = [display({
      id: 'kitchen',
      name: 'Kitchen',
      theme: 'dark',
      state: displayStateSchema.parse({ view: 'month', month: '2026-11', screen: 'off', photo_source: 'google' }),
      sockets: { display: 0, remote: 0 },
      mqtt: 'disconnected',
      mqtt_error: 'Connection refused',
    })]
    const wrapper = await mountAt(DisplaysPage, '/settings/displays')

    expect(text(wrapper, 'display-wall', 'kitchen')).toBe('Not connected')
    expect(text(wrapper, 'display-remotes', 'kitchen')).toBe('None connected')
    expect(card(wrapper, 'kitchen').find('[data-testid="display-mqtt"] .state').text()).toBe('Disconnected')
    expect(card(wrapper, 'kitchen').find('[data-testid="display-mqtt"] .detail').text()).toBe('Connection refused')
    expect(text(wrapper, 'display-screen', 'kitchen')).toBe('Off (standby)')
    expect(text(wrapper, 'display-month', 'kitchen')).toBe('November 2026')
    expect(text(wrapper, 'display-photos', 'kitchen')).toBe('Google Photos')
  })

  it('shows the message on the wall while it is showing, and not after it has run out', async () => {
    const overlay = (until: string | null): DisplayState['overlay'] => ({ text: 'Bins out tonight', icon: 'trash', until })
    displays = [display({ state: displayStateSchema.parse({ overlay: overlay('2026-10-28T14:30:00Z') }) })]
    let wrapper = await mountAt(DisplaysPage, '/settings/displays')
    expect(card(wrapper).find('.message-label').text()).toBe('Message on the wall')
    expect(text(wrapper, 'display-overlay')).toContain('Bins out tonight')

    displays = [display({ state: displayStateSchema.parse({ overlay: overlay('2026-10-28T09:00:00Z') }) })]
    wrapper = await mountAt(DisplaysPage, '/settings/displays')
    expect(card(wrapper).find('[data-testid="display-overlay"]').exists()).toBe(false)
  })

  describe('Republish discovery', () => {
    const button = (wrapper: Awaited<ReturnType<typeof mountAt>>) => wrapper.find('[data-testid="republish"]')

    it('is disabled, with the reason, when MQTT is off', async () => {
      status = connections({ mqtt: { configured: false, broker: null, discovery: false, connected: 0, total: 0 } })
      const wrapper = await mountAt(DisplaysPage, '/settings/displays')

      expect(button(wrapper).attributes('disabled')).toBeDefined()
      expect(wrapper.find('[data-testid="republish-reason"]').text()).toMatch(/^MQTT is off/)
      expect(button(wrapper).attributes('aria-describedby')).toBe('republish-reason')

      await button(wrapper).trigger('click')
      await flushPromises()
      expect(writes()).toEqual([])
    })

    it('is disabled, with the reason, when discovery is off', async () => {
      status = connections({ mqtt: { discovery: false } })
      const wrapper = await mountAt(DisplaysPage, '/settings/displays')

      expect(button(wrapper).attributes('disabled')).toBeDefined()
      expect(wrapper.find('[data-testid="republish-reason"]').text()).toMatch(/^Discovery is off/)
    })

    it('posts, and says which displays it was published for', async () => {
      displays = [display(), display({ id: 'kitchen', name: 'Kitchen' })]
      discovery = () => ({ republished: ['hallway', 'kitchen'] })
      const wrapper = await mountAt(DisplaysPage, '/settings/displays')

      expect(button(wrapper).attributes('disabled')).toBeUndefined()
      expect(wrapper.find('[data-testid="republish-reason"]').exists()).toBe(false)

      await button(wrapper).trigger('click')
      await flushPromises()

      expect(writes()).toEqual([{ method: 'POST', url: '/api/settings/discovery', pin: null }])
      expect(wrapper.find('[data-testid="republish-outcome"]').text()).toBe('Discovery published for Hallway and Kitchen.')
    })

    it('says when it was published for none', async () => {
      discovery = () => ({ republished: [] })
      const wrapper = await mountAt(DisplaysPage, '/settings/displays')

      await button(wrapper).trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="republish-outcome"]').text()).toBe('Discovery was not published for any display.')
    })

    it('shows the server\'s own message when it answers 409', async () => {
      discovery = () => {
        throw refusal(409, 'MQTT discovery is turned off in the config')
      }
      const wrapper = await mountAt(DisplaysPage, '/settings/displays')

      await button(wrapper).trigger('click')
      await flushPromises()

      const outcome = wrapper.find('[data-testid="republish-outcome"]')
      expect(outcome.text()).toBe('MQTT discovery is turned off in the config')
      expect(outcome.attributes('role')).toBe('alert')
    })
  })
})

describe('the PIN', () => {
  const dialog = (wrapper: Awaited<ReturnType<typeof mountAt>>) => wrapper.find('[data-testid="pin-dialog"]')

  it('is never asked for when the server has none set', async () => {
    const wrapper = await mountAt(CalendarsPage, '/settings/calendars')

    await wrapper.find('[data-testid="refresh"]').trigger('click')
    await flushPromises()

    expect(dialog(wrapper).exists()).toBe(false)
    expect(requests.some(request => request.url === '/api/remote')).toBe(false)
  })

  it('opens the dialog on a 401, and sends the action again with the PIN once it is right', async () => {
    pin = '4821'
    const wrapper = await mountAt(CalendarsPage, '/settings/calendars')

    await wrapper.find('[data-testid="refresh"]').trigger('click')
    await flushPromises()

    expect(dialog(wrapper).exists()).toBe(true)
    // Asked for a PIN, not told it was wrong: there was none to be wrong.
    expect(wrapper.find('[data-testid="pin-message"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="pin-input"]').attributes('inputmode')).toBe('numeric')
    expect(writes()).toEqual([{ method: 'POST', url: '/api/refresh', pin: null }])
    expect(wrapper.find('[data-testid="refresh"]').attributes('disabled')).toBeUndefined()

    // A wrong PIN is turned down, and not kept.
    await wrapper.find('[data-testid="pin-input"]').setValue('1111')
    await dialog(wrapper).find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[data-testid="pin-message"]').text()).toBe(PIN_ERRORS.wrong)
    expect(localStorage.getItem('wallcal.remote.pin')).toBeNull()
    expect(writes()).toHaveLength(1)

    // The right one is kept, under the remote's key, and the refresh goes again with it.
    await wrapper.find('[data-testid="pin-input"]').setValue('4821')
    await dialog(wrapper).find('form').trigger('submit')
    await flushPromises()

    expect(dialog(wrapper).exists()).toBe(false)
    expect(localStorage.getItem('wallcal.remote.pin')).toBe('4821')
    expect(writes().at(-1)).toEqual({ method: 'POST', url: '/api/refresh', pin: '4821' })
    expect(writes()).toHaveLength(2)
  })

  it('uses a PIN the remote kept, without asking', async () => {
    pin = '4821'
    localStorage.setItem('wallcal.remote.pin', '4821')
    const wrapper = await mountAt(CalendarsPage, '/settings/calendars')

    await wrapper.find('[data-testid="refresh"]').trigger('click')
    await flushPromises()

    expect(dialog(wrapper).exists()).toBe(false)
    expect(writes()).toEqual([{ method: 'POST', url: '/api/refresh', pin: '4821' }])
  })

  it('forgets a kept PIN the server no longer accepts, and says it was wrong', async () => {
    pin = '4821'
    localStorage.setItem('wallcal.remote.pin', '0000')
    const wrapper = await mountAt(CalendarsPage, '/settings/calendars')

    await wrapper.find('[data-testid="refresh"]').trigger('click')
    await flushPromises()

    expect(localStorage.getItem('wallcal.remote.pin')).toBeNull()
    expect(wrapper.find('[data-testid="pin-message"]').text()).toBe(PIN_ERRORS.wrong)
  })

  it('asks on the Displays tab too, and republishes once it is right', async () => {
    pin = '4821'
    const wrapper = await mountAt(DisplaysPage, '/settings/displays')

    await wrapper.find('[data-testid="republish"]').trigger('click')
    await flushPromises()
    expect(dialog(wrapper).exists()).toBe(true)

    await wrapper.find('[data-testid="pin-input"]').setValue('4821')
    await dialog(wrapper).find('form').trigger('submit')
    await flushPromises()

    expect(writes().at(-1)).toEqual({ method: 'POST', url: '/api/settings/discovery', pin: '4821' })
    expect(dialog(wrapper).exists()).toBe(false)
    expect(wrapper.find('[data-testid="republish-outcome"]').text()).toBe('Discovery published for Hallway.')
  })

  it('says so when the server has locked this browser out', async () => {
    pin = '4821'
    lockedOut = true
    const wrapper = await mountAt(CalendarsPage, '/settings/calendars')

    await wrapper.find('[data-testid="refresh"]').trigger('click')
    await flushPromises()

    expect(dialog(wrapper).exists()).toBe(true)
    expect(wrapper.find('[data-testid="pin-message"]').text()).toBe(PIN_ERRORS.locked)
  })

  it('does not send anything that is not 4 to 12 digits', async () => {
    pin = '4821'
    const wrapper = await mountAt(CalendarsPage, '/settings/calendars')
    await wrapper.find('[data-testid="refresh"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-testid="pin-input"]').setValue('12')
    await dialog(wrapper).find('form').trigger('submit')
    await flushPromises()

    expect(requests.some(request => request.url === '/api/remote/pin')).toBe(false)
    expect(wrapper.find('[data-testid="pin-message"]').text()).toBe('Enter 4 to 12 digits')
  })

  it('can be put off, which drops the action that was refused', async () => {
    pin = '4821'
    const wrapper = await mountAt(CalendarsPage, '/settings/calendars')
    await wrapper.find('[data-testid="refresh"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-testid="pin-cancel"]').trigger('click')

    expect(dialog(wrapper).exists()).toBe(false)
    expect(writes()).toHaveLength(1)
  })
})

describe('polling', () => {
  let hidden = false

  function setHidden(next: boolean) {
    hidden = next
    document.dispatchEvent(new Event('visibilitychange'))
  }

  beforeEach(() => {
    hidden = false
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  })

  /**
   * Mounts a tab on its own with the timers faked, so a test can move the clock.
   * Going to its route loads its page, which needs the real timers, so that is done first.
   */
  async function mountPolled(page: Parameters<typeof mountSuspended>[0], route: string) {
    vi.useRealTimers()
    await useRouter().push(route)
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW })
    return mountAt(page, route)
  }

  it('asks the calendars again every 15 seconds, and picks up what changed', async () => {
    const wrapper = await mountPolled(CalendarsPage, '/settings/calendars')
    expect(gets('/api/settings/calendars')).toHaveLength(1)

    calendars = [calendar({ event_count: 99 })]
    await vi.advanceTimersByTimeAsync(14_000)
    expect(gets('/api/settings/calendars')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)

    expect(gets('/api/settings/calendars')).toHaveLength(2)
    expect(wrapper.find('[data-testid="calendar-events"]').text()).toBe('99')
  })

  it('asks the displays every 5 seconds', async () => {
    const wrapper = await mountPolled(DisplaysPage, '/settings/displays')
    expect(gets('/api/settings/displays')).toHaveLength(1)

    displays = [display({ sockets: { display: 0, remote: 0 } })]
    await vi.advanceTimersByTimeAsync(5000)

    expect(gets('/api/settings/displays')).toHaveLength(2)
    expect(wrapper.find('[data-testid="display-wall"]').text()).toBe('Not connected')
  })

  it('stops while the tab is hidden, and asks at once when it is back', async () => {
    await mountPolled(CalendarsPage, '/settings/calendars')

    setHidden(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(gets('/api/settings/calendars')).toHaveLength(1)

    setHidden(false)
    await flushPromises()
    expect(gets('/api/settings/calendars')).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(15_000)
    expect(gets('/api/settings/calendars')).toHaveLength(3)
  })

  it('does not start the next wait after a fetch that ended while the tab was hidden', async () => {
    await mountPolled(CalendarsPage, '/settings/calendars')
    await vi.advanceTimersByTimeAsync(14_999)
    hidden = true
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(gets('/api/settings/calendars')).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(60_000)

    expect(gets('/api/settings/calendars')).toHaveLength(2)
  })

  it('stops for good when the page goes', async () => {
    const wrapper = await mountPolled(CalendarsPage, '/settings/calendars')

    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(60_000)
    setHidden(true)
    setHidden(false)
    await flushPromises()

    expect(gets('/api/settings/calendars')).toHaveLength(1)
  })

  it('keeps the last data and says it couldn\'t reach the server when a poll fails, then recovers', async () => {
    const wrapper = await mountPolled(CalendarsPage, '/settings/calendars')
    expect(wrapper.find('[data-testid="unreachable"]').exists()).toBe(false)

    unreachable = true
    await vi.advanceTimersByTimeAsync(15_000)

    expect(wrapper.find('[data-testid="unreachable"]').text()).toBe('Couldn\'t reach the server')
    expect(wrapper.find('[data-testid="calendar-name"]').text()).toBe('Family')

    // It keeps trying.
    unreachable = false
    await vi.advanceTimersByTimeAsync(15_000)

    expect(wrapper.find('[data-testid="unreachable"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="calendar-name"]').text()).toBe('Family')
  })

  it('has no calendars to show, only the note, when the first fetch fails', async () => {
    unreachable = true
    const wrapper = await mountPolled(CalendarsPage, '/settings/calendars')

    expect(wrapper.find('[data-testid="unreachable"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="calendar-card"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="loading"]').exists()).toBe(false)
  })
})
