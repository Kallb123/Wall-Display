import { describe, expect, it } from 'vitest'
import type { PhotoPoolInput } from '../../../shared/photoPools'
import type { PhotosConfig } from '../../../server/config/schema'
import { poolRefusal, sourceProblem, sourceProblems } from '../../../server/photoPools/checks'

// What a pool may ask for, given the config's photos block.

const full = { immich: { url: 'http://immich' }, unsplash: { access_key: 'k' }, local: { path: '/p' }, feeds: [{ id: 'mountains' }] } as unknown as PhotosConfig
const localOnly = { local: { path: '/p' }, feeds: [] } as unknown as PhotosConfig

const pool = (...sources: PhotoPoolInput['sources']): PhotoPoolInput => ({ name: 'Pool', sources })

describe('poolRefusal', () => {
  it('accepts sources the config supports', () => {
    const input = pool({ kind: 'unsplash_search', query: 'lake' }, { kind: 'unsplash_topic', topic: 'nature' }, { kind: 'immich_album', album_id: 'abc' }, { kind: 'feed', feed: 'mountains' }, { kind: 'feed', feed: 'local' })
    expect(poolRefusal(input, full)).toBeNull()
  })

  it('is a 409 with no photos block', () => {
    expect(poolRefusal(pool({ kind: 'feed', feed: 'local' }), undefined)).toMatchObject({ statusCode: 409, message: expect.stringContaining('no photos block') })
  })

  it('is a 400 naming the first source the config can\'t run', () => {
    expect(poolRefusal(pool({ kind: 'feed', feed: 'local' }, { kind: 'unsplash_collection', collection: '123' }), localOnly))
      .toMatchObject({ statusCode: 400, message: expect.stringMatching(/^sources\.1 needs a photos\.unsplash block/) })
    expect(poolRefusal(pool({ kind: 'immich_album', album_id: 'abc' }), localOnly))
      .toMatchObject({ statusCode: 400, message: expect.stringMatching(/^sources\.0 needs a photos\.immich block/) })
  })

  it('is a 400 for a feed that is not set up, listing the ones that are', () => {
    expect(poolRefusal(pool({ kind: 'feed', feed: 'garden' }), full))
      .toMatchObject({ statusCode: 400, message: expect.stringMatching(/^sources\.0 the feed "garden" is not set up.*use immich, local, unsplash, mountains/) })
  })
})

describe('sourceProblem and sourceProblems', () => {
  it('gives a message per source that can\'t run, and null for the rest', () => {
    const sources = pool({ kind: 'unsplash_search', query: 'lake' }, { kind: 'feed', feed: 'local' }, { kind: 'feed', feed: 'gone' }).sources
    expect(sourceProblems(sources, localOnly)).toEqual([expect.stringContaining('photos.unsplash'), null, expect.stringContaining('"gone"')])
    expect(sourceProblems(sources, undefined).every(problem => problem !== null)).toBe(true)
    expect(sourceProblem(sources[0]!, full)).toBeNull()
  })
})
