import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import type { CustomLayout } from '../../shared/layouts'
import type { PhotoPool, PhotoPoolsResponse } from '../../shared/photoPools'
import { PIN_HEADER } from '../../shared/remote'
import { builtApp } from '../helpers/builtApp'

// The photo pools API, on the dev config (whose photos block has the `local`
// folder only) with `remote.pin` set. The tests build on each other, in order.
describe('photo pools', async () => {
  const appDir = fileURLToPath(new URL('../..', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'wallcal-e2e-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const configFile = join(dir, 'config.yaml')
  const dev = readFileSync(join(appDir, 'config.dev.yaml'), 'utf8').replaceAll('file:./', `file:${appDir}/`)
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

  const send = <T>(method: string, path: string, body?: unknown, headers: Record<string, string> = right) =>
    $fetch<T>(path, { method: method as 'POST', body: body as Record<string, unknown>, headers })
  const create = (body: unknown, headers?: Record<string, string>) => send<PhotoPool>('POST', '/api/photo-pools', body, headers)
  const list = () => $fetch<PhotoPoolsResponse>('/api/photo-pools')

  const garden = { name: 'Garden', sources: [{ kind: 'feed', feed: 'local' }] }
  const layout = {
    name: 'Kitchen',
    landscape: { rows: [{ size: 1, panes: [{ component: 'photo', size: 2 }, { component: 'week', size: 3 }] }] },
    portrait: { rows: [{ size: 2, panes: [{ component: 'photo', size: 1 }] }, { size: 3, panes: [{ component: 'week', size: 1 }] }] },
  }

  it('lists nothing at first, and says what the config offers', async () => {
    expect(await list()).toEqual({ configured: true, unsplash_available: false, immich_available: false, feeds: [{ id: 'local', name: expect.any(String), source: 'local' }], pools: [] })
  })

  it('answers 401 to a write without the PIN', async () => {
    await expect(create(garden, {})).rejects.toMatchObject({ statusCode: 401 })
  })

  it('adds a pool, with an id from its name, and lists it with its status', async () => {
    const created = await create(garden)
    expect(created).toMatchObject({ id: 'garden', name: 'Garden', sources: garden.sources })

    const { pools } = await list()
    expect(pools).toHaveLength(1)
    expect(pools[0]).toMatchObject({ id: 'garden', used_by: [], status: [{ problem: null, photos: expect.any(Number), cached: expect.any(Number) }] })
    expect(pools[0]!.status).toHaveLength(1)
  })

  it('does not take an id a feed already has', async () => {
    expect((await create({ name: 'Local', sources: garden.sources })).id).toBe('local-2')
    await send('DELETE', '/api/photo-pools/local-2')
  })

  it('refuses a bad body, naming the field', async () => {
    await expect(create({ name: '', sources: garden.sources })).rejects.toMatchObject(reason(400, 'name'))
    await expect(create({ name: 'Empty', sources: [] })).rejects.toMatchObject(reason(400, 'sources'))
  })

  it('refuses an Unsplash or Immich source the config has no block for, and an unknown feed, naming the source', async () => {
    await expect(create({ name: 'Lakes', sources: [{ kind: 'feed', feed: 'local' }, { kind: 'unsplash_search', query: 'lake' }] })).rejects.toMatchObject(reason(400, 'sources.1 needs a photos.unsplash block'))
    await expect(create({ name: 'Album', sources: [{ kind: 'immich_album', album_id: 'abc' }] })).rejects.toMatchObject(reason(400, 'sources.0 needs a photos.immich block'))
    await expect(create({ name: 'Gone', sources: [{ kind: 'feed', feed: 'nope' }] })).rejects.toMatchObject(reason(400, 'sources.0 the feed "nope" is not set up'))
  })

  it('refuses a name another pool has, ignoring case', async () => {
    await expect(create({ ...garden, name: 'GARDEN' })).rejects.toMatchObject(reason(409, 'already a pool called'))
  })

  it('edits a pool and keeps its id', async () => {
    const updated = await send<PhotoPool>('PUT', '/api/photo-pools/garden', { name: 'Back garden', sources: garden.sources })
    expect(updated).toMatchObject({ id: 'garden', name: 'Back garden' })
    expect((await list()).pools.map(pool => pool.name)).toEqual(['Back garden'])
    await expect(send('PUT', '/api/photo-pools/nope', garden)).rejects.toMatchObject(reason(404, 'Unknown photo pool'))
    await expect(send('PUT', '/api/photo-pools/garden', { name: 'Bad', sources: [{ kind: 'unsplash_topic', topic: 'nature' }] })).rejects.toMatchObject(reason(400, 'sources.0'))
  })

  it('lets a layout\'s photo pane name the pool, and refuses an unknown one', async () => {
    const photoPane = { ...layout, landscape: { rows: [{ size: 1, panes: [{ component: 'photo', size: 2 }, { component: 'week', size: 3 }] }] }, photo_feed: 'garden' }
    const made = await send<CustomLayout>('POST', '/api/layouts', photoPane)
    expect(made.photo_feed).toBe('garden')
    await expect(send('POST', '/api/layouts', { ...photoPane, name: 'Other', photo_feed: 'nope' })).rejects.toMatchObject(reason(400, 'use'))

    expect((await list()).pools[0]!.used_by).toEqual(['Kitchen'])
  })

  it('will not delete a pool a layout shows, naming the layout', async () => {
    await expect(send('DELETE', '/api/photo-pools/garden')).rejects.toMatchObject(reason(409, '"Kitchen"'))
    expect((await list()).pools).toHaveLength(1)
  })

  it('deletes a pool once nothing shows it, and answers 404 after', async () => {
    await send('DELETE', '/api/layouts/kitchen')
    const res = await fetch('/api/photo-pools/garden', { method: 'DELETE', headers: right })
    expect(res.status).toBe(204)
    expect((await list()).pools).toEqual([])
    expect((await fetch('/api/photo-pools/garden', { method: 'DELETE', headers: right })).status).toBe(404)
  })
})
