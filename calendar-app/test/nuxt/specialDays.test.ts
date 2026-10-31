import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import App from '~/app.vue'
import SpecialDaysPage from '~/pages/settings/special-days.vue'
import { PIN_ERRORS, PIN_HEADER } from '../../shared/remote'
import { effectiveLook, specialDayInputSchema, specialDaySceneInputSchema } from '../../shared/special-days'
import type { SpecialDay, SpecialDayScene } from '../../shared/special-days'

// The Special days tab against a pretend server: `$fetch` is replaced by one
// that answers as the real routes do (architecture §6, §7.6) and records every
// request, and `XMLHttpRequest`, which the uploads use for their progress, by a
// fake the test drives. The looks are in test/visual/settings.spec.ts; the
// helpers the page is built from are in test/unit/display/specialDayEditor.test.ts.

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

// Wed 28 Oct 2026, 09:41 in London.
const NOW = new Date('2026-10-28T09:41:00Z')
const UPDATED = '2026-10-01T10:00:00.000Z'

const scene = (changes: Partial<SpecialDayScene> & Pick<SpecialDayScene, 'id' | 'name'>): SpecialDayScene => ({
  lead: 'day',
  lead_days: null,
  tile_art: null,
  takeover: false,
  full_art: null,
  greeting: null,
  palette: 'warm',
  updated_at: UPDATED,
  ...changes,
})

const day = (changes: Partial<SpecialDay> & Pick<SpecialDay, 'id' | 'name' | 'month' | 'day'>): SpecialDay => ({
  year: null,
  repeat: 'yearly',
  scene_id: null,
  who: null,
  since_year: null,
  lead: null,
  lead_days: null,
  tile_art: null,
  takeover: null,
  full_art: null,
  greeting: null,
  palette: null,
  extra_art: null,
  updated_at: UPDATED,
  ...changes,
})

const birthdayScene = () => scene({
  id: 'birthday',
  name: 'Birthday',
  lead: 'week',
  tile_art: 'cake.webp',
  takeover: true,
  full_art: 'party.webp',
  greeting: 'Happy {nth} birthday, {who}!',
  palette: 'frost',
})

const isla = () => day({ id: 'isla-birthday', name: 'Isla\'s birthday', month: 3, day: 14, scene_id: 'birthday', who: 'Isla', since_year: 2020 })
const theo = () => day({ id: 'theo-birthday', name: 'Theo\'s birthday', month: 6, day: 2, scene_id: 'birthday', who: 'Theo', since_year: 2018, palette: 'night' })
const fireworks = () => day({ id: 'fireworks', name: 'Fireworks', month: 11, day: 5, repeat: 'once', year: 2026 })
const christmas = () => day({ id: 'christmas', name: 'Christmas', month: 12, day: 25, lead: 'month', tile_art: 'tree.svg', takeover: true, full_art: 'snow.webp', greeting: 'Merry Christmas!', palette: 'sage' })

// What the pretend server holds, and what it was asked.
let days: SpecialDay[]
let scenes: SpecialDayScene[]
let displays: { id: string, name: string, timezone: string }[]
let pin: string | null
let unreachable: boolean
/** A failure the next write answers with, once. */
let refuseNext: Error | null
let requests: { method: string, url: string, pin: string | null, body: unknown }[]

/** A failed request as `$fetch` throws it: the status, and the body the server's errors carry. */
function refusal(code: number, message: string, data: Record<string, unknown> = {}) {
  return Object.assign(new Error(`${code}`), { statusCode: code, data: { statusCode: code, message, ...data } })
}

const slug = (name: string, taken: readonly { id: string }[]): string => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  let id = base
  for (let n = 2; taken.some(item => item.id === id); n++) id = `${base}-${n}`
  return id
}

/** The first problem with a body, worded the way the routes do: the field, then what is wrong with it. */
function invalid(error: { issues: { path: PropertyKey[], message: string }[] }): Error {
  const [issue] = error.issues
  return refusal(400, `${String(issue!.path[0] ?? 'body')} ${issue!.message}`)
}

/** The PIN rules for a write, shared by `$fetch` and the fake upload: what the 401 says, or null when the write may go on. */
function pinProblem(sent: string | null): string | null {
  if (pin !== null && sent === null) return PIN_ERRORS.missing
  if (pin !== null && sent !== pin) return PIN_ERRORS.wrong
  return null
}

interface Options { method?: string, headers?: Record<string, string>, body?: Record<string, unknown> }

async function server(url: string, options: Options = {}) {
  const method = options.method ?? 'GET'
  const sentPin = options.headers?.[PIN_HEADER] ?? null
  requests.push({ method, url, pin: sentPin, body: options.body })
  if (unreachable) throw new TypeError('Failed to fetch')

  if (method === 'GET') {
    if (url === '/api/special-days') return structuredClone(days)
    if (url === '/api/special-day-scenes') return structuredClone(scenes)
    if (url === '/api/displays') return displays.map(display => ({ ...display, theme: 'light', month_style: 'soft', week_start: 'monday' }))
    throw refusal(404, `Not found: ${url}`)
  }
  if (url === '/api/remote/pin') {
    if (sentPin !== pin) throw refusal(401, PIN_ERRORS.wrong)
    return undefined
  }
  const refused = pinProblem(sentPin)
  if (refused) throw refusal(401, refused)
  if (refuseNext) {
    const error = refuseNext
    refuseNext = null
    throw error
  }

  const [path = '', query = ''] = url.split('?')
  const body = options.body ?? {}

  if (method === 'POST' && path === '/api/special-days') {
    const parsed = specialDayInputSchema.safeParse(body)
    if (!parsed.success) throw invalid(parsed.error)
    const created = day({ ...parsed.data, id: slug(parsed.data.name, days), name: parsed.data.name })
    days.push(created)
    return structuredClone(created)
  }
  if (method === 'POST' && path === '/api/special-day-scenes') {
    const parsed = specialDaySceneInputSchema.safeParse(body)
    if (!parsed.success) throw invalid(parsed.error)
    const created = scene({ ...parsed.data, id: slug(parsed.data.name, scenes) })
    scenes.push(created)
    return structuredClone(created)
  }

  const dayRoute = path.match(/^\/api\/special-days\/([^/]+)(?:\/(duplicate|save-as-scene|art\/(?:tile|full|extra)))?$/)
  if (dayRoute) {
    const existing = days.find(candidate => candidate.id === dayRoute[1])
    if (!existing) throw refusal(404, 'No such special day')
    const action = dayRoute[2]
    if (method === 'PUT' && !action) {
      const parsed = specialDayInputSchema.safeParse(body)
      if (!parsed.success) throw invalid(parsed.error)
      Object.assign(existing, parsed.data)
      return structuredClone(existing)
    }
    if (method === 'DELETE' && !action) {
      days = days.filter(candidate => candidate !== existing)
      return undefined
    }
    if (method === 'POST' && action === 'duplicate') {
      const copy = { ...structuredClone(existing), id: slug(`Copy of ${existing.name}`, days), name: `Copy of ${existing.name}` }
      days.push(copy)
      return structuredClone(copy)
    }
    if (method === 'POST' && action === 'save-as-scene') {
      const look = effectiveLook(existing, scenes.find(candidate => candidate.id === existing.scene_id))
      const made = scene({ ...look, id: slug(existing.name, scenes), name: existing.name })
      scenes.push(made)
      Object.assign(existing, { scene_id: made.id, lead: null, lead_days: null, tile_art: null, takeover: null, full_art: null, greeting: null, palette: null })
      return structuredClone({ scene: made, day: existing })
    }
    if (method === 'DELETE' && action?.startsWith('art/')) {
      Object.assign(existing, { [`${action.slice(4)}_art`]: null })
      return structuredClone(existing)
    }
  }

  const sceneRoute = path.match(/^\/api\/special-day-scenes\/([^/]+)(?:\/(duplicate|art\/(?:tile|full)))?$/)
  if (sceneRoute) {
    const existing = scenes.find(candidate => candidate.id === sceneRoute[1])
    if (!existing) throw refusal(404, 'No such scene')
    if (method === 'PUT' && !sceneRoute[2]) {
      const parsed = specialDaySceneInputSchema.safeParse(body)
      if (!parsed.success) throw invalid(parsed.error)
      Object.assign(existing, parsed.data)
      return structuredClone(existing)
    }
    if (method === 'DELETE' && !sceneRoute[2]) {
      const using = days.filter(candidate => candidate.scene_id === existing.id)
      if (using.length > 0 && !query.includes('detach=true')) throw refusal(409, `scene is used by ${using.length} days`, { days: using.map(({ id, name }) => ({ id, name })) })
      for (const user of using) Object.assign(user, effectiveLook(user, existing), { scene_id: null })
      scenes = scenes.filter(candidate => candidate !== existing)
      return undefined
    }
    if (method === 'DELETE' && sceneRoute[2]?.startsWith('art/')) {
      Object.assign(existing, { [`${sceneRoute[2].slice(4)}_art`]: null })
      return structuredClone(existing)
    }
    if (method === 'POST' && sceneRoute[2] === 'duplicate') {
      const copy = { ...structuredClone(existing), id: slug(`Copy of ${existing.name}`, scenes), name: `Copy of ${existing.name}` }
      scenes.push(copy)
      return structuredClone(copy)
    }
  }

  if (method === 'POST' && /^\/api\/displays\/[^/]+\/commands$/.test(path)) return {}
  throw refusal(404, `Not found: ${method} ${url}`)
}

/** Every write the page made: not the reads, and not the PIN check. */
const writes = () => requests.filter(request => request.method !== 'GET' && request.url !== '/api/remote/pin')
const written = () => writes().map(request => `${request.method} ${request.url}`)

/** The parts of XMLHttpRequest that `uploadArt` uses, for a test to drive. */
class FakeRequest {
  static all: FakeRequest[] = []

  method = ''
  url = ''
  headers: Record<string, string> = {}
  body: unknown = null
  status = 0
  responseText = ''
  upload: { onprogress: ((event: { lengthComputable: boolean, loaded: number, total: number }) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  ontimeout: (() => void) | null = null

  constructor() {
    FakeRequest.all.push(this)
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }

  send(body: unknown) {
    this.body = body
  }

  /** The server answers. */
  respond(status: number, body: unknown) {
    this.status = status
    this.responseText = JSON.stringify(body)
    this.onload?.()
  }

  /** The server answers as the pretend server does: the PIN rules, then the art is stored. */
  answer(file: string) {
    const refused = pinProblem(this.headers[PIN_HEADER] ?? null)
    if (refused) {
      this.respond(401, { statusCode: 401, message: refused })
      return
    }
    const [, kind, id, slot] = this.url.match(/^\/api\/(special-days|special-day-scenes)\/([^/]+)\/art\/(\w+)$/)!
    const record: SpecialDay | SpecialDayScene = (kind === 'special-days' ? days : scenes).find(candidate => candidate.id === id)!
    Object.assign(record, { [`${slot}_art`]: file })
    this.respond(200, record)
  }
}

const upload = () => FakeRequest.all.at(-1)!

// The page keeps listening for the tab, so one left mounted would go on through the next test.
const mounted: { unmount: () => void }[] = []

/** Lets the page finish what it started: the requests, the route change that follows and the redraw. Only `Date` is faked, so timers run. */
async function settle() {
  for (let round = 0; round < 3; round++) {
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

/** Mounts the Special days tab at an address, as a link to a day or a scene would open it. Given `App`, the whole app: the router then renders the page, which leaving it needs. */
async function open(route = '/settings/special-days', page: Parameters<typeof mountSuspended>[0] = SpecialDaysPage) {
  const wrapper = await mountSuspended(page, { route })
  mounted.push(wrapper)
  await settle()
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof open>>

const find = (wrapper: Wrapper, testid: string) => wrapper.find(`[data-testid="${testid}"]`)
const findAll = (wrapper: Wrapper, testid: string) => wrapper.findAll(`[data-testid="${testid}"]`)
const text = (wrapper: Wrapper, testid: string) => find(wrapper, testid).text()
const query = () => useRouter().currentRoute.value.query

async function click(wrapper: Wrapper, testid: string) {
  await find(wrapper, testid).trigger('click')
  await settle()
}

/** Presses Save. The wrapper isn't in the document, where a click on a submit button wouldn't send its form, so the form is sent. */
async function save(wrapper: Wrapper) {
  await wrapper.find('form').trigger('submit')
  await settle()
}

/** Picks a radio button. */
async function choose(wrapper: Wrapper, testid: string) {
  await find(wrapper, testid).setValue(true)
  await settle()
}

async function type(wrapper: Wrapper, testid: string, value: string) {
  await find(wrapper, testid).setValue(value)
  await settle()
}

/** The checked state of a radio, a swatch or a switch. */
function checked(wrapper: Wrapper, testid: string): boolean {
  const element = find(wrapper, testid).element
  return element instanceof HTMLInputElement ? element.checked : element.getAttribute('aria-checked') === 'true'
}

const disabled = (wrapper: Wrapper, testid: string) => find(wrapper, testid).attributes('disabled') !== undefined

/** The days page's rows by name. */
const rowNames = (wrapper: Wrapper, kind: 'day' | 'scene' = 'day') => findAll(wrapper, `${kind}-row`).map(row => row.find('.name').text())

/** A picture, as the file input or a drop gives it. */
function picture(name = 'tile.png', type = 'image/png', size = 10): File {
  const file = new File([new Uint8Array(10)], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

async function drop(wrapper: Wrapper, slot: 'tile' | 'full' | 'extra', file: File) {
  await find(wrapper, `art-${slot}-drop`).trigger('drop', { dataTransfer: { files: [file] } })
  await settle()
}

/** A PUT or POST body, as the page sent it. */
const bodyOf = (index = -1) => writes().at(index)!.body

beforeEach(() => {
  fetchMock.mockImplementation(server)
  vi.stubGlobal('XMLHttpRequest', FakeRequest)
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  days = [isla(), theo(), fireworks(), christmas()]
  scenes = [birthdayScene(), scene({ id: 'spooky', name: 'Spooky', palette: 'night' })]
  displays = [{ id: 'hallway', name: 'Hallway', timezone: 'Europe/London' }]
  pin = null
  unreachable = false
  refuseNext = null
  requests = []
  FakeRequest.all = []
  localStorage.clear()
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the list', () => {
  it('shows each day with a date chip, its name and a summary', async () => {
    const wrapper = await open()

    expect(findAll(wrapper, 'day-row').map(row => ({
      day: row.find('.chip-day').text(),
      month: row.find('.chip-month').text(),
      name: row.find('.name').text(),
      summary: row.find('.summary').text(),
    }))).toEqual([
      { day: '14', month: 'Mar', name: 'Isla\'s birthday', summary: 'Birthday scene' },
      { day: '2', month: 'Jun', name: 'Theo\'s birthday', summary: 'Birthday scene · 1 change' },
      { day: '5', month: 'Nov', name: 'Fireworks', summary: 'Once in 2026' },
      { day: '25', month: 'Dec', name: 'Christmas', summary: 'Every year · tile art · full screen' },
    ])
  })

  it('opens the first day when nothing is chosen, and marks it as the current one', async () => {
    const wrapper = await open()

    expect(query()).toEqual({ day: 'isla-birthday' })
    expect(text(wrapper, 'switch-days')).toBe('Days')
    expect(findAll(wrapper, 'day-row').map(row => row.attributes('aria-current'))).toEqual(['true', undefined, undefined, undefined])
    expect((find(wrapper, 'day-name').element as HTMLInputElement).value).toBe('Isla\'s birthday')
  })

  it('opens the day an address names', async () => {
    const wrapper = await open('/settings/special-days?day=christmas')

    expect(findAll(wrapper, 'day-row').map(row => row.attributes('aria-current'))).toEqual([undefined, undefined, undefined, 'true'])
    expect((find(wrapper, 'day-name').element as HTMLInputElement).value).toBe('Christmas')
  })

  it('switches to the scenes, with how many days use each', async () => {
    const wrapper = await open()

    await click(wrapper, 'switch-scenes')

    expect(find(wrapper, 'switch-scenes').attributes('aria-pressed')).toBe('true')
    expect(find(wrapper, 'switch-days').attributes('aria-pressed')).toBe('false')
    expect(findAll(wrapper, 'day-row')).toHaveLength(0)
    expect(findAll(wrapper, 'scene-row').map(row => [row.find('.name').text(), row.find('.summary').text()])).toEqual([
      ['Birthday', 'Used by 2 days'],
      ['Spooky', 'Not used yet'],
    ])
    expect(query()).toEqual({ scene: 'birthday' })
    expect(find(wrapper, 'scene-editor').exists()).toBe(true)
    expect(find(wrapper, 'day-editor').exists()).toBe(false)

    await click(wrapper, 'switch-days')
    expect(query()).toEqual({ day: 'isla-birthday' })
  })

  it('says "Used by 1 day" in the singular', async () => {
    days = [isla()]
    const wrapper = await open()

    await click(wrapper, 'switch-scenes')

    expect(findAll(wrapper, 'scene-row')[0]!.find('.summary').text()).toBe('Used by 1 day')
  })

  it('shows the scene\'s tile art in its row', async () => {
    const wrapper = await open('/settings/special-days?scene=birthday')

    expect(findAll(wrapper, 'scene-row')[0]!.find('img').attributes('src')).toBe('/special-days/cake.webp')
    expect(findAll(wrapper, 'scene-row')[1]!.find('img').exists()).toBe(false)
  })

  it('says so when there are no days or scenes yet, and has nothing open', async () => {
    days = []
    scenes = []
    const wrapper = await open()

    expect(text(wrapper, 'list-empty')).toBe('No special days yet.')
    expect(text(wrapper, 'nothing-selected')).toContain('Pick a day or a scene, or add one.')
    await click(wrapper, 'switch-scenes')
    expect(text(wrapper, 'list-empty')).toBe('No scenes yet.')
  })

  it('adds a row for a new day until it is saved', async () => {
    const wrapper = await open()

    await click(wrapper, 'add-day')

    expect(query()).toEqual({ new: 'day' })
    expect(text(wrapper, 'new-row')).toContain('New day')
    expect(findAll(wrapper, 'day-row').every(row => row.attributes('aria-current') === undefined)).toBe(true)
    expect((find(wrapper, 'day-name').element as HTMLInputElement).value).toBe('')
  })

  it('says the server can\'t be reached, and shows no list', async () => {
    unreachable = true
    const wrapper = await open()

    expect(text(wrapper, 'unreachable')).toContain('server')
    expect(find(wrapper, 'loading').exists()).toBe(false)
  })
})

describe('the day form and its checks', () => {
  /** A new day with a name, ready to have one thing wrong with it. */
  async function newDay(name = 'Bonfire Night') {
    const wrapper = await open('/settings/special-days?new=day')
    await type(wrapper, 'day-name', name)
    return wrapper
  }

  it('asks for a name, and sends nothing', async () => {
    const wrapper = await open('/settings/special-days?new=day')

    await save(wrapper)

    expect(text(wrapper, 'field-error-name')).toBe('Name must not be empty')
    expect(find(wrapper, 'day-name').attributes('aria-invalid')).toBe('true')
    expect(writes()).toEqual([])
  })

  it('clears the message once the name is typed', async () => {
    const wrapper = await open('/settings/special-days?new=day')
    await save(wrapper)

    await type(wrapper, 'day-name', 'Bonfire Night')

    expect(find(wrapper, 'field-error-name').exists()).toBe(false)
  })

  it('offers only the days a month has, and brings a day back into a shorter month', async () => {
    const wrapper = await newDay()
    await type(wrapper, 'day-month', '1')
    await type(wrapper, 'day-day', '31')

    await type(wrapper, 'day-month', '2')

    expect(findAll(wrapper, 'day-day').length).toBe(1)
    expect(find(wrapper, 'day-day').findAll('option')).toHaveLength(29)
    expect((find(wrapper, 'day-day').element as HTMLSelectElement).value).toBe('29')
  })

  it('refuses a date that doesn\'t exist, such as 29 February once the year isn\'t a leap year', async () => {
    const wrapper = await newDay('Leap day')
    await choose(wrapper, 'repeat-once')
    await type(wrapper, 'day-year', '2028')
    await type(wrapper, 'day-month', '2')
    await type(wrapper, 'day-day', '29')
    await type(wrapper, 'day-year', '2027')

    await save(wrapper)

    expect(text(wrapper, 'field-error-day')).toBe('Day must be a day that exists in that month of 2027')
    expect(writes()).toEqual([])
  })

  it('wants a year for a day that happens once', async () => {
    const wrapper = await newDay()
    await choose(wrapper, 'repeat-once')

    await save(wrapper)

    expect(text(wrapper, 'field-error-year')).toBe('Year is required for a day that happens once')
    expect(writes()).toEqual([])
  })

  it('shows the year only for a day that happens once, and Since only for one that repeats', async () => {
    const wrapper = await newDay()
    expect(find(wrapper, 'day-year').exists()).toBe(false)
    expect(disabled(wrapper, 'day-since')).toBe(false)

    await choose(wrapper, 'repeat-once')

    expect(find(wrapper, 'day-year').exists()).toBe(true)
    expect(disabled(wrapper, 'day-since')).toBe(true)
  })

  it('wants the number of days for a custom lead, and keeps it from 1 to 365', async () => {
    const wrapper = await newDay()
    await choose(wrapper, 'lead-days')
    const days = () => wrapper.find('input[type="text"][data-testid="lead-days"]')
    expect(days().exists()).toBe(true)

    await save(wrapper)
    expect(text(wrapper, 'field-error-lead_days')).toBe('Days before is required')

    await days().setValue('400')
    await save(wrapper)
    expect(text(wrapper, 'field-error-lead_days')).toBe('Days before must be from 1 to 365')

    await days().setValue('abc')
    await save(wrapper)
    expect(text(wrapper, 'field-error-lead_days')).toBe('Days before must be a whole number')

    expect(writes()).toEqual([])
  })

  it('refuses a greeting with a placeholder that isn\'t one', async () => {
    const wrapper = await newDay()
    await click(wrapper, 'takeover')
    await type(wrapper, 'day-greeting', 'Hello {name}!')

    await save(wrapper)

    expect(text(wrapper, 'field-error-greeting')).toBe('Greeting has an unknown placeholder {name}; use {who}, {years} or {nth}')
    expect(writes()).toEqual([])
  })

  it('refuses a greeting the day has nothing to fill, rather than sending it', async () => {
    const wrapper = await newDay()
    await click(wrapper, 'takeover')
    await type(wrapper, 'day-greeting', 'Happy {nth} birthday, {who}!')

    await save(wrapper)

    expect(text(wrapper, 'field-error-greeting')).toBe('Add Since to fill {nth} · Add Who to fill {who}')
    expect(writes()).toEqual([])
  })

  it('refuses a Since year out of range', async () => {
    const wrapper = await newDay()
    await type(wrapper, 'day-since', '1800')

    await save(wrapper)

    expect(text(wrapper, 'field-error-since_year')).toBe('Since must be from 1900 to 2100')
    expect(writes()).toEqual([])
  })
})

describe('saving a day', () => {
  it('sends the whole day as a PUT and says Saved', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')
    expect(disabled(wrapper, 'day-save')).toBe(true)

    await type(wrapper, 'day-name', 'Isla\'s party')
    await save(wrapper)

    expect(written()).toEqual(['PUT /api/special-days/isla-birthday'])
    expect(bodyOf()).toEqual({
      name: 'Isla\'s party',
      month: 3,
      day: 14,
      year: null,
      repeat: 'yearly',
      scene_id: 'birthday',
      who: 'Isla',
      since_year: 2020,
      lead: null,
      lead_days: null,
      takeover: null,
      greeting: null,
      palette: null,
    })
    expect(text(wrapper, 'editor-note')).toBe('Saved.')
    expect(find(wrapper, 'unsaved').exists()).toBe(false)
    expect(disabled(wrapper, 'day-save')).toBe(true)
    expect(rowNames(wrapper)[0]).toBe('Isla\'s party')
  })

  it('sends a new day as a POST, then opens it', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')
    await click(wrapper, 'add-day')
    await type(wrapper, 'day-name', 'Bonfire Night')
    await type(wrapper, 'day-month', '11')
    await type(wrapper, 'day-day', '5')
    await type(wrapper, 'day-who', 'Everyone')

    await save(wrapper)

    expect(written()).toEqual(['POST /api/special-days'])
    expect(bodyOf()).toEqual({
      name: 'Bonfire Night',
      month: 11,
      day: 5,
      year: null,
      repeat: 'yearly',
      scene_id: null,
      who: 'Everyone',
      since_year: null,
      lead: null,
      lead_days: null,
      takeover: null,
      greeting: null,
      palette: null,
    })
    expect(query()).toEqual({ day: 'bonfire-night' })
    expect(text(wrapper, 'editor-note')).toBe('Saved.')
    expect(rowNames(wrapper)).toContain('Bonfire Night')
    expect(find(wrapper, 'new-row').exists()).toBe(false)
    expect((find(wrapper, 'day-name').element as HTMLInputElement).value).toBe('Bonfire Night')
  })

  it('sends a once-only day with its year and no Since', async () => {
    const wrapper = await open('/settings/special-days?new=day')
    await type(wrapper, 'day-name', 'Moving day')
    await choose(wrapper, 'repeat-once')
    await type(wrapper, 'day-year', '2027')

    await save(wrapper)

    expect(bodyOf()).toMatchObject({ name: 'Moving day', repeat: 'once', year: 2027, since_year: null })
  })

  it('sends a custom lead with its days', async () => {
    const wrapper = await open('/settings/special-days?new=day')
    await type(wrapper, 'day-name', 'Trip')
    await choose(wrapper, 'lead-days')
    await wrapper.find('input[type="text"][data-testid="lead-days"]').setValue('10')

    await save(wrapper)

    expect(bodyOf()).toMatchObject({ lead: 'days', lead_days: 10 })
  })

  it('shows what the server said when it refuses, under the form, and keeps the changes', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')
    await type(wrapper, 'day-who', 'Isla Rose')
    refuseNext = refusal(400, 'scene_id is not a scene')

    await save(wrapper)

    expect(text(wrapper, 'server-error')).toBe('Scene_id is not a scene')
    expect(find(wrapper, 'unsaved').exists()).toBe(true)
    expect((find(wrapper, 'day-who').element as HTMLInputElement).value).toBe('Isla Rose')
    expect(find(wrapper, 'editor-note').exists()).toBe(false)
  })

  it('says so when the server can\'t be reached', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')
    await type(wrapper, 'day-who', 'Isla Rose')
    unreachable = true

    await save(wrapper)

    expect(text(wrapper, 'server-error')).toContain('server')
  })
})

describe('what comes from the scene', () => {
  it('marks every part of a day that follows its scene "From Birthday"', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')

    const marks = findAll(wrapper, 'mark-from')
    expect(marks).toHaveLength(6)
    expect(marks.every(mark => mark.text() === 'From Birthday')).toBe(true)
    expect(findAll(wrapper, 'mark-changed')).toHaveLength(0)
    expect(findAll(wrapper, 'reset')).toHaveLength(0)
    // The scene's look is what the form shows.
    expect(checked(wrapper, 'lead-week')).toBe(true)
    expect(checked(wrapper, 'takeover')).toBe(true)
    expect(checked(wrapper, 'palette-frost')).toBe(true)
    expect((find(wrapper, 'day-greeting').element as HTMLInputElement).value).toBe('Happy {nth} birthday, {who}!')
    expect(find(wrapper, 'art-tile-image').attributes('src')).toBe('/special-days/cake.webp')
    expect(find(wrapper, 'art-full-image').attributes('src')).toBe('/special-days/party.webp')
  })

  it('marks what the day has changed "Changed", and Reset puts it back and sends null', async () => {
    const wrapper = await open('/settings/special-days?day=theo-birthday')
    expect(findAll(wrapper, 'mark-changed')).toHaveLength(1)
    expect(findAll(wrapper, 'mark-from')).toHaveLength(5)
    expect(checked(wrapper, 'palette-night')).toBe(true)

    await click(wrapper, 'reset')

    expect(checked(wrapper, 'palette-frost')).toBe(true)
    expect(findAll(wrapper, 'mark-changed')).toHaveLength(0)
    expect(findAll(wrapper, 'mark-from')).toHaveLength(6)
    expect(find(wrapper, 'unsaved').exists()).toBe(true)

    await save(wrapper)

    expect(written()).toEqual(['PUT /api/special-days/theo-birthday'])
    expect(bodyOf()).toMatchObject({ palette: null, scene_id: 'birthday' })
    expect(findAll(wrapper, 'mark-changed')).toHaveLength(0)
  })

  it('makes a change the day\'s own, until it is reset', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')

    await click(wrapper, 'takeover')
    expect(checked(wrapper, 'takeover')).toBe(false)
    expect(findAll(wrapper, 'mark-changed')).toHaveLength(1)

    await choose(wrapper, 'lead-month')
    expect(findAll(wrapper, 'mark-changed')).toHaveLength(2)

    for (const reset of findAll(wrapper, 'reset').reverse()) await reset.trigger('click')
    await settle()
    expect(checked(wrapper, 'takeover')).toBe(true)
    expect(checked(wrapper, 'lead-week')).toBe(true)
    expect(findAll(wrapper, 'mark-changed')).toHaveLength(0)
    expect(find(wrapper, 'unsaved').exists()).toBe(false)
  })

  it('sends the day\'s own change and null for the rest', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')
    await click(wrapper, 'palette-sage')

    await save(wrapper)

    expect(bodyOf()).toMatchObject({ palette: 'sage', lead: null, takeover: null, greeting: null })
  })

  it('keeps the look when None is chosen for the scene, and sends it as the day\'s own', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')

    await type(wrapper, 'day-scene', '')

    expect(findAll(wrapper, 'mark-from')).toHaveLength(0)
    expect(findAll(wrapper, 'mark-changed')).toHaveLength(0)
    expect(find(wrapper, 'edit-scene').exists()).toBe(false)
    expect(checked(wrapper, 'lead-week')).toBe(true)
    expect(checked(wrapper, 'takeover')).toBe(true)
    expect(checked(wrapper, 'palette-frost')).toBe(true)
    expect((find(wrapper, 'day-greeting').element as HTMLInputElement).value).toBe('Happy {nth} birthday, {who}!')

    await save(wrapper)

    expect(bodyOf()).toMatchObject({
      scene_id: null,
      lead: 'week',
      lead_days: null,
      takeover: true,
      greeting: 'Happy {nth} birthday, {who}!',
      palette: 'frost',
    })
  })

  it('opens the scene from the day', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')

    await click(wrapper, 'edit-scene')

    expect(query()).toEqual({ scene: 'birthday' })
    expect((find(wrapper, 'scene-name').element as HTMLInputElement).value).toBe('Birthday')
  })
})

describe('the greeting preview', () => {
  it('fills {who} and {nth} for the next time the day falls', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')

    expect(text(wrapper, 'greeting-preview')).toBe('Happy 7th birthday, Isla! · on Sun 14 Mar 2027')
  })

  it('follows what is typed, and fills {years} too', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')

    await type(wrapper, 'day-since', '2018')
    expect(text(wrapper, 'greeting-preview')).toBe('Happy 9th birthday, Isla! · on Sun 14 Mar 2027')

    await type(wrapper, 'day-greeting', '{who} is {years} today')
    expect(text(wrapper, 'greeting-preview')).toBe('Isla is 9 today · on Sun 14 Mar 2027')

    await type(wrapper, 'day-month', '10')
    await type(wrapper, 'day-day', '30')
    expect(text(wrapper, 'greeting-preview')).toBe('Isla is 8 today · on Fri 30 Oct 2026')
  })

  it('uses 11th, 12th and 13th, and 21st', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')

    await type(wrapper, 'day-since', '2016')
    expect(text(wrapper, 'greeting-preview')).toContain('11th')
    await type(wrapper, 'day-since', '2015')
    expect(text(wrapper, 'greeting-preview')).toContain('12th')
    await type(wrapper, 'day-since', '2014')
    expect(text(wrapper, 'greeting-preview')).toContain('13th')
    await type(wrapper, 'day-since', '2006')
    expect(text(wrapper, 'greeting-preview')).toContain('21st')
  })

  it('warns when Since is missing, and says what to add', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')

    await type(wrapper, 'day-since', '')

    expect(text(wrapper, 'greeting-preview')).toBe('Add Since to fill {nth}')
    expect(find(wrapper, 'greeting-preview').classes()).toContain('warning')
  })

  it('warns when Who is missing', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')

    await type(wrapper, 'day-who', '')

    expect(text(wrapper, 'greeting-preview')).toBe('Add Who to fill {who}')
  })

  it('warns that {nth} needs a day that repeats, for one that happens once', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')

    await choose(wrapper, 'repeat-once')

    expect(text(wrapper, 'greeting-preview')).toBe('{nth} needs a day that repeats every year')
  })

  it('has no line when there is no greeting', async () => {
    const wrapper = await open('/settings/special-days?day=fireworks')

    expect(find(wrapper, 'greeting-preview').exists()).toBe(false)
  })

  it('shows a scene\'s greeting filled in through the first day that uses it', async () => {
    const wrapper = await open('/settings/special-days?scene=birthday')

    expect(text(wrapper, 'greeting-preview')).toBe('On Isla\'s birthday: Happy 7th birthday, Isla!')
  })

  it('says a scene no day uses fills its placeholders for each day', async () => {
    const wrapper = await open('/settings/special-days?scene=spooky')
    await click(wrapper, 'takeover')
    await type(wrapper, 'scene-greeting', 'Boo, {who}!')

    expect(text(wrapper, 'greeting-preview')).toBe('Placeholders are filled in for each day that uses this scene')
  })
})

describe('unsaved changes', () => {
  it('flags the open day as soon as something changes, and not once it is back as it was', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')
    expect(find(wrapper, 'unsaved').exists()).toBe(false)
    expect(find(wrapper, 'row-unsaved').exists()).toBe(false)

    await type(wrapper, 'day-name', 'Isla')
    expect(text(wrapper, 'unsaved')).toBe('Unsaved changes')
    expect(findAll(wrapper, 'row-unsaved')).toHaveLength(1)
    expect(findAll(wrapper, 'day-row')[0]!.find('[data-testid="row-unsaved"]').exists()).toBe(true)
    expect(disabled(wrapper, 'day-save')).toBe(false)

    await type(wrapper, 'day-name', 'Isla\'s birthday')
    expect(find(wrapper, 'unsaved').exists()).toBe(false)
    expect(find(wrapper, 'row-unsaved').exists()).toBe(false)
  })

  it('flags a new day once anything is typed', async () => {
    const wrapper = await open('/settings/special-days?new=day')
    expect(find(wrapper, 'unsaved').exists()).toBe(false)

    await type(wrapper, 'day-name', 'B')

    expect(find(wrapper, 'unsaved').exists()).toBe(true)
  })

  it('asks before another day is opened, and stays put on Cancel', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')
    await type(wrapper, 'day-name', 'Isla')

    await findAll(wrapper, 'day-row')[1]!.trigger('click')
    await settle()

    expect(text(wrapper, 'confirm-title')).toBe('Discard changes?')
    expect(text(wrapper, 'confirm-message')).toBe('You have unsaved changes to Isla\'s birthday.')
    expect(text(wrapper, 'confirm-ok')).toBe('Discard')
    await click(wrapper, 'confirm-cancel')
    expect(find(wrapper, 'confirm-dialog').exists()).toBe(false)
    expect(query()).toEqual({ day: 'isla-birthday' })
    expect((find(wrapper, 'day-name').element as HTMLInputElement).value).toBe('Isla')
    expect(find(wrapper, 'unsaved').exists()).toBe(true)
  })

  it('lets go of the changes on Discard, and opens the other day', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')
    await type(wrapper, 'day-name', 'Isla')

    await findAll(wrapper, 'day-row')[1]!.trigger('click')
    await settle()
    await click(wrapper, 'confirm-ok')

    expect(find(wrapper, 'confirm-dialog').exists()).toBe(false)
    expect(query()).toEqual({ day: 'theo-birthday' })
    expect((find(wrapper, 'day-name').element as HTMLInputElement).value).toBe('Theo\'s birthday')
    expect(find(wrapper, 'unsaved').exists()).toBe(false)
    expect(rowNames(wrapper)[0]).toBe('Isla\'s birthday')
    expect(writes()).toEqual([])
  })

  it('doesn\'t ask when nothing has changed', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')

    await findAll(wrapper, 'day-row')[1]!.trigger('click')
    await settle()

    expect(find(wrapper, 'confirm-dialog').exists()).toBe(false)
    expect(query()).toEqual({ day: 'theo-birthday' })
  })

  it('asks before Add, and before switching to the scenes', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')
    await type(wrapper, 'day-name', 'Isla')

    await click(wrapper, 'add-day')
    expect(find(wrapper, 'confirm-dialog').exists()).toBe(true)
    expect(query()).toEqual({ day: 'isla-birthday' })
    await click(wrapper, 'confirm-cancel')

    await click(wrapper, 'switch-scenes')
    expect(find(wrapper, 'confirm-dialog').exists()).toBe(true)
    expect(find(wrapper, 'switch-days').attributes('aria-pressed')).toBe('true')
    await click(wrapper, 'confirm-ok')

    expect(query()).toEqual({ scene: 'birthday' })
    expect(find(wrapper, 'scene-editor').exists()).toBe(true)
  })

  it('names a new day that has not been saved', async () => {
    const wrapper = await open('/settings/special-days?new=day')
    await type(wrapper, 'day-name', 'Bonfire')

    await findAll(wrapper, 'day-row')[0]!.trigger('click')
    await settle()

    expect(text(wrapper, 'confirm-message')).toBe('You have unsaved changes to this new day.')
  })

  it('asks before the page is left for another tab, and goes on after Discard', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday', App)
    await type(wrapper, 'day-name', 'Isla')

    const arrived = useRouter().push('/settings/photos')
    await settle()
    expect(find(wrapper, 'confirm-dialog').exists()).toBe(true)
    await click(wrapper, 'confirm-cancel')
    await arrived
    expect(useRouter().currentRoute.value.path).toBe('/settings/special-days')

    const again = useRouter().push('/settings/photos')
    await settle()
    await click(wrapper, 'confirm-ok')
    await again
    expect(useRouter().currentRoute.value.path).toBe('/settings/photos')
  })

  it('warns the browser before the tab is closed while there are unsaved changes', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')
    const closing = () => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(closing()).toBe(false)

    await type(wrapper, 'day-name', 'Isla')

    expect(closing()).toBe(true)
  })

  it('clears the note when typing starts again', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')
    await type(wrapper, 'day-name', 'Isla')
    await save(wrapper)
    expect(text(wrapper, 'editor-note')).toBe('Saved.')

    await type(wrapper, 'day-name', 'Isla again')

    expect(find(wrapper, 'editor-note').exists()).toBe(false)
  })
})

describe('deleting', () => {
  it('asks first, and does nothing on Cancel', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')

    await click(wrapper, 'day-delete')

    expect(text(wrapper, 'confirm-title')).toBe('Delete Isla\'s birthday?')
    expect(text(wrapper, 'confirm-message')).toBe('It goes from the wall and the list. This can\'t be undone.')
    expect(text(wrapper, 'confirm-ok')).toBe('Delete')
    expect(writes()).toEqual([])

    await click(wrapper, 'confirm-cancel')

    expect(find(wrapper, 'confirm-dialog').exists()).toBe(false)
    expect(writes()).toEqual([])
    expect(rowNames(wrapper)).toHaveLength(4)
  })

  it('deletes the day on confirming, and opens the next one', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')

    await click(wrapper, 'day-delete')
    await click(wrapper, 'confirm-ok')

    expect(written()).toEqual(['DELETE /api/special-days/isla-birthday'])
    expect(rowNames(wrapper)).toEqual(['Theo\'s birthday', 'Fireworks', 'Christmas'])
    expect(query()).toEqual({ day: 'theo-birthday' })
    expect(text(wrapper, 'editor-note')).toBe('Deleted Isla\'s birthday.')
  })

  it('opens the one before when the last day goes', async () => {
    const wrapper = await open('/settings/special-days?day=christmas')

    await click(wrapper, 'day-delete')
    await click(wrapper, 'confirm-ok')

    expect(query()).toEqual({ day: 'fireworks' })
  })

  it('doesn\'t offer Delete on a new day', async () => {
    const wrapper = await open('/settings/special-days?new=day')

    expect(find(wrapper, 'day-delete').exists()).toBe(false)
    expect(find(wrapper, 'day-duplicate').exists()).toBe(false)
    expect(find(wrapper, 'day-preview').exists()).toBe(false)
  })

  it('deletes a scene no day uses after asking', async () => {
    const wrapper = await open('/settings/special-days?scene=spooky')
    expect(text(wrapper, 'scene-delete')).toBe('Delete')

    await click(wrapper, 'scene-delete')
    expect(text(wrapper, 'confirm-title')).toBe('Delete Spooky?')
    await click(wrapper, 'confirm-ok')

    expect(written()).toEqual(['DELETE /api/special-day-scenes/spooky'])
    expect(findAll(wrapper, 'scene-row').map(row => row.find('.name').text())).toEqual(['Birthday'])
    expect(query()).toEqual({ scene: 'birthday' })
  })

  it('copies a scene into the days that use it before deleting it', async () => {
    const wrapper = await open('/settings/special-days?scene=birthday')
    expect(text(wrapper, 'scene-delete')).toBe('Copy into days and delete')

    await click(wrapper, 'scene-delete')

    expect(text(wrapper, 'confirm-title')).toBe('Copy into days and delete?')
    expect(text(wrapper, 'confirm-message')).toBe('2 days use Birthday. Each gets the scene\'s look as its own, so the wall doesn\'t change, and then the scene is deleted.')
    expect(text(wrapper, 'confirm-ok')).toBe('Copy and delete')
    expect(writes()).toEqual([])

    await click(wrapper, 'confirm-ok')

    expect(written()).toEqual(['DELETE /api/special-day-scenes/birthday?detach=true'])
    expect(days.find(candidate => candidate.id === 'isla-birthday')).toMatchObject({ scene_id: null, palette: 'frost', takeover: true })
    expect(query()).toEqual({ scene: 'spooky' })
  })

  it('says "1 day uses" for a scene used once', async () => {
    days = [isla()]
    const wrapper = await open('/settings/special-days?scene=birthday')

    await click(wrapper, 'scene-delete')

    expect(text(wrapper, 'confirm-message')).toBe('1 day uses Birthday. It gets the scene\'s look as its own, so the wall doesn\'t change, and then the scene is deleted.')
  })
})

describe('the scene form', () => {
  it('says how many days a save changes', async () => {
    const wrapper = await open('/settings/special-days?scene=birthday')
    await click(wrapper, 'palette-sage')

    await save(wrapper)

    expect(written()).toEqual(['PUT /api/special-day-scenes/birthday'])
    expect(bodyOf()).toEqual({
      name: 'Birthday',
      lead: 'week',
      lead_days: null,
      takeover: true,
      greeting: 'Happy {nth} birthday, {who}!',
      palette: 'sage',
    })
    expect(text(wrapper, 'editor-note')).toBe('Saved. This changes 2 days.')
  })

  it('says when no day uses the scene', async () => {
    const wrapper = await open('/settings/special-days?scene=spooky')
    await type(wrapper, 'scene-name', 'Spookier')

    await save(wrapper)

    expect(text(wrapper, 'editor-note')).toBe('Saved. No days use this scene yet.')
    expect(findAll(wrapper, 'scene-row').map(row => row.find('.name').text())).toContain('Spookier')
  })

  it('says "1 day" in the singular', async () => {
    days = [isla()]
    const wrapper = await open('/settings/special-days?scene=birthday')
    await type(wrapper, 'scene-name', 'Birthdays')

    await save(wrapper)

    expect(text(wrapper, 'editor-note')).toBe('Saved. This changes 1 day.')
  })

  it('lists the days that use the scene, each opening that day', async () => {
    const wrapper = await open('/settings/special-days?scene=birthday')

    expect(text(wrapper, 'scene-used-count')).toContain('Used by 2 days')
    expect(findAll(wrapper, 'scene-day').map(button => button.text())).toEqual(['Isla\'s birthday', 'Theo\'s birthday'])

    await findAll(wrapper, 'scene-day')[1]!.trigger('click')
    await settle()

    expect(query()).toEqual({ day: 'theo-birthday' })
    expect(find(wrapper, 'day-editor').exists()).toBe(true)
  })

  it('says no day uses a scene that none does', async () => {
    const wrapper = await open('/settings/special-days?scene=spooky')

    expect(text(wrapper, 'scene-unused')).toBe('No days use this scene yet.')
  })

  it('creates a new scene with a POST, then opens it', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')
    await click(wrapper, 'switch-scenes')
    await click(wrapper, 'add-scene')
    await type(wrapper, 'scene-name', 'Easter')
    await click(wrapper, 'palette-sage')

    await save(wrapper)

    expect(written()).toEqual(['POST /api/special-day-scenes'])
    expect(bodyOf()).toEqual({ name: 'Easter', lead: 'day', lead_days: null, takeover: false, greeting: null, palette: 'sage' })
    expect(query()).toEqual({ scene: 'easter' })
    expect(text(wrapper, 'editor-note')).toBe('Saved. No days use this scene yet.')
  })

  it('checks a scene before sending it', async () => {
    const wrapper = await open('/settings/special-days?scene=spooky')
    await type(wrapper, 'scene-name', '  ')

    await save(wrapper)
    expect(text(wrapper, 'field-error-name')).toBe('Name must not be empty')

    await type(wrapper, 'scene-name', 'Spooky')
    await click(wrapper, 'takeover')
    await type(wrapper, 'scene-greeting', 'Boo {ghost}')
    await save(wrapper)
    expect(text(wrapper, 'field-error-greeting')).toBe('Greeting has an unknown placeholder {ghost}; use {who}, {years} or {nth}')

    expect(writes()).toEqual([])
  })

  it('has no marks, since it is what the days are compared with', async () => {
    const wrapper = await open('/settings/special-days?scene=birthday')

    expect(findAll(wrapper, 'mark-from')).toHaveLength(0)
    expect(findAll(wrapper, 'mark-changed')).toHaveLength(0)
    expect(find(wrapper, 'art-extra').exists()).toBe(false)
  })
})

describe('Duplicate, Save as scene and Preview on wall', () => {
  it('copies a day and opens the copy', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')

    await click(wrapper, 'day-duplicate')

    expect(written()).toEqual(['POST /api/special-days/isla-birthday/duplicate'])
    expect(query()).toEqual({ day: 'copy-of-isla-s-birthday' })
    expect(text(wrapper, 'editor-note')).toBe('Copied. Give it its own name and date.')
    expect((find(wrapper, 'day-name').element as HTMLInputElement).value).toBe('Copy of Isla\'s birthday')
    expect(rowNames(wrapper)).toContain('Copy of Isla\'s birthday')
  })

  it('copies a scene and opens the copy', async () => {
    const wrapper = await open('/settings/special-days?scene=birthday')

    await click(wrapper, 'scene-duplicate')

    expect(written()).toEqual(['POST /api/special-day-scenes/birthday/duplicate'])
    expect(query()).toEqual({ scene: 'copy-of-birthday' })
    expect(text(wrapper, 'editor-note')).toBe('Copied.')
    expect((find(wrapper, 'scene-name').element as HTMLInputElement).value).toBe('Copy of Birthday')
  })

  it('makes a scene from the day\'s look, and the day uses it', async () => {
    const wrapper = await open('/settings/special-days?day=christmas')
    expect(find(wrapper, 'day-editor').text()).not.toContain('From Christmas')

    await click(wrapper, 'day-save-as-scene')

    expect(written()).toEqual(['POST /api/special-days/christmas/save-as-scene'])
    expect(writes()[0]!.body).toBeUndefined()
    expect(query()).toEqual({ day: 'christmas' })
    expect(text(wrapper, 'editor-note')).toBe('Saved as the scene "Christmas". The day now uses it.')
    expect((find(wrapper, 'day-scene').element as HTMLSelectElement).value).toBe('christmas')
    expect(findAll(wrapper, 'mark-from')).toHaveLength(6)
    expect(findAll(wrapper, 'day-row')[3]!.find('.summary').text()).toBe('Christmas scene')
  })

  it('shows a day on every display for a minute', async () => {
    displays = [
      { id: 'hallway', name: 'Hallway', timezone: 'Europe/London' },
      { id: 'kitchen', name: 'Kitchen', timezone: 'Europe/London' },
    ]
    const wrapper = await open('/settings/special-days?day=isla-birthday')

    await click(wrapper, 'day-preview')

    expect(written()).toEqual(['POST /api/displays/hallway/commands', 'POST /api/displays/kitchen/commands'])
    expect(writes().map(request => request.body)).toEqual([
      { type: 'preview_special_day', id: 'isla-birthday' },
      { type: 'preview_special_day', id: 'isla-birthday' },
    ])
    expect(text(wrapper, 'editor-note')).toBe('Showing on Hallway and Kitchen for a minute.')
  })

  it('shows a scene by its id', async () => {
    const wrapper = await open('/settings/special-days?scene=birthday')

    await click(wrapper, 'scene-preview')

    expect(written()).toEqual(['POST /api/displays/hallway/commands'])
    expect(bodyOf()).toEqual({ type: 'preview_special_day', scene: 'birthday' })
    expect(text(wrapper, 'editor-note')).toBe('Showing on Hallway for a minute.')
  })

  it('says so when there is no display to show it on', async () => {
    displays = []
    const wrapper = await open('/settings/special-days?day=isla-birthday')

    await click(wrapper, 'day-preview')

    expect(writes()).toEqual([])
    expect(text(wrapper, 'editor-note')).toBe('There is no display to show it on.')
  })

  it('says what went wrong when the wall can\'t be told', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')
    refuseNext = refusal(404, 'No such display')

    await click(wrapper, 'day-preview')

    expect(text(wrapper, 'editor-note')).toBe('The server couldn\'t show it on the wall')
  })

  it('asks to save first while there are unsaved changes', async () => {
    const wrapper = await open('/settings/special-days?day=isla-birthday')

    await type(wrapper, 'day-name', 'Isla')

    for (const testid of ['day-duplicate', 'day-save-as-scene', 'day-preview']) {
      expect(disabled(wrapper, testid)).toBe(true)
      expect(find(wrapper, testid).attributes('title')).toMatch(/^Save first to /)
    }
    await find(wrapper, 'day-preview').trigger('click')
    expect(writes()).toEqual([])

    await save(wrapper)

    for (const testid of ['day-duplicate', 'day-save-as-scene', 'day-preview']) expect(disabled(wrapper, testid)).toBe(false)
  })

  it('does the same for a scene', async () => {
    const wrapper = await open('/settings/special-days?scene=birthday')

    await type(wrapper, 'scene-name', 'Birthdays')

    expect(disabled(wrapper, 'scene-duplicate')).toBe(true)
    expect(disabled(wrapper, 'scene-preview')).toBe(true)
    expect(find(wrapper, 'scene-preview').attributes('title')).toBe('Save first to preview')
  })
})

describe('art', () => {
  it('shows a day without an id yet that art waits for the first save', async () => {
    const wrapper = await open('/settings/special-days?new=day')

    for (const slot of ['tile', 'full', 'extra']) expect(find(wrapper, `art-${slot}-drop`).attributes('disabled')).toBeDefined()
    expect(text(wrapper, 'art-tile')).toContain('Save the day first to add art')
  })

  it('uploads a dropped picture with a progress bar, then shows it, keeping what is typed', async () => {
    const wrapper = await open('/settings/special-days?day=fireworks')
    await type(wrapper, 'day-name', 'Bonfire Night')
    expect(find(wrapper, 'art-tile-progress').exists()).toBe(false)

    await drop(wrapper, 'tile', picture('rocket.png'))

    expect(FakeRequest.all).toHaveLength(1)
    expect(upload().method).toBe('POST')
    expect(upload().url).toBe('/api/special-days/fireworks/art/tile')
    expect((upload().body as FormData).get('file')).toMatchObject({ name: 'rocket.png' })
    expect(find(wrapper, 'art-tile-progress').attributes('aria-valuenow')).toBe('0')
    expect(find(wrapper, 'art-tile-drop').attributes('disabled')).toBeDefined()

    upload().upload.onprogress?.({ lengthComputable: true, loaded: 40, total: 100 })
    await settle()
    expect(find(wrapper, 'art-tile-progress').attributes('aria-valuenow')).toBe('40')

    upload().answer('rocket.webp')
    await settle()

    expect(find(wrapper, 'art-tile-progress').exists()).toBe(false)
    expect(find(wrapper, 'art-tile-image').attributes('src')).toBe('/special-days/rocket.webp')
    expect(find(wrapper, 'art-tile-error').exists()).toBe(false)
    expect((find(wrapper, 'day-name').element as HTMLInputElement).value).toBe('Bonfire Night')
    expect(find(wrapper, 'unsaved').exists()).toBe(true)
    expect(findAll(wrapper, 'day-row')[2]!.find('.summary').text()).toBe('Once in 2026 · tile art')
  })

  it('takes a picture chosen with the file picker too', async () => {
    const wrapper = await open('/settings/special-days?day=fireworks')
    const input = find(wrapper, 'art-tile-input')
    Object.defineProperty(input.element, 'files', { value: [picture('rocket.svg', 'image/svg+xml')], configurable: true })

    await input.trigger('change')
    await settle()

    expect(upload().url).toBe('/api/special-days/fireworks/art/tile')
  })

  it('uploads a scene\'s full-screen art and the day\'s extra layer to their own routes', async () => {
    const scenePage = await open('/settings/special-days?scene=birthday')
    await drop(scenePage, 'full', picture('party.jpg', 'image/jpeg', 5 * 1024 * 1024))
    expect(upload().url).toBe('/api/special-day-scenes/birthday/art/full')
    upload().answer('party2.webp')
    await settle()
    expect(find(scenePage, 'art-full-image').attributes('src')).toBe('/special-days/party2.webp')

    const dayPage = await open('/settings/special-days?day=isla-birthday')
    await drop(dayPage, 'extra', picture('seven.png'))
    expect(upload().url).toBe('/api/special-days/isla-birthday/art/extra')
  })

  it('refuses a file of the wrong type without sending it', async () => {
    const wrapper = await open('/settings/special-days?day=fireworks')

    await drop(wrapper, 'tile', picture('notes.txt', 'text/plain'))

    expect(text(wrapper, 'art-tile-error')).toBe('Tile art must be a PNG, WebP or SVG')
    expect(FakeRequest.all).toHaveLength(0)
    expect(writes()).toEqual([])
    expect(find(wrapper, 'art-tile-progress').exists()).toBe(false)
  })

  it('refuses a file that is too big without sending it', async () => {
    const wrapper = await open('/settings/special-days?day=fireworks')

    await drop(wrapper, 'tile', picture('huge.png', 'image/png', 3 * 1024 * 1024))

    expect(text(wrapper, 'art-tile-error')).toBe('Tile art must be 2 MB or smaller (this one is 3.0 MB)')
    expect(FakeRequest.all).toHaveLength(0)
  })

  it('refuses a full-screen file that isn\'t a picture', async () => {
    const wrapper = await open('/settings/special-days?scene=birthday')

    await drop(wrapper, 'full', picture('notes.pdf', 'application/pdf'))

    expect(text(wrapper, 'art-full-error')).toBe('Full-screen art must be an image')
    expect(FakeRequest.all).toHaveLength(0)
  })

  it('keeps the error with the day it was for', async () => {
    const wrapper = await open('/settings/special-days?day=fireworks')
    await drop(wrapper, 'tile', picture('notes.txt', 'text/plain'))
    expect(find(wrapper, 'art-tile-error').exists()).toBe(true)

    await findAll(wrapper, 'day-row')[0]!.trigger('click')
    await settle()

    expect(find(wrapper, 'art-tile-error').exists()).toBe(false)
  })

  it('shows the server\'s reason when it refuses the picture', async () => {
    const wrapper = await open('/settings/special-days?day=fireworks')
    await drop(wrapper, 'tile', picture('rocket.png'))

    upload().respond(415, { statusCode: 415, message: 'that is not a picture the server can read' })
    await settle()

    expect(text(wrapper, 'art-tile-error')).toBe('That is not a picture the server can read')
    expect(find(wrapper, 'art-tile-progress').exists()).toBe(false)
    expect(find(wrapper, 'art-tile-drop').attributes('disabled')).toBeUndefined()
  })

  it('says when the server can\'t be reached for an upload', async () => {
    const wrapper = await open('/settings/special-days?day=fireworks')
    await drop(wrapper, 'tile', picture('rocket.png'))

    upload().onerror?.()
    await settle()

    expect(text(wrapper, 'art-tile-error')).toContain('server')
  })

  it('removes a day\'s own art with a DELETE', async () => {
    const wrapper = await open('/settings/special-days?day=christmas')
    expect(find(wrapper, 'art-tile-image').attributes('src')).toBe('/special-days/tree.svg')

    await click(wrapper, 'art-tile-remove')

    expect(written()).toEqual(['DELETE /api/special-days/christmas/art/tile'])
    expect(find(wrapper, 'art-tile-image').exists()).toBe(false)
    expect(find(wrapper, 'art-tile-remove').exists()).toBe(false)
  })

  it('goes back to the scene\'s art with Reset', async () => {
    days = [day({ ...isla(), tile_art: 'isla.webp' })]
    const wrapper = await open('/settings/special-days?day=isla-birthday')
    expect(find(wrapper, 'art-tile-image').attributes('src')).toBe('/special-days/isla.webp')
    expect(find(wrapper, 'art-tile').find('[data-testid="mark-changed"]').exists()).toBe(true)

    await find(wrapper, 'art-tile').find('[data-testid="reset"]').trigger('click')
    await settle()

    expect(written()).toEqual(['DELETE /api/special-days/isla-birthday/art/tile'])
    expect(find(wrapper, 'art-tile-image').attributes('src')).toBe('/special-days/cake.webp')
    expect(find(wrapper, 'art-tile').find('[data-testid="mark-from"]').text()).toBe('From Birthday')
  })

  it('removes a scene\'s art', async () => {
    const wrapper = await open('/settings/special-days?scene=birthday')

    await click(wrapper, 'art-full-remove')

    expect(written()).toEqual(['DELETE /api/special-day-scenes/birthday/art/full'])
    expect(find(wrapper, 'art-full-image').exists()).toBe(false)
  })
})

describe('the PIN', () => {
  /** The PIN dialog is open: type the PIN and send it. */
  async function enterPin(wrapper: Wrapper, value: string) {
    await type(wrapper, 'pin-input', value)
    await find(wrapper, 'pin-dialog').find('form').trigger('submit')
    await settle()
  }

  it('asks for the PIN when a save is refused, and saves again once it is right', async () => {
    pin = '4821'
    const wrapper = await open('/settings/special-days?day=isla-birthday')
    await type(wrapper, 'day-name', 'Isla\'s party')

    await save(wrapper)

    expect(find(wrapper, 'pin-dialog').exists()).toBe(true)
    expect(find(wrapper, 'server-error').exists()).toBe(false)
    expect(writes().map(request => [request.method, request.pin])).toEqual([['PUT', null]])

    await enterPin(wrapper, '1111')
    expect(text(wrapper, 'pin-message')).toBe(PIN_ERRORS.wrong)
    expect(writes()).toHaveLength(1)

    await enterPin(wrapper, '4821')

    expect(find(wrapper, 'pin-dialog').exists()).toBe(false)
    expect(writes().map(request => [request.method, request.url, request.pin])).toEqual([
      ['PUT', '/api/special-days/isla-birthday', null],
      ['PUT', '/api/special-days/isla-birthday', '4821'],
    ])
    expect(text(wrapper, 'editor-note')).toBe('Saved.')
    expect(localStorage.getItem('wallcal.remote.pin')).toBe('4821')
  })

  it('sends the PIN it has with the first try', async () => {
    pin = '4821'
    localStorage.setItem('wallcal.remote.pin', '4821')
    const wrapper = await open('/settings/special-days?day=isla-birthday')
    await type(wrapper, 'day-name', 'Isla\'s party')

    await save(wrapper)

    expect(find(wrapper, 'pin-dialog').exists()).toBe(false)
    expect(writes().map(request => request.pin)).toEqual(['4821'])
  })

  it('drops the save when the PIN is cancelled, and keeps the changes', async () => {
    pin = '4821'
    const wrapper = await open('/settings/special-days?day=isla-birthday')
    await type(wrapper, 'day-name', 'Isla\'s party')
    await save(wrapper)

    await click(wrapper, 'pin-cancel')

    expect(find(wrapper, 'pin-dialog').exists()).toBe(false)
    expect(writes()).toHaveLength(1)
    expect(find(wrapper, 'unsaved').exists()).toBe(true)
    expect(find(wrapper, 'server-error').exists()).toBe(false)
  })

  it('asks for it for a delete, and deletes once it is right', async () => {
    pin = '4821'
    const wrapper = await open('/settings/special-days?day=fireworks')

    await click(wrapper, 'day-delete')
    await click(wrapper, 'confirm-ok')
    expect(find(wrapper, 'pin-dialog').exists()).toBe(true)
    await enterPin(wrapper, '4821')

    expect(written()).toEqual(['DELETE /api/special-days/fireworks', 'DELETE /api/special-days/fireworks'])
    expect(rowNames(wrapper)).not.toContain('Fireworks')
  })

  it('asks for it for an upload, and sends the same picture again with it', async () => {
    pin = '4821'
    const wrapper = await open('/settings/special-days?day=fireworks')
    await drop(wrapper, 'tile', picture('rocket.png'))
    expect(FakeRequest.all).toHaveLength(1)

    upload().answer('rocket.webp')
    await settle()
    expect(find(wrapper, 'pin-dialog').exists()).toBe(true)
    expect(find(wrapper, 'art-tile-error').exists()).toBe(false)

    await enterPin(wrapper, '4821')

    expect(FakeRequest.all).toHaveLength(2)
    expect(upload().headers[PIN_HEADER]).toBe('4821')
    expect((upload().body as FormData).get('file')).toMatchObject({ name: 'rocket.png' })
    upload().answer('rocket.webp')
    await settle()
    expect(find(wrapper, 'art-tile-image').attributes('src')).toBe('/special-days/rocket.webp')
  })

  it('asks for it for Preview on wall, and sends the preview with it', async () => {
    pin = '4821'
    const wrapper = await open('/settings/special-days?day=isla-birthday')

    await click(wrapper, 'day-preview')
    expect(find(wrapper, 'pin-dialog').exists()).toBe(true)
    await enterPin(wrapper, '4821')

    expect(writes().map(request => [request.url, request.pin])).toEqual([
      ['/api/displays/hallway/commands', null],
      ['/api/displays/hallway/commands', '4821'],
    ])
    expect(text(wrapper, 'editor-note')).toBe('Showing on Hallway for a minute.')
  })
})
