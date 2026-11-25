import { describe, expect, it } from 'vitest'
import type { PhotoPool, PhotoPoolSource } from '../../../shared/photoPools'
import { poolFeedsOf } from '../../../server/photos/pools'
import { poolSourceProviderId } from '../../../server/photos/poolIds'

// Which providers and groups a set of pools makes, from the config's photos block.

const unsplash = { access_key: 'unsplash-key', query: 'landscape', content_filter: 'high' as const, count: 60, pick: 'random' as const, refresh_minutes: 60 }
const immich = { url: 'http://immich.local', api_key: 'key', mode: 'random' as const, album_ids: [], random: { count: 200, person_ids: [] }, show_date: false }
const block = { unsplash, immich, local: { path: '/photos' }, feeds: [{ id: 'garden', local: { path: '/photos/garden' } }] }

const pool = (id: string, sources: PhotoPoolSource[]): PhotoPool => ({ id, name: id.toUpperCase(), sources, created_at: '', updated_at: '' })

describe('poolFeedsOf', () => {
  it('makes one provider for each distinct source, and a group for each pool', () => {
    const lakes: PhotoPoolSource = { kind: 'unsplash_search', query: 'mountain lake' }
    const { feeds, groups } = poolFeedsOf([
      pool('trips', [lakes, { kind: 'immich_album', album_id: 'abc-1' }]),
      pool('walls', [{ kind: 'unsplash_search', query: 'Mountain  Lake' }, { kind: 'feed', feed: 'garden' }]),
    ], block)

    // The same search in two pools is one provider.
    expect([...feeds.keys()].sort()).toEqual([poolSourceProviderId(lakes), poolSourceProviderId({ kind: 'immich_album', album_id: 'abc-1' })].sort())
    expect(groups).toEqual([
      { id: 'trips', name: 'TRIPS', members: [poolSourceProviderId(lakes), poolSourceProviderId({ kind: 'immich_album', album_id: 'abc-1' })] },
      { id: 'walls', name: 'WALLS', members: [poolSourceProviderId(lakes), 'garden'] },
    ])
  })

  it('asks Unsplash for the source alone, with the default count and the block\'s key', () => {
    const search: PhotoPoolSource = { kind: 'unsplash_search', query: 'mountain lake', orientation: 'landscape' }
    const collection: PhotoPoolSource = { kind: 'unsplash_collection', collection: '317099', count: 90 }
    const topic: PhotoPoolSource = { kind: 'unsplash_topic', topic: 'nature' }
    const { feeds } = poolFeedsOf([pool('p', [search, collection, topic])], block)

    expect(feeds.get(poolSourceProviderId(search))).toMatchObject({
      source: 'unsplash',
      name: 'Unsplash "mountain lake"',
      settings: { access_key: 'unsplash-key', query: 'mountain lake', orientation: 'landscape', count: 30 },
    })
    expect(feeds.get(poolSourceProviderId(collection))!.settings).toMatchObject({ collections: ['317099'], count: 90 })
    expect(feeds.get(poolSourceProviderId(collection))!.settings).not.toHaveProperty('query')
    expect(feeds.get(poolSourceProviderId(topic))!.settings).toMatchObject({ topics: ['nature'], count: 30 })
  })

  it('runs an Immich album as that album alone', () => {
    const album: PhotoPoolSource = { kind: 'immich_album', album_id: 'abc-1' }
    const { feeds } = poolFeedsOf([pool('p', [album])], block)

    expect(feeds.get(poolSourceProviderId(album))).toMatchObject({
      source: 'immich',
      settings: { url: 'http://immich.local', api_key: 'key', mode: 'albums', album_ids: ['abc-1'], show_date: false },
    })
    // An album in a pool draws the date as the block says.
    const dated = poolFeedsOf([pool('p', [album])], { ...block, immich: { ...immich, show_date: true } })
    expect(dated.feeds.get(poolSourceProviderId(album))!.settings).toMatchObject({ show_date: true })
  })

  it('leaves out a source whose block is missing and a feed that is not set up', () => {
    const { feeds, groups } = poolFeedsOf([
      pool('p', [{ kind: 'unsplash_topic', topic: 'nature' }, { kind: 'immich_album', album_id: 'a' }, { kind: 'feed', feed: 'gone' }, { kind: 'feed', feed: 'local' }]),
    ], { ...block, unsplash: undefined, immich: undefined })

    expect(feeds.size).toBe(0)
    expect(groups).toEqual([{ id: 'p', name: 'P', members: ['local'] }])
  })

  it('keeps a pool whose sources can all not run, as a group with no members', () => {
    expect(poolFeedsOf([pool('p', [{ kind: 'feed', feed: 'gone' }])], block).groups).toEqual([{ id: 'p', name: 'P', members: [] }])
  })
})
