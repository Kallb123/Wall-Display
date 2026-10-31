import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import type { PhotoSource } from '../../../shared/display'
import { PhotoRenderError } from '../../../server/photos/render'
import type { RenderedPhoto } from '../../../server/photos/render'
import type { Random } from '../../../server/photos/playlist'
import { PhotoProviderError } from '../../../server/photos/types'
import type { PhotoListing, PhotoProvider } from '../../../server/photos/types'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** A folder that is removed after the test. */
export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wallcal-photos-'))
  dirs.push(dir)
  return dir
}

/** A small seeded random number generator (mulberry32), so a shuffle is the same every run. */
export function seeded(seed: number): Random {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface FakeProvider {
  provider: PhotoProvider
  /** What `list()` answers: the id of each photo, and its size if the provider knows it. */
  items: Map<string, { width: number, height: number } | undefined>
  /** The ids `fetch()` was asked for, in order. */
  fetched: string[]
  listFails: boolean
  fetchFails: boolean
  listCalls: number
}

/** A provider with a pool the test edits, that can be made to fail. */
export function fakeProvider(id: PhotoSource, ids: string[] = []): FakeProvider {
  const fake: FakeProvider = {
    items: new Map(ids.map(item => [item, { width: 1600, height: 900 }])),
    fetched: [],
    listFails: false,
    fetchFails: false,
    listCalls: 0,
    provider: {
      id,
      async list() {
        fake.listCalls++
        if (fake.listFails) throw new PhotoProviderError(id, 'The server did not answer')
        return [...fake.items].map(([providerAssetId, size]): PhotoListing => ({ providerAssetId, ...size }))
      },
      async fetch(providerAssetId) {
        if (fake.fetchFails) throw new PhotoProviderError(id, 'The server did not answer')
        fake.fetched.push(providerAssetId)
        return Buffer.from(providerAssetId)
      },
    },
  }
  return fake
}

/**
 * A render that doesn't draw anything: the "image" is the photo's id padded to
 * `bytes`, so every photo is a different file of a known size. `sizes` gives a
 * photo's true size by id (default 1600×900), and the id `bad` can't be rendered.
 */
export function fakeRender(sizes: Record<string, [number, number]> = {}, bytes = 100) {
  return async (input: Buffer): Promise<RenderedPhoto> => {
    const id = input.toString()
    if (id === 'bad' || id.endsWith('/bad')) throw new PhotoRenderError('The photo can\'t be read')
    const [width, height] = sizes[id] ?? [1600, 900]
    return { data: Buffer.from(id.padEnd(bytes, '.')), width, height, orientation: height > width ? 'portrait' : 'landscape' }
  }
}

/** A log that says nothing, whose calls a test can read. */
export function quietLog() {
  return { info: () => {}, warn: () => {}, error: () => {} }
}
