import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import PhotoPoolsSection from '~/components/photos/PhotoPoolsSection.vue'
import type { PhotoPoolWithStatus, PhotoPoolsResponse } from '../../shared/photoPools'

// The photo pools section of Settings → Photos against a pretend server: `$fetch`
// answers as /api/photo-pools does and every request is recorded.

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
mockNuxtImport('$fetch', () => fetchMock)

const status = { photos: 60, cached: 20, last_success_at: '2026-11-14T09:00:00Z', last_error: null, problem: null }

const pool = (changes: Partial<PhotoPoolWithStatus> = {}): PhotoPoolWithStatus => ({
  id: 'mountains',
  name: 'Mountains',
  sources: [{ kind: 'unsplash_search', query: 'mountain lake', orientation: 'landscape' }, { kind: 'feed', feed: 'local' }],
  created_at: '2026-11-01T10:00:00.000Z',
  updated_at: '2026-11-01T10:00:00.000Z',
  status: [status, { ...status, photos: 8 }],
  used_by: [],
  ...changes,
})

let response: PhotoPoolsResponse
let requests: { method: string, url: string, body?: unknown }[]
let failure: { code: number, message: string } | null

function refusal(code: number, message: string) {
  return Object.assign(new Error(`${code}`), { statusCode: code, data: { statusCode: code, message } })
}

async function server(url: string, options: { method?: string, body?: unknown } = {}) {
  const method = options.method ?? 'GET'
  requests.push({ method, url, body: options.body })
  if (method === 'GET') return structuredClone(response)
  if (failure) throw refusal(failure.code, failure.message)
  if (method === 'DELETE') return undefined
  return { ...pool(), ...(options.body as object) }
}

const mounted: { unmount: () => void }[] = []

async function mountSection() {
  const wrapper = await mountSuspended(PhotoPoolsSection)
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

const find = (wrapper: Awaited<ReturnType<typeof mountSection>>, testid: string) => wrapper.find(`[data-testid="${testid}"]`)
const writes = () => requests.filter(request => request.method !== 'GET')

beforeEach(() => {
  fetchMock.mockImplementation(server)
  response = {
    configured: true,
    unsplash_available: true,
    immich_available: true,
    feeds: [{ id: 'local', name: 'Local folder', source: 'local' }],
    pools: [pool()],
  }
  requests = []
  failure = null
})

afterEach(() => {
  mounted.splice(0).forEach(wrapper => wrapper.unmount())
  fetchMock.mockReset()
})

describe('the pools list', () => {
  it('shows each pool with its sources and how they are doing', async () => {
    const wrapper = await mountSection()

    expect(find(wrapper, 'pool-card-name').text()).toBe('Mountains')
    expect(find(wrapper, 'pool-card-id').text()).toContain('mountains')
    const sources = wrapper.findAll('[data-testid="pool-source"]')
    expect(sources).toHaveLength(2)
    expect(sources[0]!.text()).toContain('Unsplash search')
    expect(sources[0]!.text()).toContain('"mountain lake", landscape')
    expect(sources[0]!.text()).toContain('60 photos')
    expect(sources[1]!.text()).toContain('Local folder')
  })

  it('says a source that cannot run, and the last error of one that can', async () => {
    response.pools = [pool({ status: [{ ...status, problem: 'the config has no Unsplash block' }, { ...status, last_error: 'The folder is not there' }] })]
    const wrapper = await mountSection()

    const lines = wrapper.findAll('[data-testid="source-line"]').map(line => line.text())
    expect(lines).toEqual(['Can\'t run: the config has no Unsplash block', 'The folder is not there'])
  })

  it('has an empty state', async () => {
    response.pools = []
    const wrapper = await mountSection()

    expect(find(wrapper, 'pools-empty').exists()).toBe(true)
    expect(find(wrapper, 'new-pool').exists()).toBe(true)
  })

  it('refuses to delete a pool a layout uses, and says which', async () => {
    response.pools = [pool({ used_by: ['Kitchen'] })]
    const wrapper = await mountSection()

    expect(find(wrapper, 'pool-delete').attributes('disabled')).toBeDefined()
    expect(find(wrapper, 'pool-used-by').text()).toBe('Used by layout Kitchen')
  })

  it('deletes after asking', async () => {
    const wrapper = await mountSection()

    await find(wrapper, 'pool-delete').trigger('click')
    expect(find(wrapper, 'confirm-dialog').exists()).toBe(true)
    expect(writes()).toHaveLength(0)
    await find(wrapper, 'confirm-ok').trigger('click')
    await flushPromises()

    expect(writes()).toEqual([{ method: 'DELETE', url: '/api/photo-pools/mountains', body: undefined }])
    expect(find(wrapper, 'pools-note').text()).toBe('Deleted Mountains.')
  })
})

describe('the editor', () => {
  async function addSourceOf(wrapper: Awaited<ReturnType<typeof mountSection>>, kind: string) {
    await find(wrapper, 'add-kind').setValue(kind)
    await find(wrapper, 'add-source').trigger('click')
  }

  it('creates a pool of two searches and a feed', async () => {
    response.pools = []
    const wrapper = await mountSection()

    await find(wrapper, 'new-pool').trigger('click')
    await find(wrapper, 'pool-name').setValue('  Holidays ')
    await addSourceOf(wrapper, 'unsplash_search')
    await addSourceOf(wrapper, 'unsplash_search')
    await addSourceOf(wrapper, 'feed')
    const texts = wrapper.findAll('[data-testid="source-text"]')
    await texts[0]!.setValue('mountain lake')
    await texts[1]!.setValue('beach')
    await wrapper.findAll('[data-testid="source-orientation"]')[1]!.setValue('portrait')
    await wrapper.findAll('[data-testid="source-count"]')[0]!.setValue('60')
    await find(wrapper, 'pool-editor').trigger('submit')
    await flushPromises()

    expect(writes()).toEqual([{
      method: 'POST',
      url: '/api/photo-pools',
      body: {
        name: 'Holidays',
        sources: [
          { kind: 'unsplash_search', query: 'mountain lake', count: 60 },
          { kind: 'unsplash_search', query: 'beach', orientation: 'portrait' },
          { kind: 'feed', feed: 'local' },
        ],
      },
    }])
    expect(find(wrapper, 'pool-editor').exists()).toBe(false)
    expect(find(wrapper, 'pools-note').text()).toBe('Added Holidays.')
  })

  it('changes a saved pool with a PUT to its id', async () => {
    const wrapper = await mountSection()

    await find(wrapper, 'pool-edit').trigger('click')
    expect(find(wrapper, 'pool-id').text()).toContain('mountains')
    await find(wrapper, 'pool-name').setValue('Peaks')
    await find(wrapper, 'pool-editor').trigger('submit')
    await flushPromises()

    expect(writes()).toHaveLength(1)
    expect(writes()[0]).toMatchObject({ method: 'PUT', url: '/api/photo-pools/mountains', body: { name: 'Peaks' } })
  })

  it('shows what is wrong without sending anything', async () => {
    response.pools = []
    const wrapper = await mountSection()

    await find(wrapper, 'new-pool').trigger('click')
    await find(wrapper, 'pool-editor').trigger('submit')

    expect(find(wrapper, 'pool-name-error').text()).toBe('Name must not be empty')
    expect(find(wrapper, 'sources-error').text()).toContain('needs at least one source')
    expect(writes()).toHaveLength(0)
  })

  it('shows the server\'s message when it refuses', async () => {
    failure = { code: 400, message: 'sources.0: the config has no photos.unsplash block' }
    const wrapper = await mountSection()

    await find(wrapper, 'pool-edit').trigger('click')
    await find(wrapper, 'pool-editor').trigger('submit')
    await flushPromises()

    expect(find(wrapper, 'pool-server-error').text()).toBe('Sources.0: the config has no photos.unsplash block')
    expect(find(wrapper, 'pool-editor').exists()).toBe(true)
  })

  it('offers only the kinds the config can run, and says why', async () => {
    response.unsplash_available = false
    response.feeds = []
    response.pools = []
    const wrapper = await mountSection()

    await find(wrapper, 'new-pool').trigger('click')

    const kinds = wrapper.findAll('[data-testid="add-kind"] option').map(option => option.attributes('value'))
    expect(kinds).toEqual(['', 'immich_album'])
    expect(find(wrapper, 'unavailable-unsplash').exists()).toBe(true)
    expect(find(wrapper, 'unavailable-feeds').exists()).toBe(true)
    expect(find(wrapper, 'unavailable-immich').exists()).toBe(false)
  })

  it('notes the Unsplash request cost once a pool has an Unsplash source', async () => {
    const wrapper = await mountSection()

    await find(wrapper, 'pool-edit').trigger('click')
    expect(find(wrapper, 'unsplash-note').text()).toContain('30 photos')
  })
})
