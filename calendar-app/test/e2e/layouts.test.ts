import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, fetch, setup, url } from '@nuxt/test-utils/e2e'
import type { ServerMessage } from '../../shared/display'
import type { CustomLayout } from '../../shared/layouts'
import { PIN_HEADER } from '../../shared/remote'
import { builtApp } from '../helpers/builtApp'

// The layouts API, on the dev config with `remote.pin` set: the writes need
// the PIN, and the tests send it. The tests build on each other, in order.
describe('custom layouts', async () => {
  const appDir = fileURLToPath(new URL('../..', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const configFile = join(dir, 'config.yaml')
  // The hallway has a schedule that shows the kitchen layout, which is what makes a delete of it a 409.
  const schedule = '    theme: light\n    schedules:\n      - id: evenings\n        rules:\n          - { view: custom, layout: kitchen, from: "17:00", to: "21:00" }\n'
  const dev = readFileSync(join(appDir, 'config.dev.yaml'), 'utf8').replaceAll('file:./', `file:${appDir}/`).replace('    theme: light\n', schedule)
  writeFileSync(configFile, `${dev}\nremote:\n  pin: "2468"\n`)

  await setup({
    ...builtApp,
    env: {
      WALLCAL_CONFIG_FILE: configFile,
      WALLCAL_DATA_DIR: join(dir, 'data'),
    },
  })

  const reason = (statusCode: number, message: string) => ({ statusCode, data: { message: expect.stringContaining(message) } })
  const right = { [PIN_HEADER]: '2468' }
  const wrong = { [PIN_HEADER]: '1357' }

  const kitchen = {
    name: 'Kitchen',
    landscape: { rows: [{ size: 1, panes: [{ component: 'photo', size: 2 }, { component: 'week', size: 3 }] }] },
    portrait: { rows: [{ size: 2, panes: [{ component: 'photo', size: 1 }] }, { size: 3, panes: [{ component: 'week', size: 1 }] }] },
  }

  const send = <T>(method: string, path: string, body?: unknown, headers: Record<string, string> = right) =>
    $fetch<T>(path, { method: method as 'POST', body: body as Record<string, unknown>, headers })
  const raw = (method: string, path: string, headers: Record<string, string> = right) => fetch(path, { method, headers })
  const create = (body: unknown, headers?: Record<string, string>) => send<CustomLayout>('POST', '/api/layouts', body, headers)
  const update = (id: string, body: unknown, headers?: Record<string, string>) => send<CustomLayout>('PUT', `/api/layouts/${id}`, body, headers)

  /** A socket that collects what the server sends. */
  function connect(query: string) {
    const socket = new WebSocket(url(`/_ws?${query}`).replace(/^http/, 'ws'))
    const messages: ServerMessage[] = []
    const waiting: (() => void)[] = []
    socket.addEventListener('message', (event) => {
      messages.push(JSON.parse(String(event.data)) as ServerMessage)
      for (const wake of waiting.splice(0)) wake()
    })
    const opened = new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve())
      socket.addEventListener('error', () => reject(new Error('the socket did not open')))
    })
    /** Resolves with the first message from index `from` on that passes `match`. */
    async function next(match: (message: ServerMessage) => boolean, from = 0): Promise<ServerMessage> {
      const deadline = Date.now() + 10_000
      for (;;) {
        const found = messages.slice(from).find(match)
        if (found) return found
        if (Date.now() > deadline) throw new Error(`no matching message, got ${JSON.stringify(messages)}`)
        await new Promise<void>((resolve) => {
          waiting.push(resolve)
          setTimeout(resolve, 200)
        })
      }
    }
    return { socket, messages, opened, next }
  }

  const isLayouts = (message: ServerMessage): message is Extract<ServerMessage, { type: 'layouts.updated' }> => message.type === 'layouts.updated'

  it('GET /api/layouts is empty to begin with, and open without the PIN', async () => {
    expect(await $fetch('/api/layouts')).toEqual([])
  })

  it('needs the PIN for every write', async () => {
    await expect(create(kitchen, {})).rejects.toMatchObject({ statusCode: 401 })
    await expect(create(kitchen, wrong)).rejects.toMatchObject({ statusCode: 401 })
    expect((await raw('PUT', '/api/layouts/kitchen', {})).status).toBe(401)
    expect((await raw('DELETE', '/api/layouts/kitchen', {})).status).toBe(401)
    expect((await raw('POST', '/api/layouts/kitchen/duplicate', {})).status).toBe(401)
    expect(await $fetch('/api/layouts')).toEqual([])
  })

  it('POST /api/layouts answers 201 with the new layout, id and all', async () => {
    const response = await fetch('/api/layouts', { method: 'POST', body: JSON.stringify(kitchen), headers: { ...right, 'content-type': 'application/json' } })
    const created = await response.json() as CustomLayout

    expect(response.status).toBe(201)
    expect(created).toEqual({
      id: 'kitchen',
      ...kitchen,
      options: {},
      photo_feed: null,
      created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      updated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    })
    expect(await $fetch('/api/layouts')).toEqual([created])
  })

  it('keeps a photo feed that is set up, and refuses one that is not with the ones that are', async () => {
    // The dev config sets up a local folder, whose feed is called `local`.
    const withFeed = await create({ ...kitchen, name: 'Feeds', photo_feed: 'local' })
    expect(withFeed.photo_feed).toBe('local')
    expect((await update(withFeed.id, { ...kitchen, name: 'Feeds', photo_feed: null })).photo_feed).toBeNull()

    await expect(create({ ...kitchen, name: 'Nope', photo_feed: 'mountains' })).rejects.toMatchObject(reason(400, 'use local'))
    await expect(update(withFeed.id, { ...kitchen, name: 'Feeds', photo_feed: 'mountains' })).rejects.toMatchObject(reason(400, 'photo_feed "mountains"'))
    await expect(create({ ...kitchen, name: 'Nope', photo_feed: 'Not A Feed' })).rejects.toMatchObject(reason(400, 'photo_feed'))

    const copy = await send<CustomLayout>('POST', `/api/layouts/${withFeed.id}/duplicate`)
    expect(copy.photo_feed).toBeNull()
    expect((await send<CustomLayout>('PUT', `/api/layouts/${withFeed.id}`, { ...kitchen, name: 'Feeds', photo_feed: 'local' })).photo_feed).toBe('local')
    expect((await send<CustomLayout>('POST', `/api/layouts/${withFeed.id}/duplicate`)).photo_feed).toBe('local')

    // Leave the library as the tests after this one expect it.
    for (const layout of await $fetch<CustomLayout[]>('/api/layouts')) {
      if (layout.id !== 'kitchen') await send('DELETE', `/api/layouts/${layout.id}`)
    }
  })

  it('round-trips pane options, and a body with none means none', async () => {
    const options = { week: { show_hours: false, show_title: false } }
    const made = await create({ ...kitchen, name: 'Options', options })
    expect(made.options).toEqual(options)
    expect((await $fetch<CustomLayout[]>('/api/layouts')).find(layout => layout.id === made.id)!.options).toEqual(options)

    const edited = await update(made.id, { ...kitchen, name: 'Options' })
    expect(edited.options).toEqual({})
    const copied = await send<CustomLayout>('POST', `/api/layouts/${made.id}/duplicate`)
    expect(copied.options).toEqual({})

    const again = await update(made.id, { ...kitchen, name: 'Options', options })
    expect((await send<CustomLayout>('POST', `/api/layouts/${again.id}/duplicate`)).options).toEqual(options)
    expect((await raw('DELETE', `/api/layouts/${made.id}`)).status).toBe(204)
    for (const other of (await $fetch<CustomLayout[]>('/api/layouts')).filter(layout => layout.id !== 'kitchen')) await raw('DELETE', `/api/layouts/${other.id}`)
  })

  it('refuses an option that does not apply, and one for a component the layout lacks', async () => {
    await expect(create({ ...kitchen, name: 'Bad', options: { week: { fill_events: true } } })).rejects.toMatchObject(reason(400, 'options.week.fill_events must not be set on a week pane'))
    await expect(create({ ...kitchen, name: 'Bad', options: { month: { show_title: false } } })).rejects.toMatchObject(reason(400, 'options.month must not be set'))
    await expect(create({ ...kitchen, name: 'Bad', options: { week: { show_title: 'no' } } })).rejects.toMatchObject(reason(400, 'options.week.show_title must be true or false'))
    expect(await $fetch<CustomLayout[]>('/api/layouts')).toHaveLength(1)
  })

  it('answers a bad body with a 400 that names the field', async () => {
    await expect(create({ ...kitchen, name: '' })).rejects.toMatchObject(reason(400, 'name must not be empty'))
    await expect(create({ ...kitchen, name: undefined })).rejects.toMatchObject(reason(400, 'name'))
    await expect(create({ ...kitchen, landscape: { rows: [] } })).rejects.toMatchObject(reason(400, 'landscape.rows must have at least one row'))
    await expect(create({ ...kitchen, landscape: { rows: [{ size: 9, panes: [{ component: 'photo', size: 1 }, { component: 'week', size: 1 }] }] } })).rejects.toMatchObject(reason(400, 'landscape.rows.0.size must be from 1 to 4'))
    await expect(create({ ...kitchen, portrait: { rows: [{ size: 1, panes: [{ component: 'photo', size: 1 }] }] } })).rejects.toMatchObject(reason(400, 'portrait must show the same components as landscape'))
    await expect(create({ ...kitchen, id: 'other' })).rejects.toMatchObject(reason(400, 'id is not a field of a layout'))
    await expect(create(null)).rejects.toMatchObject({ statusCode: 400 })
    await expect(update('kitchen', { ...kitchen, name: 'x'.repeat(61) })).rejects.toMatchObject(reason(400, 'name must be at most 60 characters'))
    expect(await $fetch<CustomLayout[]>('/api/layouts')).toHaveLength(1)
  })

  it('answers 404 for an unknown layout', async () => {
    await expect(update('nothing', kitchen)).rejects.toMatchObject(reason(404, 'Unknown layout "nothing"'))
    expect((await raw('DELETE', '/api/layouts/nothing')).status).toBe(404)
    expect((await raw('POST', '/api/layouts/nothing/duplicate')).status).toBe(404)
  })

  it('answers 409 for a name another layout has, ignoring case', async () => {
    await expect(create({ ...kitchen, name: 'KITCHEN' })).rejects.toMatchObject(reason(409, 'There is already a layout called "KITCHEN"'))
    const hall = await create({ ...kitchen, name: 'Hall' })
    await expect(update(hall.id, { ...kitchen, name: 'kitchen' })).rejects.toMatchObject(reason(409, 'There is already a layout called "kitchen"'))
    expect(await update(hall.id, { ...kitchen, name: 'Hall' })).toMatchObject({ id: 'hall', name: 'Hall' })
  })

  it('PUT /api/layouts/:id replaces the layout and keeps its id', async () => {
    const before = (await $fetch<CustomLayout[]>('/api/layouts')).find(layout => layout.id === 'kitchen')!
    const edited = { ...kitchen, name: 'Kitchen wall', landscape: { rows: [{ size: 1, panes: [{ component: 'week', size: 1 }, { component: 'photo', size: 1 }] }] } }

    const updated = await update('kitchen', edited)

    expect(updated).toMatchObject({ id: 'kitchen', name: 'Kitchen wall', landscape: edited.landscape, created_at: before.created_at })
    expect(updated.updated_at >= before.updated_at).toBe(true)
  })

  it('POST /api/layouts/:id/duplicate answers 201 with a copy', async () => {
    const response = await fetch('/api/layouts/kitchen/duplicate', { method: 'POST', headers: right })
    const copy = await response.json() as CustomLayout

    expect(response.status).toBe(201)
    expect(copy).toMatchObject({ id: 'copy-of-kitchen-wall', name: 'Copy of Kitchen wall' })
    expect(copy.landscape).toEqual((await $fetch<CustomLayout[]>('/api/layouts')).find(layout => layout.id === 'kitchen')!.landscape)
  })

  it('lists by name', async () => {
    const names = (await $fetch<CustomLayout[]>('/api/layouts')).map(layout => layout.name)

    expect(names).toEqual(['Copy of Kitchen wall', 'Hall', 'Kitchen wall'])
  })

  it('sends the layouts to a new socket on connect, and again to every socket after a change', async () => {
    const hallway = connect('display=hallway&role=display')
    const remote = connect('display=hallway&role=remote')
    await Promise.all([hallway.opened, remote.opened])

    const onConnect = await hallway.next(isLayouts)
    expect((onConnect as { layouts: CustomLayout[] }).layouts.map(layout => layout.id)).toEqual(['copy-of-kitchen-wall', 'hall', 'kitchen'])
    await remote.next(isLayouts)

    const seen = [hallway.messages.length, remote.messages.length] as const
    await update('hall', { ...kitchen, name: 'Hall way' })

    for (const [socket, from] of [[hallway, seen[0]], [remote, seen[1]]] as const) {
      const pushed = await socket.next(message => isLayouts(message) && message.layouts.some(layout => layout.name === 'Hall way'), from)
      expect((pushed as { layouts: CustomLayout[] }).layouts.map(layout => layout.name)).toEqual(['Copy of Kitchen wall', 'Hall way', 'Kitchen wall'])
    }
    hallway.socket.close()
    remote.socket.close()
  })

  it('answers 409 when deleting a layout a schedule rule names, naming the display and the schedule', async () => {
    const response = await raw('DELETE', '/api/layouts/kitchen')

    expect(response.status).toBe(409)
    expect(((await response.json()) as { message: string }).message).toContain('schedule "evenings" on display "hallway"')
    expect((await $fetch<CustomLayout[]>('/api/layouts')).map(layout => layout.id)).toContain('kitchen')
  })

  it('DELETE /api/layouts/:id answers 204 and the layout is gone', async () => {
    const response = await raw('DELETE', '/api/layouts/copy-of-kitchen-wall')

    expect(response.status).toBe(204)
    expect((await $fetch<CustomLayout[]>('/api/layouts')).map(layout => layout.id)).toEqual(['hall', 'kitchen'])
    expect((await raw('DELETE', '/api/layouts/copy-of-kitchen-wall')).status).toBe(404)
  })
})
