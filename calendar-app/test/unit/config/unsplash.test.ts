import { describe, expect, it } from 'vitest'
import { photoFeedIdsOf, photoFeedsOf } from '../../../server/photos/feeds'
import { load, loadError, minimalConfig } from './helpers'

const ALBUM = '0b6a1c52-7a3e-4a47-9c1d-1d8d4a8f1a01'
const PERSON = '5c7e9a1b-3d5f-4b7a-9c2e-4f6a8b0c2d03'
const IMMICH = { url: 'http://immich.local:2283', api_key: 'k' }

async function photos(block: Record<string, unknown>) {
  const raw = minimalConfig()
  raw.photos = block
  return (await load({ config: raw })).config.photos!
}

async function problem(block: Record<string, unknown>, change: (raw: ReturnType<typeof minimalConfig>) => void = () => {}): Promise<string> {
  const raw = minimalConfig()
  raw.photos = block
  change(raw)
  return (await loadError({ config: raw })).message
}

describe('photos.unsplash', () => {
  it('has defaults: a search for landscape, high content filter, 60 random photos, listed every 60 minutes', async () => {
    expect((await photos({ unsplash: { access_key: 'k' } })).unsplash).toEqual({
      access_key: 'k',
      query: 'landscape',
      content_filter: 'high',
      count: 60,
      pick: 'random',
      refresh_minutes: 60,
    })
  })

  it('takes a query, collections or topics, with an orientation', async () => {
    expect((await photos({ unsplash: { access_key: 'k', query: 'mountain lake', orientation: 'portrait', count: 300, refresh_minutes: 10080, pick: 'fixed', content_filter: 'low' } })).unsplash)
      .toEqual({ access_key: 'k', query: 'mountain lake', orientation: 'portrait', count: 300, refresh_minutes: 10080, pick: 'fixed', content_filter: 'low' })
    // A number is a collection id too, as YAML would read `[317099]`.
    expect((await photos({ unsplash: { access_key: 'k', collections: [317099, '1234'] } })).unsplash).toMatchObject({ collections: ['317099', '1234'] })
    expect((await photos({ unsplash: { access_key: 'k', collections: [317099] } })).unsplash).not.toHaveProperty('query')
    expect((await photos({ unsplash: { access_key: 'k', topics: ['nature', 'travel'] } })).unsplash).toMatchObject({ topics: ['nature', 'travel'] })
  })

  it('refuses more than one of query, collections and topics', async () => {
    const message = await problem({ unsplash: { access_key: 'k', query: 'sea', topics: ['nature'] } })

    expect(message).toContain('photos.unsplash.topics')
    expect(message).toContain("query and topics can't be used together")
  })

  it.each([
    ['no access key', { query: 'sea' }, 'photos.unsplash.access_key'],
    ['an empty access key', { access_key: ' ' }, 'photos.unsplash.access_key'],
    ['an empty query', { access_key: 'k', query: '' }, 'photos.unsplash.query'],
    ['no collections', { access_key: 'k', collections: [] }, 'photos.unsplash.collections'],
    ['no topics', { access_key: 'k', topics: [] }, 'photos.unsplash.topics'],
    ['a collection id that is not an id', { access_key: 'k', collections: ['1/../2'] }, 'photos.unsplash.collections[0]'],
    ['a topic slug with a query in it', { access_key: 'k', topics: ['a?b'] }, 'photos.unsplash.topics[0]'],
    ['an orientation that does not exist', { access_key: 'k', orientation: 'wide' }, 'photos.unsplash.orientation'],
    ['a content filter that does not exist', { access_key: 'k', content_filter: 'medium' }, 'photos.unsplash.content_filter'],
    ['a count of 0', { access_key: 'k', count: 0 }, 'photos.unsplash.count'],
    ['a count above 300', { access_key: 'k', count: 301 }, 'photos.unsplash.count'],
    ['a refresh sooner than the 10 minute tick', { access_key: 'k', refresh_minutes: 9 }, 'photos.unsplash.refresh_minutes'],
    ['a refresh that is not whole minutes', { access_key: 'k', refresh_minutes: 30.5 }, 'photos.unsplash.refresh_minutes'],
    ['a refresh above a week', { access_key: 'k', refresh_minutes: 10081 }, 'photos.unsplash.refresh_minutes'],
    ['a pick that does not exist', { access_key: 'k', pick: 'shuffle' }, 'photos.unsplash.pick'],
    ['an unknown setting', { access_key: 'k', size: 'big' }, 'photos.unsplash.size: unknown setting'],
  ])('refuses %s', async (_name, block, path) => {
    expect(await problem({ unsplash: block })).toContain(path)
  })
})

describe('photos.feeds', () => {
  it('is empty by default, and a config without feeds lists the sources that are set up', async () => {
    const block = await photos({ immich: IMMICH, local: { path: '/photos' }, unsplash: { access_key: 'k' } })

    expect(block.feeds).toEqual([])
    expect(photoFeedsOf(block).map(({ id, name, source }) => ({ id, name, source }))).toEqual([
      { id: 'immich', name: 'Immich', source: 'immich' },
      { id: 'local', name: 'Local folder', source: 'local' },
      { id: 'unsplash', name: 'Unsplash', source: 'unsplash' },
    ])
  })

  it('resolves an Unsplash feed over the block: the key and what it leaves out come from the block', async () => {
    const block = await photos({
      unsplash: { access_key: 'key', query: 'sea', orientation: 'landscape', count: 90, refresh_minutes: 30, pick: 'fixed', content_filter: 'low' },
      feeds: [
        { id: 'mountains', name: 'Mountains', unsplash: { query: 'mountain lake', count: 30 } },
        { id: 'art', unsplash: { collections: ['317099'], orientation: 'squarish', pick: 'random', refresh_minutes: 90 } },
        { id: 'same', unsplash: {} },
      ],
    })

    const [mountains, art, same] = photoFeedsOf(block).slice(1)

    expect(mountains).toEqual({
      id: 'mountains',
      name: 'Mountains',
      source: 'unsplash',
      settings: { access_key: 'key', query: 'mountain lake', orientation: 'landscape', count: 30, pick: 'fixed', refresh_minutes: 30, content_filter: 'low' },
    })
    // Its own collections replace the block's search, rather than joining it.
    expect(art).toEqual({
      id: 'art',
      name: 'art',
      source: 'unsplash',
      settings: { access_key: 'key', collections: ['317099'], orientation: 'squarish', count: 90, pick: 'random', refresh_minutes: 90, content_filter: 'low' },
    })
    expect(same!.settings).toEqual(block.unsplash)
  })

  it('resolves an Immich feed over the block, with the mode following what the feed gives', async () => {
    const block = await photos({
      immich: { ...IMMICH, mode: 'albums', album_ids: [ALBUM], random: { count: 50 } },
      feeds: [
        { id: 'inherits', immich: {} },
        { id: 'faces', immich: { random: { person_ids: [PERSON] } } },
        { id: 'memories', immich: { mode: 'memories' } },
        { id: 'other-album', immich: { album_ids: ['9d2f4e6a-5b1c-4f3a-8a7e-2c4b6d8e0f02'] } },
      ],
    })

    const [inherits, faces, memories, otherAlbum] = photoFeedsOf(block).slice(1).map(feed => feed.settings)

    expect(inherits).toEqual(block.immich)
    expect(faces).toMatchObject({ url: IMMICH.url, api_key: 'k', mode: 'random', album_ids: [ALBUM], random: { count: 50, person_ids: [PERSON] } })
    expect(memories).toMatchObject({ mode: 'memories' })
    expect(otherAlbum).toMatchObject({ mode: 'albums', album_ids: ['9d2f4e6a-5b1c-4f3a-8a7e-2c4b6d8e0f02'] })
  })

  it('gives a local feed its own folder, made absolute', async () => {
    const block = await photos({ feeds: [{ id: 'garden', local: { path: '/srv/garden/' } }] })

    expect(photoFeedsOf(block)).toEqual([{ id: 'garden', name: 'garden', source: 'local', settings: { path: '/srv/garden' } }])
  })

  it('lists the ids a rule may name', async () => {
    const block = await photos({ local: { path: '/p' }, unsplash: { access_key: 'k' }, feeds: [{ id: 'garden', local: { path: '/g' } }] })

    expect(photoFeedIdsOf(block)).toEqual(['local', 'unsplash', 'garden'])
  })

  it.each([
    ['needs a source', { id: 'x' }, 'photos.feeds[0].id: needs exactly one of'],
    ['takes only one source', { id: 'x', local: { path: '/g' }, unsplash: {} }, 'photos.feeds[0].local: needs exactly one of'],
    ['can not be named for a source', { id: 'unsplash', local: { path: '/g' } }, 'photos.feeds[0].id: "unsplash" is the name of a photo source'],
    ['can not be named google either', { id: 'google', local: { path: '/g' } }, 'is the name of a photo source'],
    ['needs an id that is a slug', { id: 'My Feed', local: { path: '/g' } }, 'photos.feeds[0].id'],
    ['takes no setting it does not know', { id: 'x', local: { path: '/g', recursive: true } }, 'photos.feeds[0].local.recursive: unknown setting'],
    ['takes no access key of its own', { id: 'x', unsplash: { access_key: 'other' } }, 'photos.feeds[0].unsplash.access_key: unknown setting'],
    ['takes one of query, collections and topics at most', { id: 'x', unsplash: { query: 'a', collections: ['1'] } }, 'photos.feeds[0].unsplash.collections'],
  ])('is an error when it %s', async (_name, feed, message) => {
    expect(await problem({ unsplash: { access_key: 'k' }, feeds: [feed] })).toContain(message)
  })

  it('is an error to use an id twice', async () => {
    const message = await problem({ feeds: [{ id: 'a', local: { path: '/a' } }, { id: 'a', local: { path: '/b' } }] })

    expect(message).toContain('photos.feeds[1].id: duplicate id "a"')
  })

  it('names the block an Unsplash or Immich feed needs for its credentials', async () => {
    expect(await problem({ local: { path: '/p' }, feeds: [{ id: 'a', unsplash: { query: 'sea' } }] })).toContain('photos.feeds[0].unsplash: needs the photos.unsplash block')
    expect(await problem({ local: { path: '/p' }, feeds: [{ id: 'a', immich: {} }] })).toContain('photos.feeds[0].immich: needs the photos.immich block')
  })

  it('is an error for an Immich feed in albums mode that ends up with no albums', async () => {
    const message = await problem({ immich: IMMICH, feeds: [{ id: 'a', immich: { mode: 'albums' } }] })

    expect(message).toContain('photos.feeds[0].immich: mode "albums" needs at least one album id')
  })
})

describe('a schedule rule\'s photo_feed', () => {
  const withRule = (photoFeed: string, block: Record<string, unknown>) => {
    const raw = minimalConfig()
    raw.photos = block
    raw.displays[0].schedules = [{ id: 'day', rules: [{ view: 'photo', from: '10:00', to: '16:00', photo_feed: photoFeed }] }]
    return raw
  }
  const block = { unsplash: { access_key: 'k' }, feeds: [{ id: 'mountains', unsplash: { query: 'mountain lake' } }] }

  it('may name a source that is set up, or a feed', async () => {
    for (const name of ['unsplash', 'mountains']) {
      const { config } = await load({ config: withRule(name, block) })
      expect(config.displays[0]!.schedules[0]!.rules[0]!.photo_feed).toBe(name)
    }
  })

  it('is an error to name one that is not set up, and says which are', async () => {
    const message = (await loadError({ config: withRule('immich', block) })).message

    expect(message).toContain('displays[0].schedules[0].rules[0].photo_feed: unknown photo feed "immich" (must be one of unsplash, mountains)')
  })

  it('is an error to name one without a photos block', async () => {
    const raw = withRule('mountains', block)
    delete raw.photos

    expect((await loadError({ config: raw })).message).toContain('rules[0].photo_feed: unknown photo feed "mountains"')
  })
})
