import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import StarsPage from '~/pages/settings/stars.vue'
import { PIN_ERRORS, PIN_HEADER } from '../../shared/remote'
import type { StarChart, StarSettingsBody, StarSettingsEntry } from '../../shared/stars'

// The settings Stars tab against a pretend server: `$fetch` answers as the real
// routes do (shared/stars.ts, server/api/stars and settings/stars) and every
// request is recorded. The tab's looks are in test/visual/settings.spec.ts.

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

// Wednesday 28 October 2026, 09:41 in London. The week (from Monday) is 26 Oct to 1 Nov.
const NOW = new Date('2026-10-28T09:41:00Z')
const TODAY = '2026-10-28'

const PEOPLE = [
  { id: 'isla', name: 'Isla', initial: 'I', colour: '#E8963B' },
  { id: 'max', name: 'Max', initial: 'M', colour: '#4C8FD6' },
]

let entries: StarSettingsEntry[]
let counts: StarChart['counts']
let pin: string | null
let requests: { method: string, url: string, body: unknown, pin: string | null }[]

function refusal(code: number, message: string) {
  return Object.assign(new Error(`${code}`), { statusCode: code, data: { statusCode: code, message } })
}

const chart = (): StarChart => ({
  people: entries.filter(entry => entry.enabled).map(({ id, name, initial, colour, period, goal }) => ({ id, name, initial, colour, period, goal })),
  counts: structuredClone(counts),
})

async function server(url: string, options: { method?: string, body?: unknown, headers?: Record<string, string> } = {}) {
  const method = options.method ?? 'GET'
  const sentPin = options.headers?.[PIN_HEADER] ?? null
  requests.push({ method, url, body: options.body, pin: sentPin })
  if (method === 'GET') {
    if (url === '/api/settings/stars') return structuredClone(entries)
    if (url === '/api/stars') return chart()
    if (url === '/api/displays') return [{ id: 'hallway', name: 'Hallway', week_start: 'monday', timezone: 'Europe/London' }]
    throw refusal(404, `Not found: ${url}`)
  }
  if (url === '/api/remote/pin') {
    if (sentPin !== pin) throw refusal(401, PIN_ERRORS.wrong)
    return undefined
  }
  if (pin !== null && sentPin !== pin) throw refusal(401, sentPin === null ? PIN_ERRORS.missing : PIN_ERRORS.wrong)
  const id = decodeURIComponent(url.split('/').at(-1)!)
  if (url.startsWith('/api/settings/stars/')) {
    const body = options.body as StarSettingsBody
    const entry = entries.find(candidate => candidate.id === id)
    if (!entry) throw refusal(404, 'Unknown person')
    Object.assign(entry, body)
    return structuredClone(entry)
  }
  if (url.startsWith('/api/stars/')) {
    const { delta, date } = options.body as { delta: number, date?: string }
    const day = date ?? TODAY
    counts[id] = { ...counts[id], [day]: Math.max(0, (counts[id]?.[day] ?? 0) + delta) }
    return chart()
  }
  throw refusal(404, `Not found: ${url}`)
}

const mounted: { unmount: () => void }[] = []
async function mountPage() {
  const wrapper = await mountSuspended(StarsPage, { route: '/settings/stars' })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

const writes = () => requests.filter(request => request.method !== 'GET' && request.url !== '/api/remote/pin')

beforeEach(() => {
  entries = [
    { ...PEOPLE[0]!, enabled: true, period: 'week', goal: 10 },
    { ...PEOPLE[1]!, enabled: false, period: 'week', goal: null },
  ]
  counts = { isla: { [TODAY]: 2, '2026-10-26': 3, '2026-10-20': 5 } }
  pin = null
  requests = []
  fetchMock.mockImplementation(server)
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  localStorage.clear()
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the Stars tab', () => {
  it('lists every person with their switch, period and goal', async () => {
    const wrapper = await mountPage()
    const isla = wrapper.find('[data-testid="star-person-isla"]')
    const max = wrapper.find('[data-testid="star-person-max"]')

    expect(isla.text()).toContain('Isla')
    expect(isla.find('[data-testid="star-enabled"]').attributes('aria-checked')).toBe('true')
    expect((isla.find('[data-testid="star-period-week"]').element as HTMLInputElement).checked).toBe(true)
    expect((isla.find('[data-testid="star-goal"]').element as HTMLInputElement).value).toBe('10')
    expect(max.find('[data-testid="star-enabled"]').attributes('aria-checked')).toBe('false')
    expect((max.find('[data-testid="star-goal"]').element as HTMLInputElement).value).toBe('')
    expect(max.find('[data-testid="star-goal"]').attributes('disabled')).toBeDefined()
  })

  it('switches a chart on with a PUT of the whole settings', async () => {
    const wrapper = await mountPage()

    await wrapper.find('[data-testid="star-person-max"] [data-testid="star-enabled"]').trigger('click')
    await flushPromises()

    expect(writes()).toEqual([{ method: 'PUT', url: '/api/settings/stars/max', body: { enabled: true, period: 'week', goal: null }, pin: null }])
    expect(wrapper.find('[data-testid="star-person-max"] [data-testid="star-enabled"]').attributes('aria-checked')).toBe('true')
    // They join the week below.
    expect(wrapper.find('[data-testid="star-week-max"]').exists()).toBe(true)
  })

  it('saves a period and a goal, and a blank goal as none', async () => {
    const wrapper = await mountPage()
    const isla = () => wrapper.find('[data-testid="star-person-isla"]')

    await isla().find('[data-testid="star-period-day"]').setValue(true)
    await flushPromises()
    expect(writes().at(-1)!.body).toEqual({ enabled: true, period: 'day', goal: 10 })

    await isla().find('[data-testid="star-goal"]').setValue('4')
    await isla().find('[data-testid="star-goal"]').trigger('change')
    await flushPromises()
    expect(writes().at(-1)!.body).toEqual({ enabled: true, period: 'day', goal: 4 })

    await isla().find('[data-testid="star-goal"]').setValue('')
    await isla().find('[data-testid="star-goal"]').trigger('change')
    await flushPromises()
    expect(writes().at(-1)!.body).toEqual({ enabled: true, period: 'day', goal: null })
  })

  it('does not send a goal that is not a whole number from 1 to 99', async () => {
    const wrapper = await mountPage()
    const input = wrapper.find('[data-testid="star-person-isla"] [data-testid="star-goal"]')

    for (const bad of ['abc', '0', '100', '2.5']) {
      await input.setValue(bad)
      await input.trigger('change')
      expect(wrapper.find('[data-testid="star-goal-error"]').exists()).toBe(true)
    }
    expect(writes()).toEqual([])

    await input.setValue('7')
    await input.trigger('change')
    await flushPromises()
    expect(wrapper.find('[data-testid="star-goal-error"]').exists()).toBe(false)
    expect(writes()).toHaveLength(1)
  })

  it('shows this week for the people with a chart, with the week\'s total', async () => {
    const wrapper = await mountPage()

    expect(wrapper.findAll('[data-testid^="star-week-"]').map(row => row.attributes('data-testid'))).toEqual(['star-week-isla'])
    expect(wrapper.findAll('[data-date]').map(cell => cell.attributes('data-date'))).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'])
    expect(wrapper.find('[data-testid="star-count-isla-2026-10-26"]').text()).toBe('3')
    expect(wrapper.find('[data-testid="star-count-isla-2026-10-27"]').text()).toBe('0')
    expect(wrapper.find('[data-testid="star-count-isla-2026-10-28"]').text()).toBe('2')
    // Last week's 5 are not in it.
    expect(wrapper.find('[data-testid="star-weektotal-isla"]').text()).toContain('5')
  })

  it('corrects a day with a POST carrying its date, and cannot change the days to come', async () => {
    const wrapper = await mountPage()

    await wrapper.find('[data-testid="star-plus-isla-2026-10-27"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="star-minus-isla-2026-10-26"]').trigger('click')
    await flushPromises()

    expect(writes().map(write => [write.method, write.url, write.body])).toEqual([
      ['POST', '/api/stars/isla', { delta: 1, date: '2026-10-27' }],
      ['POST', '/api/stars/isla', { delta: -1, date: '2026-10-26' }],
    ])
    expect(wrapper.find('[data-testid="star-count-isla-2026-10-27"]').text()).toBe('1')
    expect(wrapper.find('[data-testid="star-count-isla-2026-10-26"]').text()).toBe('2')
    expect(wrapper.find('[data-testid="star-plus-isla-2026-10-29"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="star-minus-isla-2026-10-27"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-testid="star-minus-isla-2026-10-28"]').attributes('disabled')).toBeUndefined()
  })

  it('asks for the PIN and sends the write again once it is right', async () => {
    pin = '4821'
    const wrapper = await mountPage()

    await wrapper.find('[data-testid="star-plus-isla-2026-10-27"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="pin-dialog"]').exists()).toBe(true)

    await wrapper.find('[data-testid="pin-input"]').setValue('4821')
    await wrapper.find('[data-testid="pin-dialog"] form').trigger('submit')
    await flushPromises()

    expect(writes().at(-1)).toMatchObject({ url: '/api/stars/isla', pin: '4821' })
    expect(wrapper.find('[data-testid="star-count-isla-2026-10-27"]').text()).toBe('1')
  })

  it('shows a refusal in a notice and puts the line back', async () => {
    const wrapper = await mountPage()
    fetchMock.mockImplementation(async (url: string, options: { method?: string } = {}) => {
      if (options.method === 'PUT') throw refusal(409, 'goal is too high')
      return server(url, options)
    })

    await wrapper.find('[data-testid="star-person-max"] [data-testid="star-enabled"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="stars-error"]').text()).toBe('Goal is too high')
    expect(wrapper.find('[data-testid="star-person-max"] [data-testid="star-enabled"]').attributes('aria-checked')).toBe('false')
  })

  it('says so when the server cannot be reached', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch')
    })
    const wrapper = await mountPage()

    expect(wrapper.find('[data-testid="stars-unreachable"]').text()).toBe('Couldn\'t reach the server')
  })
})
