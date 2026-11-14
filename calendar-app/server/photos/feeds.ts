import { PHOTO_SOURCE_NAMES } from '../../shared/photos'
import type { PhotoSource } from '../../shared/display'
import type { ImmichConfig, PhotoFeedConfig, PhotosConfig, UnsplashConfig } from '../config/schema'

// The photo feeds a config sets up (see `photos.feeds` in config.example.yaml).
// A feed is a named pool of photos from one source. Each top-level source block
// (`photos.immich`, `photos.local`, `photos.unsplash`) is a feed of its own whose
// id is the source's name, and each entry of `photos.feeds` is one more. The
// config schema, the photo plugin and the settings page all want the same list,
// so it is worked out here, once, from the parsed config: nothing in this file
// reads a file or the network. Only types come from the schema, so the schema
// can use these functions without a cycle.

type UnsplashFeedConfig = NonNullable<PhotoFeedConfig['unsplash']>
type ImmichFeedConfig = NonNullable<PhotoFeedConfig['immich']>

/** The `local` source's settings: a folder, absolute by the time the config is parsed. */
export interface LocalSettings {
  path: string
}

export type PhotoFeed =
  | { id: string, name: string, source: 'immich', settings: ImmichConfig }
  | { id: string, name: string, source: 'local', settings: LocalSettings }
  | { id: string, name: string, source: 'unsplash', settings: UnsplashConfig }

/** The sources a feed can be of, in the order the top-level blocks are listed. Google is not one: it is not built. */
const SOURCE_BLOCKS = ['immich', 'local', 'unsplash'] as const satisfies readonly PhotoSource[]

/** Whether a feed id would collide with the name of a source, which every top-level block already takes. */
export const isSourceName = (id: string): boolean => (Object.keys(PHOTO_SOURCE_NAMES) as string[]).includes(id)

/**
 * The ids a layout's or a rule's `photo_feed` may name: each top-level source
 * that is set up, then each of `photos.feeds`. Takes only the shape it needs, so
 * the config check can use it on a config that has not finished parsing.
 */
export function photoFeedIdsOf(photos: { immich?: unknown, local?: unknown, unsplash?: unknown, feeds: readonly { id: string }[] }): string[] {
  return [...SOURCE_BLOCKS.filter(source => photos[source] !== undefined), ...photos.feeds.map(feed => feed.id)]
}

/**
 * An Unsplash feed's settings: the top-level block's, with whatever the feed
 * sets laid over it. A feed that names any of `query`, `collections` or `topics`
 * replaces the block's choice of what to show wholesale (a query of its own
 * must not also search the block's collections); one that names none shows what
 * the block shows. The key always comes from the block.
 */
export function resolveUnsplash(block: UnsplashConfig, feed: UnsplashFeedConfig): UnsplashConfig {
  const own = feed.query !== undefined || feed.collections !== undefined || feed.topics !== undefined
  const what = own
    ? { query: feed.query, collections: feed.collections, topics: feed.topics }
    : { query: block.query, collections: block.collections, topics: block.topics }
  return {
    access_key: block.access_key,
    ...(what.query === undefined ? {} : { query: what.query }),
    ...(what.collections === undefined ? {} : { collections: what.collections }),
    ...(what.topics === undefined ? {} : { topics: what.topics }),
    ...((feed.orientation ?? block.orientation) === undefined ? {} : { orientation: (feed.orientation ?? block.orientation)! }),
    content_filter: feed.content_filter ?? block.content_filter,
    count: feed.count ?? block.count,
    refresh_hours: feed.refresh_hours ?? block.refresh_hours,
  }
}

/**
 * An Immich feed's settings: the top-level block's address and key, with the
 * feed's own `mode`, `album_ids` and `random` laid over the block's. The mode
 * is the feed's if it says one; otherwise it follows what the feed gave, as the
 * block's does (album ids mean `albums`, a `random` filter means `random`), and
 * a feed that gives nothing of that kind keeps the block's mode.
 */
export function resolveImmich(block: ImmichConfig, feed: ImmichFeedConfig): ImmichConfig {
  const albumIds = feed.album_ids ?? block.album_ids
  const random: ImmichConfig['random'] = { ...block.random }
  for (const [key, value] of Object.entries(feed.random ?? {})) {
    if (value !== undefined) Object.assign(random, { [key]: value })
  }
  const mode = feed.mode
    ?? (feed.album_ids !== undefined && feed.album_ids.length > 0 ? 'albums' : feed.random !== undefined ? 'random' : block.mode)
  return { url: block.url, api_key: block.api_key, mode, album_ids: albumIds, random }
}

/**
 * Every feed that is set up, ready to run: the top-level sources first (their
 * id is the source's name, their name the source's label), then `photos.feeds`
 * in the order written (named by `name`, or by the id when there is none). The
 * config check makes sure a feed's block exists and its ids are fit to use.
 */
export function photoFeedsOf(photos: Pick<PhotosConfig, 'immich' | 'local' | 'unsplash' | 'feeds'>): PhotoFeed[] {
  const feeds: PhotoFeed[] = []
  if (photos.immich) feeds.push({ id: 'immich', name: PHOTO_SOURCE_NAMES.immich, source: 'immich', settings: photos.immich })
  if (photos.local) feeds.push({ id: 'local', name: PHOTO_SOURCE_NAMES.local, source: 'local', settings: { path: photos.local.path } })
  if (photos.unsplash) feeds.push({ id: 'unsplash', name: PHOTO_SOURCE_NAMES.unsplash, source: 'unsplash', settings: photos.unsplash })
  for (const feed of photos.feeds) {
    const name = feed.name ?? feed.id
    if (feed.immich && photos.immich) feeds.push({ id: feed.id, name, source: 'immich', settings: resolveImmich(photos.immich, feed.immich) })
    else if (feed.unsplash && photos.unsplash) feeds.push({ id: feed.id, name, source: 'unsplash', settings: resolveUnsplash(photos.unsplash, feed.unsplash) })
    else if (feed.local) feeds.push({ id: feed.id, name, source: 'local', settings: { path: feed.local.path } })
  }
  return feeds
}
