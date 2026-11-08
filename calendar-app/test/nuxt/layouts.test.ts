import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import LayoutsManager from '~/components/layouts/LayoutsManager.vue'
import RemotePage from '~/pages/remote.vue'
import { displayStateSchema } from '../../shared/display'
import type { Command, DisplaySettings, DisplayState, PhotoSource } from '../../shared/display'
import { customLayoutInputSchema } from '../../shared/layouts'
import type { CustomLayout, LayoutArrangement } from '../../shared/layouts'

// The custom layouts' UI (PR 5.17) against a pretend server: the remote's
// layout tiles, its pickers for a custom view and its edit sheet, and the
// editor's toggles and moves as the PUT they make. `$fetch` answers as the real
// routes do (shared/layouts.ts, server/api/layouts) and records every request;
// the socket is a fake the test pushes layouts and states down. The pure
// operations are in test/unit/display/layoutEditor.test.ts and the looks in
// test/visual/layouts-editor.spec.ts.

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

const NOW = new Date('2026-10-28T09:41:00Z')
const STAMP = '2026-10-01T10:00:00.000Z'

const settings: DisplaySettings = { id: 'hallway', name: 'Hallway', theme: 'light', month_style: 'soft', week_start: 'monday', timezone: 'Europe/London', burn_in: true, orientation: 'auto', night_text: 'none', week_hours: { from: 7, to: 21 }, day_parts: { afternoon: 12, evening: 17 }, photo_sources: [] }

const arrangement = (...rows: [number, ...[string, number][]][]): LayoutArrangement => ({
  rows: rows.map(([size, ...panes]) => ({ size, panes: panes.map(([component, paneSize]) => ({ component: component as 'week', size: paneSize })) })),
})

const layout = (id: string, name: string, landscape: LayoutArrangement, portrait: LayoutArrangement): CustomLayout => ({ id, name, landscape, portrait, options: {}, created_at: STAMP, updated_at: STAMP })

/** A photo beside a week, and the two stacked in portrait. */
const kitchen = () => layout('kitchen', 'Kitchen', arrangement([1, ['photo', 2], ['week', 3]]), arrangement([2, ['photo', 1]], [3, ['week', 1]]))
/** A month beside an agenda. */
const planner = () => layout('planner', 'Planner', arrangement([1, ['month', 3], ['agenda', 1]]), arrangement([3, ['month', 1]], [1, ['agenda', 1]]))
/** A week, with no photo. */
const weekly = () => layout('weekly', 'Weekly', arrangement([1, ['week', 1]]), arrangement([1, ['week', 1]]))

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

  push(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

const stateWith = (changes: Partial<DisplayState> = {}) => displayStateSchema.parse(changes)

/** A failed request as `$fetch` throws it: the status, and the body the server's errors carry. */
function refusal(status: number, message: string) {
  return Object.assign(new Error(`${status}`), { statusCode: status, data: { statusCode: status, message } })
}

// What the pretend server holds, and what it was asked.
let library: CustomLayout[]
let state: DisplayState
let photoSources: PhotoSource[]
let commands: Command[]
let writes: { method: string, url: string, body: unknown }[]
let layoutsReachable: boolean

interface Options { method?: string, body?: unknown, headers?: Record<string, string> }

async function server(url: string, options: Options = {}) {
  const method = options.method ?? 'GET'
  if (url === '/api/displays') return [{ ...settings, photo_sources: photoSources }]
  if (url === '/api/remote') return { pin_required: false }
  if (url === '/api/layouts' && method === 'GET') {
    if (!layoutsReachable) throw new TypeError('Failed to fetch')
    return structuredClone(library)
  }
  if (url === '/api/displays/hallway/commands') {
    commands.push(options.body as Command)
    const command = options.body as Command
    if (command.type === 'set_view') state = stateWith({ ...state, view: command.view })
    if (command.type === 'set_layout') state = stateWith({ ...state, view: 'custom', layout: command.layout })
    return state
  }
  if (url.startsWith('/api/layouts')) {
    writes.push({ method, url, body: options.body })
    const parsed = customLayoutInputSchema.safeParse(options.body)
    if (method === 'PUT' || method === 'POST') {
      if (!parsed.success) throw refusal(400, `${parsed.error.issues[0]!.path.join('.')} ${parsed.error.issues[0]!.message}`)
      if (parsed.data.name === 'Reject me') throw refusal(400, 'landscape.rows.0.size must be from 1 to 4')
      if (parsed.data.name === 'Taken') throw refusal(409, 'There is already a layout called "Taken"')
    }
    const id = url.split('/')[3]
    if (method === 'PUT') {
      const found = library.find(candidate => candidate.id === id)!
      Object.assign(found, parsed.data)
      return structuredClone(found)
    }
    if (method === 'POST') {
      const created = layout('new-one', parsed.data!.name, parsed.data!.landscape, parsed.data!.portrait)
      library.push(created)
      return structuredClone(created)
    }
    if (method === 'DELETE') {
      library = library.filter(candidate => candidate.id !== id)
      return undefined
    }
  }
  throw refusal(404, `Not found: ${url}`)
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket)
  fetchMock.mockImplementation(server)
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  FakeSocket.all = []
  library = [kitchen(), planner(), weekly()]
  state = stateWith()
  photoSources = ['local']
  commands = []
  writes = []
  layoutsReachable = true
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Mounts the remote, opens its socket and sends the first state. */
async function mountRemote(initial: Partial<DisplayState> = {}) {
  state = stateWith(initial)
  const wrapper = await mountSuspended(RemotePage, { route: '/remote?id=hallway' })
  await flushPromises()
  const socket = FakeSocket.all.at(-1)!
  socket.open()
  socket.push({ type: 'state.updated', display_id: 'hallway', state })
  await flushPromises()
  return { wrapper, socket }
}

const tiles = (wrapper: Awaited<ReturnType<typeof mountRemote>>['wrapper']) => wrapper.findAll('.layout-tile').map(tile => tile.text())

describe('the remote\'s layouts', () => {
  it('has a tile for each layout, asking for them when the socket has not sent them', async () => {
    const { wrapper } = await mountRemote()

    expect(tiles(wrapper)).toEqual(['Kitchen', 'Planner', 'Weekly'])
    expect(wrapper.find('[data-testid="layouts-edit"]').text()).toBe('Edit layouts')
  })

  it('takes the layouts the socket sends in place of the ones it asked for', async () => {
    const { wrapper, socket } = await mountRemote()

    socket.push({ type: 'layouts.updated', layouts: [planner()] })
    await flushPromises()

    expect(tiles(wrapper)).toEqual(['Planner'])
  })

  it('still shows the page when the layouts can\'t be fetched', async () => {
    layoutsReachable = false

    const { wrapper } = await mountRemote()

    expect(tiles(wrapper)).toEqual([])
    expect(wrapper.find('[data-testid="display-name"]').text()).toBe('Hallway')
  })

  it('marks the layout on the wall, and no tile when the wall is on another view', async () => {
    const { wrapper } = await mountRemote({ view: 'custom', layout: 'planner' })
    const pressed = () => wrapper.findAll('.layout-tile').filter(tile => tile.attributes('aria-pressed') === 'true').map(tile => tile.text())

    expect(pressed()).toEqual(['Planner'])
    expect(wrapper.find('[data-testid="tile-month"]').attributes('aria-pressed')).toBe('false')

    await wrapper.find('[data-testid="tile-agenda"]').trigger('click')
    await flushPromises()
    // The layout is remembered by the state but is not what is shown.
    expect(pressed()).toEqual([])
  })

  it('sends set_layout when a tile is tapped, and takes the answer at once', async () => {
    const { wrapper } = await mountRemote({ view: 'month' })

    await wrapper.find('[data-testid="layout-tile-weekly"]').trigger('click')
    await flushPromises()

    expect(commands).toEqual([{ type: 'set_layout', layout: 'weekly' }])
    expect(wrapper.find('[data-testid="layout-tile-weekly"]').attributes('aria-pressed')).toBe('true')
  })

  it('leaves out a layout with photos when there is no photo source, unless it is on the wall', async () => {
    photoSources = []

    const without = await mountRemote()
    expect(tiles(without.wrapper)).toEqual(['Planner', 'Weekly'])

    const shown = await mountRemote({ view: 'custom', layout: 'kitchen' })
    expect(tiles(shown.wrapper)).toEqual(['Kitchen', 'Planner', 'Weekly'])
  })

  it('shows the week picker for a layout with a week, and the month picker for one with a month', async () => {
    const week = await mountRemote({ view: 'custom', layout: 'weekly' })
    expect(week.wrapper.find('[data-testid="week-picker"]').exists()).toBe(true)
    expect(week.wrapper.find('[data-testid="month-picker"]').exists()).toBe(false)

    const month = await mountRemote({ view: 'custom', layout: 'planner' })
    expect(month.wrapper.find('[data-testid="month-picker"]').exists()).toBe(true)
    expect(month.wrapper.find('[data-testid="week-picker"]').exists()).toBe(false)
  })

  it('shows no picker for a custom view whose layout is unknown, and the week one when the layout has loaded', async () => {
    const { wrapper } = await mountRemote({ view: 'custom', layout: 'gone' })

    expect(wrapper.find('[data-testid="week-picker"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="month-picker"]').exists()).toBe(false)
  })

  it('turns on Next photo for a layout with a photo pane only', async () => {
    const photos = await mountRemote({ view: 'custom', layout: 'kitchen' })
    expect(photos.wrapper.find('[data-testid="photo-next"]').attributes('disabled')).toBeUndefined()

    const none = await mountRemote({ view: 'custom', layout: 'weekly' })
    expect(none.wrapper.find('[data-testid="photo-next"]').attributes('disabled')).toBeDefined()
  })

  it('opens the editing sheet with the layouts in it, and closes it', async () => {
    const { wrapper } = await mountRemote()

    await wrapper.find('[data-testid="layouts-edit"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="layouts-sheet"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="layout-row"]').map(row => row.text())).toEqual([expect.stringContaining('Kitchen'), expect.stringContaining('Planner'), expect.stringContaining('Weekly')])

    await wrapper.find('[data-testid="layouts-close"]').trigger('click')

    expect(wrapper.find('[data-testid="layouts-sheet"]').exists()).toBe(false)
  })

  it('marks the layout on the wall in the sheet\'s list', async () => {
    const { wrapper } = await mountRemote({ view: 'custom', layout: 'planner' })

    await wrapper.find('[data-testid="layouts-edit"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('[data-testid="shown-on"]').map(chip => chip.text())).toEqual(['Shown on Hallway'])
  })
})

describe('the layouts editor', () => {
  async function mountManager(props: Record<string, unknown> = {}) {
    const wrapper = await mountSuspended(LayoutsManager, { props: { displays: [{ id: 'hallway', name: 'Hallway', layout: null }], photosConfigured: true, ...props } })
    await flushPromises()
    return wrapper
  }

  const click = async (wrapper: Awaited<ReturnType<typeof mountManager>>, testid: string) => {
    await wrapper.find(`[data-testid="${testid}"]`).trigger('click')
    await flushPromises()
  }

  /** Presses Save: the form is submitted, as a browser does for its submit button (a form that is not in the document, as under test, is not submitted by a click). */
  const submit = async (wrapper: Awaited<ReturnType<typeof mountManager>>) => {
    await wrapper.find('[data-testid="layout-editor"]').trigger('submit')
    await flushPromises()
  }

  it('lists the layouts and opens the first in the editor', async () => {
    const wrapper = await mountManager()

    expect(wrapper.findAll('[data-testid="layout-row"]').map(row => row.attributes('data-id'))).toEqual(['kitchen', 'planner', 'weekly'])
    expect((wrapper.find('[data-testid="layout-name"]').element as HTMLInputElement).value).toBe('Kitchen')
    expect(wrapper.find('[data-testid="layout-id"]').text()).toContain('kitchen')
  })

  it('edits the day grid of the selected days pane, per orientation', async () => {
    const wrapper = await mountManager()
    const text = (testid: string) => wrapper.find(`[data-testid="${testid}"]`).text()
    const disabled = (testid: string) => wrapper.find(`[data-testid="${testid}"]`).attributes('disabled') !== undefined

    expect(wrapper.find('[data-testid="grid-controls"]').exists()).toBe(false)
    await click(wrapper, 'toggle-days')
    expect(wrapper.find('[data-testid="grid-controls"]').exists()).toBe(false)
    await wrapper.find('[data-testid="layout-editor"] [data-component="days"]').trigger('click')
    expect(text('grid-rows')).toBe('Rows 2')
    expect(text('grid-columns')).toBe('Columns 4')
    expect(wrapper.find('[data-testid="start-today"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="preview-grid"]').findAll('i')).toHaveLength(8)

    await click(wrapper, 'rows-more')
    await click(wrapper, 'columns-fewer')
    await click(wrapper, 'start-week')
    expect(text('grid-rows')).toBe('Rows 3')
    expect(text('grid-columns')).toBe('Columns 3')
    expect(wrapper.find('[data-testid="start-week"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="preview-grid"]').findAll('i')).toHaveLength(9)

    for (let i = 0; i < 5; i++) await click(wrapper, 'columns-more')
    expect(text('grid-columns')).toBe('Columns 7')
    expect(disabled('columns-more')).toBe(true)
    for (let i = 0; i < 6; i++) await click(wrapper, 'rows-fewer')
    expect(text('grid-rows')).toBe('Rows 1')
    expect(disabled('rows-fewer')).toBe(true)

    await click(wrapper, 'switch-portrait')
    await wrapper.find('[data-testid="layout-editor"] [data-component="days"]').trigger('click')
    expect(text('grid-rows')).toBe('Rows 4')
    expect(text('grid-columns')).toBe('Columns 2')
    expect(wrapper.find('[data-testid="start-today"]').attributes('aria-pressed')).toBe('true')

    await submit(wrapper)
    const body = writes[0]!.body as { landscape: LayoutArrangement, portrait: LayoutArrangement }
    expect(customLayoutInputSchema.safeParse(body).success).toBe(true)
    const gridIn = (a: LayoutArrangement) => a.rows.flatMap(row => row.panes).filter(pane => pane.grid)
    expect(gridIn(body.landscape)).toEqual([{ component: 'days', size: 1, grid: { rows: 1, columns: 7, start: 'week' } }])
    expect(gridIn(body.portrait)).toEqual([{ component: 'days', size: 1, grid: { rows: 4, columns: 2, start: 'today' } }])
  })

  it('shows Display chips for the selected pane and saves the ones changed', async () => {
    const wrapper = await mountManager()
    const pressed = (key: string) => wrapper.find(`[data-testid="option-${key}"]`).attributes('aria-pressed')

    // The kitchen shows a photo and a week, and the photo is selected to begin with: it has no options.
    expect(wrapper.find('[data-testid="option-controls"]').exists()).toBe(false)

    await wrapper.find('[data-testid="layout-editor"] [data-component="week"]').trigger('click')
    expect(wrapper.findAll('[data-testid^="option-show_"]').map(chip => chip.attributes('data-testid'))).toEqual(['option-show_title', 'option-show_hours'])
    expect(wrapper.find('[data-testid="option-show_title"]').text()).toBe('Date title')
    expect(pressed('show_hours')).toBe('true')

    await click(wrapper, 'option-show_hours')
    expect(pressed('show_hours')).toBe('false')
    // Both orientations share them.
    await click(wrapper, 'switch-portrait')
    await wrapper.find('[data-testid="layout-editor"] [data-component="week"]').trigger('click')
    expect(pressed('show_hours')).toBe('false')

    await submit(wrapper)
    expect((writes[0]!.body as { options: unknown }).options).toEqual({ week: { show_hours: false } })

    await click(wrapper, 'option-show_hours')
    expect(pressed('show_hours')).toBe('true')
  })

  it('offers the initials only once events are coloured', async () => {
    const wrapper = await mountManager()
    await click(wrapper, 'toggle-agenda')
    await wrapper.find('[data-testid="layout-editor"] [data-component="agenda"]').trigger('click')
    const chip = () => wrapper.find('[data-testid="option-show_initials"]')

    expect(chip().text()).toBe('Initials')
    expect(chip().attributes('disabled')).toBeDefined()
    await click(wrapper, 'option-fill_events')
    expect(chip().attributes('disabled')).toBeUndefined()
    expect(chip().attributes('aria-pressed')).toBe('true')

    await click(wrapper, 'option-show_initials')
    expect(chip().attributes('aria-pressed')).toBe('false')
    await submit(wrapper)
    expect((writes[0]!.body as { options: unknown }).options).toEqual({ agenda: { fill_events: true, show_initials: false } })
  })

  it('saves a toggled component and a moved pane as one PUT', async () => {
    const wrapper = await mountManager()

    await click(wrapper, 'toggle-agenda')
    await wrapper.find('[data-testid="layout-editor"] [data-component="week"]').trigger('click')
    await click(wrapper, 'move-left')
    await submit(wrapper)

    expect(writes).toEqual([{
      method: 'PUT',
      url: '/api/layouts/kitchen',
      body: {
        name: 'Kitchen',
        landscape: arrangement([1, ['week', 3], ['photo', 2], ['agenda', 1]]),
        portrait: arrangement([2, ['photo', 1]], [3, ['week', 1], ['agenda', 1]]),
        options: {},
      },
    }])
    expect(wrapper.find('[data-testid="layouts-note"]').text()).toBe('Saved.')
  })

  it('edits the portrait arrangement on its own, and sizes with the buttons', async () => {
    const wrapper = await mountManager()

    await click(wrapper, 'switch-portrait')
    await wrapper.find('[data-testid="layout-editor"] [data-component="photo"]').trigger('click')
    await click(wrapper, 'taller')
    await submit(wrapper)

    const body = writes[0]!.body as { landscape: LayoutArrangement, portrait: LayoutArrangement }
    expect(body.landscape).toEqual(kitchen().landscape)
    expect(body.portrait).toEqual(arrangement([3, ['photo', 1]], [3, ['week', 1]]))
  })

  it('starts the portrait arrangement again from the landscape one', async () => {
    const wrapper = await mountManager()

    await click(wrapper, 'switch-portrait')
    await wrapper.find('[data-testid="layout-editor"] [data-component="photo"]').trigger('click')
    await click(wrapper, 'move-down')
    expect(wrapper.find('[data-testid="layout-save"]').attributes('disabled')).toBeUndefined()
    await click(wrapper, 'reset-portrait')
    await submit(wrapper)

    // Photo beside week turned on its side is the photo above the week, as the library had it, so nothing is left to save.
    expect(writes).toEqual([])
    expect(wrapper.find('[data-testid="layout-save"]').attributes('disabled')).toBeDefined()
  })

  it('will not remove the last component, and disables the photo pane without a photo source', async () => {
    const wrapper = await mountManager({ photosConfigured: false })
    // Kitchen already has the photo, so it can be turned off; once it is, it can't be turned back on.
    await click(wrapper, 'toggle-photo')

    expect(wrapper.find('[data-testid="toggle-photo"]').attributes('aria-pressed')).toBe('false')
    expect(wrapper.find('[data-testid="toggle-photo"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="toggle-photo"]').text()).toContain('Not set up')

    await click(wrapper, 'toggle-week')
    expect(wrapper.find('[data-testid="toggle-week"]').attributes('disabled')).toBeDefined()
  })

  it('says what the server found wrong with a save, under the form', async () => {
    const wrapper = await mountManager()

    await wrapper.find('[data-testid="layout-name"]').setValue('Reject me')
    await submit(wrapper)

    expect(wrapper.find('[data-testid="layout-server-error"]').text()).toBe('Landscape.rows.0.size must be from 1 to 4')
    expect(wrapper.find('[data-testid="layout-save"]').attributes('disabled')).toBeUndefined()
  })

  it('says a name is taken', async () => {
    const wrapper = await mountManager()

    await wrapper.find('[data-testid="layout-name"]').setValue('Taken')
    await submit(wrapper)

    expect(wrapper.find('[data-testid="layout-server-error"]').text()).toBe('There is already a layout called "Taken"')
  })

  it('keeps Save off for an empty or too long name, and says why for a long one', async () => {
    const wrapper = await mountManager()

    await wrapper.find('[data-testid="layout-name"]').setValue('')
    expect(wrapper.find('[data-testid="layout-save"]').attributes('disabled')).toBeDefined()

    await wrapper.find('[data-testid="layout-name"]').setValue('x'.repeat(61))
    expect(wrapper.find('[data-testid="layout-save"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="layout-name-error"]').text()).toContain('at most 60 characters')
  })

  it('adds a new layout with a POST', async () => {
    const wrapper = await mountManager()

    await click(wrapper, 'add-layout')
    await wrapper.find('[data-testid="layout-name"]').setValue('Hall')
    await click(wrapper, 'toggle-agenda')
    await submit(wrapper)

    expect(writes.map(write => [write.method, write.url])).toEqual([['POST', '/api/layouts']])
    expect((writes[0]!.body as { name: string }).name).toBe('Hall')
    expect(wrapper.findAll('[data-testid="layout-row"]')).toHaveLength(4)
  })

  it('asks before deleting, then deletes', async () => {
    const wrapper = await mountManager()

    await click(wrapper, 'layout-delete')
    expect(wrapper.find('[data-testid="confirm-title"]').text()).toBe('Delete Kitchen?')
    await click(wrapper, 'confirm-ok')

    expect(writes.map(write => [write.method, write.url])).toEqual([['DELETE', '/api/layouts/kitchen']])
    expect(wrapper.findAll('[data-testid="layout-row"]').map(row => row.attributes('data-id'))).toEqual(['planner', 'weekly'])
  })

  it('duplicates a layout', async () => {
    const wrapper = await mountManager()

    await click(wrapper, 'layout-duplicate')

    expect(writes.map(write => [write.method, write.url])).toEqual([['POST', '/api/layouts/kitchen/duplicate']])
  })

  it('shows a layout on the wall with set_layout, once there is nothing unsaved', async () => {
    const wrapper = await mountManager()

    await wrapper.find('[data-testid="layout-name"]').setValue('Kitchen wall')
    expect(wrapper.find('[data-testid="layout-show"]').attributes('disabled')).toBeDefined()
    await wrapper.find('[data-testid="layout-name"]').setValue('Kitchen')
    await click(wrapper, 'layout-show')

    expect(commands).toEqual([{ type: 'set_layout', layout: 'kitchen' }])
    expect(wrapper.find('[data-testid="layouts-note"]').text()).toBe('Showing Kitchen on Hallway.')
  })

  it('asks which display when there are several', async () => {
    const wrapper = await mountManager({ displays: [{ id: 'hallway', name: 'Hallway', layout: null }, { id: 'kitchen-wall', name: 'Kitchen wall', layout: null }] })

    expect(wrapper.findAll('[data-testid="show-display"] option').map(option => option.text())).toEqual(['Hallway', 'Kitchen wall'])
  })

  it('asks before leaving unsaved changes for another layout', async () => {
    const wrapper = await mountManager()

    await wrapper.find('[data-testid="layout-name"]').setValue('Kitchen two')
    await wrapper.findAll('[data-testid="layout-row"]')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="confirm-title"]').text()).toBe('Discard changes?')

    await click(wrapper, 'confirm-ok')

    expect((wrapper.find('[data-testid="layout-name"]').element as HTMLInputElement).value).toBe('Planner')
  })

  it('in its compact form shows the list and the editor in turn', async () => {
    const wrapper = await mountManager({ compact: true })

    expect(wrapper.find('[data-testid="layout-editor"]').exists()).toBe(false)
    await wrapper.findAll('[data-testid="layout-row"]')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="layouts-list"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="layout-editor"]').exists()).toBe(true)

    await click(wrapper, 'layouts-back')

    expect(wrapper.find('[data-testid="layouts-list"]').exists()).toBe(true)
  })

  it('says when the server can\'t be reached', async () => {
    layoutsReachable = false

    const wrapper = await mountManager()

    expect(wrapper.find('[data-testid="unreachable"]').exists()).toBe(true)
  })
})
