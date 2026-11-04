import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import DisplaysPage from '~/pages/settings/displays.vue'
import { displayStateSchema } from '../../shared/display'
import { PIN_ERRORS, PIN_HEADER } from '../../shared/remote'
import type { DisplayPreferences, DisplayPreferencesEntry, PreferencesStatus, PreferencesUpdate, SharedPreferences } from '../../shared/settings'

// The Displays tab's preferences forms (PR 5.6) against a pretend server that
// answers GET /api/settings/preferences and the two PUTs as the real routes do
// (shared/settings.ts). The rest of the tab is covered in settings.test.ts.

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

const displayValues: DisplayPreferences = {
  theme: 'light',
  month_style: 'soft',
  week_start: 'monday',
  month_return_minutes: 5,
  week_hours: { from: 7, to: 21 },
  burn_in: true,
  night_text: 'none',
}

const sharedValues: SharedPreferences = {
  photo_interval_seconds: 60,
  off_after_minutes: 10,
  quiet_hours: null,
  night_action: 'none',
  night_below_lux: null,
  night_above_lux: null,
  min_step: 5,
  smoothing_seconds: 30,
}

const entry = (id: string, changes: Partial<DisplayPreferences> = {}, changed: DisplayPreferencesEntry['changed'] = []): DisplayPreferencesEntry => ({
  id,
  name: id === 'hallway' ? 'Hallway' : 'Kitchen',
  values: { ...structuredClone(displayValues), ...changes },
  config: structuredClone(displayValues),
  changed,
})

const status = (changes: Partial<PreferencesStatus> = {}): PreferencesStatus => ({
  displays: [entry('hallway'), entry('kitchen')],
  shared: { values: structuredClone(sharedValues), config: structuredClone(sharedValues), changed: [] },
  photos_configured: true,
  alarm_configured: true,
  mqtt_configured: true,
  ...changes,
})

let current: PreferencesStatus
let requests: { method: string, url: string, body: unknown, pin: string | null }[]
/** What the next PUT answers with instead of applying, when set. */
let refuse: (() => never) | null
let pin: string | null

function refusal(code: number, message: string, data?: unknown) {
  return Object.assign(new Error(`${code}`), { statusCode: code, data: { statusCode: code, message, data } })
}

/** Applies an update to a set of values and the keys that have a saved change, as the server would. */
function apply<T extends object>(set: { values: T, config: T, changed: string[] }, update: PreferencesUpdate<T>) {
  for (const [key, value] of Object.entries(update.set ?? {})) {
    ;(set.values as Record<string, unknown>)[key] = value
    if (!set.changed.includes(key)) set.changed.push(key)
  }
  for (const key of update.reset ?? []) {
    ;(set.values as Record<string, unknown>)[key] = (set.config as Record<string, unknown>)[key]
    set.changed = set.changed.filter(item => item !== key)
  }
  return set
}

function server(url: string, options: { method?: string, body?: unknown, headers?: Record<string, string> } = {}) {
  const method = options.method ?? 'GET'
  const sentPin = options.headers?.[PIN_HEADER] ?? null
  requests.push({ method, url, body: options.body, pin: sentPin })
  if (url === '/api/settings/displays') {
    return [{ id: 'hallway', name: 'Hallway', theme: 'light', month_style: 'soft', state: displayStateSchema.parse({}), sockets: { display: 1, remote: 0 }, mqtt: 'connected', mqtt_error: null }]
  }
  if (url === '/api/settings/connections') return { mqtt: { configured: true, broker: 'mqtt://x', discovery: true, connected: 1, total: 1 }, homeassistant: { configured: false, state: 'unconfigured', error: null, checked_at: null } }
  if (url === '/api/remote') return { pin_required: pin !== null }
  if (url === '/api/remote/pin') {
    if (sentPin !== pin) throw refusal(401, PIN_ERRORS.wrong)
    return undefined
  }
  if (method === 'GET' && url === '/api/settings/preferences') return structuredClone(current)
  if (method === 'PUT') {
    if (pin !== null && sentPin !== pin) throw refusal(401, sentPin ? PIN_ERRORS.wrong : PIN_ERRORS.missing)
    if (refuse) refuse()
    const update = options.body as PreferencesUpdate<never>
    if (url.startsWith('/api/settings/preferences/displays/')) {
      const found = current.displays.find(item => item.id === decodeURIComponent(url.split('/').pop()!))
      if (!found) throw refusal(404, 'No such display')
      apply(found, update as PreferencesUpdate<DisplayPreferences>)
    } else if (url === '/api/settings/preferences/shared') {
      apply(current.shared, update as PreferencesUpdate<SharedPreferences>)
    }
    return structuredClone(current)
  }
  throw refusal(404, `Not found: ${url}`)
}

const puts = () => requests.filter(request => request.method === 'PUT')

const mounted: { unmount: () => void }[] = []

async function open() {
  const wrapper = await mountSuspended(DisplaysPage, { route: '/settings/displays' })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof open>>
const hallway = (wrapper: Wrapper) => wrapper.find('[data-display="hallway"]')
const shared = (wrapper: Wrapper) => wrapper.find('[data-testid="shared-card"]')

beforeEach(() => {
  fetchMock.mockImplementation(server)
  current = status()
  requests = []
  refuse = null
  pin = null
  localStorage.clear()
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
})

describe('the display preferences', () => {
  it('shows the values in force, with no marks while nothing has a saved change', async () => {
    const wrapper = await open()
    const card = hallway(wrapper)

    expect((card.find('[data-testid="theme-light"]').element as HTMLInputElement).checked).toBe(true)
    expect((card.find('[data-testid="week_start-monday"]').element as HTMLInputElement).checked).toBe(true)
    expect((card.find('[data-testid="month_return_minutes"]').element as HTMLInputElement).value).toBe('5')
    expect((card.find('[data-testid="week_hours-from"]').element as HTMLSelectElement).value).toBe('7')
    expect((card.find('[data-testid="week_hours-to"]').element as HTMLSelectElement).value).toBe('21')
    expect(card.find('[data-testid="burn_in"]').attributes('aria-checked')).toBe('true')
    expect(card.find('[data-testid="mark-changed"]').exists()).toBe(false)
    expect(card.find('[data-testid="save"]').attributes('disabled')).toBeDefined()
    expect(card.find('[data-testid="unsaved"]').exists()).toBe(false)
  })

  it('marks a key with a saved change, Changed with a Reset, on that card only', async () => {
    current = status({ displays: [entry('hallway', { theme: 'dark' }, ['theme']), entry('kitchen')] })
    const wrapper = await open()

    const marks = hallway(wrapper).findAll('[data-testid="mark-changed"]')
    expect(marks).toHaveLength(1)
    expect(hallway(wrapper).find('[data-pref="theme"] [data-testid="mark-changed"]').text()).toBe('Changed')
    expect(hallway(wrapper).find('[data-testid="reset"]').attributes('aria-label')).toBe('Reset Theme to Light')
    expect((hallway(wrapper).find('[data-testid="theme-dark"]').element as HTMLInputElement).checked).toBe(true)
  })

  it('saves only the keys that were edited, and then shows them as changed', async () => {
    const wrapper = await open()
    const card = hallway(wrapper)

    await card.find('[data-testid="theme-dark"]').setValue(true)
    await card.find('[data-testid="burn_in"]').trigger('click')
    expect(card.find('[data-testid="unsaved"]').exists()).toBe(true)
    await card.find('[data-testid="save"]').trigger('click')
    await flushPromises()

    expect(puts()).toEqual([{ method: 'PUT', url: '/api/settings/preferences/displays/hallway', body: { set: { theme: 'dark', burn_in: false } }, pin: null }])
    expect(card.findAll('[data-testid="mark-changed"]')).toHaveLength(2)
    expect(card.find('[data-testid="unsaved"]').exists()).toBe(false)
    expect(card.find('[data-testid="preferences-outcome"]').text()).toContain('Saved')
  })

  it('sends a changed week hours and minutes as numbers', async () => {
    const wrapper = await open()
    const card = hallway(wrapper)

    await card.find('[data-testid="week_hours-to"]').setValue('22')
    await card.find('[data-testid="month_return_minutes"]').setValue('12')
    await card.find('[data-testid="save"]').trigger('click')
    await flushPromises()

    expect(puts()[0]!.body).toEqual({ set: { week_hours: { from: 7, to: 22 }, month_return_minutes: 12 } })
  })

  it('Reset sends reset for that key and goes back to the config\'s value', async () => {
    current = status({ displays: [entry('hallway', { theme: 'dark' }, ['theme']), entry('kitchen')] })
    const wrapper = await open()
    const card = hallway(wrapper)

    await card.find('[data-testid="reset"]').trigger('click')
    await flushPromises()

    expect(puts()).toEqual([{ method: 'PUT', url: '/api/settings/preferences/displays/hallway', body: { reset: ['theme'] }, pin: null }])
    expect(card.find('[data-testid="mark-changed"]').exists()).toBe(false)
    expect((card.find('[data-testid="theme-light"]').element as HTMLInputElement).checked).toBe(true)
  })

  it('keeps an unsaved edit of another key when one is reset', async () => {
    current = status({ displays: [entry('hallway', { theme: 'dark' }, ['theme']), entry('kitchen')] })
    const wrapper = await open()
    const card = hallway(wrapper)

    await card.find('[data-testid="burn_in"]').trigger('click')
    await card.find('[data-testid="reset"]').trigger('click')
    await flushPromises()

    expect(card.find('[data-testid="burn_in"]').attributes('aria-checked')).toBe('false')
    expect(card.find('[data-testid="unsaved"]').exists()).toBe(true)
  })

  it('discards edits back to what is in force', async () => {
    const wrapper = await open()
    const card = hallway(wrapper)

    await card.find('[data-testid="theme-dark"]').setValue(true)
    await card.find('[data-testid="discard"]').trigger('click')

    expect((card.find('[data-testid="theme-light"]').element as HTMLInputElement).checked).toBe(true)
    expect(card.find('[data-testid="unsaved"]').exists()).toBe(false)
  })

  it('shows the server\'s message under the field when it refuses a value, and saves nothing', async () => {
    refuse = () => {
      throw refusal(400, 'week_hours: from must be before to', { fields: { week_hours: 'from must be before to' } })
    }
    const wrapper = await open()
    const card = hallway(wrapper)

    await card.find('[data-testid="week_hours-from"]').setValue('22')
    await card.find('[data-testid="save"]').trigger('click')
    await flushPromises()

    expect(card.find('[data-pref="week_hours"] [data-testid="field-error"]').text()).toBe('from must be before to')
    expect(card.find('[data-testid="unsaved"]').exists()).toBe(true)
    expect(card.find('[data-testid="mark-changed"]').exists()).toBe(false)
  })

  it('says so when the server can\'t be reached', async () => {
    refuse = () => {
      throw new TypeError('Failed to fetch')
    }
    const wrapper = await open()
    const card = hallway(wrapper)

    await card.find('[data-testid="theme-dark"]').setValue(true)
    await card.find('[data-testid="save"]').trigger('click')
    await flushPromises()

    expect(card.find('[data-testid="preferences-outcome"]').text()).toContain('reach')
  })

  it('disables Next alarm without an alarm block, and not with one', async () => {
    current = status({ alarm_configured: false })
    const without = await open()
    expect(hallway(without).find('[data-testid="night_text-next_alarm"]').attributes('disabled')).toBeDefined()
    expect(hallway(without).find('[data-testid="night_text-first_event"]').attributes('disabled')).toBeUndefined()
    expect(hallway(without).text()).toContain('Next alarm needs an alarm block')

    current = status()
    const withAlarm = await open()
    expect(hallway(withAlarm).find('[data-testid="night_text-next_alarm"]').attributes('disabled')).toBeUndefined()
  })

  it('asks for the PIN when the server wants one, and saves once it is given', async () => {
    pin = '4821'
    const wrapper = await open()
    const card = hallway(wrapper)

    await card.find('[data-testid="theme-dark"]').setValue(true)
    await card.find('[data-testid="save"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="pin-dialog"]').exists()).toBe(true)
    expect(puts()).toHaveLength(1)

    await wrapper.find('[data-testid="pin-input"]').setValue('4821')
    await wrapper.find('[data-testid="pin-dialog"]').find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid="pin-dialog"]').exists()).toBe(false)
    expect(puts().map(request => [request.pin, request.body])).toEqual([[null, { set: { theme: 'dark' } }], ['4821', { set: { theme: 'dark' } }]])
    expect(card.find('[data-testid="mark-changed"]').exists()).toBe(true)
  })
})

describe('the shared preferences', () => {
  it('has an Every display card with the shared values', async () => {
    const wrapper = await open()

    expect(shared(wrapper).find('h2').text()).toBe('Every display')
    expect((shared(wrapper).find('[data-testid="photo_interval_seconds"]').element as HTMLInputElement).value).toBe('60')
    expect((shared(wrapper).find('[data-testid="off_after_minutes"]').element as HTMLInputElement).value).toBe('10')
    expect((shared(wrapper).find('[data-testid="night_below_lux"]').element as HTMLInputElement).value).toBe('')
    expect(shared(wrapper).find('[data-testid="quiet_hours"]').attributes('aria-checked')).toBe('false')
    expect(shared(wrapper).find('[data-testid="quiet_hours-from"]').exists()).toBe(false)
  })

  it('saves only the edited keys, with a blank lux box as null', async () => {
    current = status({ shared: { values: { ...sharedValues, night_action: 'night_view', night_below_lux: 5 }, config: structuredClone(sharedValues), changed: ['night_action', 'night_below_lux'] } })
    const wrapper = await open()
    const card = shared(wrapper)

    await card.find('[data-testid="night_below_lux"]').setValue('')
    await card.find('[data-testid="night_action-none"]').setValue(true)
    await card.find('[data-testid="smoothing_seconds"]').setValue('45')
    await card.find('[data-testid="save"]').trigger('click')
    await flushPromises()

    expect(puts()).toEqual([{ method: 'PUT', url: '/api/settings/preferences/shared', body: { set: { night_action: 'none', night_below_lux: null, smoothing_seconds: 45 } }, pin: null }])
  })

  it('turns quiet hours on with times to edit, and sends the window', async () => {
    const wrapper = await open()
    const card = shared(wrapper)

    await card.find('[data-testid="quiet_hours"]').trigger('click')
    expect((card.find('[data-testid="quiet_hours-from"]').element as HTMLInputElement).value).toBe('22:00')
    await card.find('[data-testid="quiet_hours-to"]').setValue('06:30')
    await card.find('[data-testid="save"]').trigger('click')
    await flushPromises()

    expect(puts()[0]!.body).toEqual({ set: { quiet_hours: { from: '22:00', to: '06:30' } } })
  })

  it('Reset on a shared key sends reset', async () => {
    current = status({ shared: { values: { ...sharedValues, min_step: 10 }, config: structuredClone(sharedValues), changed: ['min_step'] } })
    const wrapper = await open()

    await shared(wrapper).find('[data-pref="min_step"] [data-testid="reset"]').trigger('click')
    await flushPromises()

    expect(puts()[0]!.body).toEqual({ reset: ['min_step'] })
    expect((shared(wrapper).find('[data-testid="min_step"]').element as HTMLInputElement).value).toBe('5')
  })

  it('shows the 400\'s message under the field', async () => {
    refuse = () => {
      throw refusal(400, 'night_below_lux is needed', { fields: { night_below_lux: 'is needed when night_action is night_view' } })
    }
    const wrapper = await open()
    const card = shared(wrapper)

    await card.find('[data-testid="night_action-night_view"]').setValue(true)
    await card.find('[data-testid="save"]').trigger('click')
    await flushPromises()

    expect(card.find('[data-pref="night_below_lux"] [data-testid="field-error"]').text()).toBe('is needed when night_action is night_view')
  })

  it('disables the photo interval, with a note, without a photos block', async () => {
    current = status({ photos_configured: false })
    const wrapper = await open()
    const card = shared(wrapper)

    expect(card.find('[data-testid="photo_interval_seconds"]').attributes('disabled')).toBeDefined()
    expect(card.text()).toContain('Photos are not set up')
  })

  it('leaves the photo interval open with a photos block', async () => {
    const wrapper = await open()

    expect(shared(wrapper).find('[data-testid="photo_interval_seconds"]').attributes('disabled')).toBeUndefined()
  })

  it('says the policies need MQTT when there is no mqtt block, and not when there is', async () => {
    current = status({ mqtt_configured: false })
    const without = await open()
    expect(shared(without).find('[data-testid="mqtt-note"]').text()).toContain('mqtt block')

    current = status()
    const withMqtt = await open()
    expect(shared(withMqtt).find('[data-testid="mqtt-note"]').exists()).toBe(false)
  })
})

describe('when the preferences can\'t be read', () => {
  it('shows a notice and no forms, and the rest of the tab still works', async () => {
    fetchMock.mockImplementation((url: string, options?: object) => {
      if (url === '/api/settings/preferences') throw new TypeError('Failed to fetch')
      return server(url, options)
    })
    const wrapper = await open()

    expect(wrapper.find('[data-testid="preferences-failed"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="display-card"]').exists()).toBe(true)
    expect(wrapper.find('[data-preferences]').exists()).toBe(false)
  })
})
