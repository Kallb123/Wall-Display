import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import DisplayPage from '~/pages/display.vue'
import { burnInOffset, pillCorner } from '~/utils/burnIn'
import { PALETTES, THEMES } from '~/utils/themes'
import { displayStateSchema } from '../../shared/display'
import type { DisplayState } from '../../shared/display'
import type { SpecialDaysResolution, Takeover } from '../../shared/special-days'
import type { CalendarEvent } from '../../shared/types/events'

// The wall page and what it does with special days (architecture §6): the
// takeover's palette, art and greeting, a takeover that is out of date, the
// photo and night views, a preview, and the evening preload. The looks are in
// test/visual/special-days.spec.ts. The server is pretended: `$fetch` answers
// as the routes do, the socket is one the test pushes messages through, and
// only the clock is faked (the page ticks on setInterval).

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

class FakeSocket {
  static all: FakeSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {
    FakeSocket.all.push(this)
  }

  close() {}
  push(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

class FakeImage {
  static all: FakeImage[] = []
  static broken = false
  src = ''
  decoded = 0
  constructor() {
    FakeImage.all.push(this)
  }

  decode() {
    this.decoded++
    return FakeImage.broken ? Promise.reject(new Error('broken')) : Promise.resolve()
  }
}

// Halloween 2026, a Saturday, at 10:00 in London (the clocks went back on the 25th).
const NOW = new Date('2026-10-31T10:00:00Z')

const halloween: Takeover = { id: 'halloween', name: 'Halloween', date: '2026-10-31', greeting: 'Happy Halloween', palette: 'night', full_art: 'wall.webp', extra_art: 'bat.png' }
const resolution = (changes: Partial<SpecialDaysResolution> = {}): SpecialDaysResolution => ({
  today: '2026-10-31',
  from: '2026-09-28',
  to: '2026-12-13',
  tiles: [{ date: '2026-10-31', days: [{ id: 'halloween', name: 'Halloween', palette: 'night', tile_art: 'pumpkin.svg' }] }],
  current: { id: 'halloween', name: 'Halloween' },
  takeover: halloween,
  tomorrow_art: [],
  ...changes,
})
// What the server answers for a preview of Christmas: its own date, takeover and tiles.
const christmas = resolution({
  today: '2026-12-25',
  from: '2026-11-16',
  to: '2027-01-10',
  tiles: [{ date: '2026-12-25', days: [{ id: 'christmas', name: 'Christmas', palette: 'frost', tile_art: 'tree.svg' }] }],
  current: { id: 'christmas', name: 'Christmas' },
  takeover: { id: 'christmas', name: 'Christmas', date: '2026-12-25', greeting: 'Merry Christmas', palette: 'frost', full_art: 'snow.webp', extra_art: null },
})

const state = (changes: Partial<DisplayState> = {}): DisplayState => displayStateSchema.parse({ view: 'month', ...changes })

let requests: { url: string, query: Record<string, string> | undefined }[]
/** What `GET /api/special-days/preview` answers, or null to fail. */
let previewAnswer: (query: Record<string, string>) => SpecialDaysResolution | null
/** What the display's settings say beyond the usual: `burn_in` and `night_text`, for the tests of those. */
let settingsExtra: Record<string, unknown>
/** What `GET /api/events` answers. */
let eventsAnswer: CalendarEvent[]

function server(url: string, options?: { query?: Record<string, string> }) {
  requests.push({ url, query: options?.query })
  if (url === '/api/displays') return [{ id: 'hallway', name: 'Hallway', theme: 'light', month_style: 'soft', week_start: 'monday', timezone: 'Europe/London', burn_in: true, night_text: 'none', ...settingsExtra }]
  if (url === '/api/events') return { events: eventsAnswer }
  if (url === '/api/special-days/preview') {
    const answer = previewAnswer(options?.query ?? {})
    if (!answer) throw new Error('Unknown special day')
    return { special_days: answer }
  }
  throw new Error(`Not found: ${url}`)
}

const mounted: { unmount: () => void }[] = []

async function openWall(initial: { state?: DisplayState, specialDays?: SpecialDaysResolution | null } = {}) {
  const wrapper = await mountSuspended(DisplayPage, { route: '/display?id=hallway' })
  mounted.push(wrapper)
  await flushPromises()
  const socket = FakeSocket.all.at(-1)!
  const send = async (message: unknown) => {
    socket.push(message)
    await flushPromises()
  }
  await send({ type: 'state.updated', display_id: 'hallway', state: initial.state ?? state() })
  if (initial.specialDays !== undefined) await send({ type: 'special_days.updated', special_days: initial.specialDays })
  return {
    wrapper,
    stage: () => wrapper.find('[data-testid="stage"]'),
    // Where `element` is in the stage in document order: later is painted over earlier (nothing in the stage has a z-index), whether it sits in the shifting layer or after it like the dimmer.
    positionInStage: (element: Element) => [...wrapper.find('[data-testid="stage"]').element.querySelectorAll('*')].indexOf(element),
    setState: (changes: Partial<DisplayState>) => send({ type: 'state.updated', display_id: 'hallway', state: state(changes) }),
    setAlarm: (next: string | null) => send({ type: 'alarm.updated', alarm: next }),
    setSpecialDays: (next: SpecialDaysResolution | null) => send({ type: 'special_days.updated', special_days: next }),
    // The page ticks on setInterval, which is faked.
    tick: async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms)
      await flushPromises()
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW })
  fetchMock.mockImplementation(server)
  FakeSocket.all = []
  FakeImage.all = []
  FakeImage.broken = false
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('Image', FakeImage)
  requests = []
  settingsExtra = {}
  eventsAnswer = []
  previewAnswer = () => christmas
  localStorage.clear()
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const previewing = () => ({ special_day: 'christmas', until: '2026-10-31T10:01:00.000Z' })

describe('the wall with no special day', () => {
  it('has the display\'s own theme, no art, no badge and no palette', async () => {
    const wall = await openWall({ specialDays: null })

    expect(wall.stage().attributes('data-palette')).toBeUndefined()
    expect(wall.stage().attributes('data-preview')).toBeUndefined()
    expect(wall.stage().attributes('style')).toContain(`--bg: ${THEMES.light.bg}`)
    expect(wall.wrapper.find('[data-testid="takeover-full"]').exists()).toBe(false)
    expect(wall.wrapper.find('[data-testid="preview-badge"]').exists()).toBe(false)
    expect(wall.wrapper.find('[data-testid="greeting"]').exists()).toBe(false)
    expect(wall.wrapper.find('[data-testid="month-view"]').exists()).toBe(true)
  })
})

describe('a takeover today', () => {
  it('swaps in its palette as the theme, whatever the display\'s theme is', async () => {
    const wall = await openWall({ specialDays: resolution() })

    expect(wall.stage().attributes('data-palette')).toBe('night')
    expect(wall.stage().attributes('data-theme')).toBe('light')
    for (const [name, value] of Object.entries({ bg: PALETTES.night.bg, tile: PALETTES.night.tile, accent: PALETTES.night.accent, panel: PALETTES.night.panel })) {
      expect(wall.stage().attributes('style'), name).toContain(`--${name}: ${value}`)
    }
  })

  it('puts its art behind the view, the full art first and the extra art over it', async () => {
    const wall = await openWall({ specialDays: resolution() })

    const layers = wall.stage().findAll('img.takeover-art')
    expect(layers.map(layer => layer.attributes('src'))).toEqual(['/special-days/wall.webp', '/special-days/bat.png'])
    expect(layers.map(layer => layer.attributes('data-testid'))).toEqual(['takeover-full', 'takeover-extra'])
    expect(layers.every(layer => layer.attributes('alt') === '')).toBe(true)
    // Before the view in the stage, so the view is painted over it.
    expect(wall.positionInStage(layers[1]!.element)).toBeLessThan(wall.positionInStage(wall.wrapper.find('[data-testid="month-view"]').element))
  })

  it('draws no layer for art it does not have, and still changes the palette', async () => {
    const wall = await openWall({ specialDays: resolution({ takeover: { ...halloween, full_art: null, extra_art: null } }) })

    expect(wall.wrapper.find('img.takeover-art').exists()).toBe(false)
    expect(wall.stage().attributes('data-palette')).toBe('night')
  })

  it('keeps the display\'s theme for the warm palette, and says so', async () => {
    const wall = await openWall({ specialDays: resolution({ takeover: { ...halloween, palette: 'warm' } }) })

    expect(wall.stage().attributes('data-palette')).toBe('warm')
    expect(wall.stage().attributes('style')).toContain(`--bg: ${THEMES.light.bg}`)
  })

  it('draws the greeting in the month view, and the decorated tiles', async () => {
    const wall = await openWall({ specialDays: resolution() })

    expect(wall.wrapper.find('[data-testid="greeting"]').text()).toBe('Happy Halloween')
    expect(wall.wrapper.find('[data-testid="day-tile"][data-date="2026-10-31"]').attributes('data-special')).toBe('halloween')
    expect(wall.wrapper.find('[data-testid="tile-art"]').attributes('src')).toBe('/special-days/pumpkin.svg')
  })

  it('changes the agenda too, with the greeting above today\'s list', async () => {
    const wall = await openWall({ state: state({ view: 'agenda' }), specialDays: resolution() })

    expect(wall.stage().attributes('data-palette')).toBe('night')
    expect(wall.wrapper.find('[data-testid="agenda-view"] [data-testid="greeting"]').text()).toBe('Happy Halloween')
    expect(wall.wrapper.find('[data-testid="takeover-full"]').exists()).toBe(true)
  })

  it('changes the week view\'s palette and art, which is a stand-in for now', async () => {
    const wall = await openWall({ state: state({ view: 'week' }), specialDays: resolution() })

    expect(wall.stage().attributes('data-palette')).toBe('night')
    expect(wall.wrapper.find('[data-testid="takeover-full"]').exists()).toBe(true)
  })

  it.each(['photo', 'night'] as const)('leaves the %s view alone', async (view) => {
    const wall = await openWall({ state: state({ view }), specialDays: resolution() })

    expect(wall.stage().attributes('data-palette')).toBeUndefined()
    expect(wall.stage().attributes('style')).toContain(`--bg: ${THEMES.light.bg}`)
    expect(wall.wrapper.find('[data-testid="takeover-full"]').exists()).toBe(false)
    expect(wall.wrapper.find('[data-testid="takeover-extra"]').exists()).toBe(false)
  })

  it('starts when the view goes from the photo frame to the calendar, and ends when it goes back', async () => {
    const wall = await openWall({ state: state({ view: 'photo' }), specialDays: resolution() })
    expect(wall.stage().attributes('data-palette')).toBeUndefined()

    await wall.setState({ view: 'month' })
    expect(wall.stage().attributes('data-palette')).toBe('night')

    await wall.setState({ view: 'night' })
    expect(wall.stage().attributes('data-palette')).toBeUndefined()
  })

  it('goes at midnight by the page\'s own clock, before the server says so', async () => {
    const wall = await openWall({ specialDays: resolution() })
    expect(wall.stage().attributes('data-palette')).toBe('night')

    // 00:00:01 on 1 November in London (the clocks have already gone back).
    vi.setSystemTime(new Date('2026-11-01T00:00:01Z'))
    await wall.tick(1000)

    expect(wall.stage().attributes('data-palette')).toBeUndefined()
    expect(wall.wrapper.find('[data-testid="takeover-full"]').exists()).toBe(false)
    expect(wall.wrapper.find('[data-testid="greeting"]').exists()).toBe(false)
    // The tiles stay: the server's resolution covers the range, and its tile for the 31st is still the 31st's.
    expect(wall.wrapper.find('[data-special="halloween"]').exists()).toBe(true)
  })

  it('is not shown from a takeover that is for yesterday', async () => {
    const wall = await openWall({ specialDays: resolution({ today: '2026-10-30', takeover: { ...halloween, date: '2026-10-30' } }) })

    expect(wall.stage().attributes('data-palette')).toBeUndefined()
    expect(wall.wrapper.find('[data-testid="takeover-full"]').exists()).toBe(false)
  })

  it('is not shown from one for tomorrow', async () => {
    const wall = await openWall({ specialDays: resolution({ takeover: { ...halloween, date: '2026-11-01' } }) })

    expect(wall.stage().attributes('data-palette')).toBeUndefined()
  })

  it('is shown from the cache until the server has been heard, if it is for today', async () => {
    localStorage.setItem('wallcal:display:hallway', JSON.stringify({
      settings: { id: 'hallway', name: 'Hallway', theme: 'light', month_style: 'soft', week_start: 'monday', timezone: 'Europe/London' },
      state: state(),
      events: [],
      weather: null,
      special_days: resolution(),
      saved_at: NOW.toISOString(),
    }))
    const wrapper = await mountSuspended(DisplayPage, { route: '/display?id=hallway' })
    mounted.push(wrapper)

    expect(wrapper.find('[data-testid="stage"]').attributes('data-palette')).toBe('night')
  })

  it('is saved to the cache for the next load, and a preview is not', async () => {
    const wall = await openWall({ specialDays: resolution() })
    await wall.setState({ preview: previewing() })

    const cached = JSON.parse(localStorage.getItem('wallcal:display:hallway')!)
    expect(cached.special_days.takeover.id).toBe('halloween')
  })
})

describe('a preview', () => {
  it('asks the server for the day, shows a badge, and shows what it answers in its place', async () => {
    const wall = await openWall({ specialDays: resolution() })
    expect(wall.stage().attributes('data-palette')).toBe('night')

    await wall.setState({ preview: previewing() })

    expect(requests.filter(request => request.url === '/api/special-days/preview')).toEqual([{ url: '/api/special-days/preview', query: { special_day: 'christmas' } }])
    expect(wall.wrapper.find('[data-testid="preview-badge"]').text()).toBe('Preview')
    expect(wall.stage().attributes('data-preview')).toBe('true')
    expect(wall.stage().attributes('data-palette')).toBe('frost')
    expect(wall.wrapper.find('[data-testid="greeting"]').text()).toBe('Merry Christmas')
    expect(wall.wrapper.find('[data-testid="takeover-full"]').attributes('src')).toBe('/special-days/snow.webp')
    expect(wall.wrapper.find('[data-special="christmas"]').exists()).toBe(true)
    expect(wall.wrapper.find('[data-special="halloween"]').exists()).toBe(false)
  })

  it('asks for a scene by its id', async () => {
    previewAnswer = () => christmas
    const wall = await openWall()

    await wall.setState({ preview: { scene: 'birthday', until: '2026-10-31T10:01:00.000Z' } })

    expect(requests.find(request => request.url === '/api/special-days/preview')?.query).toEqual({ scene: 'birthday' })
  })

  it('shows the month of the date it answers with, and fetches that month\'s events', async () => {
    const wall = await openWall({ specialDays: resolution() })
    expect(wall.wrapper.find('[data-testid="month-title"]').text()).toBe('October 2026')

    await wall.setState({ preview: previewing() })

    expect(wall.wrapper.find('[data-testid="month-title"]').text()).toBe('December 2026')
    const fetched = requests.filter(request => request.url === '/api/events').map(request => request.query)
    expect(fetched.some(query => query?.from === '2026-11-24' && query?.to === '2027-01-15')).toBe(true)
  })

  it('shows that month even when another is pinned', async () => {
    const wall = await openWall({ state: state({ month: '2026-03' }), specialDays: resolution() })
    expect(wall.wrapper.find('[data-testid="month-title"]').text()).toBe('March 2026')

    await wall.setState({ month: '2026-03', preview: previewing() })

    expect(wall.wrapper.find('[data-testid="month-title"]').text()).toBe('December 2026')
  })

  it('goes back to the real days, month and palette when the server clears it', async () => {
    const wall = await openWall({ specialDays: resolution() })
    await wall.setState({ preview: previewing() })

    await wall.setState({ preview: null })

    expect(wall.wrapper.find('[data-testid="preview-badge"]').exists()).toBe(false)
    expect(wall.stage().attributes('data-preview')).toBeUndefined()
    expect(wall.stage().attributes('data-palette')).toBe('night')
    expect(wall.wrapper.find('[data-testid="month-title"]').text()).toBe('October 2026')
    expect(wall.wrapper.find('[data-testid="greeting"]').text()).toBe('Happy Halloween')
  })

  it('goes back by itself at its time, if the server is not there to say so', async () => {
    const wall = await openWall({ specialDays: resolution() })
    await wall.setState({ preview: { special_day: 'christmas', until: '2026-10-31T10:00:30.000Z' } })
    expect(wall.stage().attributes('data-palette')).toBe('frost')

    vi.setSystemTime(new Date('2026-10-31T10:00:31Z'))
    await wall.tick(1000)

    expect(wall.wrapper.find('[data-testid="preview-badge"]').exists()).toBe(false)
    expect(wall.stage().attributes('data-palette')).toBe('night')
  })

  it('asks again when the target changes, and shows nothing of the old target meanwhile', async () => {
    const wall = await openWall({ specialDays: resolution() })
    await wall.setState({ preview: previewing() })
    previewAnswer = query => query.special_day === 'diwali' ? resolution({ today: '2026-11-08', takeover: { ...halloween, id: 'diwali', date: '2026-11-08', palette: 'sage', greeting: 'Happy Diwali' }, tiles: [] }) : christmas

    await wall.setState({ preview: { special_day: 'diwali', until: '2026-10-31T10:01:00.000Z' } })

    expect(requests.filter(request => request.url === '/api/special-days/preview').map(request => request.query)).toEqual([{ special_day: 'christmas' }, { special_day: 'diwali' }])
    expect(wall.wrapper.find('[data-testid="greeting"]').text()).toBe('Happy Diwali')
    expect(wall.stage().attributes('data-palette')).toBe('sage')
    expect(wall.wrapper.find('[data-testid="month-title"]').text()).toBe('November 2026')
  })

  it('does not ask again for the same target started again', async () => {
    const wall = await openWall()
    await wall.setState({ preview: previewing() })

    await wall.setState({ preview: { special_day: 'christmas', until: '2026-10-31T10:02:00.000Z' } })

    expect(requests.filter(request => request.url === '/api/special-days/preview')).toHaveLength(1)
  })

  it('asks again when the server says special days changed, and shows the new answer', async () => {
    const wall = await openWall({ specialDays: resolution() })
    await wall.setState({ preview: previewing() })
    previewAnswer = () => ({ ...christmas, takeover: { ...christmas.takeover!, greeting: 'Happy Christmas, all' } })

    await wall.setSpecialDays(resolution({ tiles: [] }))

    expect(requests.filter(request => request.url === '/api/special-days/preview')).toHaveLength(2)
    expect(wall.wrapper.find('[data-testid="greeting"]').text()).toBe('Happy Christmas, all')
  })

  it('does not ask on a special days update when nothing is previewing', async () => {
    const wall = await openWall({ specialDays: resolution() })

    await wall.setSpecialDays(resolution())

    expect(requests.some(request => request.url === '/api/special-days/preview')).toBe(false)
  })

  it('keeps the real days out of the preview when the answer fails, but still says it is a preview', async () => {
    previewAnswer = () => null
    const wall = await openWall({ specialDays: resolution() })

    await wall.setState({ preview: previewing() })

    expect(wall.wrapper.find('[data-testid="preview-badge"]').exists()).toBe(true)
    expect(wall.stage().attributes('data-palette')).toBeUndefined()
    expect(wall.wrapper.find('[data-testid="greeting"]').exists()).toBe(false)
    expect(wall.wrapper.find('[data-special]').exists()).toBe(false)
    expect(wall.wrapper.find('[data-testid="month-title"]').text()).toBe('October 2026')
  })

  it('shows a preview of a day with no takeover as tiles only, in the display\'s theme', async () => {
    previewAnswer = () => ({ ...christmas, takeover: null })
    const wall = await openWall({ specialDays: resolution() })

    await wall.setState({ preview: previewing() })

    expect(wall.stage().attributes('data-palette')).toBeUndefined()
    expect(wall.wrapper.find('[data-testid="greeting"]').exists()).toBe(false)
    expect(wall.wrapper.find('[data-special="christmas"]').exists()).toBe(true)
    expect(wall.wrapper.find('[data-testid="preview-badge"]').exists()).toBe(true)
  })

  it('does not take over the photo frame, but the badge shows', async () => {
    const wall = await openWall({ state: state({ view: 'photo' }) })

    await wall.setState({ view: 'photo', preview: previewing() })

    expect(wall.stage().attributes('data-palette')).toBeUndefined()
    expect(wall.wrapper.find('[data-testid="preview-badge"]').exists()).toBe(true)
  })

  it('keeps the badge below an overlay in the stacking order', async () => {
    const wall = await openWall()
    await wall.setState({ preview: previewing(), overlay: { text: 'Bins out tonight', icon: null, until: null } })

    const badge = wall.positionInStage(wall.wrapper.find('[data-testid="preview-badge"]').element)
    const overlay = wall.positionInStage(wall.wrapper.find('[data-testid="overlay-banner"]').element)
    const dimmer = wall.positionInStage(wall.wrapper.find('[data-testid="dimmer"]').element)
    expect(badge).toBeLessThan(overlay)
    expect(overlay).toBeLessThan(dimmer)
  })
})

/** A timed event, for the night view's line. */
const swimming: CalendarEvent = {
  id: 1, calendar_id: 'family', title: 'Swimming', display_title: 'Swimming', location: null,
  start: '2026-11-01T08:30:00Z', end: '2026-11-01T09:30:00Z', all_day: false, start_date: null, end_date: null, people: [],
}

describe('burn-in shifting', () => {
  const shift = (wall: Awaited<ReturnType<typeof openWall>>) => wall.wrapper.find('[data-testid="shift"]')

  it('moves the view, the badges and the banner together by the orbit, and leaves the dimmer where it is', async () => {
    const wall = await openWall({ state: state({ overlay: { text: 'Bins out tonight', icon: null, until: null } }) })
    const { x, y } = burnInOffset(NOW)
    expect({ x, y }).not.toEqual({ x: 0, y: 0 })

    expect(shift(wall).attributes('style')).toContain(`transform: translate(${x}px, ${y}px)`)
    expect(shift(wall).find('[data-testid="month-view"]').exists()).toBe(true)
    expect(shift(wall).find('[data-testid="overlay-banner"]').exists()).toBe(true)
    expect(shift(wall).find('[data-testid="dimmer"]').exists()).toBe(false)
    expect(wall.stage().find('[data-testid="dimmer"]').exists()).toBe(true)
  })

  it('moves on to the next place after three minutes', async () => {
    const wall = await openWall()
    const before = shift(wall).attributes('style')

    await wall.tick(3 * 60_000)

    const { x, y } = burnInOffset(new Date(NOW.getTime() + 3 * 60_000))
    expect(shift(wall).attributes('style')).toContain(`translate(${x}px, ${y}px)`)
    expect(shift(wall).attributes('style')).not.toBe(before)
  })

  it('stays still when the display turns burn_in off', async () => {
    settingsExtra = { burn_in: false }
    const wall = await openWall({ state: state({ view: 'photo' }) })

    expect(shift(wall).attributes('style')).toContain('transform: none')
    await wall.tick(15 * 60_000)
    expect(shift(wall).attributes('style')).toContain('transform: none')
    expect(wall.wrapper.find('[data-testid="photo-pill"]').attributes('data-corner')).toBe('top-left')
  })

  it('shifts a display whose cached settings predate the switch', async () => {
    localStorage.setItem('wallcal:display:hallway', JSON.stringify({
      settings: { id: 'hallway', name: 'Hallway', theme: 'light', month_style: 'soft', week_start: 'monday', timezone: 'Europe/London' },
      state: state(),
      events: [],
      saved_at: NOW.toISOString(),
    }))
    const wrapper = await mountSuspended(DisplayPage, { route: '/display?id=hallway' })
    mounted.push(wrapper)

    expect(wrapper.find('[data-testid="shift"]').attributes('style')).toContain('translate(')
  })

  it('walks the photo frame\'s pill round the corners, a quarter of an hour at a time', async () => {
    const wall = await openWall({ state: state({ view: 'photo' }) })
    const corner = () => wall.wrapper.find('[data-testid="photo-pill"]').attributes('data-corner')
    expect(corner()).toBe(pillCorner(NOW, { overlay: false }))

    await wall.tick(15 * 60_000)

    expect(corner()).toBe(pillCorner(new Date(NOW.getTime() + 15 * 60_000), { overlay: false }))
    expect(corner()).not.toBe(pillCorner(NOW, { overlay: false }))
  })

  it('takes the pill out of a bottom corner while a banner shows, and gives the offline badge the other side when the pill has top right', async () => {
    const wall = await openWall({ state: state({ view: 'photo' }) })
    const corner = () => wall.wrapper.find('[data-testid="photo-pill"]').attributes('data-corner')
    const side = () => wall.wrapper.findComponent({ name: 'OfflineBadge' }).props('side')
    expect(side()).toBe('right')

    // Quarter of an hour on, the pill is top right.
    await wall.tick(15 * 60_000)
    expect(corner()).toBe('top-right')
    expect(side()).toBe('left')

    // Half an hour on it would be bottom right, where the banner is, so it stays up.
    await wall.tick(15 * 60_000)
    expect(corner()).toBe('bottom-right')
    expect(side()).toBe('right')
    await wall.setState({ view: 'photo', overlay: { text: 'Bins out tonight', icon: null, until: null } })
    expect(corner()).toBe('top-right')
    expect(side()).toBe('left')
  })

  it('does not move the offline badge for a view that has no pill', async () => {
    const wall = await openWall()
    await wall.tick(15 * 60_000)

    expect(wall.wrapper.findComponent({ name: 'OfflineBadge' }).props('side')).toBe('right')
  })
})

describe('the night view', () => {
  it('is the night view, not a placeholder, and shows the clock', async () => {
    const wall = await openWall({ state: state({ view: 'night' }) })

    expect(wall.wrapper.find('[data-testid="night-view"]').exists()).toBe(true)
    expect(wall.wrapper.find('[data-testid="night-clock"]').text()).toBe('10:00')
    expect(wall.wrapper.find('[data-testid="night-text"]').exists()).toBe(false)
  })

  it('shows the first event of the next 24 hours when the display asks for it', async () => {
    settingsExtra = { night_text: 'first_event' }
    eventsAnswer = [swimming]
    const wall = await openWall({ state: state({ view: 'night' }) })

    expect(wall.wrapper.find('[data-testid="night-text"]').text()).toBe('Tomorrow 08:30 \u00B7 Swimming')
  })

  it('shows the next alarm the server sends, and drops it when it goes', async () => {
    settingsExtra = { night_text: 'next_alarm' }
    const wall = await openWall({ state: state({ view: 'night' }) })
    expect(wall.wrapper.find('[data-testid="night-text"]').exists()).toBe(false)

    await wall.setAlarm('2026-11-01T06:45:00.000Z')
    expect(wall.wrapper.find('[data-testid="night-text"]').text()).toBe('Tomorrow 06:45')

    await wall.setAlarm(null)
    expect(wall.wrapper.find('[data-testid="night-text"]').exists()).toBe(false)
  })

  it('keeps the alarm in the cache for the next load', async () => {
    const wall = await openWall({ state: state({ view: 'night' }) })

    await wall.setAlarm('2026-11-01T06:45:00.000Z')

    expect(JSON.parse(localStorage.getItem('wallcal:display:hallway')!).alarm).toBe('2026-11-01T06:45:00.000Z')
  })

  it('is not taken over by a special day', async () => {
    const wall = await openWall({ state: state({ view: 'night' }), specialDays: resolution() })

    expect(wall.stage().attributes('data-palette')).toBeUndefined()
    expect(wall.wrapper.find('[data-testid="takeover-full"]').exists()).toBe(false)
  })
})

describe('preloading tomorrow\'s art', () => {
  const tomorrow = resolution({ tomorrow_art: ['bonfire.webp', 'sparkler.png'] })

  it('does nothing in the daytime', async () => {
    await openWall({ specialDays: tomorrow })

    expect(FakeImage.all).toEqual([])
  })

  it('loads and decodes each file once from 18:00 wall time', async () => {
    vi.setSystemTime(new Date('2026-10-31T17:59:00Z'))
    const wall = await openWall({ specialDays: tomorrow })
    expect(FakeImage.all).toEqual([])

    vi.setSystemTime(new Date('2026-10-31T18:00:01Z'))
    await wall.tick(1000)
    expect(FakeImage.all.map(image => [image.src, image.decoded])).toEqual([['/special-days/bonfire.webp', 1], ['/special-days/sparkler.png', 1]])

    // Not again, even when the server sends the same list again or the clock ticks on.
    await wall.setSpecialDays(tomorrow)
    await wall.tick(60_000)
    expect(FakeImage.all).toHaveLength(2)
  })

  it('loads one that is added later in the evening', async () => {
    vi.setSystemTime(new Date('2026-10-31T19:00:00Z'))
    const wall = await openWall({ specialDays: tomorrow })

    await wall.setSpecialDays({ ...tomorrow, tomorrow_art: [...tomorrow.tomorrow_art, 'ghost.svg'] })

    expect(FakeImage.all.map(image => image.src)).toEqual(['/special-days/bonfire.webp', '/special-days/sparkler.png', '/special-days/ghost.svg'])
  })

  it('does not mind a file that will not decode', async () => {
    vi.setSystemTime(new Date('2026-10-31T19:00:00Z'))
    FakeImage.broken = true

    await expect(openWall({ specialDays: tomorrow })).resolves.toBeDefined()
    expect(FakeImage.all).toHaveLength(2)
  })

  it('does not preload during a preview, which has no tomorrow', async () => {
    vi.setSystemTime(new Date('2026-10-31T19:00:00Z'))
    const wall = await openWall({ specialDays: { ...tomorrow, tomorrow_art: [] } })
    await wall.setState({ preview: { special_day: 'christmas', until: '2026-10-31T19:05:00.000Z' } })
    await wall.setSpecialDays(tomorrow)

    expect(FakeImage.all).toEqual([])
  })
})
