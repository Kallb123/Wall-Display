import { DEFAULT_POOL_UNSPLASH_COUNT } from '../../shared/photoPools'
import type { PhotoPool, PhotoPoolSource } from '../../shared/photoPools'
import type { PhotosConfig } from '../config/schema'
import { photoFeedIdsOf, resolveImmich, resolveUnsplash } from './feeds'
import type { PhotoFeed } from './feeds'
import { poolSourceProviderId } from './poolIds'

// Works out, from the pools a person has made and the config's `photos` block,
// what the photo service has to run for them: one provider for each distinct
// Unsplash search, collection, topic or Immich album (two pools asking for the
// same thing share one), and one group for each pool, naming the providers its
// photos come from. A `feed` source needs no provider of its own: it is a feed
// the config already runs, so the group just names it. Pure: nothing here
// reads a file or the network.

/** A pool as the service sees it: its id (what `photo_feed` holds), its name and the providers whose photos it is the union of. */
export interface PhotoGroup {
  id: string
  name: string
  members: string[]
}

/** A provider to run for a pool's source: always Unsplash or Immich (a local folder is reachable only as a feed). */
export type PoolFeed = Extract<PhotoFeed, { source: 'unsplash' | 'immich' }>

export interface PoolFeeds {
  /** The providers to run for the pools' own sources, by provider id. */
  feeds: Map<string, PoolFeed>
  groups: PhotoGroup[]
}

/** A readable name for a provider made for a source, for the logs and the settings API. Never holds a key. */
function nameOf(source: PhotoPoolSource): string {
  switch (source.kind) {
    case 'unsplash_search':
      return `Unsplash "${source.query}"`
    case 'unsplash_collection':
      return `Unsplash collection ${source.collection}`
    case 'unsplash_topic':
      return `Unsplash topic ${source.topic}`
    case 'immich_album':
      return `Immich album ${source.album_id}`
    case 'feed':
      return source.feed
  }
}

/** The provider for a source that has a block to run on, or null when the config lacks it (or the source is a feed). */
function feedFor(source: PhotoPoolSource, photos: Pick<PhotosConfig, 'immich' | 'unsplash'>): PoolFeed | null {
  const id = poolSourceProviderId(source)
  const name = nameOf(source)
  if (source.kind === 'immich_album') {
    return photos.immich ? { id, name, source: 'immich', settings: resolveImmich(photos.immich, { mode: 'albums', album_ids: [source.album_id] }) } : null
  }
  if (source.kind === 'feed' || !photos.unsplash) return null
  const asked = source.kind === 'unsplash_search' ? { query: source.query } : source.kind === 'unsplash_collection' ? { collections: [source.collection] } : { topics: [source.topic] }
  const settings = resolveUnsplash(photos.unsplash, {
    ...asked,
    ...(source.orientation === undefined ? {} : { orientation: source.orientation }),
    count: source.count ?? DEFAULT_POOL_UNSPLASH_COUNT,
  })
  return { id, name, source: 'unsplash', settings }
}

/**
 * The providers and groups for `pools`. A source whose config block is missing,
 * or a `feed` source naming a feed that is not set up, is left out of its
 * group's members; the rest of the pool still shows. A pool left with no member
 * still has its group, which the service skips like an unknown feed.
 */
export function poolFeedsOf(pools: readonly Pick<PhotoPool, 'id' | 'name' | 'sources'>[], photos: Pick<PhotosConfig, 'immich' | 'local' | 'unsplash' | 'feeds'>): PoolFeeds {
  const feeds = new Map<string, PoolFeed>()
  const configured = new Set(photoFeedIdsOf(photos))
  const groups = pools.map((pool): PhotoGroup => {
    const members: string[] = []
    for (const source of pool.sources) {
      const id = poolSourceProviderId(source)
      if (source.kind === 'feed') {
        if (!configured.has(source.feed)) continue
      } else if (!feeds.has(id)) {
        const feed = feedFor(source, photos)
        if (!feed) continue
        feeds.set(id, feed)
      }
      if (!members.includes(id)) members.push(id)
    }
    return { id: pool.id, name: pool.name, members }
  })
  return { feeds, groups }
}
