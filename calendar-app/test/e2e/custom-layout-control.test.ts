import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, setup, url } from '@nuxt/test-utils/e2e'
import type { DisplayState, ServerMessage } from '../../shared/display'
import type { CustomLayout } from '../../shared/layouts'
import { builtApp } from '../helpers/builtApp'

// Choosing a custom layout over the command API, and what deleting the layout
// on show does to the wall. The tests build on each other, in order.
describe('custom layout control', async () => {
  const appDir = fileURLToPath(new URL('../..', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const configFile = join(dir, 'config.yaml')
  writeFileSync(configFile, readFileSync(join(appDir, 'config.dev.yaml'), 'utf8').replaceAll('file:./', `file:${appDir}/`))

  await setup({
    ...builtApp,
    env: {
      WALLCAL_CONFIG_FILE: configFile,
      WALLCAL_DATA_DIR: join(dir, 'data'),
    },
  })

  const reason = (statusCode: number, message: string) => ({ statusCode, data: { message: expect.stringContaining(message) } })
  const command = (body: unknown) => $fetch<DisplayState>('/api/displays/hallway/commands', { method: 'POST', body: body as Record<string, unknown> })
  const stateOf = () => $fetch<DisplayState>('/api/displays/hallway/state')
  const create = (body: unknown) => $fetch<CustomLayout>('/api/layouts', { method: 'POST', body: body as Record<string, unknown> })

  const board = {
    name: 'Board',
    landscape: { rows: [{ size: 1, panes: [{ component: 'month', size: 2 }, { component: 'agenda', size: 1 }] }] },
    portrait: { rows: [{ size: 2, panes: [{ component: 'month', size: 1 }] }, { size: 1, panes: [{ component: 'agenda', size: 1 }] }] },
  }
  const kitchen = {
    name: 'Kitchen',
    landscape: { rows: [{ size: 1, panes: [{ component: 'week', size: 3 }, { component: 'agenda', size: 2 }] }] },
    portrait: { rows: [{ size: 3, panes: [{ component: 'week', size: 1 }] }, { size: 2, panes: [{ component: 'agenda', size: 1 }] }] },
  }

  /** A socket that collects what the server sends. */
  function connect() {
    const socket = new WebSocket(url('/_ws?display=hallway&role=remote').replace(/^http/, 'ws'))
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

  it('answers 404 for set_layout when there are no layouts', async () => {
    await expect(command({ type: 'set_layout', layout: 'kitchen' })).rejects.toMatchObject(reason(404, 'Unknown layout "kitchen"'))
    expect((await stateOf()).view).toBe('month')
  })

  it('answers 400 for a set_layout with no layout or a layout that is not an id', async () => {
    await expect(command({ type: 'set_layout' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(command({ type: 'set_layout', layout: 'Kitchen Board' })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('shows a layout with set_layout, and answers with the new state', async () => {
    await create(board)
    await create(kitchen)

    expect(await command({ type: 'set_layout', layout: 'kitchen' })).toMatchObject({ view: 'custom', layout: 'kitchen' })
    expect(await stateOf()).toMatchObject({ view: 'custom', layout: 'kitchen' })
  })

  it('answers 404 for a layout that is not in the library, and leaves the wall as it is', async () => {
    await expect(command({ type: 'set_layout', layout: 'garage' })).rejects.toMatchObject(reason(404, 'Unknown layout "garage"'))
    expect(await stateOf()).toMatchObject({ view: 'custom', layout: 'kitchen' })
  })

  it('keeps the layout when the view moves away, and set_view custom brings it back', async () => {
    expect(await command({ type: 'set_view', view: 'agenda' })).toMatchObject({ view: 'agenda', layout: 'kitchen' })
    expect(await command({ type: 'set_view', view: 'custom' })).toMatchObject({ view: 'custom', layout: 'kitchen' })
  })

  it('steps through the layouts by name with next_view', async () => {
    await command({ type: 'set_view', view: 'week_photo' })

    // The layouts follow the built-in views, by name, and then it wraps round to the month.
    expect(await command({ type: 'next_view' })).toMatchObject({ view: 'custom', layout: 'board' })
    expect(await command({ type: 'next_view' })).toMatchObject({ view: 'custom', layout: 'kitchen' })
    expect(await command({ type: 'next_view' })).toMatchObject({ view: 'month' })
  })

  it('keeps a layout with a week for set_week, and switches to the week view for one without', async () => {
    await command({ type: 'set_layout', layout: 'kitchen' })
    expect(await command({ type: 'set_week', week: 'next' })).toMatchObject({ view: 'custom', layout: 'kitchen', week: expect.any(String) })

    await command({ type: 'set_layout', layout: 'board' })
    expect(await command({ type: 'set_week', week: 'next' })).toMatchObject({ view: 'week' })
  })

  it('takes the wall off a layout that is deleted, to the month view, and tells the sockets', async () => {
    await command({ type: 'set_layout', layout: 'kitchen' })
    const remote = connect()
    await remote.opened
    await remote.next(message => message.type === 'state.updated')
    const seen = remote.messages.length

    const response = await fetch(url('/api/layouts/kitchen'), { method: 'DELETE' })

    expect(response.status).toBe(204)
    expect(await stateOf()).toMatchObject({ view: 'month', layout: null })
    const update = await remote.next(message => message.type === 'state.updated' && message.state.layout === null, seen)
    expect(update).toMatchObject({ state: { view: 'month' } })
    remote.socket.close()
  })

  it('answers 404 for the layout that was deleted, and still takes the one that is left', async () => {
    await expect(command({ type: 'set_layout', layout: 'kitchen' })).rejects.toMatchObject(reason(404, 'Unknown layout "kitchen"'))
    expect(await command({ type: 'set_layout', layout: 'board' })).toMatchObject({ view: 'custom', layout: 'board' })
  })
})
