import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h, ref } from 'vue'
import RemotePage from '~/pages/remote.vue'
import { displayStateSchema } from '../../shared/display'
import type { Command, DisplaySettings, DisplayState, PhotoSource } from '../../shared/display'
import { PIN_ERRORS, PIN_HEADER } from '../../shared/remote'
import type { SocketStatus } from '~/composables/useDisplaySocket'
import { OVERLAY_DURATIONS, OVERLAY_ICON_CHOICES } from '~/utils/overlay'

// The remote page against a pretend server: `$fetch` is replaced by one that
// answers the display list, the commands and the PIN check as the real routes
// do, and the socket is a fake the test can open and push states down. The
// page's looks are in test/visual/remote.spec.ts.

// `$fetch` is an auto-import that is fixed when the page is loaded, so it is
// replaced the way Nuxt means imports to be.
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

const settings: DisplaySettings = { id: 'hallway', name: 'Hallway', theme: 'light', month_style: 'soft', week_start: 'monday', timezone: 'Europe/London', photo_sources: [] }
const NOW = new Date('2026-10-28T09:41:00Z')

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
  open() {
    this.onopen?.()
  }

  push(state: DisplayState) {
    this.onmessage?.({ data: JSON.stringify({ type: 'state.updated', display_id: 'hallway', state }) })
  }
}

const stateWith = (changes: Partial<DisplayState> = {}) => displayStateSchema.parse(changes)

// What the pretend server does: the PIN it wants (or none), and every command it was sent.
let pin: string | null = null
let state = stateWith()
let commands: { command: Command, pin: string | null }[] = []
let pinChecks: (string | null)[] = []
let lockedOut = false
// The photo sources the pretend server has set up.
let photoSources: PhotoSource[] = []

/** What each command does to the state, as far as these tests need. */
function apply(command: Command): DisplayState {
  if (command.type === 'set_view') state = stateWith({ ...state, view: command.view })
  if (command.type === 'set_screen') state = stateWith({ ...state, screen: command.screen })
  if (command.type === 'set_photo_source') state = stateWith({ ...state, photo_source: command.photo_source })
  if (command.type === 'set_month') state = stateWith({ ...state, view: 'month', month: command.month === 'current' ? null : command.month })
  if (command.type === 'set_brightness') state = stateWith({ ...state, brightness: command.brightness })
  if (command.type === 'set_overlay') {
    const { overlay } = command
    state = stateWith({
      ...state,
      overlay: overlay && { text: overlay.text, icon: overlay.icon ?? null, until: overlay.ttl === undefined ? null : new Date(NOW.getTime() + overlay.ttl * 1000).toISOString() },
    })
  }
  return state
}

/** A failed request as `$fetch` throws it: the status, and the body the server's errors carry. */
function refusal(status: number, message: string) {
  return Object.assign(new Error(`${status}`), { statusCode: status, data: { statusCode: status, message } })
}

const COMMANDS_URL = '/api/displays/hallway/commands'

interface Options { method?: string, body?: Command, headers?: Record<string, string> }

/** The server: it answers each request as the real routes do (architecture §7.5). */
async function server(url: string, options: Options = {}) {
  const sentPin = options.headers?.[PIN_HEADER] ?? null
  if (url === '/api/displays') return [{ ...settings, photo_sources: photoSources }]
  if (url === '/api/remote') return { pin_required: pin !== null }
  if (url === '/api/remote/pin') {
    pinChecks.push(sentPin)
    if (lockedOut) throw refusal(429, PIN_ERRORS.locked)
    if (sentPin !== pin) throw refusal(401, PIN_ERRORS.wrong)
    return undefined
  }
  if (url === COMMANDS_URL) {
    commands.push({ command: options.body!, pin: sentPin })
    if (lockedOut) throw refusal(429, PIN_ERRORS.locked)
    if (pin !== null && sentPin === null) throw refusal(401, PIN_ERRORS.missing)
    if (pin !== null && sentPin !== pin) throw refusal(401, PIN_ERRORS.wrong)
    return apply(options.body!)
  }
  throw refusal(404, `Not found: ${url}`)
}

/** Mounts the page, opens its socket and sends the first state, as the server does on connect. */
async function mountRemote(initial: Partial<DisplayState> = {}, query = '?id=hallway') {
  state = stateWith(initial)
  const wrapper = await mountSuspended(RemotePage, { route: `/remote${query}` })
  await flushPromises()
  const socket = FakeSocket.all.at(-1)
  socket?.open()
  socket?.push(state)
  await flushPromises()
  return { wrapper, socket }
}

const sent = () => commands.map(entry => entry.command)

describe('the remote page', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeSocket)
    fetchMock.mockImplementation(server)
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    FakeSocket.all = []
    pin = null
    commands = []
    pinChecks = []
    lockedOut = false
    photoSources = []
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('names the display and says it is connected once the socket is open', async () => {
    const { wrapper } = await mountRemote()

    expect(wrapper.find('[data-testid="display-name"]').text()).toBe('Hallway')
    expect(wrapper.find('[data-testid="connection-pill"]').text()).toBe('Connected')
    expect(FakeSocket.all.at(-1)!.url).toContain('/_ws?display=hallway&role=remote')
  })

  it('says Reconnecting until the socket opens, and Connecting before it has a state', async () => {
    state = stateWith()
    const wrapper = await mountSuspended(RemotePage, { route: '/remote?id=hallway' })
    await flushPromises()

    expect(wrapper.text()).toContain('Connecting')
    expect(wrapper.find('[data-testid="display-name"]').exists()).toBe(false)

    FakeSocket.all.at(-1)!.push(state)
    await flushPromises()

    expect(wrapper.find('[data-testid="connection-pill"]').text()).toBe('Reconnecting')
  })

  it('says so for an id the server does not have', async () => {
    const wrapper = await mountSuspended(RemotePage, { route: '/remote?id=garage' })
    await flushPromises()

    expect(wrapper.text()).toContain('Unknown display')
  })

  it('marks the view on the wall, and a tile sends set_view and takes the answer at once', async () => {
    const { wrapper } = await mountRemote({ view: 'month' })
    const pressed = () => wrapper.findAll('.tile').filter(tile => tile.attributes('aria-pressed') === 'true').map(tile => tile.text())

    expect(wrapper.findAll('.tile').map(tile => tile.text())).toEqual(['Agenda', 'Month', 'Week', 'Night'])
    expect(pressed()).toEqual(['Month'])

    await wrapper.find('[data-testid="tile-agenda"]').trigger('click')
    await flushPromises()

    expect(sent()).toEqual([{ type: 'set_view', view: 'agenda' }])
    expect(pressed()).toEqual(['Agenda'])
  })

  it('keeps the latest tap\'s answer when an earlier one comes back after it', async () => {
    const { wrapper } = await mountRemote({ view: 'month' })
    let answerFirst!: () => void
    fetchMock.mockImplementationOnce(async (url: string, options: Options) => {
      const answer = await server(url, options)
      await new Promise<void>((resolve) => {
        answerFirst = resolve
      })
      return answer
    })

    await wrapper.find('[data-testid="tile-agenda"]').trigger('click')
    await wrapper.find('[data-testid="tile-week"]').trigger('click')
    await flushPromises()
    answerFirst()
    await flushPromises()

    expect(sent()).toEqual([{ type: 'set_view', view: 'agenda' }, { type: 'set_view', view: 'week' }])
    expect(wrapper.find('[data-testid="tile-week"]').attributes('aria-pressed')).toBe('true')
  })

  it('follows a state the socket sends', async () => {
    const { wrapper, socket } = await mountRemote({ view: 'month' })

    socket!.push(stateWith({ view: 'night', screen: 'off' }))
    await flushPromises()

    expect(wrapper.find('[data-testid="tile-night"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="tile-month"]').attributes('aria-pressed')).toBe('false')
  })

  describe('the photo frame', () => {
    const photoTile = (wrapper: Awaited<ReturnType<typeof mountRemote>>['wrapper']) => wrapper.find('[data-testid="tile-photo"]')
    const segment = (wrapper: Awaited<ReturnType<typeof mountRemote>>['wrapper'], source: string) => wrapper.find<HTMLButtonElement>(`[data-testid="photo-source-${source}"]`)
    const nextButton = (wrapper: Awaited<ReturnType<typeof mountRemote>>['wrapper']) => wrapper.find<HTMLButtonElement>('[data-testid="photo-next"]')

    it('is left out when the server has no photo source: no tile, no "Photos from"', async () => {
      const { wrapper } = await mountRemote()

      expect(photoTile(wrapper).exists()).toBe(false)
      expect(wrapper.find('[data-testid="photos-from"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Photo frame')
    })

    it('keeps the tile, active, when the wall is on the photo view anyway, but not the section', async () => {
      const { wrapper } = await mountRemote({ view: 'photo' })

      expect(photoTile(wrapper).attributes('aria-pressed')).toBe('true')
      expect(wrapper.find('[data-testid="photos-from"]').exists()).toBe(false)
    })

    it('has a full-width Photo frame tile after the four views, which sends set_view photo', async () => {
      photoSources = ['local']
      const { wrapper } = await mountRemote({ view: 'month' })

      expect(wrapper.findAll('.tile').map(tile => tile.text())).toEqual(['Agenda', 'Month', 'Week', 'Night', 'Photo frame'])
      expect(photoTile(wrapper).classes()).toContain('wide')
      expect(photoTile(wrapper).attributes('aria-pressed')).toBe('false')

      await photoTile(wrapper).trigger('click')
      await flushPromises()

      expect(sent()).toEqual([{ type: 'set_view', view: 'photo' }])
      expect(photoTile(wrapper).attributes('aria-pressed')).toBe('true')
      expect(wrapper.find('[data-testid="tile-month"]').attributes('aria-pressed')).toBe('false')
    })

    it('marks the source in use, and sends set_photo_source for another that is set up', async () => {
      photoSources = ['immich', 'local']
      const { wrapper } = await mountRemote({ view: 'photo', photo_source: 'immich' })

      expect(wrapper.findAll('[data-testid^="photo-source-"]').map(button => button.text().split('\n')[0])).toEqual(['Immich', 'Google Not set up', 'Folder'])
      expect(segment(wrapper, 'immich').attributes('aria-pressed')).toBe('true')
      expect(segment(wrapper, 'local').attributes('aria-pressed')).toBe('false')

      await segment(wrapper, 'local').trigger('click')
      await flushPromises()

      expect(sent()).toEqual([{ type: 'set_photo_source', photo_source: 'local' }])
      expect(segment(wrapper, 'local').attributes('aria-pressed')).toBe('true')
      expect(segment(wrapper, 'immich').attributes('aria-pressed')).toBe('false')
    })

    it('disables a source the server has not set up, with a hint, and sends nothing for it', async () => {
      photoSources = ['local']
      const { wrapper } = await mountRemote({ view: 'photo' })

      for (const source of ['immich', 'google']) {
        expect(segment(wrapper, source).attributes('disabled')).toBeDefined()
        expect(segment(wrapper, source).text()).toContain('Not set up')
      }
      expect(segment(wrapper, 'local').attributes('disabled')).toBeUndefined()
      expect(segment(wrapper, 'local').text()).not.toContain('Not set up')

      await segment(wrapper, 'google').trigger('click')
      await flushPromises()
      expect(sent()).toEqual([])
    })

    it('shows the source the server falls back to when the chosen one is not set up', async () => {
      // The default is Immich, but only the folder is set up, so the folder is what the wall shows.
      photoSources = ['local']
      const { wrapper } = await mountRemote({ view: 'photo', photo_source: 'immich' })

      expect(segment(wrapper, 'local').attributes('aria-pressed')).toBe('true')
      expect(segment(wrapper, 'immich').attributes('aria-pressed')).toBe('false')
    })

    it('groups the segments under the "Photos from" heading', async () => {
      photoSources = ['immich']
      const { wrapper } = await mountRemote({ view: 'photo' })

      const group = wrapper.find('[data-testid="photos-from"] [role="group"]')
      expect(group.attributes('aria-labelledby')).toBe('photos-title')
      expect(wrapper.find('#photos-title').text()).toBe('Photos from')
    })

    it('sends photo_next from Next photo, which reads Skipped for two seconds', async () => {
      photoSources = ['local']
      const { wrapper } = await mountRemote({ view: 'photo' })
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW })
      expect(nextButton(wrapper).text()).toBe('Next photo')

      await nextButton(wrapper).trigger('click')
      await flushPromises()

      expect(sent()).toEqual([{ type: 'photo_next' }])
      expect(nextButton(wrapper).text()).toBe('Skipped')

      await vi.advanceTimersByTimeAsync(1900)
      expect(nextButton(wrapper).text()).toBe('Skipped')
      await vi.advanceTimersByTimeAsync(200)
      expect(nextButton(wrapper).text()).toBe('Next photo')
    })

    it('does not say Skipped when the wall could not be asked', async () => {
      photoSources = ['local']
      const { wrapper } = await mountRemote({ view: 'photo' })
      fetchMock.mockImplementationOnce(async () => {
        throw Object.assign(new Error('offline'), { statusCode: undefined })
      })

      await nextButton(wrapper).trigger('click')
      await flushPromises()

      expect(nextButton(wrapper).text()).toBe('Next photo')
      expect(wrapper.find('[data-testid="error"]').exists()).toBe(true)
    })

    it('has Next photo off, with the reason, while the wall is not on the photo frame', async () => {
      photoSources = ['local']
      const { wrapper, socket } = await mountRemote({ view: 'month' })

      expect(nextButton(wrapper).attributes('disabled')).toBeDefined()
      expect(nextButton(wrapper).attributes('aria-describedby')).toBe('next-photo-reason')
      expect(wrapper.find('[data-testid="photo-next-reason"]').text()).toBe('Turn on the photo frame to skip photos.')
      // The source can be picked ahead of switching.
      expect(segment(wrapper, 'local').attributes('disabled')).toBeUndefined()

      socket!.push(stateWith({ view: 'photo' }))
      await flushPromises()

      expect(nextButton(wrapper).attributes('disabled')).toBeUndefined()
      expect(wrapper.find('[data-testid="photo-next-reason"]').exists()).toBe(false)
    })
  })

  describe('the month picker', () => {
    it('shows only while the month view is on', async () => {
      const { wrapper, socket } = await mountRemote({ view: 'agenda' })
      expect(wrapper.find('[data-testid="month-picker"]').exists()).toBe(false)

      socket!.push(stateWith({ view: 'month' }))
      await flushPromises()

      expect(wrapper.find('[data-testid="month-picker"]').exists()).toBe(true)
    })

    it('offers 25 months and shows the pinned one, or this month', async () => {
      const { wrapper, socket } = await mountRemote({ view: 'month' })
      const select = wrapper.find<HTMLSelectElement>('[data-testid="month-select"]')

      expect(select.findAll('option')).toHaveLength(25)
      expect(select.findAll('option')[0]!.text()).toBe('October 2025')
      expect(select.element.value).toBe('2026-10')

      socket!.push(stateWith({ view: 'month', month: '2027-03', month_set_at: '2026-10-28T09:41:00.000Z' }))
      await flushPromises()

      expect(select.element.value).toBe('2027-03')
    })

    it('sends set_month for a pick, and current for the current month', async () => {
      const { wrapper } = await mountRemote({ view: 'month' })

      await wrapper.find('[data-testid="month-select"]').setValue('2027-03')
      await flushPromises()
      await wrapper.find('[data-testid="month-select"]').setValue('2026-10')
      await flushPromises()

      expect(sent()).toEqual([
        { type: 'set_month', month: '2027-03' },
        { type: 'set_month', month: 'current' },
      ])
    })

    it('has arrows that send prev and next, and stop at 12 months either side', async () => {
      const { wrapper, socket } = await mountRemote({ view: 'month' })

      await wrapper.find('[data-testid="month-prev"]').trigger('click')
      await flushPromises()
      await wrapper.find('[data-testid="month-next"]').trigger('click')
      await flushPromises()
      expect(sent()).toEqual([{ type: 'set_month', month: 'prev' }, { type: 'set_month', month: 'next' }])

      socket!.push(stateWith({ view: 'month', month: '2025-10', month_set_at: '2026-10-28T09:41:00.000Z' }))
      await flushPromises()
      expect(wrapper.find('[data-testid="month-prev"]').attributes('disabled')).toBeDefined()
      expect(wrapper.find('[data-testid="month-next"]').attributes('disabled')).toBeUndefined()

      socket!.push(stateWith({ view: 'month', month: '2027-10', month_set_at: '2026-10-28T09:41:00.000Z' }))
      await flushPromises()
      expect(wrapper.find('[data-testid="month-prev"]').attributes('disabled')).toBeUndefined()
      expect(wrapper.find('[data-testid="month-next"]').attributes('disabled')).toBeDefined()
    })

    it('offers the way back only when another month is pinned', async () => {
      const { wrapper, socket } = await mountRemote({ view: 'month' })
      expect(wrapper.find('[data-testid="month-current"]').exists()).toBe(false)

      socket!.push(stateWith({ view: 'month', month: '2026-12', month_set_at: '2026-10-28T09:41:00.000Z' }))
      await flushPromises()
      const back = wrapper.find('[data-testid="month-current"]')
      expect(back.text()).toBe('Back to this month')

      await back.trigger('click')
      await flushPromises()

      expect(sent()).toEqual([{ type: 'set_month', month: 'current' }])
      expect(wrapper.find('[data-testid="month-current"]').exists()).toBe(false)
    })
  })

  describe('the screen', () => {
    it('says it is on, and the controls are not faded', async () => {
      const { wrapper } = await mountRemote({ screen: 'on' })

      expect(wrapper.find('[data-testid="screen-state"]').text()).toBe('On')
      expect(wrapper.find('[data-testid="screen-toggle"]').attributes('aria-checked')).toBe('true')
      expect(wrapper.find('[data-testid="controls"]').classes()).not.toContain('dimmed')
    })

    it('turns off with the toggle, which fades the controls but leaves them working', async () => {
      const { wrapper } = await mountRemote({ screen: 'on' })

      await wrapper.find('[data-testid="screen-toggle"]').trigger('click')
      await flushPromises()

      expect(sent()).toEqual([{ type: 'set_screen', screen: 'off' }])
      expect(wrapper.find('[data-testid="screen-state"]').text()).toBe('Off, panel in standby')
      expect(wrapper.find('[data-testid="screen-toggle"]').attributes('aria-checked')).toBe('false')
      expect(wrapper.find('[data-testid="controls"]').classes()).toContain('dimmed')

      await wrapper.find('[data-testid="tile-week"]').trigger('click')
      await flushPromises()
      expect(sent().at(-1)).toEqual({ type: 'set_view', view: 'week' })

      await wrapper.find('[data-testid="screen-toggle"]').trigger('click')
      await flushPromises()
      expect(sent().at(-1)).toEqual({ type: 'set_screen', screen: 'on' })
      expect(wrapper.find('[data-testid="controls"]').classes()).not.toContain('dimmed')
    })
  })

  describe('the message', () => {
    const input = (wrapper: Awaited<ReturnType<typeof mountRemote>>['wrapper']) => wrapper.find<HTMLInputElement>('[data-testid="overlay-input"]')
    const submit = (wrapper: Awaited<ReturnType<typeof mountRemote>>['wrapper']) => wrapper.find<HTMLButtonElement>('[data-testid="overlay-submit"]')

    it('has a form for a message, and nothing about one on the wall when there is none', async () => {
      const { wrapper } = await mountRemote()

      expect(wrapper.find('[data-testid="overlay-current"]').exists()).toBe(false)
      expect(input(wrapper).attributes('maxlength')).toBe('200')
      expect(input(wrapper).attributes('placeholder')).toBe('Bins out tonight')
      expect(wrapper.find('label[for="overlay-text"]').exists()).toBe(true)
      expect(wrapper.find('[role="radiogroup"]').findAll('input[type="radio"]').length).toBe(OVERLAY_ICON_CHOICES.length + 1)
      expect(wrapper.findAll('[data-testid="overlay-duration"] option').map(option => option.text())).toEqual(OVERLAY_DURATIONS.map(duration => duration.label))
      expect(wrapper.find<HTMLSelectElement>('[data-testid="overlay-duration"]').element.value).toBe('1h')
    })

    it('cannot be sent with no text, or only spaces', async () => {
      const { wrapper } = await mountRemote()
      expect(submit(wrapper).attributes('disabled')).toBeDefined()

      await input(wrapper).setValue('   ')
      expect(submit(wrapper).attributes('disabled')).toBeDefined()

      await input(wrapper).setValue(' Bins ')
      expect(submit(wrapper).attributes('disabled')).toBeUndefined()
    })

    it('sends the text, icon and duration, and clears the text', async () => {
      const { wrapper } = await mountRemote()

      await input(wrapper).setValue(' Bins out tonight ')
      await wrapper.find('[data-testid="overlay-icon-trash"]').setValue(true)
      await wrapper.find('[data-testid="overlay-duration"]').setValue('3h')
      await wrapper.find('[data-testid="overlay-form"]').trigger('submit')
      await flushPromises()

      expect(sent()).toEqual([{ type: 'set_overlay', overlay: { text: 'Bins out tonight', icon: 'trash', ttl: 10_800 } }])
      expect(input(wrapper).element.value).toBe('')
    })

    it('leaves out the icon for none and the ttl for until cleared', async () => {
      const { wrapper } = await mountRemote()

      await input(wrapper).setValue('Hello')
      await wrapper.find('[data-testid="overlay-duration"]').setValue('cleared')
      await wrapper.find('[data-testid="overlay-form"]').trigger('submit')
      await flushPromises()

      expect(sent()).toEqual([{ type: 'set_overlay', overlay: { text: 'Hello' } }])
    })

    it('keeps the text when the wall does not take it', async () => {
      const { wrapper } = await mountRemote()
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

      await input(wrapper).setValue('Hello')
      await wrapper.find('[data-testid="overlay-form"]').trigger('submit')
      await flushPromises()

      expect(input(wrapper).element.value).toBe('Hello')
      expect(wrapper.find('[data-testid="error"]').exists()).toBe(true)
    })

    it('shows what is on the wall and when it ends, and Clear sends null', async () => {
      const { wrapper } = await mountRemote({ overlay: { text: 'Bins out tonight', icon: 'trash', until: '2026-10-28T14:30:00Z' } })

      expect(wrapper.find('[data-testid="overlay-current-text"]').text()).toBe('Bins out tonight')
      expect(wrapper.find('[data-testid="overlay-current-until"]').text()).toBe('Until 14:30')

      await wrapper.find('[data-testid="overlay-clear"]').trigger('click')
      await flushPromises()

      expect(sent()).toEqual([{ type: 'set_overlay', overlay: null }])
      expect(wrapper.find('[data-testid="overlay-current"]').exists()).toBe(false)
    })

    it('says "Until cleared" for one with no end, and follows the socket', async () => {
      const { wrapper, socket } = await mountRemote()

      socket!.push(stateWith({ overlay: { text: 'Hello', icon: null, until: null } }))
      await flushPromises()

      expect(wrapper.find('[data-testid="overlay-current-until"]').text()).toBe('Until cleared')

      socket!.push(stateWith())
      await flushPromises()

      expect(wrapper.find('[data-testid="overlay-current"]').exists()).toBe(false)
    })

    it('does not show one that has already run out', async () => {
      const { wrapper } = await mountRemote({ overlay: { text: 'Old news', icon: null, until: '2026-10-28T09:00:00Z' } })

      expect(wrapper.find('[data-testid="overlay-current"]').exists()).toBe(false)
    })
  })

  describe('more', () => {
    it('sends the brightness when the slider is let go, not on every step', async () => {
      const { wrapper } = await mountRemote({ brightness: 80 })
      const slider = wrapper.find<HTMLInputElement>('[data-testid="brightness"]')
      expect(wrapper.find('[data-testid="brightness-value"]').text()).toBe('80%')

      slider.element.value = '55'
      await slider.trigger('input')
      slider.element.value = '40'
      await slider.trigger('input')
      expect(sent()).toEqual([])
      expect(wrapper.find('[data-testid="brightness-value"]').text()).toBe('40%')

      await slider.trigger('change')
      await flushPromises()

      expect(sent()).toEqual([{ type: 'set_brightness', brightness: 40 }])
    })

    it('does not let an incoming state move the slider while it is being dragged', async () => {
      const { wrapper, socket } = await mountRemote({ brightness: 80 })
      const slider = wrapper.find<HTMLInputElement>('[data-testid="brightness"]')

      slider.element.value = '30'
      await slider.trigger('input')
      socket!.push(stateWith({ brightness: 90 }))
      await flushPromises()

      expect(wrapper.find('[data-testid="brightness-value"]').text()).toBe('30%')

      await slider.trigger('change')
      await flushPromises()
      socket!.push(stateWith({ brightness: 60 }))
      await flushPromises()

      expect(wrapper.find('[data-testid="brightness-value"]').text()).toBe('60%')
    })

    it('sends refresh, and says what it is doing', async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW })
      const { wrapper } = await mountRemote()
      const button = wrapper.find('[data-testid="refresh"]')
      expect(button.text()).toBe('Refresh calendars')

      await button.trigger('click')
      await flushPromises()

      expect(sent()).toEqual([{ type: 'refresh' }])
      expect(button.text()).toBe('Asked')

      await vi.advanceTimersByTimeAsync(3000)
      expect(button.text()).toBe('Refresh calendars')
    })
  })

  describe('when a command fails', () => {
    it('says so, and the message can be dismissed', async () => {
      const { wrapper } = await mountRemote()
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

      await wrapper.find('[data-testid="tile-agenda"]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="error"]').text()).toContain('Couldn\'t reach the wall')
      expect(wrapper.find('[data-testid="tile-agenda"]').attributes('aria-pressed')).toBe('false')

      await wrapper.find('[data-testid="error"] button').trigger('click')

      expect(wrapper.find('[data-testid="error"]').exists()).toBe(false)
    })
  })

  describe('the PIN', () => {
    it('is never asked for when the server has none set', async () => {
      const { wrapper } = await mountRemote()

      expect(wrapper.find('[data-testid="pin-sheet"]').exists()).toBe(false)
    })

    it('is asked for at the start when the server wants one and the phone has none', async () => {
      pin = '4821'
      const { wrapper } = await mountRemote()

      const sheet = wrapper.find('[data-testid="pin-sheet"]')
      expect(sheet.exists()).toBe(true)
      const input = wrapper.find('[data-testid="pin-input"]')
      expect(input.attributes('inputmode')).toBe('numeric')
      expect(input.attributes('autocomplete')).toBe('off')
    })

    it('is not asked for at the start when the phone has one', async () => {
      pin = '4821'
      localStorage.setItem('wallcal.remote.pin', '4821')
      const { wrapper } = await mountRemote()

      expect(wrapper.find('[data-testid="pin-sheet"]').exists()).toBe(false)

      await wrapper.find('[data-testid="tile-agenda"]').trigger('click')
      await flushPromises()

      expect(commands).toEqual([{ command: { type: 'set_view', view: 'agenda' }, pin: '4821' }])
    })

    it('opens the sheet on a 401, keeps the command, and sends it again with the PIN once it is right', async () => {
      pin = '4821'
      localStorage.setItem('wallcal.remote.pin', '0000')
      const { wrapper } = await mountRemote()
      expect(wrapper.find('[data-testid="pin-sheet"]').exists()).toBe(false)

      // The stored PIN is wrong: refused, forgotten, and the sheet opens saying so.
      await wrapper.find('[data-testid="tile-agenda"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-testid="pin-sheet"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="pin-message"]').text()).toBe(PIN_ERRORS.wrong)
      expect(localStorage.getItem('wallcal.remote.pin')).toBeNull()
      expect(wrapper.find('[data-testid="tile-agenda"]').attributes('aria-pressed')).toBe('false')

      // A wrong PIN is turned down by the server, and not kept.
      await wrapper.find('[data-testid="pin-input"]').setValue('1111')
      await wrapper.find('[data-testid="pin-sheet"] form').trigger('submit')
      await flushPromises()
      expect(wrapper.find('[data-testid="pin-message"]').text()).toBe('Wrong PIN')
      expect(localStorage.getItem('wallcal.remote.pin')).toBeNull()
      expect(commands).toHaveLength(1)

      // The right one is kept, and the command that was refused goes again with it.
      await wrapper.find('[data-testid="pin-input"]').setValue('4821')
      await wrapper.find('[data-testid="pin-sheet"] form').trigger('submit')
      await flushPromises()

      expect(pinChecks).toEqual(['1111', '4821'])
      expect(wrapper.find('[data-testid="pin-sheet"]').exists()).toBe(false)
      expect(localStorage.getItem('wallcal.remote.pin')).toBe('4821')
      expect(commands.at(-1)).toEqual({ command: { type: 'set_view', view: 'agenda' }, pin: '4821' })
      expect(wrapper.find('[data-testid="tile-agenda"]').attributes('aria-pressed')).toBe('true')
    })

    it('asks for a PIN after a command with none, without telling the person they were wrong', async () => {
      const { wrapper } = await mountRemote()
      pin = '4821'

      await wrapper.find('[data-testid="screen-toggle"]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="pin-sheet"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="pin-message"]').exists()).toBe(false)
    })

    it('does not send anything that is not 4 to 12 digits', async () => {
      pin = '4821'
      const { wrapper } = await mountRemote()

      await wrapper.find('[data-testid="pin-input"]').setValue('12')
      await wrapper.find('[data-testid="pin-sheet"] form').trigger('submit')
      await flushPromises()

      expect(pinChecks).toEqual([])
      expect(wrapper.find('[data-testid="pin-message"]').text()).toBe('Enter 4 to 12 digits')
    })

    it('says so when the server has locked this phone out', async () => {
      pin = '4821'
      lockedOut = true
      const { wrapper } = await mountRemote()

      await wrapper.find('[data-testid="pin-input"]').setValue('4821')
      await wrapper.find('[data-testid="pin-sheet"] form').trigger('submit')
      await flushPromises()

      expect(wrapper.find('[data-testid="pin-message"]').text()).toBe(PIN_ERRORS.locked)
      expect(wrapper.find('[data-testid="pin-sheet"]').exists()).toBe(true)
    })

    it('can be put off, which drops the command that was refused', async () => {
      const { wrapper } = await mountRemote()
      pin = '4821'
      await wrapper.find('[data-testid="tile-agenda"]').trigger('click')
      await flushPromises()

      await wrapper.find('.sheet .link').trigger('click')

      expect(wrapper.find('[data-testid="pin-sheet"]').exists()).toBe(false)
      expect(commands).toHaveLength(1)
    })
  })
})

// The pill's clock, with the sockets' status set by hand.
describe('useConnectionState', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  async function mountPill() {
    const status = ref<SocketStatus>('connecting')
    const wrapper = await mountSuspended(defineComponent({
      setup() {
        const connection = useConnectionState(status)
        return () => h('p', connection.value)
      },
    }))
    return { status, wrapper }
  }

  it('is reconnecting until ten seconds without a socket, then offline, and connected again when it opens', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    const { status, wrapper } = await mountPill()
    expect(wrapper.text()).toBe('reconnecting')

    await vi.advanceTimersByTimeAsync(9000)
    expect(wrapper.text()).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.text()).toBe('offline')

    status.value = 'open'
    await flushPromises()
    expect(wrapper.text()).toBe('connected')
  })

  it('starts the ten seconds again each time the socket goes down, and counts closed like connecting', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    const { status, wrapper } = await mountPill()
    status.value = 'open'
    await vi.advanceTimersByTimeAsync(60_000)
    expect(wrapper.text()).toBe('connected')

    status.value = 'closed'
    await vi.advanceTimersByTimeAsync(6000)
    status.value = 'connecting'
    await vi.advanceTimersByTimeAsync(6000)

    expect(wrapper.text()).toBe('offline')
  })

  it('is offline at once when the phone loses its network, and back to reconnecting when it returns', async () => {
    const { wrapper } = await mountPill()
    const onLine = vi.spyOn(navigator, 'onLine', 'get')

    onLine.mockReturnValue(false)
    window.dispatchEvent(new Event('offline'))
    await flushPromises()
    expect(wrapper.text()).toBe('offline')

    onLine.mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(wrapper.text()).toBe('reconnecting')
    onLine.mockRestore()
  })
})

describe('useColourScheme', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** A `matchMedia` whose answer the test can change, telling the listeners when it does. */
  function fakeMatchMedia(matches: boolean) {
    const listeners = new Set<() => void>()
    const query = {
      matches,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }
    vi.stubGlobal('matchMedia', vi.fn(() => query))
    return {
      listeners,
      set(next: boolean) {
        query.matches = next
        for (const listener of listeners) listener()
      },
    }
  }

  function mountScheme() {
    return mountSuspended(defineComponent({
      setup() {
        const scheme = useColourScheme()
        return () => h('p', scheme.value)
      },
    }))
  }

  it('is what the phone prefers, and follows it', async () => {
    const media = fakeMatchMedia(true)
    const wrapper = await mountScheme()
    expect(wrapper.text()).toBe('dark')

    media.set(false)
    await flushPromises()
    expect(wrapper.text()).toBe('light')
  })

  it('stops listening when it is unmounted', async () => {
    const media = fakeMatchMedia(false)
    const wrapper = await mountScheme()
    expect(media.listeners.size).toBe(1)

    wrapper.unmount()

    expect(media.listeners.size).toBe(0)
  })

  it('is light where the browser can\'t say', async () => {
    vi.stubGlobal('matchMedia', undefined)

    expect((await mountScheme()).text()).toBe('light')
  })
})
